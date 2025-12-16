package com.ucs.dto;

import lombok.Data;

@Data
public class TaskSummaryDTO {
    private Long total;
    private Long executing;
    private Long completed;
    private Long abnormal;
    private Long pending;
}
