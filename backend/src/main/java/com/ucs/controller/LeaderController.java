package com.ucs.controller;

import com.ucs.dto.*;
import com.ucs.entity.OperationLog;
import com.ucs.entity.Task;
import com.ucs.entity.TeamMember;
import com.ucs.entity.User;
import com.ucs.repository.TeamMemberRepository;
import com.ucs.security.UserPrincipal;
import com.ucs.service.*;
import org.springframework.data.domain.Page;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1/leader")
public class LeaderController {
    
    private final DroneService droneService;
    private final TaskService taskService;
    private final TeamService teamService;
    private final UserService userService;
    private final OperationLogService operationLogService;
    private final PermissionService permissionService;
    private final TeamMemberRepository teamMemberRepository;
    
    public LeaderController(DroneService droneService,
                           TaskService taskService,
                           TeamService teamService,
                           UserService userService,
                           OperationLogService operationLogService,
                           PermissionService permissionService,
                           TeamMemberRepository teamMemberRepository) {
        this.droneService = droneService;
        this.taskService = taskService;
        this.teamService = teamService;
        this.userService = userService;
        this.operationLogService = operationLogService;
        this.permissionService = permissionService;
        this.teamMemberRepository = teamMemberRepository;
    }
    
    @GetMapping("/uav/list")
    public ApiResponse<List<DroneStatusDTO>> getTeamUavList(@AuthenticationPrincipal UserPrincipal principal) {
        User user = userService.getUserById(principal.getUserId());
        if (user.getTeamId() == null) {
            return ApiResponse.error(-1, "User is not in a team");
        }
        List<DroneStatusDTO> drones = droneService.getDronesByTeamId(user.getTeamId());
        return ApiResponse.success(drones);
    }
    
    @GetMapping("/member/list")
    public ApiResponse<List<TeamMemberDTO>> getMemberList(@AuthenticationPrincipal UserPrincipal principal) {
        User user = userService.getUserById(principal.getUserId());
        if (user.getTeamId() == null) {
            return ApiResponse.error(-1, "User is not in a team");
        }
        List<TeamMemberDTO> members = teamService.getTeamMembers(user.getTeamId());
        return ApiResponse.success(members);
    }
    
    @PostMapping("/uav/assign")
    public ApiResponse<Object> assignUav(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestBody AssignDroneRequest request) {
        try {
            List<Long> droneIds = request.getUavIds().stream()
                    .map(droneService::parseDroneId)
                    .collect(Collectors.toList());
            
            Long targetUserId;
            String userId = request.getUserId();
            if (userId.startsWith("U")) {
                targetUserId = Long.parseLong(userId.substring(1));
            } else {
                targetUserId = Long.parseLong(userId);
            }
            
            droneService.assignDronesToUser(droneIds, targetUserId, principal.getUserId());
            return ApiResponse.success("assigned", null);
        } catch (Exception e) {
            return ApiResponse.error(-1, e.getMessage());
        }
    }
    
    @PostMapping("/uav/batch-command")
    public ApiResponse<Object> batchCommand(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestBody BatchCommandRequest request) {
        try {
            if (request.getTaskName() != null) {
                CreateTaskRequest taskRequest = new CreateTaskRequest();
                taskRequest.setTaskName(request.getTaskName());
                taskRequest.setTaskType(request.getTaskType());
                taskRequest.setAssignedDroneIds(request.getUavIds());
                Task task = taskService.createTask(taskRequest, principal.getUserId());
                return ApiResponse.success("batch command accepted", 
                        Map.of("taskId", "TASK_" + String.format("%02d", task.getId())));
            }
            
            for (String uavId : request.getUavIds()) {
                Long droneId = droneService.parseDroneId(uavId);
                droneService.sendCommand(droneId, principal.getUserId(), 
                        request.getCommandType(), request.getPayload());
            }
            return ApiResponse.success("batch command accepted", null);
        } catch (Exception e) {
            return ApiResponse.error(-1, e.getMessage());
        }
    }
    
    @GetMapping("/team/info")
    public ApiResponse<TeamInfoDTO> getTeamInfo(@AuthenticationPrincipal UserPrincipal principal) {
        User user = userService.getUserById(principal.getUserId());
        if (user.getTeamId() == null) {
            return ApiResponse.error(-1, "User is not in a team");
        }
        TeamInfoDTO teamInfo = teamService.getTeamInfo(user.getTeamId());
        return ApiResponse.success(teamInfo);
    }
    
    @PostMapping("/task/create")
    public ApiResponse<Object> createTask(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestBody CreateTaskRequest request) {
        try {
            Task task = taskService.createTask(request, principal.getUserId());
            return ApiResponse.success("task created", 
                    Map.of("taskId", "TASK_" + String.format("%02d", task.getId())));
        } catch (Exception e) {
            return ApiResponse.error(-1, e.getMessage());
        }
    }
    
    /**
     * Get team-scoped operation logs (only logs from team members).
     * Issue #7: Team leader interface needs team-filtered logs.
     */
    @GetMapping("/team/logs")
    public ApiResponse<Map<String, Object>> getTeamLogs(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size) {
        User user = userService.getUserById(principal.getUserId());
        if (user.getTeamId() == null) {
            return ApiResponse.error(-1, "用户未分配到任何队伍");
        }

        // Get all team member user IDs
        List<TeamMember> members = teamMemberRepository.findByTeamId(user.getTeamId());
        List<Long> memberUserIds = members.stream()
                .map(TeamMember::getUserId)
                .collect(Collectors.toList());

        // Fetch logs for team members
        Page<OperationLog> logs = operationLogService.getLogsByUserIds(memberUserIds, page, size);

        Map<String, Object> result = new HashMap<>();
        result.put("content", logs.getContent().stream()
                .map(operationLogService::toDTO)
                .collect(Collectors.toList()));
        result.put("totalElements", logs.getTotalElements());
        result.put("totalPages", logs.getTotalPages());
        result.put("currentPage", logs.getNumber());
        result.put("pageSize", logs.getSize());

        return ApiResponse.success(result);
    }
    
    /**
     * Transfer drone control within team (leader → team member).
     * Issue #7: Team leader needs drone control transfer functionality.
     */
    @PostMapping("/uav/transfer")
    public ApiResponse<Map<String, Object>> transferWithinTeam(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestBody PermissionTransferRequest request) {
        // 获取当前用户的队伍ID（优先从User.teamId获取，如果为空则从TeamMember表查找）
        User user = userService.getUserById(principal.getUserId());
        Long operatorTeamId = user.getTeamId();
        if (operatorTeamId == null) {
            // 后备方案：从TeamMember表查找用户所在队伍
            List<TeamMember> operatorMemberships = teamMemberRepository.findByUserId(principal.getUserId());
            if (!operatorMemberships.isEmpty()) {
                operatorTeamId = operatorMemberships.get(0).getTeamId();
            }
        }
        if (operatorTeamId == null) {
            return ApiResponse.error(-1, "用户未分配到任何队伍");
        }

        // 验证目标用户是否在同一队伍中
        Long targetUserId = request.getToUserId();
        if (targetUserId == null) {
            return ApiResponse.error(-1, "未指定目标用户");
        }
        boolean targetInTeam = teamMemberRepository.findByTeamIdAndUserId(operatorTeamId, targetUserId).isPresent();
        if (!targetInTeam) {
            // 额外检查：目标用户是否在TeamMember表中与当前用户同队
            List<TeamMember> targetMemberships = teamMemberRepository.findByUserId(targetUserId);
            final Long finalTeamId = operatorTeamId;
            targetInTeam = targetMemberships.stream()
                    .anyMatch(tm -> tm.getTeamId().equals(finalTeamId));
        }
        if (!targetInTeam) {
            return ApiResponse.error(-1, "目标用户不在当前队伍中");
        }

        // 执行转移
        List<String> successList = permissionService.batchTransferPermission(
                request.getUavIds(),
                targetUserId,
                principal.getUserId(),
                principal.getUsername());

        List<String> failedList = request.getUavIds().stream()
                .filter(id -> !successList.contains(id))
                .collect(Collectors.toList());

        Map<String, Object> result = new HashMap<>();
        result.put("transferred", successList);
        result.put("failed", failedList);
        result.put("total", request.getUavIds().size());

        return ApiResponse.success(result);
    }
}
