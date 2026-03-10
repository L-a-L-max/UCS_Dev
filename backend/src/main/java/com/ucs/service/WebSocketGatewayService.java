package com.ucs.service;

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

        log.debug("WebSocket Gateway: Broadcast to {} partitions", partitionData.size());
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
