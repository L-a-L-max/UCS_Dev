package com.ucs.dto;

import lombok.Data;

import java.util.List;

/**
 * Request DTO for transferring drone control permission.
 * Uses Redis distributed lock for strong consistency.
 */
@Data
public class PermissionTransferRequest {
    /**
     * List of drone uavIds to transfer.
     */
    private List<String> uavIds;
    
    /**
     * Target user ID to transfer control to.
     */
    private Long toUserId;
    
    /**
     * Optional reason for the transfer.
     */
    private String reason;
}
