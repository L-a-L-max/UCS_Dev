package com.ucs.dto;

import lombok.Data;
import java.time.Instant;

/**
 * DTO for UAV telemetry data received from ROS 2 gateway
 */
@Data
public class UavTelemetryDTO {
    private Integer uavId;
    private Instant timestamp;
    
    // GPS coordinates (WGS84)
    private Double lat;
    private Double lon;
    private Double alt;
    
    // Motion state
    private Double heading;
    private Double groundSpeed;
    private Double verticalSpeed;
    
    // NED local coordinates
    private Double nedX;
    private Double nedY;
    private Double nedZ;
    
    // NED velocity
    private Double vx;
    private Double vy;
    private Double vz;
    
    // Data quality
    private Double dataAge;
    private Long msgCount;
    private Boolean isActive;
}
