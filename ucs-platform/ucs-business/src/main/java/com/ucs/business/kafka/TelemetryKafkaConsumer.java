package com.ucs.business.kafka;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ucs.business.service.PartitionRoutingService;
import com.ucs.business.service.RedisService;
import com.ucs.business.service.TelemetryPersistenceService;
import com.ucs.business.service.WebSocketGatewayService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Kafka 遥测数据消费者（业务服务）。
 *
 * 消费 telemetry.processed topic（由 ucs-telemetry-ingest 校验/清洗后转发）。
 * ucs-telemetry-ingest 已完成：Epoch校验、Redis状态更新、GeoHash索引。
 * 本消费者职责：
 *   1. 自动注册未知无人机（含分区映射）
 *   2. 标记在线（冗余保证）
 *   3. 持久化遥测数据到 uav_latest_state 表
 *   4. 分区路由 + WebSocket 推送（TelemetryBatch 格式）
 *
 * 数据链路：
 *   telemetry.raw → [ingest: 校验/Redis/GeoHash] → telemetry.processed
 *     → [本消费者: 自动注册/持久化/分区路由/WebSocket广播] → 前端
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "kafka.enabled", havingValue = "true", matchIfMissing = true)
public class TelemetryKafkaConsumer {

    private final ObjectMapper objectMapper;
    private final PartitionRoutingService partitionRoutingService;
    private final TelemetryPersistenceService telemetryPersistenceService;
    private final WebSocketGatewayService webSocketGatewayService;
    private final RedisService redisService;

    /** 已知无人机缓存，避免每条消息都查库 */
    private final Set<String> knownDrones = ConcurrentHashMap.newKeySet();

    @KafkaListener(
            topics = "${kafka.topic.telemetry-processed:telemetry.processed}",
            groupId = "ucs-business-telemetry",
            concurrency = "4"
    )
    public void consumeTelemetry(String message) {
        try {
            Map<String, Object> payload = objectMapper.readValue(
                    message, new TypeReference<Map<String, Object>>() {});

            String uavId = String.valueOf(payload.get("uavId"));
            if (uavId == null || "null".equals(uavId)) {
                return;
            }

            // --- 解析时间戳（Ingest已校验，此处仅提取用于广播）---
            Object tsRaw = payload.get("timestamp");
            Instant msgTime = null;
            if (tsRaw instanceof Number) {
                msgTime = Instant.ofEpochMilli(((Number) tsRaw).longValue());
            } else if (tsRaw instanceof String) {
                try { msgTime = Instant.parse((String) tsRaw); } catch (Exception ignored) {}
            }

            // --- 自动注册未知无人机（含分区映射 observer+commander）---
            if (!knownDrones.contains(uavId)) {
                try {
                    // getPartitionsForDrone 内部会检查DB，如果不存在则自动创建drone+分区映射
                    partitionRoutingService.getPartitionsForDrone(uavId);
                    knownDrones.add(uavId);
                    log.info("[BusinessConsumer] Drone '{}' registered/confirmed with partitions", uavId);
                } catch (Exception regEx) {
                    log.warn("[BusinessConsumer] Drone registration failed for {}: {}", uavId, regEx.getMessage());
                }
            }

            // --- 标记在线（冗余保证，Ingest已做但TTL可能过期）---
            try {
                redisService.setDroneOnline(uavId);
            } catch (Exception redisEx) {
                log.debug("[BusinessConsumer] Redis setDroneOnline failed for {}: {}", uavId, redisEx.getMessage());
            }

            // --- 持久化到 uav_latest_state 表 ---
            try {
                telemetryPersistenceService.persistFromMap(payload);
            } catch (Exception persistEx) {
                log.error("[BusinessConsumer] Persistence failed for {}: {}", uavId, persistEx.getMessage());
            }

            // --- 分区路由 + WebSocket 推送 ---
            Instant timestamp = msgTime != null ? msgTime : Instant.now();
            try {
                Set<String> partitions = partitionRoutingService.getPartitionsForDrone(uavId);
                Map<String, List<Map<String, Object>>> partitionData = new LinkedHashMap<>();
                for (String partition : partitions) {
                    partitionData.computeIfAbsent(partition, k -> new ArrayList<>()).add(payload);
                }
                webSocketGatewayService.broadcastToPartitions(partitionData, timestamp);
            } catch (Exception routeEx) {
                log.warn("[BusinessConsumer] Partition routing failed for {}: {}", uavId, routeEx.getMessage());
            }

            // --- 全局广播（TelemetryBatch格式，独立于分区路由，始终执行）---
            try {
                webSocketGatewayService.broadcastAll(List.of(payload), timestamp);
            } catch (Exception wsEx) {
                log.warn("[BusinessConsumer] WebSocket broadcastAll failed: {}", wsEx.getMessage());
            }

        } catch (Exception e) {
            log.error("[BusinessConsumer] Failed to process telemetry message: {}", e.getMessage(), e);
        }
    }
}
