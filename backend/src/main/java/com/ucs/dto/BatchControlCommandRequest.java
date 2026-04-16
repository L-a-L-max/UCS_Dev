package com.ucs.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import lombok.Data;

import java.util.List;

/**
 * Request DTO for sending batch control commands to multiple drones.
 */
@Data
public class BatchControlCommandRequest {
    /**
     * List of target drone uavIds.
     */
    @NotEmpty(message = "uavIds must not be empty")
    private List<String> uavIds;
    
    /**
     * PX4 command type.
     */
    @NotBlank(message = "commandType is required")
    private String commandType;
    
    /**
     * Command parameters as JSON string.
     */
    private String params;
    
    /**
     * Optional confirmation flag.
     */
    private Boolean confirmed;
}
