package com.ucs.service;

import com.ucs.dto.ControlCommandRequest;
import com.ucs.dto.ControlCommandResponse;
import com.ucs.entity.CommandLog;
import com.ucs.entity.Drone;
import com.ucs.gateway.GatewayRouter;
import com.ucs.gateway.GatewayStrategy;
import com.ucs.config.IdempotencyConfig;
import com.ucs.kafka.CommandKafkaProducer;
import com.ucs.repository.CommandLogRepository;
import com.ucs.repository.DroneOwnershipRepository;
import com.ucs.repository.DroneRepository;
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

    /** T-03: 网关路由器 — 根据 uavId 自动选择 DDS 或 MAVLink 策略 */
    private final GatewayRouter gatewayRouter;

    /** T-50: 幂等性保障（Redis SETNX 去重） */
    private final IdempotencyConfig idempotencyConfig;

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
        
        // T-50: 幂等性检查 — 同一命令 5s 内不重复执行
        if (!idempotencyConfig.tryAcquire(uavId, commandType, request.getParams())) {
            return ControlCommandResponse.success("CMD_DEDUP", uavId);
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
        
        // 5. T-03: 通过 GatewayRouter 策略模式路由命令（替代硬编码前缀检查）
        boolean published = sendCommandViaStrategy(uavId, commandType, request.getParams(),
                userId, cmdLog.getId());
        
        if (published) {
            cmdLog.setStatus("SENT");
            commandLogRepository.save(cmdLog);
            
            // T-03: 通过策略模式管理心跳（DDS/MAVLink各自处理）
            GatewayStrategy strategy = gatewayRouter.resolve(uavId);
            if ("OFFBOARD".equalsIgnoreCase(commandType)) {
                strategy.startHeartbeat(uavId);
            } else if ("LAND".equalsIgnoreCase(commandType)
                    || "RTL".equalsIgnoreCase(commandType)
                    || "DISARM".equalsIgnoreCase(commandType)) {
                strategy.stopHeartbeat(uavId);
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
     * T-03: 通过 GatewayRouter 策略模式发送命令。
     * GatewayRouter 根据 uavId 自动选择 DDS 或 MAVLink 策略，
     * 每种策略内部各自处理 Kafka 投递和 HTTP Fallback。
     */
    private boolean sendCommandViaStrategy(String uavId, String commandType,
                                            String params, Long userId, Long commandLogId) {
        GatewayStrategy strategy = gatewayRouter.resolve(uavId);
        log.info("[Command] Routing {} -> {} via {} strategy",
                commandType, uavId, strategy.getGatewayType());
        return strategy.sendCommand(uavId, commandType, params, userId, commandLogId);
    }

    /**
     * @deprecated 保留兼容 — 新代码请使用 sendCommandViaStrategy
     */
    @Deprecated
    private boolean sendCommandViaKafkaOrHttp(String uavId, String commandType,
                                               String params, Long userId, Long commandLogId) {
        return sendCommandViaStrategy(uavId, commandType, params, userId, commandLogId);
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
