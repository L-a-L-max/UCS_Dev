package com.ucs.push.consumer;

import com.ucs.common.config.KafkaTopicConstants;
import com.ucs.common.dto.TelemetryMessage;
import com.ucs.common.service.RedisClusterService;
import com.ucs.common.service.ViewportFilterService;
import com.ucs.common.util.JsonUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.user.SimpUserRegistry;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 遥测数据推送消费者。
 * 从 Kafka telemetry.processed 批量消费 → 组装 TelemetryBatch → WebSocket STOMP 推送。
 *
 * 数据链路：
 *   telemetry.processed → [本服务: 批量聚合] → WebSocket STOMP
 *     - /topic/telemetry              全量推送（TelemetryBatch格式，前端主订阅）
 *     - /topic/drone/{uavId}          单机推送
 *     - /topic/telemetry/partition/{p} 分区推送（角色视图：Commander/Leader等）
 *
 * 前端期望格式 (TelemetryBatch):
 *   { "timestamp": "...", "msgSeqNumber": N, "homeLat": 0, "homeLon": 0, "homeAlt": 0,
 *     "numUavsTotal": N, "numUavsActive": N, "uavs": [ {TelemetryData}, ... ] }
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class TelemetryPushConsumer {

    private final SimpMessagingTemplate messagingTemplate;
    private final SimpUserRegistry userRegistry;
    private final ViewportFilterService viewportFilter;
    private final RedisClusterService redisClusterService;

    private final AtomicLong msgSeqCounter = new AtomicLong(0);

    @KafkaListener(
            topics = KafkaTopicConstants.TELEMETRY_PROCESSED,
            groupId = KafkaTopicConstants.GROUP_PUSH,
            batch = "true",
            concurrency = "4"
    )
    public void consumeBatch(List<ConsumerRecord<String, String>> records) {
        if (records.isEmpty()) return;

        try {
            // 1. Parse all messages in this batch
            List<Map<String, Object>> allDrones = new ArrayList<>(records.size());
            // Partition routing: partition -> list of drone data
            Map<String, List<Map<String, Object>>> partitionDrones = new LinkedHashMap<>();

            for (ConsumerRecord<String, String> record : records) {
                try {
                    TelemetryMessage msg = JsonUtil.parse(record.value(), TelemetryMessage.class);
                    String uavId = msg.getUavId();
                    if (uavId == null) continue;

                    Map<String, Object> droneData = buildDroneDataMap(msg);
                    allDrones.add(droneData);

                    // Per-drone topic
                    messagingTemplate.convertAndSend("/topic/drone/" + uavId,
                            JsonUtil.toJson(droneData));

                    // Partition routing: look up which partitions this drone belongs to
                    Set<String> partitions = redisClusterService.getDronePartitions(uavId);
                    for (String partition : partitions) {
                        partitionDrones.computeIfAbsent(partition, k -> new ArrayList<>())
                                .add(droneData);
                    }
                } catch (Exception e) {
                    log.debug("[Push] Failed to parse record: {}", e.getMessage());
                }
            }

            if (allDrones.isEmpty()) return;

            // 2. Build TelemetryBatch and broadcast to /topic/telemetry
            Map<String, Object> batch = buildTelemetryBatch(allDrones);
            messagingTemplate.convertAndSend("/topic/telemetry", batch);

            // 3. Send partition-specific batches to /topic/telemetry/partition/{partitionName}
            for (Map.Entry<String, List<Map<String, Object>>> entry : partitionDrones.entrySet()) {
                Map<String, Object> partitionMsg = new LinkedHashMap<>();
                partitionMsg.put("partition", entry.getKey());
                partitionMsg.put("timestamp", Instant.now().toString());
                partitionMsg.put("drones", entry.getValue());
                messagingTemplate.convertAndSend(
                        "/topic/telemetry/partition/" + entry.getKey(), partitionMsg);
            }

            log.trace("[Push] Broadcast batch: {} drones, {} partitions",
                    allDrones.size(), partitionDrones.size());

        } catch (Exception e) {
            log.error("[Push] Failed to push telemetry batch: {}", e.getMessage());
        }
    }

    /**
     * Build TelemetryBatch map matching the frontend TelemetryBatch interface.
     */
    private Map<String, Object> buildTelemetryBatch(List<Map<String, Object>> drones) {
        long activeCount = drones.stream()
                .filter(d -> Boolean.TRUE.equals(d.get("isActive")))
                .count();

        Map<String, Object> batch = new LinkedHashMap<>();
        batch.put("timestamp", Instant.now().toString());
        batch.put("msgSeqNumber", msgSeqCounter.incrementAndGet());
        batch.put("homeLat", 0.0);
        batch.put("homeLon", 0.0);
        batch.put("homeAlt", 0.0);
        batch.put("numUavsTotal", drones.size());
        batch.put("numUavsActive", activeCount);
        batch.put("uavs", drones);
        return batch;
    }

    /**
     * Convert TelemetryMessage to a Map matching the frontend TelemetryData interface.
     */
    private Map<String, Object> buildDroneDataMap(TelemetryMessage msg) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("uavId", msg.getUavId());
        map.put("uavName", msg.getUavName() != null ? msg.getUavName() : msg.getUavId());
        map.put("timestamp", Instant.ofEpochMilli(msg.getTimestamp()).toString());
        map.put("lat", msg.getLat());
        map.put("lon", msg.getLon());
        map.put("alt", msg.getAlt());
        map.put("heading", msg.getHeading());
        map.put("groundSpeed", msg.getGroundSpeed());
        map.put("verticalSpeed", msg.getVerticalSpeed());
        map.put("nedX", msg.getNedX());
        map.put("nedY", msg.getNedY());
        map.put("nedZ", msg.getNedZ());
        map.put("vx", msg.getVx());
        map.put("vy", msg.getVy());
        map.put("vz", msg.getVz());
        map.put("dataAge", 0.0);
        map.put("msgCount", 0);
        map.put("isActive", true);
        map.put("armed", msg.isArmed());
        map.put("flightMode", msg.getFlightMode() != null ? msg.getFlightMode() : "");
        map.put("batteryPercent", msg.getBatteryPercent());
        return map;
    }
}
