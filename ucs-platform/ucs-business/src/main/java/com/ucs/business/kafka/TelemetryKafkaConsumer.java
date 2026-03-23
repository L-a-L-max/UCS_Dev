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
    private final EpochManager epochManager;

    /** 已知无人机缓存，避免每条消息都查库 */
    private final Set<String> knownDrones = ConcurrentHashMap.newKeySet();

    /**
     * 聚合缓冲区：uavId -> 最新遥测 payload。
     * 多个 Kafka 消费线程写入，定时任务读取并清空。
     * ConcurrentHashMap 保证线程安全，每架无人机只保留最新数据。
     */
    private final ConcurrentHashMap<String, Map<String, Object>> latestPayloads = new ConcurrentHashMap<>();

    /**
     * 全量无人机快照：保留所有已知在线无人机的最新数据。
     * 与 latestPayloads（增量缓冲区）不同，此 Map 不会被清空，
     * 确保每次分区广播都包含所有无人机（即使某架无人机在该周期内没有新数据）。
     */
    private final ConcurrentHashMap<String, Map<String, Object>> allDroneSnapshot = new ConcurrentHashMap<>();

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

            // --- 同步 Epoch（确保 CommandKafkaProducer 发送正确的 epoch）---
            try {
                Object epochObj = payload.get("epoch");
                if (epochObj instanceof Number) {
                    long msgEpoch = ((Number) epochObj).longValue();
                    epochManager.validateEpoch(uavId, msgEpoch);
                }
            } catch (Exception epochEx) {
                log.debug("[BusinessConsumer] Epoch sync failed for {}: {}", uavId, epochEx.getMessage());
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
            allDroneSnapshot.put(uavId, payload);

        } catch (Exception e) {
            log.error("[BusinessConsumer] Failed to process telemetry message: {}", e.getMessage(), e);
        }
    }

    /**
     * 定时刷新聚合缓冲区，统一广播遥测数据到分区 topic。
     *
     * 每 500ms 执行，将全量无人机快照广播到各分区 topic。
     *
     * 关键设计（参考 DDSTest 分支渲染逻辑）：
     *   1. 只广播到分区 topic（/topic/telemetry/partition/{name}），
     *      不再广播到全局 /topic/telemetry。
     *      原因：前端 useTelemetryWebSocket hook 总是订阅 /topic/telemetry，
     *      每次收到消息都触发 setLastBatch() → React state 变更 → CommanderView re-render → 界面闪烁。
     *      Commander/Leader 使用分区 topic 作为主数据源，Observer 在 App.tsx 中单独处理。
     *   2. 每次广播发送全量快照（allDroneSnapshot），而非仅增量数据。
     *      前端 handlePartitionData 通过 Map merge 合并数据，全量快照确保每架无人机都在。
     *      与 DDSTest 的 DDSGatewayController 行为一致：每次 HTTP 批次包含所有无人机。
     */
    @Scheduled(fixedRate = 500)
    public void flushTelemetryBroadcast() {
        if (allDroneSnapshot.isEmpty()) {
            return;
        }

        // 消费增量缓冲区（避免无限增长），实际广播使用全量快照
        latestPayloads.clear();

        Instant now = Instant.now();

        // --- 全量分区路由 + WebSocket 推送 ---
        // 使用 allDroneSnapshot（全量），确保每个分区每次广播都包含其所有无人机
        try {
            Map<String, List<Map<String, Object>>> partitionData = new LinkedHashMap<>();
            for (Map<String, Object> payload : allDroneSnapshot.values()) {
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

        // 注意：不再广播到 /topic/telemetry，避免触发前端 setLastBatch re-render
    }
}
