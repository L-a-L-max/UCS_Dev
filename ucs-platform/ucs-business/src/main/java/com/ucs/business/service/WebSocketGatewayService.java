package com.ucs.business.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.*;

/**
 * Gateway 3: WebSocket Server Gateway
 * 
 * Responsible for broadcasting partition-specific telemetry data to frontend clients.
 * Each frontend client subscribes to their partition topic (e.g., /topic/telemetry/partition/user_3).
 * 
 * Data flow:
 *   DDSGatewayController (receives from Python DDS Gateway)
 *     -> PartitionRoutingService (determines partitions)
 *     -> WebSocketGatewayService (broadcasts to WebSocket subscribers)
 * 
 * WebSocket topics:
 *   /topic/telemetry/partition/{partitionName}  - partition-specific data
 *   /topic/telemetry/all                        - all telemetry (for persistence/monitoring)
 *   /topic/telemetry                            - legacy format for backward compatibility
 * 
 * Startup: This service runs within the Spring Boot backend process.
 *          It is activated automatically when the backend starts.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class WebSocketGatewayService {

    private final SimpMessagingTemplate messagingTemplate;

    /**
     * Broadcast telemetry data to partition-specific WebSocket topics.
     * Called by DDSGatewayController after partition routing.
     *
     * @param partitionData Map of partition name -> list of drone telemetry messages
     * @param timestamp     The telemetry timestamp
     */
    public void broadcastToPartitions(Map<String, List<Map<String, Object>>> partitionData, Instant timestamp) {
        for (Map.Entry<String, List<Map<String, Object>>> entry : partitionData.entrySet()) {
            String partitionName = entry.getKey();
            List<Map<String, Object>> rawDrones = entry.getValue();

            // Convert to frontend TelemetryData format
            List<Map<String, Object>> drones = new ArrayList<>(rawDrones.size());
            for (Map<String, Object> raw : rawDrones) {
                drones.add(buildTelemetryDataMap(raw));
            }

            String topic = "/topic/telemetry/partition/" + partitionName;
            Map<String, Object> message = new LinkedHashMap<>();
            message.put("partition", partitionName);
            message.put("timestamp", timestamp.toString());
            message.put("drones", drones);
            messagingTemplate.convertAndSend(topic, message);
        }

        if (log.isDebugEnabled()) {
            log.debug("[WebSocket] Broadcast to {} partition(s)", partitionData.size());
            for (Map.Entry<String, List<Map<String, Object>>> entry2 : partitionData.entrySet()) {
                log.debug("[WebSocket]   -> /topic/telemetry/partition/{} ({} drone(s))",
                        entry2.getKey(), entry2.getValue().size());
            }
        }
    }

    /**
     * Notify specific partitions that a drone has been removed from their view.
     * Called after permission transfer when a drone's partition routing changes.
     *
     * @param uavId              The drone identifier that was removed
     * @param removedPartitions  The partitions that no longer have access to this drone
     */
    public void notifyDroneRemoved(String uavId, Set<String> removedPartitions) {
        if (removedPartitions == null || removedPartitions.isEmpty()) return;

        for (String partition : removedPartitions) {
            String topic = "/topic/telemetry/partition/" + partition;
            Map<String, Object> message = new LinkedHashMap<>();
            message.put("partition", partition);
            message.put("type", "drone_removed");
            message.put("timestamp", Instant.now().toString());
            message.put("removedDrones", List.of(uavId));
            message.put("drones", List.of()); // empty drones list for compatibility
            messagingTemplate.convertAndSend(topic, message);
        }

        log.info("[WebSocket] Notified {} partition(s) about drone '{}' removal: {}",
                removedPartitions.size(), uavId, removedPartitions);
    }

    /**
     * Broadcast gateway/drone offline status to all connected frontend clients.
     *
     * Called by GatewayHealthMonitor when it detects that:
     *   - No drone heartbeat keys exist in Redis (all TTLs expired)
     *   - This persists for > 60 seconds (confirming gateway is truly down, not transient)
     *
     * Frontend should listen on /topic/drone-status to detect offline events
     * and display appropriate UI warnings (e.g., "Gateway offline - all drones unreachable").
     *
     * @param offlineDroneIds Set of drone IDs that went offline
     * @param reason          Human-readable reason for the offline event
     */
    public void broadcastOfflineStatus(Set<String> offlineDroneIds, String reason) {
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("type", "gateway_offline");
        message.put("timestamp", Instant.now().toString());
        message.put("reason", reason);
        message.put("offlineDrones", offlineDroneIds);
        message.put("droneCount", offlineDroneIds.size());

        // Send to dedicated drone-status topic
        messagingTemplate.convertAndSend("/topic/drone-status", message);

        // Also send to each partition so partition-specific UIs get notified
        for (String droneId : offlineDroneIds) {
            // Notify via existing partition topics that these drones are removed
            notifyDroneRemoved(droneId, Set.of("__all__"));
        }

        log.warn("[WebSocket] Broadcast GATEWAY_OFFLINE: {} drone(s) affected, reason={}",
                offlineDroneIds.size(), reason);
    }

    /** 消息序列号计数器 */
    private long msgSeqCounter = 0;

    /**
     * Broadcast all telemetry data to the global topic.
     * Sends TelemetryBatch format matching frontend interface:
     *   { timestamp, msgSeqNumber, homeLat, homeLon, homeAlt,
     *     numUavsTotal, numUavsActive, uavs: [TelemetryData...] }
     *
     * @param allTelemetry List of all drone telemetry messages (raw Map from Kafka)
     * @param timestamp    The telemetry timestamp
     */
    public void broadcastAll(List<Map<String, Object>> allTelemetry, Instant timestamp) {
        // Convert raw Kafka payload maps to frontend TelemetryData format
        List<Map<String, Object>> uavs = new ArrayList<>(allTelemetry.size());
        for (Map<String, Object> raw : allTelemetry) {
            uavs.add(buildTelemetryDataMap(raw));
        }

        long activeCount = uavs.stream()
                .filter(d -> Boolean.TRUE.equals(d.get("isActive")))
                .count();

        // Build TelemetryBatch matching frontend TelemetryBatch interface exactly
        Map<String, Object> batch = new LinkedHashMap<>();
        batch.put("timestamp", timestamp.toString());
        batch.put("msgSeqNumber", ++msgSeqCounter);
        batch.put("homeLat", 0.0);
        batch.put("homeLon", 0.0);
        batch.put("homeAlt", 0.0);
        batch.put("numUavsTotal", uavs.size());
        batch.put("numUavsActive", activeCount);
        batch.put("uavs", uavs);

        // Send to /topic/telemetry (frontend main subscription)
        messagingTemplate.convertAndSend("/topic/telemetry", batch);

        // Also send to /topic/telemetry/all (monitoring/persistence)
        messagingTemplate.convertAndSend("/topic/telemetry/all", batch);
    }

    /**
     * Convert raw Kafka payload Map to frontend TelemetryData format.
     * Handles both field name differences and type coercion.
     */
    private Map<String, Object> buildTelemetryDataMap(Map<String, Object> raw) {
        Map<String, Object> map = new LinkedHashMap<>();
        String uavId = String.valueOf(raw.getOrDefault("uavId", ""));
        map.put("uavId", uavId);
        map.put("uavName", raw.getOrDefault("uavName", uavId));

        // Timestamp: convert epoch millis to ISO string
        Object ts = raw.get("timestamp");
        if (ts instanceof Number) {
            map.put("timestamp", Instant.ofEpochMilli(((Number) ts).longValue()).toString());
        } else if (ts instanceof String) {
            map.put("timestamp", ts);
        } else {
            map.put("timestamp", Instant.now().toString());
        }

        map.put("lat", toDouble(raw.get("lat")));
        map.put("lon", toDouble(raw.get("lon")));
        map.put("alt", toDouble(raw.get("alt")));
        map.put("heading", toDouble(raw.get("heading")));
        map.put("groundSpeed", toDouble(raw.get("groundSpeed")));
        map.put("verticalSpeed", toDouble(raw.get("verticalSpeed")));
        map.put("nedX", toDouble(raw.get("nedX")));
        map.put("nedY", toDouble(raw.get("nedY")));
        map.put("nedZ", toDouble(raw.get("nedZ")));
        map.put("vx", toDouble(raw.get("vx")));
        map.put("vy", toDouble(raw.get("vy")));
        map.put("vz", toDouble(raw.get("vz")));
        map.put("dataAge", 0.0);
        map.put("msgCount", 0);
        map.put("isActive", true);
        map.put("armed", toBool(raw.get("armed")));
        map.put("flightMode", raw.getOrDefault("flightMode", ""));
        map.put("batteryPercent", toDouble(raw.get("batteryPercent")));
        return map;
    }

    private static double toDouble(Object val) {
        if (val instanceof Number) return ((Number) val).doubleValue();
        if (val instanceof String) {
            try { return Double.parseDouble((String) val); } catch (Exception e) { return 0.0; }
        }
        return 0.0;
    }

    private static boolean toBool(Object val) {
        if (val instanceof Boolean) return (Boolean) val;
        if (val instanceof String) return "true".equalsIgnoreCase((String) val);
        return false;
    }
}
