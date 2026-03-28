package com.ucs.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Response DTO for control command operations.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ControlCommandResponse {
    private String commandId;
    private String uavId;
    private String status;
    private String message;
    
    public static ControlCommandResponse success(String commandId, String uavId) {
        return new ControlCommandResponse(commandId, uavId, "ACCEPTED", "Command accepted and sent to drone");
    }
    
    public static ControlCommandResponse failed(String uavId, String message) {
        return new ControlCommandResponse(null, uavId, "REJECTED", message);
    }
}
