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

/**
 * Kafka 遥测数据消费者。
 *
 * 消费 telemetry.raw topic 中的遥测消息，替代原先的 HTTP 同步调用链路。
 * 消息以 uav_id 为 Key，Kafka 保证同一架无人机的消息在同一个分区中有序。
 *
 * 消费流程：
 *   1. 反序列化消息
 *   2. Epoch 校验 —— 丢弃过期代际的消息（防止僵尸数据）
 *   3. 时间戳校验 —— 丢弃超过 30 秒的过期消息
 *   4. 标记无人机在线（Redis heartbeat）
 *   5. 持久化遥测数据（TelemetryPersistenceService）
 *   6. 分区路由 + WebSocket 推送（WebSocketGatewayService）
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "kafka.enabled", havingValue = "true", matchIfMissing = true)
public class TelemetryKafkaConsumer {

    private final ObjectMapper objectMapper;
    private final EpochManager epochManager;
    private final PartitionRoutingService partitionRoutingService;
    private final TelemetryPersistenceService telemetryPersistenceService;
    private final WebSocketGatewayService webSocketGatewayService;
    private final RedisService redisService;

    /** 消息过期阈值（秒）：超过此时间的消息将被丢弃 */
    private static final long MAX_MESSAGE_AGE_SECONDS = 30;

    @KafkaListener(
            topics = "${kafka.topic.telemetry-raw:telemetry.raw}",
            groupId = "ucs-telemetry-consumer",
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

            // --- Epoch 校验：丢弃过期代际的消息 ---
            long msgEpoch = payload.containsKey("epoch")
                    ? ((Number) payload.get("epoch")).longValue()
                    : 0L;
            if (!epochManager.validateEpoch(uavId, msgEpoch)) {
                log.debug("[KafkaConsumer] Stale epoch for {}: msg={} current={}",
                        uavId, msgEpoch, epochManager.getCurrentEpoch(uavId));
                return;
            }

            // --- 时间戳校验：丢弃超过 30 秒的过期消息 ---
            String tsStr = (String) payload.get("timestamp");
            if (tsStr != null) {
                Instant msgTime = Instant.parse(tsStr);
                long ageSeconds = Instant.now().getEpochSecond() - msgTime.getEpochSecond();
                if (ageSeconds > MAX_MESSAGE_AGE_SECONDS) {
                    log.debug("[KafkaConsumer] Expired message for {}: age={}s", uavId, ageSeconds);
                    return;
                }
            }

            // --- 标记在线 ---
            redisService.setDroneOnline(uavId);

            // --- 持久化 ---
            telemetryPersistenceService.persistFromMap(payload);

            // --- 分区路由 + WebSocket 推送 ---
            Set<String> partitions = partitionRoutingService.getPartitionsForDrone(uavId);
            Map<String, List<Map<String, Object>>> partitionData = new LinkedHashMap<>();
            for (String partition : partitions) {
                partitionData.computeIfAbsent(partition, k -> new ArrayList<>()).add(payload);
            }

            Instant timestamp = tsStr != null ? Instant.parse(tsStr) : Instant.now();
            webSocketGatewayService.broadcastToPartitions(partitionData, timestamp);
            webSocketGatewayService.broadcastAll(List.of(payload), timestamp);

        } catch (Exception e) {
            log.error("[KafkaConsumer] Failed to process telemetry message: {}", e.getMessage(), e);
        }
    }
}
