package com.ucs.controller;

import com.ucs.dto.*;
import com.ucs.service.*;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/screen")
public class ScreenController {
    
    private final DroneService droneService;
    private final TaskService taskService;
    private final TeamService teamService;
    private final WeatherService weatherService;
    private final EventService eventService;
    
    public ScreenController(DroneService droneService,
                           TaskService taskService,
                           TeamService teamService,
                           WeatherService weatherService,
                           EventService eventService) {
        this.droneService = droneService;
        this.taskService = taskService;
        this.teamService = teamService;
        this.weatherService = weatherService;
        this.eventService = eventService;
    }
    
    @GetMapping("/uav/heatmap")
    public ApiResponse<List<HeatmapPointDTO>> getHeatmap() {
        List<HeatmapPointDTO> heatmapData = droneService.getHeatmapData();
        return ApiResponse.success(heatmapData);
    }
    
    @GetMapping("/uav/list")
    public ApiResponse<List<DroneStatusDTO>> getAllUavList() {
        List<DroneStatusDTO> drones = droneService.getAllDrones();
        return ApiResponse.success(drones);
    }
    
    @GetMapping("/team/status")
    public ApiResponse<List<TeamInfoDTO>> getTeamStatus() {
        List<TeamInfoDTO> teams = teamService.getAllTeams();
        return ApiResponse.success(teams);
    }
    
    @GetMapping("/task/summary")
    public ApiResponse<TaskSummaryDTO> getTaskSummary() {
        TaskSummaryDTO summary = taskService.getTaskSummary();
        return ApiResponse.success(summary);
    }
    
    @GetMapping("/task/list")
    public ApiResponse<List<TaskDTO>> getAllTasks() {
        List<TaskDTO> tasks = taskService.getAllTasks();
        return ApiResponse.success(tasks);
    }
    
    @GetMapping("/weather")
    public ApiResponse<WeatherDTO> getWeather() {
        WeatherDTO weather = weatherService.getCurrentWeather();
        return ApiResponse.success(weather);
    }
    
    @GetMapping("/events")
    public ApiResponse<List<EventDTO>> getEvents(@RequestParam(defaultValue = "20") int limit) {
        List<EventDTO> events = eventService.getLatestEvents(limit);
        return ApiResponse.success(events);
    }
    
    @GetMapping("/alerts")
    public ApiResponse<List<EventDTO>> getAlerts(@RequestParam(defaultValue = "10") int limit) {
        List<EventDTO> alerts = eventService.getAlerts(limit);
        return ApiResponse.success(alerts);
    }
}
