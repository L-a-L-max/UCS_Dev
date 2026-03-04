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
 * Validates permissions, sends commands via Zenoh, and logs operations.
 * 
 * Control flow:
 * 1. Validate user has control permission for the drone (via DroneOwnership)
 * 2. Check drone is online (via Redis heartbeat)
 * 3. Build PX4-compatible vehicle_command
 * 4. Publish to Zenoh: {uavId}/fmu/in/vehicle_command
 * 5. Log command to command_log table
 * 6. Log operation to operation_log table
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ControlService {
    
    private final DroneRepository droneRepository;
    private final DroneOwnershipRepository droneOwnershipRepository;
    private final CommandLogRepository commandLogRepository;
    private final ZenohService zenohService;
    private final RedisService redisService;
    private final OperationLogService operationLogService;
    
    /**
     * Send a control command to a drone.
     * 
     * @param request The control command request
     * @param userId  The user ID of the command sender
     * @param username The username for logging
     * @return Control command response with status
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
            // Check if user is a leader/commander (they can control team drones)
            // For now, ownership check is sufficient - leaders assign first then control
            operationLogService.logFailure(userId, username, "CONTROL_COMMAND",
                    drone.getId(), uavId, commandType, "No control permission");
            return ControlCommandResponse.failed(uavId, "No control permission for drone: " + uavId);
        }
        
        // 3. Check drone online status via Redis
        boolean isOnline = redisService.isDroneOnline(uavId);
        if (!isOnline) {
            log.warn("Drone {} is offline, command will be queued/rejected", uavId);
            // Still allow command - drone may reconnect and receive it
            // But log warning
        }
        
        // 4. Publish command to Zenoh
        boolean published = zenohService.publishCommand(uavId, commandType, request.getParams());
        
        // 5. Handle GOTO command - also publish trajectory setpoint
        if ("GOTO".equalsIgnoreCase(commandType) && request.getParams() != null) {
            try {
                com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                @SuppressWarnings("unchecked")
                java.util.Map<String, Object> params = mapper.readValue(request.getParams(), java.util.Map.class);
                double lat = ((Number) params.getOrDefault("lat", 0.0)).doubleValue();
                double lon = ((Number) params.getOrDefault("lon", 0.0)).doubleValue();
                double alt = ((Number) params.getOrDefault("alt", 100.0)).doubleValue();
                zenohService.publishTrajectorySetpoint(uavId, lat, lon, alt);
            } catch (Exception e) {
                log.warn("Failed to publish trajectory setpoint for GOTO: {}", e.getMessage());
            }
        }
        
        // 6. Log to command_log table
        CommandLog cmdLog = new CommandLog();
        cmdLog.setDroneId(drone.getId());
        cmdLog.setUserId(userId);
        cmdLog.setCommandType(commandType);
        cmdLog.setPayload(request.getParams());
        cmdLog.setStatus(published ? "SENT" : "FAILED");
        commandLogRepository.save(cmdLog);
        
        // 7. Log to operation_log table
        String detail = String.format("{\"commandType\":\"%s\",\"params\":%s,\"published\":%s}",
                commandType, request.getParams() != null ? request.getParams() : "{}",
                published);
        
        if (published) {
            operationLogService.logSuccess(userId, username, "CONTROL_COMMAND",
                    drone.getId(), uavId, detail);
            return ControlCommandResponse.success("CMD_" + cmdLog.getId(), uavId);
        } else {
            operationLogService.logFailure(userId, username, "CONTROL_COMMAND",
                    drone.getId(), uavId, detail, "Zenoh publish failed");
            return ControlCommandResponse.failed(uavId, "Failed to send command via Zenoh");
        }
    }
    
    /**
     * Get drone by uavId.
     */
    public Optional<Drone> getDroneByUavId(String uavId) {
        return droneRepository.findByUavId(uavId);
    }
}
