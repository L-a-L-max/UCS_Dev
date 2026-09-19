package com.ucs.dto;

import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/** 航点任务详情（任务卡片与详情弹窗共用） */
@Data
public class TaskDetailDTO {

    private Long id;

    private String taskName;

    private String taskType;

    /** 0 待执行 / 1 执行中 / 2 暂停 / 3 已完成 / 4 异常 / 5 已分配 */
    private Integer status;

    private String statusText;

    private Integer priority;

    private String description;

    private Integer execCount;

    /** 单点超时保护（秒） */
    private Integer waypointTimeoutSec;

    private Float arrivalRadius;

    private Float arrivalAltTol;

    private String onFinish;

    private Long createdBy;

    private String createdByName;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime lastExecTime;

    private Integer waypointCount;

    /** 任务整体进度 0 ~ 100，取所有已分配无人机的平均值 */
    private Float progress;

    /** 列表接口不返回航点明细，详情接口返回 */
    private List<WaypointDTO> waypoints;

    private List<AssignedDroneDTO> drones;
}
