package com.ucs.service;

import com.ucs.dto.ControlCommandRequest;
import com.ucs.dto.ControlCommandResponse;
import com.ucs.entity.CommandLog;
import com.ucs.entity.Drone;
import com.ucs.repository.CommandLogRepository;
import com.ucs.repository.DroneOwnershipRepository;
import com.ucs.repository.DroneRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;

/**
 * Service for handling drone control commands.
 * Validates permissions, publishes to DDS via gateway, and logs operations.
 * 
 * Control flow:
 * 1. Validate user has control permission for the drone (via DroneOwnership)
 * 2. Check drone is online (via Redis heartbeat)
 * 3. Publish command to DDS gateway (which forwards to PX4 via ROS2)
 * 4. Log command to command_log table
 * 5. Log operation to operation_log table
 * 
 * DDS command publishing is handled by the DDS gateway (Python/rclpy) which
 * exposes a REST API on port 5050 for receiving commands from this service.
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
        
        // 5. Publish command to DDS gateway
        boolean published = ddsCommandService.sendCommand(uavId, commandType, request.getParams());
        
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
            case "TAKEOFF" -> "起飞无人机 " + uavId;
            case "LAND" -> "降落无人机 " + uavId;
            case "RTL" -> "无人机 " + uavId + " 返航";
            case "HOLD" -> "无人机 " + uavId + " 悬停";
            case "GOTO" -> "无人机 " + uavId + " 飞向目标位置";
            default -> "执行指令 " + commandType + " 于无人机 " + uavId;
        };
    }
}
