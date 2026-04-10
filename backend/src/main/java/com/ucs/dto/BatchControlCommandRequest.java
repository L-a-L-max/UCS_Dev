package com.ucs.dto;

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
    private List<String> uavIds;
    
    /**
     * PX4 command type.
     */
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
