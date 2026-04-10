package com.ucs.business.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.Instant;

/**
 * UAV Latest State entity - stores the most recent state of each UAV
 * This table is updated via UPSERT for fast dashboard queries
 */
@Data
@Entity
@Table(name = "uav_latest_state")
public class UavLatestState {
    @Id
    @Column(name = "uav_id", length = 50)
    private String uavId;
    
    @Column(name = "last_update", nullable = false)
    private Instant lastUpdate;
    
    // GPS coordinates (WGS84)
    @Column(name = "lat", nullable = false)
    private Double lat;
    
    @Column(name = "lon", nullable = false)
    private Double lon;
    
    @Column(name = "alt", nullable = false)
    private Double alt;
    
    // Motion state
    @Column(name = "heading")
    private Float heading;
    
    @Column(name = "ground_speed")
    private Float groundSpeed;
    
    @Column(name = "vertical_speed")
    private Float verticalSpeed;
    
    // NED local coordinates
    @Column(name = "ned_x")
    private Double nedX;
    
    @Column(name = "ned_y")
    private Double nedY;
    
    @Column(name = "ned_z")
    private Double nedZ;
    
    // NED velocity
    @Column(name = "vx")
    private Double vx;
    
    @Column(name = "vy")
    private Double vy;
    
    @Column(name = "vz")
    private Double vz;
    
    // Data quality
    @Column(name = "data_age")
    private Double dataAge;
    
    @Column(name = "msg_count")
    private Long msgCount;
    
    @Column(name = "is_active")
    private Boolean isActive;
    
    // Flight status fields (populated from Kafka telemetry)
    @Column(name = "armed")
    private Boolean armed;
    
    @Column(name = "flight_mode", length = 50)
    private String flightMode;
    
    @Column(name = "battery_percent")
    private Float batteryPercent;
}
