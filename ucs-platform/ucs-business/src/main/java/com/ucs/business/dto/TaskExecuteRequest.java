package com.ucs.business.dto;

import lombok.Data;

/**
 * 任务执行请求。所有字段可选：为空时沿用任务创建时保存的配置。
 * 允许操作人员在本次执行前临时覆盖单点超时等参数。
 */
@Data
public class TaskExecuteRequest {

    /** 本次执行的单点超时保护（秒），覆盖任务上保存的值 */
    private Integer waypointTimeoutSec;

    private Float arrivalRadius;

    private Float arrivalAltTol;

    private String onFinish;

    /** true 表示同时把覆盖值写回任务，作为之后的默认配置 */
    private Boolean persistOverrides;
}
