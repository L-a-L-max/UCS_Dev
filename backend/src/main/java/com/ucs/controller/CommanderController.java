package com.ucs.controller;

import com.ucs.dto.*;
import com.ucs.entity.*;
import com.ucs.repository.*;
import com.ucs.security.UserPrincipal;
import com.ucs.service.PermissionService;
import com.ucs.service.RedisService;
import com.ucs.service.impl.TeamServiceImpl;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.*;
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
    private final DroneOwnershipRepository droneOwnershipRepository;
    private final TeamDroneMapRepository teamDroneMapRepository;
    private final TeamRepository teamRepository;
    private final UserRepository userRepository;
    private final TeamServiceImpl teamService;
    
    public CommanderController(PermissionService permissionService,
                                RedisService redisService,
                                DroneRepository droneRepository,
                                DroneOwnershipRepository droneOwnershipRepository,
                                TeamDroneMapRepository teamDroneMapRepository,
                                TeamRepository teamRepository,
                                UserRepository userRepository,
                                TeamServiceImpl teamService) {
        this.permissionService = permissionService;
        this.redisService = redisService;
        this.droneRepository = droneRepository;
        this.droneOwnershipRepository = droneOwnershipRepository;
        this.teamDroneMapRepository = teamDroneMapRepository;
        this.teamRepository = teamRepository;
        this.userRepository = userRepository;
        this.teamService = teamService;
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
     * Enhanced: includes team info, owner name, and controller name for each drone.
     */
    @GetMapping("/fleet/overview")
    @Operation(summary = "Get global drone fleet overview with team/owner/controller details")
    public ApiResponse<Map<String, Object>> getFleetOverview() {
        List<Drone> allDrones = droneRepository.findAll();
        
        long totalDrones = allDrones.size();
        long onlineDrones = allDrones.stream()
                .filter(d -> d.getUavId() != null && redisService.isDroneOnline(d.getUavId()))
                .count();
        
        // Build team mapping: droneId -> teamName
        List<Team> allTeams = teamRepository.findAll();
        Map<Long, String> droneTeamMap = new HashMap<>();
        for (Team team : allTeams) {
            List<Long> teamDroneIds = teamDroneMapRepository.findDroneIdsByTeamId(team.getId());
            for (Long droneId : teamDroneIds) {
                droneTeamMap.put(droneId, team.getTeamName());
            }
        }
        
        List<Map<String, Object>> droneList = allDrones.stream()
                .map(drone -> {
                    boolean online = drone.getUavId() != null && redisService.isDroneOnline(drone.getUavId());
                    Long controllerId = drone.getUavId() != null ? redisService.getDroneController(drone.getUavId()) : null;
                    
                    Map<String, Object> info = new HashMap<>();
                    info.put("id", drone.getId());
                    info.put("uavId", drone.getUavId() != null ? drone.getUavId() : "");
                    info.put("droneSn", drone.getDroneSn());
                    info.put("model", drone.getModel() != null ? drone.getModel() : "");
                    info.put("online", online);
                    info.put("controllerId", controllerId != null ? controllerId : -1);
                    
                    // Add team info
                    String teamName = droneTeamMap.getOrDefault(drone.getId(), "未分配队伍");
                    info.put("teamName", teamName);
                    
                    // Add owner info (from drone_ownership)
                    droneOwnershipRepository.findActiveByDroneId(drone.getId()).ifPresentOrElse(
                            ownership -> {
                                info.put("ownerId", ownership.getUserId());
                                userRepository.findById(ownership.getUserId()).ifPresent(user ->
                                        info.put("ownerName", user.getRealName() != null ? user.getRealName() : user.getUsername()));
                            },
                            () -> {
                                info.put("ownerId", -1);
                                info.put("ownerName", "未分配");
                            }
                    );
                    
                    // Add controller name
                    if (controllerId != null) {
                        userRepository.findById(controllerId).ifPresent(user ->
                                info.put("controllerName", user.getRealName() != null ? user.getRealName() : user.getUsername()));
                    } else {
                        info.put("controllerName", "无");
                    }
                    
                    return info;
                })
                .collect(Collectors.toList());
        
        return ApiResponse.success(Map.of(
                "totalDrones", totalDrones,
                "onlineDrones", onlineDrones,
                "offlineDrones", totalDrones - onlineDrones,
                "drones", droneList
        ));
    }
    
    /**
     * Transfer drone control to a team (not just a user).
     * Issue #4: Permission transfer should target teams, not just users.
     * Drone is assigned to team leader automatically.
     */
    @PostMapping("/permission/transfer-to-team")
    @Operation(summary = "Transfer drone control to a team (assigns to team leader)")
    public ApiResponse<Map<String, Object>> transferPermissionToTeam(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestBody Map<String, Object> request) {
        try {
            @SuppressWarnings("unchecked")
            List<String> uavIds = (List<String>) request.get("uavIds");
            Long toTeamId = Long.valueOf(request.get("toTeamId").toString());
            
            List<String> successList = permissionService.batchTransferPermissionToTeam(
                    uavIds, toTeamId, principal.getUserId(), principal.getUsername());
            
            List<String> failedList = uavIds.stream()
                    .filter(id -> !successList.contains(id))
                    .collect(Collectors.toList());
            
            return ApiResponse.success(Map.of(
                    "transferred", successList,
                    "failed", failedList,
                    "total", uavIds.size()
            ));
        } catch (Exception e) {
            return ApiResponse.error(-1, "Team transfer failed: " + e.getMessage());
        }
    }
    
    /**
     * Get all teams with status information for commander team management.
     * Fixes Issue #2: Commander role sees "暂无团队数据".
     */
    @GetMapping("/teams")
    @Operation(summary = "Get all teams with status info")
    public ApiResponse<List<TeamInfoDTO>> getAllTeams() {
        List<TeamInfoDTO> teams = teamService.getAllTeams();
        return ApiResponse.success(teams);
    }
}
