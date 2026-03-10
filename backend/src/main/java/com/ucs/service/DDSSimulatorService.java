package com.ucs.service;

import com.ucs.entity.Drone;
import com.ucs.repository.DroneRepository;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.*;

/**
 * Simulates DDS drone telemetry data generation (h2dev mode only).
 * Replaces real DDS/PX4 network for testing purposes.
 * 
 * Generates position data for all registered drones at configured intervals,
 * then delegates to the three gateway services:
 *   Gateway 1 (Routing):     PartitionRoutingService (partition lookup)
 *   Gateway 2 (Persistence): TelemetryPersistenceService (batch DB writes)
 *   Gateway 3 (WebSocket):   WebSocketGatewayService (broadcasts to frontend)
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DDSSimulatorService {

    private final DroneRepository droneRepository;
    private final PartitionRoutingService partitionRoutingService;
    private final TelemetryPersistenceService telemetryPersistenceService;  // Gateway 2
    private final WebSocketGatewayService webSocketGatewayService;          // Gateway 3
    private final RedisService redisService;

    @Value("${dds.simulator.enabled:true}")
    private boolean enabled;

    // Track simulated drone positions (uavId -> state)
    private final Map<String, DroneSimState> droneStates = new LinkedHashMap<>();
    private boolean initialized = false;

    /**
     * Initialize drone simulation states from database.
     */
    @PostConstruct
    public void init() {
        if (!enabled) {
            log.info("DDS Simulator is disabled");
            return;
        }
        log.info("DDS Simulator initializing...");
    }

    /**
     * Ensure simulation states are initialized from DB.
     */
    private void ensureInitialized() {
        if (initialized) return;
        
        List<Drone> drones = droneRepository.findAll();
        if (drones.isEmpty()) {
            return; // DB not ready yet
        }
        
        for (Drone drone : drones) {
            if (drone.getUavId() != null) {
                DroneSimState state = new DroneSimState();
                state.uavId = drone.getUavId();
                // Beijing area base coordinates with slight offsets
                state.lat = 39.9042 + (new Random(drone.getId()).nextDouble() - 0.5) * 0.02;
                state.lon = 116.4074 + (new Random(drone.getId() + 1).nextDouble() - 0.5) * 0.02;
                state.alt = 50.0 + new Random(drone.getId() + 2).nextDouble() * 100;
                state.heading = new Random(drone.getId() + 3).nextDouble() * 360;
                state.groundSpeed = 5.0 + new Random(drone.getId() + 4).nextDouble() * 15;
                droneStates.put(drone.getUavId(), state);
            }
        }
        
        // Warm up partition cache
        partitionRoutingService.warmUpCache();
        initialized = true;
        log.info("DDS Simulator initialized with {} drones", droneStates.size());
    }

    /**
     * Generate and route simulated telemetry data at fixed intervals.
     * Simulates the DDS network routing gateway behavior:
     * 1. Generate position data for each drone
     * 2. Look up partitions for each drone
     * 3. Send data to partition-specific WebSocket topics
     * 4. Also send to persistence topic for all-data storage
     */
    @Scheduled(fixedDelayString = "${dds.simulator.interval-ms:2000}")
    public void generateTelemetry() {
        if (!enabled) return;
        ensureInitialized();
        if (droneStates.isEmpty()) return;

        Instant now = Instant.now();
        
        // Collect all telemetry for persistence (all partitions)
        List<Map<String, Object>> allTelemetry = new ArrayList<>();
        
        // Per-partition telemetry collection
        Map<String, List<Map<String, Object>>> partitionData = new LinkedHashMap<>();

        for (DroneSimState state : droneStates.values()) {
            // Simulate movement
            updateDronePosition(state);
            
            // Mark drone as online
            redisService.setDroneOnline(state.uavId);

            // Build telemetry message
            Map<String, Object> telemetryMsg = buildTelemetryMessage(state, now);
            allTelemetry.add(telemetryMsg);

            // Get partitions for this drone
            Set<String> partitions = partitionRoutingService.getPartitionsForDrone(state.uavId);
            
            // Route to each partition
            for (String partition : partitions) {
                partitionData.computeIfAbsent(partition, k -> new ArrayList<>()).add(telemetryMsg);
            }
        }

        // === Gateway 2: Persistence Gateway ===
        for (Map<String, Object> telemetryMsg : allTelemetry) {
            telemetryPersistenceService.persistFromMap(telemetryMsg);
        }

        // === Gateway 3: WebSocket Server Gateway ===
        webSocketGatewayService.broadcastToPartitions(partitionData, now);
        webSocketGatewayService.broadcastAll(allTelemetry, now);

        log.debug("Generated telemetry for {} drones, {} partitions", 
                droneStates.size(), partitionData.size());
    }

    /**
     * Simulate drone position changes (circular flight pattern).
     */
    private void updateDronePosition(DroneSimState state) {
        // Simulate circular flight pattern
        double angularSpeed = 0.001; // radians per tick
        state.heading = (state.heading + Math.toDegrees(angularSpeed)) % 360;
        
        double speedMs = state.groundSpeed; // m/s
        double dt = 2.0; // seconds per tick
        double distance = speedMs * dt;
        
        // Convert distance to lat/lon degrees (approximate)
        double dLat = distance * Math.cos(Math.toRadians(state.heading)) / 111320.0;
        double dLon = distance * Math.sin(Math.toRadians(state.heading)) / 
                (111320.0 * Math.cos(Math.toRadians(state.lat)));
        
        state.lat += dLat;
        state.lon += dLon;
        
        // Slight altitude variation
        state.alt += (Math.random() - 0.5) * 2.0;
        state.alt = Math.max(10.0, Math.min(500.0, state.alt));
        
        // Slight speed variation
        state.groundSpeed += (Math.random() - 0.5) * 1.0;
        state.groundSpeed = Math.max(2.0, Math.min(25.0, state.groundSpeed));
    }

    /**
     * Build telemetry message in the format expected by frontend.
     * Includes uavName (DDS identifier) for display.
     */
    private Map<String, Object> buildTelemetryMessage(DroneSimState state, Instant timestamp) {
        Map<String, Object> msg = new LinkedHashMap<>();
        msg.put("uavName", state.uavId);  // DDS identifier for frontend display
        msg.put("uavId", state.uavId);
        msg.put("timestamp", timestamp.toString());
        msg.put("lat", state.lat);
        msg.put("lon", state.lon);
        msg.put("alt", state.alt);
        msg.put("heading", state.heading);
        msg.put("groundSpeed", state.groundSpeed);
        msg.put("verticalSpeed", (Math.random() - 0.5) * 2.0);
        msg.put("nedX", 0.0);
        msg.put("nedY", 0.0);
        msg.put("nedZ", -state.alt);
        msg.put("vx", state.groundSpeed * Math.cos(Math.toRadians(state.heading)));
        msg.put("vy", state.groundSpeed * Math.sin(Math.toRadians(state.heading)));
        msg.put("vz", 0.0);
        msg.put("dataAge", 0);
        msg.put("msgCount", 1);
        msg.put("isActive", true);
        return msg;
    }

    /**
     * Internal state tracking for simulated drones.
     */
    private static class DroneSimState {
        String uavId;
        double lat;
        double lon;
        double alt;
        double heading;
        double groundSpeed;
    }
}
