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
import java.util.concurrent.atomic.AtomicLong;

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
     * 确保每次广播都包含所有无人机（即使某架无人机在该周期内没有新数据）。
     */
    private final ConcurrentHashMap<String, Map<String, Object>> allDroneSnapshot = new ConcurrentHashMap<>();

    /** 全局广播节流：上次全局广播时间戳 */
    private final AtomicLong lastGlobalBroadcastMs = new AtomicLong(0);

    /** 全局广播间隔（毫秒）：降低 /topic/telemetry 频率，减少不必要的前端 re-render */
    private static final long GLOBAL_BROADCAST_INTERVAL_MS = 3000;

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
     * 定时刷新聚合缓冲区，统一广播遥测数据。
     *
     * 分区广播（/topic/telemetry/partition/{name}）：每 500ms，只发送本周期有新数据的无人机。
     * 全局广播（/topic/telemetry）：每 3 秒，发送全量无人机快照。
     *
     * 分离两种广播频率的原因：
     *   - 前端 useTelemetryWebSocket hook 订阅 /topic/telemetry 后会触发 setLastBatch
     *     状态更新，即使 Commander 不使用该数据也会导致 React re-render。
     *   - 分区广播是 Commander/Leader 的主要数据源，保持 500ms 实时性。
     *   - 全局广播降频到 3s，减少不必要的 re-render，消除界面闪烁。
     */
    @Scheduled(fixedRate = 500)
    public void flushTelemetryBroadcast() {
        if (latestPayloads.isEmpty()) {
            return;
        }

        // 取出本周期增量数据并清空缓冲区
        Map<String, Map<String, Object>> snapshot = new HashMap<>(latestPayloads);
        latestPayloads.clear();

        Instant now = Instant.now();

        // --- 分区路由 + WebSocket 推送（500ms 增量，仅本周期有新数据的无人机）---
        try {
            List<Map<String, Object>> incrementalPayloads = new ArrayList<>(snapshot.values());
            Map<String, List<Map<String, Object>>> partitionData = new LinkedHashMap<>();
            for (Map<String, Object> payload : incrementalPayloads) {
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

        // --- 全局广播（3s 全量快照，降频减少前端 re-render）---
        long nowMs = now.toEpochMilli();
        if (nowMs - lastGlobalBroadcastMs.get() >= GLOBAL_BROADCAST_INTERVAL_MS) {
            lastGlobalBroadcastMs.set(nowMs);
            try {
                List<Map<String, Object>> allPayloads = new ArrayList<>(allDroneSnapshot.values());
                if (!allPayloads.isEmpty()) {
                    webSocketGatewayService.broadcastAll(allPayloads, now);
                }
            } catch (Exception wsEx) {
                log.warn("[BusinessConsumer] WebSocket broadcastAll failed: {}", wsEx.getMessage());
            }
        }
    }
}
