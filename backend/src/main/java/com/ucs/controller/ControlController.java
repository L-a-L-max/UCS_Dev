package com.ucs.controller;

import com.ucs.dto.*;
import com.ucs.security.UserPrincipal;
import com.ucs.service.ControlService;
import com.ucs.service.RedisService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Controller for drone control commands via Zenoh network.
 * 
 * All commands are mapped to PX4 standard DDS topics:
 * - Commands → {uavId}/fmu/in/vehicle_command
 * - Trajectory → {uavId}/fmu/in/trajectory_setpoint
 * 
 * Requires PILOT, LEADER, or COMMANDER role.
 */
@RestController
@RequestMapping("/api/v1/control")
@Tag(name = "Control", description = "Drone Control Command API (Zenoh)")
public class ControlController {
    
    private final ControlService controlService;
    private final RedisService redisService;
    
    public ControlController(ControlService controlService, RedisService redisService) {
        this.controlService = controlService;
        this.redisService = redisService;
    }
    
    /**
     * Send a single control command to a drone.
     * The command is validated, published to Zenoh, and logged.
     */
    @PostMapping("/command")
    @Operation(summary = "Send control command to a drone via Zenoh")
    public ApiResponse<ControlCommandResponse> sendCommand(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestBody ControlCommandRequest request) {
        try {
            ControlCommandResponse response = controlService.sendControlCommand(
                    request, principal.getUserId(), principal.getUsername());
            
            if ("ACCEPTED".equals(response.getStatus())) {
                return ApiResponse.success(response);
            } else {
                return ApiResponse.error(-1, response.getMessage());
            }
        } catch (Exception e) {
            return ApiResponse.error(-1, "Failed to send command: " + e.getMessage());
        }
    }
    
    /**
     * Send batch control commands to multiple drones.
     */
    @PostMapping("/batch-command")
    @Operation(summary = "Send batch control commands to multiple drones")
    public ApiResponse<Map<String, Object>> batchCommand(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestBody BatchControlCommandRequest request) {
        try {
            List<String> successList = new ArrayList<>();
            List<String> failedList = new ArrayList<>();
            
            for (String uavId : request.getUavIds()) {
                ControlCommandRequest singleRequest = new ControlCommandRequest();
                singleRequest.setUavId(uavId);
                singleRequest.setCommandType(request.getCommandType());
                singleRequest.setParams(request.getParams());
                singleRequest.setConfirmed(request.getConfirmed());
                
                ControlCommandResponse response = controlService.sendControlCommand(
                        singleRequest, principal.getUserId(), principal.getUsername());
                
                if ("ACCEPTED".equals(response.getStatus())) {
                    successList.add(uavId);
                } else {
                    failedList.add(uavId);
                }
            }
            
            // Log batch operation as a single aggregate entry visible in leader/commander logs
            String batchDetail = String.format("批量%s: 共%d架, 成功%d架[%s], 失败%d架%s",
                    request.getCommandType(),
                    request.getUavIds().size(),
                    successList.size(), String.join(",", successList),
                    failedList.size(), failedList.isEmpty() ? "" : "[" + String.join(",", failedList) + "]");
            controlService.logBatchOperation(
                    principal.getUserId(), principal.getUsername(),
                    request.getCommandType(), request.getUavIds(),
                    successList, failedList, batchDetail);
            
            return ApiResponse.success(Map.of(
                    "success", successList,
                    "failed", failedList,
                    "total", request.getUavIds().size()
            ));
        } catch (Exception e) {
            return ApiResponse.error(-1, "Batch command failed: " + e.getMessage());
        }
    }
    
    /**
     * Check drone online status (via Redis heartbeat).
     */
    @GetMapping("/status/{uavId}")
    @Operation(summary = "Check drone online status")
    public ApiResponse<Map<String, Object>> getDroneStatus(
            @PathVariable String uavId) {
        boolean isOnline = redisService.isDroneOnline(uavId);
        Long controllerId = redisService.getDroneController(uavId);
        
        return ApiResponse.success(Map.of(
                "uavId", uavId,
                "online", isOnline,
                "controllerId", controllerId != null ? controllerId : -1
        ));
    }
}
