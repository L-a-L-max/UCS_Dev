package com.ucs.business.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "task_drone_map")
public class TaskDroneMap {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(name = "task_id", nullable = false)
    private Long taskId;
    
    @Column(name = "drone_id", nullable = false)
    private Long droneId;
    
    @Column
    private Float progress = 0f;
    
    @Column
    private Integer status = 0;
    
    /** 该无人机当前正在飞往的航点 seq，-1 表示尚未开始 */
    @Column(name = "current_seq")
    private Integer currentSeq = -1;

    /** 本次执行的唯一标识，用于丢弃上一轮执行残留的迟到进度消息 */
    @Column(name = "mission_id", length = 64)
    private String missionId;

    /** 失败原因 */
    @Column(name = "error_message", length = 500)
    private String errorMessage;

    @Column(name = "last_update_time")
    private LocalDateTime lastUpdateTime;
    
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "task_id", insertable = false, updatable = false)
    private Task task;
    
    @PrePersist
    protected void onCreate() {
        lastUpdateTime = LocalDateTime.now();
    }
    
    @PreUpdate
    protected void onUpdate() {
        lastUpdateTime = LocalDateTime.now();
    }
}
