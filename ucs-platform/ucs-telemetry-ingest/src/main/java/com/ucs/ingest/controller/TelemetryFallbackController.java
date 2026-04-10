package com.ucs.ingest.controller;

import com.ucs.common.config.KafkaTopicConstants;
import com.ucs.common.service.EpochValidationService;
import com.ucs.common.service.GeoSpatialService;
import com.ucs.common.service.RedisClusterService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.*;

/**
 * DDS Gateway HTTP fallback channel.
 * When Kafka is unavailable, dds_gateway.py submits telemetry via HTTP POST.
 * Data is forwarded to Kafka when possible; otherwise written directly to Redis.
 *
 * This is an internal endpoint accessed only through the API Gateway.
 * Authentication is handled at the API Gateway layer (JWT whitelist + network isolation).
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/dds-gateway")
@RequiredArgsConstructor
public class TelemetryFallbackController {

    private final RedisClusterService redisService;
    private final EpochValidationService epochService;
    private final GeoSpatialService geoService;
    private final KafkaTemplate<String, String> kafkaTemplate;

    /**
     * Receive batch telemetry from DDS Gateway (HTTP fallback).
     * Request format is compatible with the legacy DDSGatewayController.
     */
    @PostMapping("/telemetry")
    public ResponseEntity<Map<String, Object>> receiveTelemetry(
            @RequestBody Map<String, Object> payload) {

        try {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> drones = (List<Map<String, Object>>) payload.get("drones");
            if (drones == null || drones.isEmpty()) {
                return ResponseEntity.ok(Map.of("status", "ok", "processed", 0));
            }

            int processed = 0;
            for (Map<String, Object> droneData : drones) {
                String uavId = String.valueOf(droneData.get("uavId"));
                if (uavId == null || "null".equals(uavId)) {
                    continue;
                }

                // Try forwarding to Kafka first
                try {
                    String json = com.ucs.common.util.JsonUtil.toJson(droneData);
                    kafkaTemplate.send(KafkaTopicConstants.TELEMETRY_RAW, uavId, json);
                    processed++;
                    continue;
                } catch (Exception kafkaEx) {
                    log.debug("[Fallback] Kafka unavailable, processing directly: {}", kafkaEx.getMessage());
                }

                // Direct processing when Kafka is unavailable
                long epoch = droneData.get("epoch") != null
                        ? ((Number) droneData.get("epoch")).longValue() : 0;
                if (!epochService.validate(uavId, epoch)) {
                    continue;
                }

                Map<String, String> stateMap = new HashMap<>();
                stateMap.put("lat", String.valueOf(droneData.getOrDefault("lat", 0.0)));
                stateMap.put("lon", String.valueOf(droneData.getOrDefault("lon", 0.0)));
                stateMap.put("alt", String.valueOf(droneData.getOrDefault("alt", 0.0)));
                stateMap.put("speed", String.valueOf(droneData.getOrDefault("groundSpeed", 0.0)));
                stateMap.put("heading", String.valueOf(droneData.getOrDefault("heading", 0.0)));
                stateMap.put("armed", String.valueOf(droneData.getOrDefault("armed", false)));
                stateMap.put("epoch", String.valueOf(epoch));
                stateMap.put("timestamp", String.valueOf(System.currentTimeMillis()));

                redisService.updateDroneState(uavId, stateMap);
                redisService.setDroneOnline(uavId);

                double lat = ((Number) droneData.getOrDefault("lat", 0.0)).doubleValue();
                double lon = ((Number) droneData.getOrDefault("lon", 0.0)).doubleValue();
                if (lat != 0.0 || lon != 0.0) {
                    geoService.updateDronePosition(uavId, lat, lon);
                }
                processed++;
            }

            log.info("[Fallback] Processed {} drone(s) via HTTP fallback", processed);
            return ResponseEntity.ok(Map.of(
                    "status", "ok",
                    "processed", processed,
                    "channel", "http-fallback"
            ));
        } catch (Exception e) {
            log.error("[Fallback] Failed to process telemetry: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Receive command acknowledgment from DDS Gateway (HTTP fallback).
     */
    @PostMapping("/command-ack")
    public ResponseEntity<Map<String, Object>> receiveCommandAck(
            @RequestBody Map<String, Object> payload) {

        try {
            String uavId = String.valueOf(payload.get("uavId"));
            log.info("[Fallback] Command ack received: uavId={}, command={}, result={}",
                    uavId, payload.get("command"), payload.get("result"));

            // Try forwarding to Kafka
            try {
                String json = com.ucs.common.util.JsonUtil.toJson(payload);
                kafkaTemplate.send(KafkaTopicConstants.COMMANDS_ACK, uavId, json);
            } catch (Exception kafkaEx) {
                log.warn("[Fallback] Could not forward ack to Kafka: {}", kafkaEx.getMessage());
            }

            return ResponseEntity.ok(Map.of("status", "ok"));
        } catch (Exception e) {
            log.error("[Fallback] Failed to process command ack: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Health check for DDS Gateway to verify ingest service reachability.
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        return ResponseEntity.ok(Map.of(
                "status", "ok",
                "timestamp", Instant.now().toString(),
                "service", "ucs-telemetry-ingest"
        ));
    }
}
