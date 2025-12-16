package com.ucs.controller;

import com.ucs.dto.*;
import com.ucs.security.UserPrincipal;
import com.ucs.service.DroneService;
import com.ucs.service.TaskService;
import com.ucs.service.UserService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/pilot")
public class PilotController {
    
    private final DroneService droneService;
    private final TaskService taskService;
    private final UserService userService;
    
    public PilotController(DroneService droneService, 
                          TaskService taskService,
                          UserService userService) {
        this.droneService = droneService;
        this.taskService = taskService;
        this.userService = userService;
    }
    
    @GetMapping("/uav/list")
    public ApiResponse<List<DroneStatusDTO>> getUavList(@AuthenticationPrincipal UserPrincipal principal) {
        List<DroneStatusDTO> drones = droneService.getDronesByUserId(principal.getUserId());
        return ApiResponse.success(drones);
    }
    
    @GetMapping("/uav/filter")
    public ApiResponse<List<String>> filterUav(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestParam(defaultValue = "all") String type) {
        List<String> filteredIds = droneService.filterDrones(principal.getUserId(), type);
        return ApiResponse.success(filteredIds);
    }
    
    @GetMapping("/task/list")
    public ApiResponse<List<TaskDTO>> getTaskList(@AuthenticationPrincipal UserPrincipal principal) {
        List<TaskDTO> tasks = taskService.getTasksByUserId(principal.getUserId());
        return ApiResponse.success(tasks);
    }
    
    @PostMapping("/uav/{uavId}/command")
    public ApiResponse<Object> sendCommand(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable String uavId,
            @RequestBody CommandRequest request) {
        try {
            Long droneId = droneService.parseDroneId(uavId);
            String commandId = droneService.sendCommand(droneId, principal.getUserId(), 
                    request.getCommandType(), request.getPayload());
            return ApiResponse.success("command accepted", 
                    java.util.Map.of("commandId", commandId));
        } catch (Exception e) {
            return ApiResponse.error(-1, e.getMessage());
        }
    }
}
