package com.ucs.dto;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class TaskDTO {
    private String taskId;
    private String taskName;
    private String taskType;
    private LocalDateTime startTime;
    private LocalDateTime endTime;
    private String status;
    private Float progress;
    private Integer priority;
    private String description;
    private String createdBy;
}
