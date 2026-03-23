package com.ucs.business.service;

import com.ucs.business.entity.UavLatestState;
import com.ucs.business.entity.UavTelemetry;
import com.ucs.business.repository.UavLatestStateRepository;
import com.ucs.business.repository.UavTelemetryRepository;
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
        // NED local coordinates
        record.nedX = ((Number) telemetryMsg.getOrDefault("nedX", 0.0)).doubleValue();
        record.nedY = ((Number) telemetryMsg.getOrDefault("nedY", 0.0)).doubleValue();
        record.nedZ = ((Number) telemetryMsg.getOrDefault("nedZ", 0.0)).doubleValue();
        // NED velocity
        record.vx = ((Number) telemetryMsg.getOrDefault("vx", 0.0)).doubleValue();
        record.vy = ((Number) telemetryMsg.getOrDefault("vy", 0.0)).doubleValue();
        record.vz = ((Number) telemetryMsg.getOrDefault("vz", 0.0)).doubleValue();
        // Flight status
        record.armed = telemetryMsg.get("armed") instanceof Boolean ? (Boolean) telemetryMsg.get("armed") : false;
        record.flightMode = telemetryMsg.get("flightMode") != null ? String.valueOf(telemetryMsg.get("flightMode")) : "";
        Object bp = telemetryMsg.get("batteryPercent");
        record.batteryPercent = bp instanceof Number ? ((Number) bp).floatValue() : -1f;
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
            state.setNedX(r.nedX);
            state.setNedY(r.nedY);
            state.setNedZ(r.nedZ);
            state.setVx(r.vx);
            state.setVy(r.vy);
            state.setVz(r.vz);
            state.setIsActive(true);
            state.setArmed(r.armed);
            state.setFlightMode(r.flightMode);
            state.setBatteryPercent(r.batteryPercent);
            latestStates.add(state);
        }

        // Batch save
        if (!telemetryList.isEmpty()) {
            telemetryRepository.saveAll(telemetryList);
        }
        if (!latestStates.isEmpty()) {
            latestStateRepository.saveAll(latestStates);
        }

        log.info("[Persistence] Flushed buffer: {} telemetry records, {} latest states", 
                telemetryList.size(), latestStates.size());
        for (Map.Entry<String, TelemetryRecord> logEntry : latestByUav.entrySet()) {
            TelemetryRecord lr = logEntry.getValue();
            log.info("[Persistence]   Drone '{}': lat={}, lon={}, alt={}",
                    lr.uavId, lr.lat, lr.lon, lr.alt);
        }
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
        double nedX;
        double nedY;
        double nedZ;
        double vx;
        double vy;
        double vz;
        boolean armed;
        String flightMode;
        float batteryPercent;
        Instant timestamp;
    }
}
