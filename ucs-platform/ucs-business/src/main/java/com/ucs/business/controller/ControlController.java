package com.ucs.business.controller;

import com.ucs.business.dto.*;
import com.ucs.business.security.UserPrincipal;
import com.ucs.business.service.ControlService;
import com.ucs.business.service.RedisService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
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
            @Valid @RequestBody ControlCommandRequest request) {
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
            @Valid @RequestBody BatchControlCommandRequest request) {
        try {
            List<String> successList = new ArrayList<>();
            List<String> failedList = new ArrayList<>();
            
            // Parse formation parameters for GOTO / ORBIT / RTL
            String paramsStr = request.getParams();
            String cmdType = request.getCommandType();
            boolean isFormation = false;
            double baseLat = 0, baseLon = 0, baseAlt = 50;
            double baseRadius = 5;
            double droneArea = 6.25; // 2.5m x 2.5m per drone
            boolean isGoto = "GOTO".equalsIgnoreCase(cmdType);
            boolean isOrbit = "ORBIT".equalsIgnoreCase(cmdType);
            boolean isRtl = "RTL".equalsIgnoreCase(cmdType);
            
            if ((isGoto || isOrbit || isRtl) && paramsStr != null) {
                try {
                    var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                    var json = mapper.readTree(paramsStr);
                    if (json.has("formation") && json.get("formation").asBoolean()) {
                        isFormation = true;
                        baseLat = json.has("lat") ? json.get("lat").asDouble() : 0;
                        baseLon = json.has("lon") ? json.get("lon").asDouble() : 0;
                        baseAlt = json.has("alt") ? json.get("alt").asDouble() : 50;
                        baseRadius = json.has("radius") ? json.get("radius").asDouble() : 5;
                        droneArea = json.has("droneArea") ? json.get("droneArea").asDouble() : 6.25;
                    }
                } catch (Exception e) {
                    // Fall through to non-formation handling
                }
            }
            
            // Calculate formation grid offsets if needed (for GOTO / RTL with target point)
            double[][] offsets = null;
            if (isFormation && (isGoto || isRtl)) {
                int n = request.getUavIds().size();
                double spacing = Math.sqrt(droneArea); // 2.5m for 6.25m²
                int cols = (int) Math.ceil(Math.sqrt(n));
                int rows = (int) Math.ceil((double) n / cols);
                offsets = new double[n][2]; // [lat_offset, lon_offset] in degrees
                double cosLat = Math.cos(Math.toRadians(baseLat));
                for (int i = 0; i < n; i++) {
                    int row = i / cols;
                    int col = i % cols;
                    double rowOffset = (row - (rows - 1) / 2.0) * spacing; // meters north
                    double colOffset = (col - (cols - 1) / 2.0) * spacing; // meters east
                    offsets[i][0] = rowOffset / 111320.0; // delta lat in degrees
                    offsets[i][1] = colOffset / (111320.0 * cosLat); // delta lon in degrees
                }
            }
            
            // For ORBIT formation: each drone gets a different radius to avoid collision
            // Drone 0 uses baseRadius, drone 1 uses baseRadius + spacing, etc.
            double orbitSpacing = isFormation && isOrbit ? Math.sqrt(droneArea) : 0;
            
            for (int i = 0; i < request.getUavIds().size(); i++) {
                String uavId = request.getUavIds().get(i);
                ControlCommandRequest singleRequest = new ControlCommandRequest();
                singleRequest.setUavId(uavId);
                singleRequest.setCommandType(request.getCommandType());
                singleRequest.setConfirmed(request.getConfirmed());
                
                if (isFormation && (isGoto || isRtl) && offsets != null) {
                    // Formation GOTO / RTL: each drone gets offset coordinates in a grid
                    double droneLat = baseLat + offsets[i][0];
                    double droneLon = baseLon + offsets[i][1];
                    String droneParams = String.format(
                        "{\"lat\":%.8f,\"lon\":%.8f,\"alt\":%.1f}",
                        droneLat, droneLon, baseAlt);
                    singleRequest.setParams(droneParams);
                } else if (isFormation && isOrbit) {
                    // Formation ORBIT: each drone gets a different radius (stacked orbits)
                    double droneRadius = baseRadius + (i * orbitSpacing);
                    String droneParams = String.format(
                        "{\"lat\":%.8f,\"lon\":%.8f,\"radius\":%.2f,\"alt\":%.1f}",
                        baseLat, baseLon, droneRadius, baseAlt);
                    singleRequest.setParams(droneParams);
                } else {
                    singleRequest.setParams(request.getParams());
                }
                
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
    
    /**
     * Get cached Home position for a drone from Redis.
     * Returns the lat/lon/alt that was last set via MARK_HOME or TAKEOFF.
     * Used to sync Home position across PilotView and LeaderView.
     */
    @GetMapping("/home/{uavId}")
    @Operation(summary = "Get drone Home position from Redis cache")
    public ApiResponse<Map<String, Object>> getDroneHome(
            @PathVariable String uavId) {
        double[] home = redisService.getDroneHome(uavId);
        if (home != null && home.length == 3) {
            return ApiResponse.success(Map.of(
                    "uavId", uavId,
                    "lat", home[0],
                    "lon", home[1],
                    "alt", home[2]
            ));
        }
        return ApiResponse.success(Map.of(
                "uavId", uavId,
                "lat", 0.0,
                "lon", 0.0,
                "alt", 0.0
        ));
    }
}
