package com.ucs.business.controller;

import com.ucs.business.service.PartitionRoutingService;
import com.ucs.business.service.RedisService;
import com.ucs.business.service.TelemetryPersistenceService;
import com.ucs.business.service.WebSocketGatewayService;
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
 * then delegates to three gateway services:
 * 
 *   Gateway 1 (DDS Routing): Python dds_gateway.py -> this controller (partition routing)
 *   Gateway 2 (Persistence): TelemetryPersistenceService (batch writes to PostgreSQL)
 *   Gateway 3 (WebSocket):   WebSocketGatewayService (broadcasts to frontend subscribers)
 * 
 * Authentication: Uses a shared API key (dds.gateway.api-key) in the
 * X-Gateway-Key header to authenticate gateway requests.
 * 
 * [Phase 1 NOTE] This HTTP endpoint is preserved as fallback. The primary data path
 * is now: Gateway -> Kafka(telemetry.raw) -> TelemetryKafkaConsumer.
 * When Kafka is fully stable, this endpoint can be deprecated.
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
    private final SimpMessagingTemplate messagingTemplate;

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
            // 只广播到分区 topic，不广播到全局 /topic/telemetry
            // 原因：useTelemetryWebSocket hook 总是订阅 /topic/telemetry，
            // 每次消息触发 setLastBatch() → React state 变更 → CommanderView re-render → 界面闪烁
            // Commander/Leader 使用分区 topic，Observer 在 App.tsx 中单独处理
            webSocketGatewayService.broadcastToPartitions(partitionData, timestamp);

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
     * Receive command acknowledgment from the DDS gateway.
     * PX4 sends VehicleCommandAck after processing a command.
     * This endpoint forwards the ack to frontend clients via WebSocket
     * for two-stage command feedback (Stage 1: command sent, Stage 2: PX4 acknowledged).
     *
     * Request body format:
     * {
     *   "uavId": "px4_1",
     *   "command": 400,
     *   "result": 0,
     *   "timestamp": 1700000000.0
     * }
     *
     * PX4 result codes: 0=ACCEPTED, 1=TEMPORARILY_REJECTED, 2=DENIED,
     * 3=UNSUPPORTED, 4=FAILED, 5=IN_PROGRESS, 6=CANCELLED
     */
    @PostMapping("/command-ack")
    @Operation(summary = "Receive command acknowledgment from DDS gateway")
    public ResponseEntity<Map<String, Object>> receiveCommandAck(
            @RequestHeader(value = "X-Gateway-Key", required = false) String apiKey,
            @RequestBody Map<String, Object> payload) {

        if (!gatewayApiKey.equals(apiKey)) {
            return ResponseEntity.status(401).body(Map.of("error", "Invalid API key"));
        }

        try {
            String uavId = String.valueOf(payload.get("uavId"));
            int command = ((Number) payload.getOrDefault("command", 0)).intValue();
            int result = ((Number) payload.getOrDefault("result", -1)).intValue();

            log.info("[CommandAck] uavId={}, command={}, result={}", uavId, command, result);

            // Broadcast command ack to frontend via WebSocket
            Map<String, Object> ackMessage = new LinkedHashMap<>();
            ackMessage.put("type", "command_ack");
            ackMessage.put("uavId", uavId);
            ackMessage.put("command", command);
            ackMessage.put("result", result);
            ackMessage.put("resultText", commandResultToText(result));
            ackMessage.put("timestamp", Instant.now().toString());
            messagingTemplate.convertAndSend("/topic/command-ack", ackMessage);

            // Also send to partition-specific topics
            Set<String> partitions = partitionRoutingService.getPartitionsForDrone(uavId);
            for (String partition : partitions) {
                messagingTemplate.convertAndSend(
                        "/topic/command-ack/partition/" + partition, ackMessage);
            }

            return ResponseEntity.ok(Map.of("status", "ok"));
        } catch (Exception e) {
            log.error("[CommandAck] Failed to process: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    private static String commandResultToText(int result) {
        return switch (result) {
            case 0 -> "ACCEPTED";
            case 1 -> "TEMPORARILY_REJECTED";
            case 2 -> "DENIED";
            case 3 -> "UNSUPPORTED";
            case 4 -> "FAILED";
            case 5 -> "IN_PROGRESS";
            case 6 -> "CANCELLED";
            default -> "UNKNOWN(" + result + ")";
        };
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
