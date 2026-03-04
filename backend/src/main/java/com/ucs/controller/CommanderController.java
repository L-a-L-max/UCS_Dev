package com.ucs.controller;

import com.ucs.dto.*;
import com.ucs.entity.Drone;
import com.ucs.repository.DroneRepository;
import com.ucs.security.UserPrincipal;
import com.ucs.service.PermissionService;
import com.ucs.service.RedisService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Commander-level controller for global drone management.
 * Only accessible by COMMANDER role.
 * 
 * Provides:
 * - Permission transfer (with Redis distributed lock)
 * - Global drone overview
 * - Partition management
 */
@RestController
@RequestMapping("/api/v1/commander")
@Tag(name = "Commander", description = "Commander Global Management API")
public class CommanderController {
    
    private final PermissionService permissionService;
    private final RedisService redisService;
    private final DroneRepository droneRepository;
    
    public CommanderController(PermissionService permissionService,
                                RedisService redisService,
                                DroneRepository droneRepository) {
        this.permissionService = permissionService;
        this.redisService = redisService;
        this.droneRepository = droneRepository;
    }
    
    /**
     * Transfer drone control permission to another user.
     * Uses Redis distributed lock for strong consistency.
     */
    @PostMapping("/permission/transfer")
    @Operation(summary = "Transfer drone control permission (with distributed lock)")
    public ApiResponse<Map<String, Object>> transferPermission(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestBody PermissionTransferRequest request) {
        try {
            List<String> successList = permissionService.batchTransferPermission(
                    request.getUavIds(),
                    request.getToUserId(),
                    principal.getUserId(),
                    principal.getUsername());
            
            List<String> failedList = request.getUavIds().stream()
                    .filter(id -> !successList.contains(id))
                    .collect(Collectors.toList());
            
            return ApiResponse.success(Map.of(
                    "transferred", successList,
                    "failed", failedList,
                    "total", request.getUavIds().size()
            ));
        } catch (Exception e) {
            return ApiResponse.error(-1, "Permission transfer failed: " + e.getMessage());
        }
    }
    
    /**
     * Get current controller for a drone.
     */
    @GetMapping("/permission/{uavId}")
    @Operation(summary = "Get current controller for a drone")
    public ApiResponse<Map<String, Object>> getController(@PathVariable String uavId) {
        Long controllerId = permissionService.getCurrentController(uavId);
        return ApiResponse.success(Map.of(
                "uavId", uavId,
                "controllerId", controllerId != null ? controllerId : -1
        ));
    }
    
    /**
     * Get global drone fleet overview.
     */
    @GetMapping("/fleet/overview")
    @Operation(summary = "Get global drone fleet overview")
    public ApiResponse<Map<String, Object>> getFleetOverview() {
        List<Drone> allDrones = droneRepository.findAll();
        
        long totalDrones = allDrones.size();
        long onlineDrones = allDrones.stream()
                .filter(d -> d.getUavId() != null && redisService.isDroneOnline(d.getUavId()))
                .count();
        
        List<Map<String, Object>> droneList = allDrones.stream()
                .map(drone -> {
                    boolean online = drone.getUavId() != null && redisService.isDroneOnline(drone.getUavId());
                    Long controller = drone.getUavId() != null ? redisService.getDroneController(drone.getUavId()) : null;
                    return Map.<String, Object>of(
                            "id", drone.getId(),
                            "uavId", drone.getUavId() != null ? drone.getUavId() : "",
                            "droneSn", drone.getDroneSn(),
                            "model", drone.getModel() != null ? drone.getModel() : "",
                            "online", online,
                            "controllerId", controller != null ? controller : -1
                    );
                })
                .collect(Collectors.toList());
        
        return ApiResponse.success(Map.of(
                "totalDrones", totalDrones,
                "onlineDrones", onlineDrones,
                "offlineDrones", totalDrones - onlineDrones,
                "drones", droneList
        ));
    }
}
