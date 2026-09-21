package com.ucs.business.dto;

import lombok.Data;

@Data
public class DroneStatusDTO {
    private String uavId;
    private String droneSn;
    private Double lat;
    private Double lng;
    private Double altitude;
    private Float battery;
    private String hardwareStatus;
    private String flightStatus;
    private String taskStatus;
    private String color;
    private String model;
    private String owner;
    private Float velocity;
    private Float heading;
    private String networkType;
    private Float signalStrength;
    private Boolean onlineStatus;
    private String teamName;
    private String teamLeader;
    private String controlOwnerName;
    private String lastHeartbeat;

    // ---- 航点任务（无人机正在执行的任务，无任务时全部为 null） ----
    /** 正在执行的任务 ID */
    private Long currentTaskId;
    /** 正在执行的任务名称，前端在无人机卡片上展示 */
    private String currentTaskName;
    /** 当前飞往的航点序号，从 0 开始；-1 表示尚未开始 */
    private Integer currentTaskSeq;
    /** 该任务的航点总数 */
    private Integer currentTaskTotal;
    /** 该机在此任务上的进度 0 ~ 100 */
    private Float currentTaskProgress;
}
