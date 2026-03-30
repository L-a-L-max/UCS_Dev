package com.ucs.dto;

import lombok.Data;

/**
 * Request DTO for sending control commands to drones via Zenoh.
 * Commands are mapped to PX4 standard DDS topics.
 */
@Data
public class ControlCommandRequest {
    /**
     * Target drone's unique identifier (derived from MAC).
     * Example: "UAV_001"
     */
    private String uavId;
    
    /**
     * PX4 command type, mapped to PX4 vehicle_command.
     * Examples: TAKEOFF, LAND, RTL (Return to Launch), ARM, DISARM,
     * GOTO (go to waypoint), HOLD (loiter), OFFBOARD
     */
    private String commandType;
    
    /**
     * Command parameters as JSON string.
     * For TAKEOFF: {"altitude": 50.0}
     * For GOTO: {"lat": 39.9042, "lon": 116.4074, "alt": 100.0}
     * For RTL: {} (no params needed)
     */
    private String params;
    
    /**
     * Optional confirmation flag for dangerous commands (DISARM, etc.)
     */
    private Boolean confirmed;
}
