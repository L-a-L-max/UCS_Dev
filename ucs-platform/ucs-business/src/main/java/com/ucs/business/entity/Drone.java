package com.ucs.business.entity;

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
     * Unique identifier for the drone in the DDS network.
     * Matches PX4 simulation topic prefix (e.g., "px4_1", "px4_2").
     */
    @Column(name = "uav_id", unique = true, length = 50)
    private String uavId;
    
    @Column(name = "mavlink_system_id")
    private Integer mavlinkSystemId;
    
    /**
     * T-03: Gateway type for this drone (DDS / MAVLINK).
     * Used by GatewayRouter to determine command routing strategy.
     */
    @Column(name = "gateway_type", length = 20)
    private String gatewayType;
    
    @Column(length = 100)
    private String model;
    
    @Column(length = 100)
    private String manufacturer;
    
    @Column(length = 2000)
    private String capabilities;
    
    @Column(name = "default_team_id")
    private Long defaultTeamId;
    
    /**
     * Current control permission owner (user ID who can send commands).
     * NULL means no one has control permission (new drone).
     */
    @Column(name = "control_owner_id")
    private Long controlOwnerId;
    
    /**
     * Current view permission owner at Leader/Pilot level.
     * Each level only has one person. NULL means default viewing (observer+commander only).
     */
    @Column(name = "view_owner_id")
    private Long viewOwnerId;
    
    /**
     * Current online status based on DDS heartbeat.
     */
    /**
     * Last known home position (saved on ARM/TAKEOFF).
     * Used for NED coordinate conversion and RTL reference.
     */
    @Column(name = "last_home_lat")
    private Double lastHomeLat;
    
    @Column(name = "last_home_lon")
    private Double lastHomeLon;
    
    @Column(name = "last_home_alt")
    private Double lastHomeAlt;
    
    @Column(name = "online_status")
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
