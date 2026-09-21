package com.ucs.business.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "tasks")
public class Task {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(name = "task_name", nullable = false, length = 200)
    private String taskName;
    
    @Column(name = "task_type", length = 50)
    private String taskType;
    
    @Column
    private Integer status = 0;
    
    @Column
    private Integer priority = 0;
    
    @Column(name = "start_time")
    private LocalDateTime startTime;
    
    @Column(name = "end_time")
    private LocalDateTime endTime;
    
    @Column(name = "created_by")
    private Long createdBy;
    
    @Column(length = 2000)
    private String description;
    
    /** 任务被执行的次数 */
    @Column(name = "exec_count")
    private Integer execCount = 0;

    /**
     * 单点超时保护（秒）：飞往同一个航点超过该时长仍未到达即判定任务异常。
     * 由操作人员在创建/执行任务时配置，默认 300 秒。
     */
    @Column(name = "waypoint_timeout_sec")
    private Integer waypointTimeoutSec = 300;

    /** 水平到点判定半径（米） */
    @Column(name = "arrival_radius")
    private Float arrivalRadius = 3.0f;

    /** 垂直到点判定容差（米） */
    @Column(name = "arrival_alt_tol")
    private Float arrivalAltTol = 2.0f;

    /** 全部航点飞完后的动作：HOLD / RTL / LAND */
    @Column(name = "on_finish", length = 20)
    private String onFinish = "HOLD";

    /** 最近一次执行时间 */
    @Column(name = "last_exec_time")
    private LocalDateTime lastExecTime;

    @Column(name = "created_at")
    private LocalDateTime createdAt;
    
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
    
    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }
    
    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
