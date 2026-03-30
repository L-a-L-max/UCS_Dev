package com.ucs.dto;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * Query request for operation logs with filtering.
 */
@Data
public class OperationLogQueryRequest {
    private Long userId;
    private String operationType;
    private Long targetDroneId;
    private String targetUavId;
    private LocalDateTime startTime;
    private LocalDateTime endTime;
    private Integer page = 0;
    private Integer size = 20;
}
