package com.ucs.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.Instant;

/**
 * UAV Telemetry data entity - stores real-time telemetry from ROS 2 gateway
 * This table is designed to work with TimescaleDB hypertable for time-series data
 */
@Data
@Entity
@Table(name = "uav_telemetry", indexes = {
    @Index(name = "idx_uav_telemetry_uav_id", columnList = "uav_id"),
    @Index(name = "idx_uav_telemetry_timestamp", columnList = "timestamp")
})
public class UavTelemetry {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(name = "uav_id", nullable = false)
    private Integer uavId;
    
    @Column(name = "timestamp", nullable = false)
    private Instant timestamp;
    
    // GPS coordinates (WGS84)
    @Column(name = "lat", nullable = false)
    private Double lat;
    
    @Column(name = "lon", nullable = false)
    private Double lon;
    
    @Column(name = "alt", nullable = false)
    private Double alt;
    
    // Motion state
    @Column(name = "heading")
    private Double heading;
    
    @Column(name = "ground_speed")
    private Double groundSpeed;
    
    @Column(name = "vertical_speed")
    private Double verticalSpeed;
    
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
}
