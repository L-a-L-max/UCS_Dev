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
 * Validates permissions and logs operations.
 * 
 * Control flow:
 * 1. Validate user has control permission for the drone (via DroneOwnership)
 * 2. Check drone is online (via Redis heartbeat)
 * 3. Log command to command_log table
 * 4. Log operation to operation_log table
 * 
 * Note: Actual DDS command publishing is deferred to future implementation.
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
    
    /**
     * Send a control command to a drone.
     * Currently logs the command; actual DDS publishing deferred.
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
            log.warn("Drone {} is offline, command will be queued/rejected", uavId);
        }
        
        // 4. Log to command_log table (actual DDS publish deferred)
        CommandLog cmdLog = new CommandLog();
        cmdLog.setDroneId(drone.getId());
        cmdLog.setUserId(userId);
        cmdLog.setCommandType(commandType);
        cmdLog.setPayload(request.getParams());
        cmdLog.setStatus("PENDING");
        commandLogRepository.save(cmdLog);
        
        // 5. Log to operation_log table
        String detail = buildHumanReadableDetail(commandType, uavId);
        
        operationLogService.logSuccess(userId, username, "CONTROL_COMMAND",
                drone.getId(), uavId, detail);
        
        log.info("Control command logged: {} -> {} (DDS publish deferred)", commandType, uavId);
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
