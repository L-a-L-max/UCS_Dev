package com.ucs.repository;

import com.ucs.entity.UavTelemetry;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;

/**
 * Repository for UAV telemetry data
 */
@Repository
public interface UavTelemetryRepository extends JpaRepository<UavTelemetry, Long> {
    
    /**
     * Find telemetry data for a specific UAV within a time range
     */
    List<UavTelemetry> findByUavIdAndTimestampBetweenOrderByTimestampAsc(
            Integer uavId, Instant startTime, Instant endTime);
    
    /**
     * Find all telemetry data within a time range
     */
    List<UavTelemetry> findByTimestampBetweenOrderByTimestampAsc(
            Instant startTime, Instant endTime);
    
    /**
     * Delete telemetry data older than a specific timestamp (for retention policy)
     */
    void deleteByTimestampBefore(Instant timestamp);
    
    /**
     * Count telemetry records for a specific UAV
     */
    long countByUavId(Integer uavId);
}
