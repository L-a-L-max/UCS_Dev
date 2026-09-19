package com.ucs.dto;

import lombok.Data;

import java.util.List;

/**
 * 创建 / 修改航点任务的请求。
 *
 * 与旧的 {@link CreateTaskRequest} 区分：这里携带航点序列与执行参数，
 * 旧 DTO 仍服务于 /api/v1/leader/task/create 的批量指令场景，不做改动。
 */
@Data
public class TaskCreateRequest {

    private String taskName;

    private String taskType;

    private String description;

    private Integer priority;

    /**
     * 单点超时保护（秒），操作人员可配置。
     * 为空时后端取默认值 300。允许范围见 WaypointTaskService 的校验。
     */
    private Integer waypointTimeoutSec;

    /** 水平到点判定半径（米），为空取 3.0 */
    private Float arrivalRadius;

    /** 垂直到点判定容差（米），为空取 2.0 */
    private Float arrivalAltTol;

    /** 全部航点飞完后的动作：HOLD / RTL / LAND，为空取 HOLD */
    private String onFinish;

    /** 航点序列，前端按展示编号给出，后端按 displayLabel 升序重排 seq */
    private List<WaypointDTO> waypoints;
}
