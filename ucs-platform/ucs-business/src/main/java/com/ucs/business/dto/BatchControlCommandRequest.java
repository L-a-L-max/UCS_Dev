package com.ucs.business.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

import java.util.List;

/**
 * T-54: Request DTO for sending batch control commands to multiple drones.
 */
@Data
public class BatchControlCommandRequest {
    /**
     * List of target drone uavIds.
     */
    @NotEmpty(message = "uavIds 不能为空")
    private List<@NotBlank(message = "uavId 不能为空字符串") String> uavIds;

    /**
     * PX4 command type.
     */
    @NotBlank(message = "commandType 不能为空")
    @Pattern(regexp = "TAKEOFF|LAND|RTL|ARM|DISARM|GOTO|HOLD|OFFBOARD",
            message = "commandType 必须为: TAKEOFF, LAND, RTL, ARM, DISARM, GOTO, HOLD, OFFBOARD")
    private String commandType;

    /**
     * Command parameters as JSON string.
     */
    private String params;

    /**
     * Optional request ID for idempotency check (T-50).
     */
    private String requestId;

    /**
     * Optional confirmation flag.
     */
    private Boolean confirmed;
}
