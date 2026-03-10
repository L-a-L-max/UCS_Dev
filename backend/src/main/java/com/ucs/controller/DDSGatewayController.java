package com.ucs.controller;

import com.ucs.service.PartitionRoutingService;
import com.ucs.service.RedisService;
import com.ucs.service.TelemetryPersistenceService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.*;

/**
 * REST API endpoint for the external DDS Gateway (Python script).
 * Receives telemetry data from the DDS network via the Python gateway,
 * performs partition routing, WebSocket broadcasting, and persistence.
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
    private final TelemetryPersistenceService telemetryPersistenceService;
    private final SimpMessagingTemplate messagingTemplate;
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

                // Enrich message with uavName for frontend display
                droneData.put("uavName", uavId);
                droneData.put("timestamp", timestamp.toString());
                allTelemetry.add(droneData);

                // Persist telemetry
                telemetryPersistenceService.persistFromMap(droneData);

                // Get partition routing for this drone
                Set<String> partitions = partitionRoutingService.getPartitionsForDrone(uavId);
                for (String partition : partitions) {
                    partitionData.computeIfAbsent(partition, k -> new ArrayList<>()).add(droneData);
                }
            }

            // Send to partition-specific WebSocket topics
            for (Map.Entry<String, List<Map<String, Object>>> entry : partitionData.entrySet()) {
                String topic = "/topic/telemetry/partition/" + entry.getKey();
                Map<String, Object> message = new LinkedHashMap<>();
                message.put("partition", entry.getKey());
                message.put("timestamp", timestamp.toString());
                message.put("drones", entry.getValue());
                messagingTemplate.convertAndSend(topic, message);
            }

            // Send to legacy /topic/telemetry for backward compatibility
            Map<String, Object> legacyBatch = new LinkedHashMap<>();
            legacyBatch.put("timestamp", timestamp.toString());
            legacyBatch.put("msgSeqNumber", System.currentTimeMillis() / 1000);
            legacyBatch.put("numUavsTotal", allTelemetry.size());
            legacyBatch.put("numUavsActive", allTelemetry.size());
            legacyBatch.put("uavs", allTelemetry);
            messagingTemplate.convertAndSend("/topic/telemetry", legacyBatch);

            log.debug("DDS Gateway: Processed {} drones, {} partitions",
                    drones.size(), partitionData.size());

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
