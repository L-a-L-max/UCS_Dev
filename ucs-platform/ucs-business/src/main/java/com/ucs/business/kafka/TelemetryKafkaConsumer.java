package com.ucs.business.kafka;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ucs.business.service.PartitionRoutingService;
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
 * T-63: Kafka 遥测数据消费者（业务服务）— 仅负责业务逻辑。
 *
 * 消费 telemetry.processed topic（由 ucs-telemetry-ingest 校验/清洗后转发）。
 *
 * 职责划分（T-63 清理后）：
 *   - 本服务仅负责：自动注册未知无人机（含分区映射）+ 实时分区路由 + WebSocket 推送
 *   - Epoch校验：由 ucs-telemetry-ingest 负责（EpochValidationService）
 *   - Redis心跳：由 ucs-telemetry-ingest 负责（RedisClusterService.setDroneOnline）
 *   - 遥测持久化：由 ucs-telemetry-store 负责（TelemetryBatchConsumer）
 *   - WebSocket全量广播：由 ucs-realtime-push 负责（TelemetryPushConsumer）
 *
 * 实时性设计（10Hz 目标）：
 *   - 每条 Kafka 消息到达后立即处理并推送到 WebSocket，无 @Scheduled 缓冲
 *   - 前端通过 partitioned topic 订阅，只收到自己分区的数据
 *   - allDroneSnapshot 保留所有在线无人机最新数据，确保每次推送包含全量
 *   - DroneHeartbeatService 定时扫描 ZSet，超时 3 秒判定离线并清理
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "kafka.enabled", havingValue = "true", matchIfMissing = true)
public class TelemetryKafkaConsumer {

    private final ObjectMapper objectMapper;
    private final PartitionRoutingService partitionRoutingService;
    private final WebSocketGatewayService webSocketGatewayService;

    /** 已知无人机缓存，避免每条消息都查库 */
    private final Set<String> knownDrones = ConcurrentHashMap.newKeySet();

    /**
     * 全量无人机快照：保留所有已知在线无人机的最新数据。
     * 每条 Kafka 消息更新对应 uavId 的数据后，整个快照被推送到分区 topic。
     * DroneHeartbeatService 会清理超时的无人机条目。
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

            // --- T-63: 仅负责自动注册 + 分区路由 + WebSocket推送 ---
            // Epoch校验、Redis心跳、持久化均由专职微服务负责，此处不再重复

            // 自动注册未知无人机（含分区映射 observer+commander）
            if (!knownDrones.contains(uavId)) {
                try {
                    partitionRoutingService.getPartitionsForDrone(uavId);
                    knownDrones.add(uavId);
                    log.debug("[BusinessConsumer] Drone '{}' registered/confirmed with partitions", uavId);
                } catch (Exception regEx) {
                    log.warn("[BusinessConsumer] Drone registration failed for {}: {}", uavId, regEx.getMessage());
                }
            }

            // 实时更新快照并立即推送到 WebSocket 分区 topic
            allDroneSnapshot.put(uavId, payload);
            broadcastToPartitionsNow();

        } catch (Exception e) {
            log.error("[BusinessConsumer] Failed to process telemetry message: {}", e.getMessage(), e);
        }
    }

    /**
     * 立即将全量无人机快照广播到各分区 WebSocket topic。
     * 每条 Kafka 消息到达后直接调用，无 @Scheduled 缓冲延迟。
     * 前端只订阅自己分区的 topic，因此不会收到无关数据。
     */
    private void broadcastToPartitionsNow() {
        if (allDroneSnapshot.isEmpty()) {
            return;
        }

        Instant now = Instant.now();

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
    }

    /**
     * 从全量快照中移除指定无人机（由 DroneHeartbeatService 超时检测调用）。
     */
    public void removeDroneFromSnapshot(String uavId) {
        allDroneSnapshot.remove(uavId);
        knownDrones.remove(uavId);
        // T-73: Downgrade per-drone removal log from INFO to DEBUG
        log.debug("[BusinessConsumer] Removed offline drone '{}' from snapshot", uavId);
    }

    /**
     * 获取当前快照中的所有无人机ID（用于心跳检测服务）。
     */
    public Set<String> getSnapshotDroneIds() {
        return new HashSet<>(allDroneSnapshot.keySet());
    }
}
