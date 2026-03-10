package com.ucs.service;

import com.ucs.entity.UavLatestState;
import com.ucs.entity.UavTelemetry;
import com.ucs.repository.UavLatestStateRepository;
import com.ucs.repository.UavTelemetryRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * Persistence gateway service.
 * Subscribes to all partition data and persists drone telemetry to database.
 * Supports path replay functionality.
 * 
 * Data is buffered and batch-persisted at regular intervals for performance.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TelemetryPersistenceService {

    private final UavTelemetryRepository telemetryRepository;
    private final UavLatestStateRepository latestStateRepository;

    // Buffer for batch persistence
    private final ConcurrentLinkedQueue<TelemetryRecord> buffer = new ConcurrentLinkedQueue<>();

    /**
     * Accept telemetry data from the DDS simulator for persistence.
     * Called by DDSSimulatorService for each telemetry cycle.
     */
    public void persistTelemetry(String uavId, double lat, double lon, double alt,
                                  double heading, double groundSpeed, double verticalSpeed,
                                  Instant timestamp) {
        TelemetryRecord record = new TelemetryRecord();
        record.uavId = uavId;
        record.lat = lat;
        record.lon = lon;
        record.alt = alt;
        record.heading = heading;
        record.groundSpeed = groundSpeed;
        record.verticalSpeed = verticalSpeed;
        record.timestamp = timestamp;
        buffer.add(record);
    }

    /**
     * Accept telemetry data from a map structure.
     */
    public void persistFromMap(Map<String, Object> telemetryMsg) {
        TelemetryRecord record = new TelemetryRecord();
        record.uavId = String.valueOf(telemetryMsg.get("uavId"));
        record.lat = ((Number) telemetryMsg.getOrDefault("lat", 0.0)).doubleValue();
        record.lon = ((Number) telemetryMsg.getOrDefault("lon", 0.0)).doubleValue();
        record.alt = ((Number) telemetryMsg.getOrDefault("alt", 0.0)).doubleValue();
        record.heading = ((Number) telemetryMsg.getOrDefault("heading", 0.0)).doubleValue();
        record.groundSpeed = ((Number) telemetryMsg.getOrDefault("groundSpeed", 0.0)).doubleValue();
        record.verticalSpeed = ((Number) telemetryMsg.getOrDefault("verticalSpeed", 0.0)).doubleValue();
        record.timestamp = Instant.now();
        buffer.add(record);
    }

    /**
     * Batch persist buffered telemetry data every 5 seconds.
     */
    @Scheduled(fixedDelay = 5000)
    @Transactional
    public void flushBuffer() {
        if (buffer.isEmpty()) return;

        List<UavTelemetry> telemetryList = new ArrayList<>();
        List<UavLatestState> latestStates = new ArrayList<>();
        Map<String, TelemetryRecord> latestByUav = new LinkedHashMap<>();

        TelemetryRecord record;
        int count = 0;
        while ((record = buffer.poll()) != null && count < 1000) {
            // Create telemetry history record
            UavTelemetry telemetry = new UavTelemetry();
            telemetry.setUavId(record.uavId);
            telemetry.setTimestamp(record.timestamp);
            telemetry.setLat(record.lat);
            telemetry.setLon(record.lon);
            telemetry.setAlt(record.alt);
            telemetry.setHeading((float) record.heading);
            telemetry.setGroundSpeed((float) record.groundSpeed);
            telemetry.setVerticalSpeed((float) record.verticalSpeed);
            telemetry.setIsActive(true);
            telemetryList.add(telemetry);

            // Track latest state per UAV
            latestByUav.put(record.uavId, record);
            count++;
        }

        // Build latest state records
        for (Map.Entry<String, TelemetryRecord> entry : latestByUav.entrySet()) {
            TelemetryRecord r = entry.getValue();
            UavLatestState state = new UavLatestState();
            state.setUavId(r.uavId);
            state.setLastUpdate(r.timestamp);
            state.setLat(r.lat);
            state.setLon(r.lon);
            state.setAlt(r.alt);
            state.setHeading((float) r.heading);
            state.setGroundSpeed((float) r.groundSpeed);
            state.setVerticalSpeed((float) r.verticalSpeed);
            state.setIsActive(true);
            latestStates.add(state);
        }

        // Batch save
        if (!telemetryList.isEmpty()) {
            telemetryRepository.saveAll(telemetryList);
        }
        if (!latestStates.isEmpty()) {
            latestStateRepository.saveAll(latestStates);
        }

        log.debug("Persisted {} telemetry records, {} latest states", 
                telemetryList.size(), latestStates.size());
    }

    /**
     * Internal record for buffering telemetry data.
     */
    private static class TelemetryRecord {
        String uavId;
        double lat;
        double lon;
        double alt;
        double heading;
        double groundSpeed;
        double verticalSpeed;
        Instant timestamp;
    }
}
