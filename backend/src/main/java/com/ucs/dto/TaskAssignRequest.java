package com.ucs.dto;

import lombok.Data;

import java.util.List;

/** 任务指派请求：一次性覆盖该任务的无人机列表（复选框结果） */
@Data
public class TaskAssignRequest {

    /** 无人机标识列表，支持 uavId（如 px4_1）或数据库 id */
    private List<String> uavIds;
}
