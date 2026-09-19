package com.ucs.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 任务下某架无人机的执行进度 */
@Data
public class AssignedDroneDTO {

    private Long droneId;

    private String uavId;

    private String droneSn;

    /** 0 待执行 / 1 执行中 / 3 已完成 / 4 异常 / 5 已分配 */
    private Integer status;

    private String statusText;

    /** 0 ~ 100 */
    private Float progress;

    /** 当前正在飞往的航点 seq，-1 表示未开始 */
    private Integer currentSeq;

    private String errorMessage;

    private Boolean online;

    private LocalDateTime lastUpdateTime;
}
