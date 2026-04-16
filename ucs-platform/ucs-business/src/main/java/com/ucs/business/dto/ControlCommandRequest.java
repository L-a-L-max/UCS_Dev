package com.ucs.business.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

/**
 * T-54: Request DTO for sending control commands to drones via Zenoh.
 * Commands are mapped to PX4 standard DDS topics.
 */
@Data
public class ControlCommandRequest {
    /**
     * Target drone's unique identifier (derived from MAC).
     * Example: "UAV_001"
     */
    @NotBlank(message = "uavId 不能为空")
    private String uavId;

    /**
     * PX4 command type, mapped to PX4 vehicle_command.
     * Examples: TAKEOFF, LAND, RTL (Return to Launch), ARM, DISARM,
     * GOTO (go to waypoint), HOLD (loiter), OFFBOARD
     */
    @NotBlank(message = "commandType 不能为空")
    @Pattern(regexp = "TAKEOFF|LAND|RTL|ARM|DISARM|GOTO|HOLD|OFFBOARD",
            message = "commandType 必须为: TAKEOFF, LAND, RTL, ARM, DISARM, GOTO, HOLD, OFFBOARD")
    private String commandType;

    /**
     * Command parameters as JSON string.
     * For TAKEOFF: {"altitude": 50.0}
     * For GOTO: {"lat": 39.9042, "lon": 116.4074, "alt": 100.0}
     * For RTL: {} (no params needed)
     */
    private String params;

    /**
     * Optional request ID for idempotency check (T-50).
     */
    private String requestId;

    /**
     * Optional confirmation flag for dangerous commands (DISARM, etc.)
     */
    private Boolean confirmed;
}
