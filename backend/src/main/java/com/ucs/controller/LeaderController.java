package com.ucs.controller;

import com.ucs.dto.*;
import com.ucs.entity.Task;
import com.ucs.entity.User;
import com.ucs.security.UserPrincipal;
import com.ucs.service.DroneService;
import com.ucs.service.TaskService;
import com.ucs.service.TeamService;
import com.ucs.service.UserService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1/leader")
public class LeaderController {
    
    private final DroneService droneService;
    private final TaskService taskService;
    private final TeamService teamService;
    private final UserService userService;
    
    public LeaderController(DroneService droneService,
                           TaskService taskService,
                           TeamService teamService,
                           UserService userService) {
        this.droneService = droneService;
        this.taskService = taskService;
        this.teamService = teamService;
        this.userService = userService;
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
}
