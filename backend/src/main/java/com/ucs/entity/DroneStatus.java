package com.ucs.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "drone_status")
public class DroneStatus {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(name = "drone_id", nullable = false)
    private Long droneId;
    
    @Column
    private LocalDateTime timestamp;
    
    @Column
    private Double lat;
    
    @Column
    private Double lng;
    
    @Column
    private Double alt;
    
    @Column
    private Float heading;
    
    @Column
    private Float velocity;
    
    @Column
    private Float battery;
    
    @Column(name = "health_status", columnDefinition = "TINYINT DEFAULT 0")
    private Integer healthStatus = 0;
    
    @Column(name = "risk_level", columnDefinition = "TINYINT DEFAULT 0")
    private Integer riskLevel = 0;
    
    @Column(name = "payload_state", columnDefinition = "JSON")
    private String payloadState;
    
    @Column(name = "grid_x")
    private Integer gridX;
    
    @Column(name = "grid_y")
    private Integer gridY;
    
    @Column(name = "flight_status", length = 50)
    private String flightStatus;
    
    @Column(name = "task_status", length = 50)
    private String taskStatus;
    
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "drone_id", insertable = false, updatable = false)
    private Drone drone;
    
    @PrePersist
    protected void onCreate() {
        timestamp = LocalDateTime.now();
    }
}
