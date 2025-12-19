package com.ucs.dto;

import lombok.Data;
import java.time.Instant;
import java.util.List;

/**
 * DTO for batch UAV telemetry data received from ROS 2 gateway
 * Matches the UavGpsArray.msg format
 */
@Data
public class UavTelemetryBatchDTO {
    private Instant timestamp;
    private Long msgSeqNumber;
    
    // Home point information
    private Double homeLat;
    private Double homeLon;
    private Double homeAlt;
    
    // Statistics
    private Integer numUavsTotal;
    private Integer numUavsActive;
    
    // UAV data array
    private List<UavTelemetryDTO> uavs;
}
