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
            List<Map<String, Object>> drones = entry.getValue();

            String topic = "/topic/telemetry/partition/" + partitionName;
            Map<String, Object> message = new LinkedHashMap<>();
            message.put("partition", partitionName);
            message.put("timestamp", timestamp.toString());
            message.put("drones", drones);
            messagingTemplate.convertAndSend(topic, message);
        }

        log.info("[WebSocket] Broadcast to {} partition(s)", partitionData.size());
        for (Map.Entry<String, List<Map<String, Object>>> entry2 : partitionData.entrySet()) {
            log.info("[WebSocket]   -> /topic/telemetry/partition/{} ({} drone(s))",
                    entry2.getKey(), entry2.getValue().size());
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

    /**
     * Broadcast all telemetry data to the global topic (for monitoring/persistence).
     *
     * @param allTelemetry List of all drone telemetry messages
     * @param timestamp    The telemetry timestamp
     */
    public void broadcastAll(List<Map<String, Object>> allTelemetry, Instant timestamp) {
        // Send to /topic/telemetry/all
        Map<String, Object> allDataMsg = new LinkedHashMap<>();
        allDataMsg.put("timestamp", timestamp.toString());
        allDataMsg.put("numDrones", allTelemetry.size());
        allDataMsg.put("drones", allTelemetry);
        messagingTemplate.convertAndSend("/topic/telemetry/all", allDataMsg);

        // Send to legacy /topic/telemetry for backward compatibility
        Map<String, Object> legacyBatch = new LinkedHashMap<>();
        legacyBatch.put("timestamp", timestamp.toString());
        legacyBatch.put("msgSeqNumber", System.currentTimeMillis() / 1000);
        legacyBatch.put("numUavsTotal", allTelemetry.size());
        legacyBatch.put("numUavsActive", allTelemetry.size());
        legacyBatch.put("uavs", allTelemetry);
        messagingTemplate.convertAndSend("/topic/telemetry", legacyBatch);
    }
}
