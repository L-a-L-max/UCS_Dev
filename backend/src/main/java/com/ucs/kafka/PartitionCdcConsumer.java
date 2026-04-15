package com.ucs.kafka;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ucs.cache.MultiLevelPartitionCache;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * T-26: CDC (Change Data Capture) 消费者
 *
 * 监听 Debezium 从 PostgreSQL WAL 捕获的 drone_partition_map 表变更事件，
 * 自动失效对应 uavId 的三级缓存（L1 Caffeine + L2 Redis）。
 *
 * CDC Topic格式: cdc.public.drone_partition_map
 * Debezium 消息结构:
 * {
 *   "before": { ... },  // 变更前的行数据（UPDATE/DELETE时存在）
 *   "after": { ... },   // 变更后的行数据（INSERT/UPDATE时存在）
 *   "op": "c|u|d|r",    // 操作类型: c=create, u=update, d=delete, r=read(snapshot)
 *   "source": { ... }   // WAL位点等元数据
 * }
 *
 * 失效策略：
 * - INSERT/UPDATE/DELETE: 从 before/after 中提取 uav_id，失效该 uavId 的所有缓存
 * - 不做缓存重建（lazy load: 下次查询时自动从 DB 加载最新数据）
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "kafka.enabled", havingValue = "true", matchIfMissing = true)
public class PartitionCdcConsumer {

    private final ObjectMapper objectMapper;
    private final MultiLevelPartitionCache multiLevelPartitionCache;

    /**
     * 监听 Debezium CDC 事件。
     * Topic名称由 Debezium connector 的 topic.prefix + table name 决定。
     */
    @KafkaListener(
            topics = "cdc.public.drone_partition_map",
            groupId = "ucs-cdc-consumer",
            containerFactory = "kafkaListenerContainerFactory"
    )
    public void consumeCdcEvent(String message, Acknowledgment ack) {
        try {
            Map<String, Object> event = objectMapper.readValue(
                    message, new TypeReference<Map<String, Object>>() {});

            String op = (String) event.get("op");

            // 从 before/after 中提取 uav_id
            String uavId = extractUavId(event);
            if (uavId == null) {
                log.debug("[CDC] Cannot extract uav_id from event, skipping");
                ack.acknowledge();
                return;
            }

            // 失效缓存
            multiLevelPartitionCache.invalidate(uavId);
            log.info("[CDC] Cache invalidated for uavId={}, op={}", uavId, op);

            ack.acknowledge();

        } catch (Exception e) {
            log.error("[CDC] Failed to process CDC event: {}", e.getMessage(), e);
            // 不ack，消息将重新投递
        }
    }

    /**
     * 从 Debezium CDC 事件中提取 uav_id。
     * 优先从 after（INSERT/UPDATE），其次从 before（DELETE）。
     */
    @SuppressWarnings("unchecked")
    private String extractUavId(Map<String, Object> event) {
        // 优先从 after 中获取（INSERT/UPDATE场景）
        Object after = event.get("after");
        if (after instanceof Map) {
            Object uavId = ((Map<String, Object>) after).get("uav_id");
            if (uavId != null) return String.valueOf(uavId);
        }

        // 其次从 before 中获取（DELETE场景）
        Object before = event.get("before");
        if (before instanceof Map) {
            Object uavId = ((Map<String, Object>) before).get("uav_id");
            if (uavId != null) return String.valueOf(uavId);
        }

        return null;
    }
}
