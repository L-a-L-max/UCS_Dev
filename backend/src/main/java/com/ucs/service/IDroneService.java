package com.ucs.service;

import com.ucs.dto.DroneStatusDTO;
import com.ucs.dto.HeatmapPointDTO;
import com.ucs.entity.Drone;

import java.util.List;

/**
 * Drone Service Interface
 * Following MyBatis-Plus convention with I prefix for interfaces
 */
public interface IDroneService {
    
    /**
     * Get drones by user ID
     */
    List<DroneStatusDTO> getDronesByUserId(Long userId);
    
    /**
     * Get drones by team ID
     */
    List<DroneStatusDTO> getDronesByTeamId(Long teamId);
    
    /**
     * Get all drones
     */
    List<DroneStatusDTO> getAllDrones();
    
    /**
     * Filter drones by criteria
     */
    List<String> filterDrones(Long userId, String filterType);
    
    /**
     * Send command to drone
     */
    String sendCommand(Long droneId, Long userId, String commandType, String payload);
    
    /**
     * Assign drones to user
     */
    void assignDronesToUser(List<Long> droneIds, Long userId, Long assignedBy);
    
    /**
     * Get heatmap data
     */
    List<HeatmapPointDTO> getHeatmapData();
    
    /**
     * Get drone by ID
     */
    Drone getDroneById(Long droneId);
    
    /**
     * Parse drone ID from UAV string
     */
    Long parseDroneId(String uavId);
}
