package com.ucs.service;

import com.ucs.dto.UavTelemetryBatchDTO;
import com.ucs.dto.UavTelemetryDTO;
import com.ucs.entity.UavLatestState;
import com.ucs.entity.UavTelemetry;

import java.time.Instant;
import java.util.List;

/**
 * Service interface for UAV telemetry data
 */
public interface ITelemetryService {
    
    /**
     * Process batch telemetry data from ROS 2 gateway
     * - Saves to history table (for path replay)
     * - Updates latest state table (for dashboard)
     * - Broadcasts to WebSocket subscribers
     */
    void processBatchTelemetry(UavTelemetryBatchDTO batch);
    
    /**
     * Get all latest UAV states for dashboard
     */
    List<UavLatestState> getAllLatestStates();
    
    /**
     * Get latest state for a specific UAV
     */
    UavLatestState getLatestState(Integer uavId);
    
    /**
     * Get telemetry history for path replay
     */
    List<UavTelemetry> getTelemetryHistory(Integer uavId, Instant startTime, Instant endTime);
    
    /**
     * Clean up old telemetry data based on retention policy
     */
    void cleanupOldTelemetry(int retentionDays);
}
