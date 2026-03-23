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
import org.springframework.scheduling.annotation.Scheduled;
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

    /**
     * 聚合缓冲区：uavId -> 最新遥测 payload。
     * 多个 Kafka 消费线程写入，定时任务读取并清空。
     * ConcurrentHashMap 保证线程安全，每架无人机只保留最新数据。
     */
    private final ConcurrentHashMap<String, Map<String, Object>> latestPayloads = new ConcurrentHashMap<>();

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

            // --- 存入聚合缓冲区（定时任务统一广播，避免单条推送导致前端闪烁）---
            latestPayloads.put(uavId, payload);

        } catch (Exception e) {
            log.error("[BusinessConsumer] Failed to process telemetry message: {}", e.getMessage(), e);
        }
    }

    /**
     * 定时刷新聚合缓冲区，统一广播所有无人机的最新遥测数据。
     * 每 500ms 执行一次，将缓冲区中所有无人机数据组装为一个 TelemetryBatch 推送，
     * 前端收到的每个 batch 都包含所有在线无人机，不再闪烁。
     */
    @Scheduled(fixedRate = 500)
    public void flushTelemetryBroadcast() {
        if (latestPayloads.isEmpty()) {
            return;
        }

        // 取出所有数据并清空缓冲区
        Map<String, Map<String, Object>> snapshot = new HashMap<>(latestPayloads);
        latestPayloads.clear();

        Instant now = Instant.now();
        List<Map<String, Object>> allPayloads = new ArrayList<>(snapshot.values());

        // --- 全局广播（TelemetryBatch格式，包含所有无人机）---
        try {
            webSocketGatewayService.broadcastAll(allPayloads, now);
        } catch (Exception wsEx) {
            log.warn("[BusinessConsumer] WebSocket broadcastAll failed: {}", wsEx.getMessage());
        }

        // --- 分区路由 + WebSocket 推送 ---
        try {
            Map<String, List<Map<String, Object>>> partitionData = new LinkedHashMap<>();
            for (Map<String, Object> payload : allPayloads) {
                String uavId = String.valueOf(payload.get("uavId"));
                Set<String> partitions = partitionRoutingService.getPartitionsForDrone(uavId);
                for (String partition : partitions) {
                    partitionData.computeIfAbsent(partition, k -> new ArrayList<>()).add(payload);
                }
            }
            webSocketGatewayService.broadcastToPartitions(partitionData, now);
        } catch (Exception routeEx) {
            log.warn("[BusinessConsumer] Partition routing failed: {}", routeEx.getMessage());
        }
    }
}
