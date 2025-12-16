package com.ucs.dto;

import lombok.Data;
import java.time.LocalDateTime;
import java.util.List;

@Data
public class CreateTaskRequest {
    private String taskName;
    private String taskType;
    private String description;
    private Integer priority;
    private LocalDateTime startTime;
    private LocalDateTime endTime;
    private List<String> assignedUserIds;
    private List<String> assignedDroneIds;
}
