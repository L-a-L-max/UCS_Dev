package com.ucs.common.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * Telemetry message DTO shared across microservices.
 * Represents a single drone telemetry data point from Kafka topic: telemetry.raw
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TelemetryMessage implements Serializable {

    private String uavId;
    private String uavName;
    private double lat;
    private double lon;
    private double alt;
    private double heading;
    private double groundSpeed;
    private double verticalSpeed;
    private double nedX;
    private double nedY;
    private double nedZ;
    private double vx;
    private double vy;
    private double vz;
    private boolean armed;
    private String flightMode;
    private Double batteryPercent;
    private long epoch;
    private long timestamp;
}
