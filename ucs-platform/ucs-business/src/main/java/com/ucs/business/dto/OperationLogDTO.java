package com.ucs.business.dto;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * DTO for operation log query results.
 */
@Data
public class OperationLogDTO {
    private Long id;
    private Long userId;
    private String username;
    private String operationType;
    private Long targetDroneId;
    private String targetUavId;
    private Long targetUserId;
    private String detail;
    private String result;
    private String errorMessage;
    private LocalDateTime createdAt;
}
