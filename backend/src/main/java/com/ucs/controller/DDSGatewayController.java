package com.ucs.controller;

import com.ucs.service.PartitionRoutingService;
import com.ucs.service.RedisService;
import com.ucs.service.TelemetryPersistenceService;
import com.ucs.service.WebSocketGatewayService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.*;

/**
 * REST API endpoint for the external DDS Gateway (Python script).
 * Receives telemetry data from the DDS network via the Python gateway,
 * then delegates to three gateway services:
 * 
 *   Gateway 1 (DDS Routing): Python dds_gateway.py -> this controller (partition routing)
 *   Gateway 2 (Persistence): TelemetryPersistenceService (batch writes to PostgreSQL)
 *   Gateway 3 (WebSocket):   WebSocketGatewayService (broadcasts to frontend subscribers)
 * 
 * Authentication: Uses a shared API key (dds.gateway.api-key) in the
 * X-Gateway-Key header to authenticate gateway requests.
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/dds-gateway")
@RequiredArgsConstructor
@Tag(name = "DDS Gateway", description = "DDS Gateway Telemetry Ingestion API")
public class DDSGatewayController {

    private final PartitionRoutingService partitionRoutingService;
    private final TelemetryPersistenceService telemetryPersistenceService;  // Gateway 2: Persistence
    private final WebSocketGatewayService webSocketGatewayService;          // Gateway 3: WebSocket
    private final RedisService redisService;

    @Value("${dds.gateway.api-key:ucs-dds-gateway-secret-2024}")
    private String gatewayApiKey;

    /**
     * Receive batch telemetry from the DDS gateway.
     * The gateway collects telemetry from all discovered PX4 drones
     * and sends them as a batch at regular intervals.
     * 
     * Request body format:
     * {
     *   "timestamp": "2024-01-01T00:00:00Z",
     *   "drones": [
     *     {
     *       "uavId": "px4_1",
     *       "lat": 39.9042, "lon": 116.4074, "alt": 100.0,
     *       "heading": 45.0, "groundSpeed": 10.0, "verticalSpeed": 0.5,
     *       "vx": 7.07, "vy": 7.07, "vz": 0.5,
     *       "nedX": 100.0, "nedY": 200.0, "nedZ": -100.0,
     *       "armed": true, "flightMode": "OFFBOARD"
     *     }
     *   ]
     * }
     */
    @PostMapping("/telemetry")
    @Operation(summary = "Receive batch telemetry from DDS gateway")
    public ResponseEntity<Map<String, Object>> receiveTelemetry(
            @RequestHeader(value = "X-Gateway-Key", required = false) String apiKey,
            @RequestBody Map<String, Object> payload) {

        // Validate API key
        if (!gatewayApiKey.equals(apiKey)) {
            log.warn("DDS Gateway: Invalid API key");
            return ResponseEntity.status(401).body(Map.of("error", "Invalid API key"));
        }

        try {
            String timestampStr = (String) payload.getOrDefault("timestamp", Instant.now().toString());
            Instant timestamp = Instant.parse(timestampStr);

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> drones = (List<Map<String, Object>>) payload.get("drones");
            if (drones == null || drones.isEmpty()) {
                return ResponseEntity.ok(Map.of("status", "ok", "processed", 0));
            }

            // Per-partition telemetry collection for WebSocket routing
            Map<String, List<Map<String, Object>>> partitionData = new LinkedHashMap<>();
            List<Map<String, Object>> allTelemetry = new ArrayList<>();

            for (Map<String, Object> droneData : drones) {
                String uavId = String.valueOf(droneData.get("uavId"));
                if (uavId == null || "null".equals(uavId)) {
                    continue;
                }

                // Mark drone as online
                redisService.setDroneOnline(uavId);

                // Enrich message with fields expected by frontend
                droneData.put("uavName", uavId);
                droneData.put("timestamp", timestamp.toString());
                // Frontend expects isActive field (derived from armed status)
                Object armed = droneData.get("armed");
                droneData.put("isActive", armed != null && Boolean.TRUE.equals(armed));
                allTelemetry.add(droneData);

                // === Gateway 2: Persistence Gateway ===
                telemetryPersistenceService.persistFromMap(droneData);

                // === Gateway 1: Partition Routing ===
                Set<String> partitions = partitionRoutingService.getPartitionsForDrone(uavId);
                for (String partition : partitions) {
                    partitionData.computeIfAbsent(partition, k -> new ArrayList<>()).add(droneData);
                }
            }

            // === Gateway 3: WebSocket Server Gateway ===
            webSocketGatewayService.broadcastToPartitions(partitionData, timestamp);
            webSocketGatewayService.broadcastAll(allTelemetry, timestamp);

            // Detailed logging for debugging data flow
            log.info("[DDSGateway] Received {} drone(s), routed to {} partition(s)",
                    drones.size(), partitionData.size());
            for (Map.Entry<String, List<Map<String, Object>>> pEntry : partitionData.entrySet()) {
                log.info("[DDSGateway]   Partition '{}' -> {} drone(s)",
                        pEntry.getKey(), pEntry.getValue().size());
            }
            for (Map<String, Object> droneData : drones) {
                String droneId = String.valueOf(droneData.get("uavId"));
                log.info("[DDSGateway]   Drone '{}': lat={}, lon={}, alt={}, armed={}, mode={}",
                        droneId, droneData.get("lat"), droneData.get("lon"),
                        droneData.get("alt"), droneData.get("armed"), droneData.get("flightMode"));
            }

            return ResponseEntity.ok(Map.of(
                    "status", "ok",
                    "processed", drones.size(),
                    "partitions", partitionData.keySet()
            ));
        } catch (Exception e) {
            log.error("DDS Gateway: Failed to process telemetry", e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Health check endpoint for the DDS gateway to verify connectivity.
     */
    @GetMapping("/health")
    @Operation(summary = "DDS Gateway health check")
    public ResponseEntity<Map<String, Object>> health() {
        return ResponseEntity.ok(Map.of(
                "status", "ok",
                "timestamp", Instant.now().toString(),
                "service", "ucs-dds-gateway-api"
        ));
    }
}
