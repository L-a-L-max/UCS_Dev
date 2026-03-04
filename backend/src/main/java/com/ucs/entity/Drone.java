package com.ucs.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "drones")
public class Drone {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(name = "drone_sn", nullable = false, unique = true, length = 100)
    private String droneSn;
    
    /**
     * Unique identifier derived from MAC address on the onboard computer.
     * This is the permanent drone identifier used throughout the Zenoh network.
     * Format example: "UAV_001", "UAV_002", etc.
     */
    @Column(name = "uav_id", unique = true, length = 50)
    private String uavId;
    
    @Column(name = "mavlink_system_id")
    private Integer mavlinkSystemId;
    
    @Column(length = 100)
    private String model;
    
    @Column(length = 100)
    private String manufacturer;
    
    @Column(columnDefinition = "JSON")
    private String capabilities;
    
    @Column(name = "default_team_id")
    private Long defaultTeamId;
    
    /**
     * Current online status based on Zenoh heartbeat.
     */
    @Column(name = "online_status", columnDefinition = "BOOLEAN DEFAULT FALSE")
    private Boolean onlineStatus = false;
    
    @Column(name = "last_heartbeat")
    private LocalDateTime lastHeartbeat;
    
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
