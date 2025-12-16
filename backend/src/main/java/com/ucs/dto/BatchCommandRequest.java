package com.ucs.dto;

import lombok.Data;
import java.util.List;

@Data
public class BatchCommandRequest {
    private List<String> uavIds;
    private String commandType;
    private String payload;
    private String taskName;
    private String taskType;
}
