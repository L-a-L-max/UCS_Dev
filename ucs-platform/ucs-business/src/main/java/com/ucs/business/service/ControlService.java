package com.ucs.business.service;

import com.ucs.business.dto.ControlCommandRequest;
import com.ucs.business.dto.ControlCommandResponse;
import com.ucs.business.entity.CommandLog;
import com.ucs.business.entity.Drone;
import com.ucs.business.kafka.CommandKafkaProducer;
import com.ucs.business.repository.CommandLogRepository;
import com.ucs.business.repository.DroneOwnershipRepository;
import com.ucs.business.repository.DroneRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

/**
 * Service for handling drone control commands.
 * Validates permissions, publishes commands via Kafka, and logs operations.
 * 
 * [Phase 1] Control flow (Kafka-first with HTTP fallback):
 * 1. Validate user has control permission for the drone (via DroneOwnership)
 * 2. Check drone is online (via Redis heartbeat)
 * 3. Send command to Kafka commands.down topic (primary path)
 *    - Gateway consumes from commands.down and forwards to PX4 via DDS
 *    - If Kafka unavailable, falls back to direct HTTP call to Gateway
 * 4. Log command to command_log table
 * 5. Log operation to operation_log table
 * 
 * Command acknowledgments flow: PX4 -> Gateway -> Kafka(commands.ack) -> CommandKafkaConsumer -> WebSocket
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ControlService {
    
    private final DroneRepository droneRepository;
    private final DroneOwnershipRepository droneOwnershipRepository;
    private final CommandLogRepository commandLogRepository;
    private final RedisService redisService;
    private final OperationLogService operationLogService;
    private final DdsCommandService ddsCommandService;
    private final DDSSimulatorService ddsSimulatorService;

    /** Kafka 指令生产者（可选，Kafka 未启用时为 null） */
    @Autowired(required = false)
    private CommandKafkaProducer commandKafkaProducer;
    
    /**
     * Send a control command to a drone.
     * Publishes to DDS gateway and logs the operation.
     */
    @Transactional
    public ControlCommandResponse sendControlCommand(ControlCommandRequest request,
                                                       Long userId, String username) {
        String uavId = request.getUavId();
        String commandType = request.getCommandType();
        
        // 1. Find the drone by uavId
        Optional<Drone> droneOpt = droneRepository.findByUavId(uavId);
        if (droneOpt.isEmpty()) {
            operationLogService.logFailure(userId, username, "CONTROL_COMMAND",
                    null, uavId, commandType, "Drone not found: " + uavId);
            return ControlCommandResponse.failed(uavId, "Drone not found: " + uavId);
        }
        Drone drone = droneOpt.get();
        
        // 2. Validate user has control permission
        boolean hasPermission = droneOwnershipRepository.findActiveByDroneId(drone.getId())
                .map(ownership -> ownership.getUserId().equals(userId))
                .orElse(false);
        
        if (!hasPermission) {
            operationLogService.logFailure(userId, username, "CONTROL_COMMAND",
                    drone.getId(), uavId, commandType, "No control permission");
            return ControlCommandResponse.failed(uavId, "No control permission for drone: " + uavId);
        }
        
        // 3. Check drone online status via Redis
        boolean isOnline = redisService.isDroneOnline(uavId);
        if (!isOnline) {
            operationLogService.logFailure(userId, username, "CONTROL_COMMAND",
                    drone.getId(), uavId, commandType, "Drone is offline");
            return ControlCommandResponse.failed(uavId, "Drone is offline: " + uavId);
        }
        
        // 4. Log to command_log table with PENDING status
        CommandLog cmdLog = new CommandLog();
        cmdLog.setDroneId(drone.getId());
        cmdLog.setUserId(userId);
        cmdLog.setCommandType(commandType);
        cmdLog.setPayload(request.getParams());
        cmdLog.setStatus("PENDING");
        commandLogRepository.save(cmdLog);
        
        // 5. Publish command: Kafka (primary) -> HTTP fallback
        boolean published = sendCommandViaKafkaOrHttp(uavId, commandType, request.getParams(),
                userId, cmdLog.getId());
        
        if (published) {
            cmdLog.setStatus("SENT");
            commandLogRepository.save(cmdLog);
            
            // Handle OFFBOARD heartbeat lifecycle
            if ("OFFBOARD".equalsIgnoreCase(commandType)) {
                ddsCommandService.startHeartbeat(uavId);
            } else if ("LAND".equalsIgnoreCase(commandType)
                    || "RTL".equalsIgnoreCase(commandType)
                    || "DISARM".equalsIgnoreCase(commandType)) {
                ddsCommandService.stopHeartbeat(uavId);
            }
            
            // Update simulator armed state so telemetry reflects the change
            if ("ARM".equalsIgnoreCase(commandType) || "TAKEOFF".equalsIgnoreCase(commandType)) {
                ddsSimulatorService.setDroneArmed(uavId, true);
            } else if ("DISARM".equalsIgnoreCase(commandType) || "LAND".equalsIgnoreCase(commandType)) {
                ddsSimulatorService.setDroneArmed(uavId, false);
            }
            
            // Save home position for MARK_HOME and TAKEOFF
            if ("MARK_HOME".equalsIgnoreCase(commandType) || "TAKEOFF".equalsIgnoreCase(commandType)) {
                try {
                    String params = request.getParams();
                    if (params != null && !params.isEmpty()) {
                        var json = new com.fasterxml.jackson.databind.ObjectMapper().readTree(params);
                        double lat = json.has("lat") ? json.get("lat").asDouble() : 0;
                        double lon = json.has("lon") ? json.get("lon").asDouble() : 0;
                        double alt = json.has("alt") ? json.get("alt").asDouble() : 0;
                        if (lat != 0 && lon != 0) {
                            drone.setLastHomeLat(lat);
                            drone.setLastHomeLon(lon);
                            drone.setLastHomeAlt(alt);
                            droneRepository.save(drone);
                            redisService.setDroneHome(uavId, lat, lon, alt);
                            log.info("Saved home for {}: lat={}, lon={}, alt={}", uavId, lat, lon, alt);
                        }
                    }
                } catch (Exception e) {
                    log.warn("Failed to parse home coords for {}: {}", uavId, e.getMessage());
                }
            }
        } else {
            cmdLog.setStatus("GATEWAY_UNREACHABLE");
            commandLogRepository.save(cmdLog);
            log.warn("DDS gateway unreachable for command {} -> {}, logged for retry", commandType, uavId);
        }
        
        // 6. Log to operation_log table
        String detail = buildHumanReadableDetail(commandType, uavId);
        operationLogService.logSuccess(userId, username, "CONTROL_COMMAND",
                drone.getId(), uavId, detail);
        
        log.info("Control command {} -> {} status={}", commandType, uavId, cmdLog.getStatus());
        return ControlCommandResponse.success("CMD_" + cmdLog.getId(), uavId);
    }
    
    /**
     * Log a batch control operation as a single aggregate entry.
     * This creates one log entry summarizing the batch command,
     * visible in leader/commander operation logs.
     */
    public void logBatchOperation(Long userId, String username,
                                   String commandType, List<String> allUavIds,
                                   List<String> successIds, List<String> failedIds,
                                   String detail) {
        String result = failedIds.isEmpty() ? "SUCCESS" : (successIds.isEmpty() ? "FAILED" : "PARTIAL");
        String errorMsg = failedIds.isEmpty() ? null : "Failed drones: " + String.join(",", failedIds);
        operationLogService.recordOperation(
                userId, username, "BATCH_CONTROL",
                null, String.join(",", allUavIds),
                null, detail, result, errorMsg, null);
        log.info("Batch {} logged: {} total, {} success, {} failed",
                commandType, allUavIds.size(), successIds.size(), failedIds.size());
    }

    /**
     * Send command via Kafka (primary) with HTTP fallback.
     * If CommandKafkaProducer is available, sends to commands.down topic.
     * Otherwise, falls back to direct HTTP call to Gateway.
     */
    private boolean sendCommandViaKafkaOrHttp(String uavId, String commandType,
                                               String params, Long userId, Long commandLogId) {
        // Try Kafka first
        if (commandKafkaProducer != null) {
            try {
                commandKafkaProducer.sendCommand(uavId, commandType, params, userId, commandLogId);
                log.info("[Command] Sent via Kafka: {} -> {} (cmdLogId={})", commandType, uavId, commandLogId);
                return true;
            } catch (Exception e) {
                log.warn("[Command] Kafka send failed, falling back to HTTP: {}", e.getMessage());
            }
        }
        // Fallback to direct HTTP
        return ddsCommandService.sendCommand(uavId, commandType, params);
    }

    /**
     * Get drone by uavId.
     */
    public Optional<Drone> getDroneByUavId(String uavId) {
        return droneRepository.findByUavId(uavId);
    }
    
    /**
     * Build human-readable operation detail.
     */
    private String buildHumanReadableDetail(String commandType, String uavId) {
        return switch (commandType.toUpperCase()) {
            case "ARM" -> "解锁无人机 " + uavId;
            case "DISARM" -> "锁定无人机 " + uavId;
            case "TAKEOFF" -> "起飞(解锁+OFFBOARD)无人机 " + uavId;
            case "LAND" -> "降落无人机 " + uavId;
            case "RTL" -> "无人机 " + uavId + " 返航";
            case "HOLD" -> "无人机 " + uavId + " 悬停";
            case "GOTO" -> "无人机 " + uavId + " 飞向目标位置";
            case "MARK_HOME" -> "设置无人机 " + uavId + " 的Home点";
            default -> "执行指令 " + commandType + " 于无人机 " + uavId;
        };
    }
}
