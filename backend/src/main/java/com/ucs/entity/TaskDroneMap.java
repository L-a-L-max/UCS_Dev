package com.ucs.entity;

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
    
    @Column(columnDefinition = "TINYINT DEFAULT 0")
    private Integer status = 0;
    
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
