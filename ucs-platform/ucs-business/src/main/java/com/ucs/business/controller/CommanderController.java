package com.ucs.business.controller;

import com.ucs.business.dto.*;
import com.ucs.business.entity.*;
import com.ucs.business.repository.*;
import com.ucs.business.security.UserPrincipal;
import com.ucs.business.service.PermissionService;
import com.ucs.business.service.RedisService;
import com.ucs.business.service.impl.TeamServiceImpl;
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
    private final TeamMemberRepository teamMemberRepository;
    private final UserRepository userRepository;
    private final UserRoleMapRepository userRoleMapRepository;
    private final TeamRoleRepository teamRoleRepository;
    private final TeamServiceImpl teamService;
    private final UavLatestStateRepository uavLatestStateRepository;
    
    public CommanderController(PermissionService permissionService,
                                RedisService redisService,
                                DroneRepository droneRepository,
                                DroneOwnershipRepository droneOwnershipRepository,
                                TeamDroneMapRepository teamDroneMapRepository,
                                TeamRepository teamRepository,
                                TeamMemberRepository teamMemberRepository,
                                UserRepository userRepository,
                                UserRoleMapRepository userRoleMapRepository,
                                TeamRoleRepository teamRoleRepository,
                                TeamServiceImpl teamService,
                                UavLatestStateRepository uavLatestStateRepository) {
        this.permissionService = permissionService;
        this.redisService = redisService;
        this.droneRepository = droneRepository;
        this.droneOwnershipRepository = droneOwnershipRepository;
        this.teamDroneMapRepository = teamDroneMapRepository;
        this.teamRepository = teamRepository;
        this.teamMemberRepository = teamMemberRepository;
        this.userRepository = userRepository;
        this.userRoleMapRepository = userRoleMapRepository;
        this.teamRoleRepository = teamRoleRepository;
        this.teamService = teamService;
        this.uavLatestStateRepository = uavLatestStateRepository;
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
        
        // Build uavId -> UavLatestState map for telemetry data
        List<UavLatestState> latestStates = uavLatestStateRepository.findAllByOrderByUavIdAsc();
        Map<String, UavLatestState> stateMap = new HashMap<>();
        for (UavLatestState state : latestStates) {
            stateMap.put(state.getUavId(), state);
        }
        
        long totalDrones = allDrones.size();
        long onlineDrones = allDrones.stream()
                .filter(d -> d.getUavId() != null && redisService.isDroneOnline(d.getUavId()))
                .count();
        
        // Build team mapping: droneId -> teamId, droneId -> teamName
        List<Team> allTeams = teamRepository.findAll();
        Map<Long, String> droneTeamMap = new HashMap<>();
        Map<Long, Long> droneTeamIdMap = new HashMap<>();
        for (Team team : allTeams) {
            List<Long> teamDroneIds = teamDroneMapRepository.findDroneIdsByTeamId(team.getId());
            for (Long droneId : teamDroneIds) {
                droneTeamMap.put(droneId, team.getTeamName());
                droneTeamIdMap.put(droneId, team.getId());
            }
        }
        
        // Build team leader mapping: teamId -> leader realName
        // Use teamRoleRepository.findById instead of lazy tm.getTeamRole() to avoid
        // LazyInitializationException (findByTeamIdWithUser only fetches user, not teamRole)
        Map<Long, String> teamLeaderMap = new HashMap<>();
        for (Team team : allTeams) {
            List<TeamMember> members = teamMemberRepository.findByTeamIdWithUser(team.getId());
            for (TeamMember tm : members) {
                if (tm.getTeamRoleId() != null) {
                    teamRoleRepository.findById(tm.getTeamRoleId()).ifPresent(teamRole -> {
                        if ("Leader".equalsIgnoreCase(teamRole.getRoleName())) {
                            User leaderUser = tm.getUser();
                            if (leaderUser != null) {
                                teamLeaderMap.put(team.getId(), leaderUser.getRealName() != null ? leaderUser.getRealName() : leaderUser.getUsername());
                            }
                        }
                    });
                }
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
                    info.put("onlineStatus", online);
                    info.put("controllerId", controllerId != null ? controllerId : -1);
                    
                    // Add telemetry data from uav_latest_state (populated by Kafka consumer)
                    UavLatestState telemetry = drone.getUavId() != null ? stateMap.get(drone.getUavId()) : null;
                    if (telemetry != null) {
                        info.put("lat", telemetry.getLat() != null ? telemetry.getLat() : 0.0);
                        info.put("lng", telemetry.getLon() != null ? telemetry.getLon() : 0.0);
                        info.put("altitude", telemetry.getAlt() != null ? telemetry.getAlt() : 0.0);
                        info.put("heading", telemetry.getHeading() != null ? telemetry.getHeading() : 0f);
                        info.put("flightStatus", Boolean.TRUE.equals(telemetry.getIsActive()) ? "FLYING" : "IDLE");
                        info.put("battery", -1); // No battery data in uav_latest_state yet
                        info.put("lastHeartbeat", telemetry.getLastUpdate() != null ? telemetry.getLastUpdate().toString() : "");
                    } else {
                        info.put("lat", 0.0);
                        info.put("lng", 0.0);
                        info.put("altitude", 0.0);
                        info.put("heading", 0f);
                        info.put("flightStatus", "OFFLINE");
                        info.put("battery", -1);
                        info.put("lastHeartbeat", "");
                    }
                    
                    // Add team info
                    String teamName = droneTeamMap.getOrDefault(drone.getId(), "未分配队伍");
                    info.put("teamName", teamName);
                    
                    // Add team leader name
                    Long teamId = droneTeamIdMap.get(drone.getId());
                    info.put("teamLeader", teamId != null ? teamLeaderMap.getOrDefault(teamId, "未知") : "未分配队伍");
                    
                    // Add owner info (from drone_ownership)
                    droneOwnershipRepository.findActiveByDroneId(drone.getId()).ifPresentOrElse(
                            ownership -> {
                                info.put("ownerId", ownership.getUserId());
                                userRepository.findById(ownership.getUserId()).ifPresent(user ->
                                        info.put("owner", user.getRealName() != null ? user.getRealName() : user.getUsername()));
                            },
                            () -> {
                                info.put("ownerId", -1);
                                info.put("owner", "未分配");
                            }
                    );
                    
                    // Add actual controller name (controlOwnerName for frontend)
                    if (controllerId != null) {
                        userRepository.findById(controllerId).ifPresent(user ->
                                info.put("controlOwnerName", user.getRealName() != null ? user.getRealName() : user.getUsername()));
                    } else {
                        // Fallback: use owner as controller
                        info.putIfAbsent("controlOwnerName", info.getOrDefault("owner", "无"));
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
    
    /**
     * Get all registered users for commander's permission transfer dropdown.
     * Returns user id, username, realName, and role for selection.
     */
    @GetMapping("/users")
    @Operation(summary = "Get all registered users for permission transfer dropdown")
    public ApiResponse<List<Map<String, Object>>> getAllUsers() {
        List<User> users = userRepository.findAll();
        List<Map<String, Object>> userList = users.stream()
                .map(user -> {
                    Map<String, Object> info = new HashMap<>();
                    info.put("userId", user.getId());
                    info.put("username", user.getUsername());
                    info.put("realName", user.getRealName() != null ? user.getRealName() : user.getUsername());
                    // Get roles via UserRoleMap
                    List<UserRoleMap> roleMaps = userRoleMapRepository.findByUserIdWithRole(user.getId());
                    String roles = roleMaps.stream()
                            .map(urm -> urm.getRole().getRoleName())
                            .collect(Collectors.joining(", "));
                    info.put("role", roles);
                    return info;
                })
                .collect(Collectors.toList());
        return ApiResponse.success(userList);
    }
}
