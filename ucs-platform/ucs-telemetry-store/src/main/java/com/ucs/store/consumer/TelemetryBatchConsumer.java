package com.ucs.store.consumer;

import com.ucs.common.config.KafkaTopicConstants;
import com.ucs.common.dto.TelemetryMessage;
import com.ucs.common.util.JsonUtil;
import com.ucs.store.repository.TelemetryRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * 遥测数据批量消费者。
 * 从 Kafka telemetry.processed 批量消费（已经过 Ingest 服务的 Epoch 校验和清洗），
 * 使用 JDBC batchUpdate 写入 TimescaleDB，实现 >50k rows/s 吞吐。
 *
 * 数据链路：
 *   telemetry.raw → [ingest: 校验/清洗] → telemetry.processed → [本服务: 批量持久化]
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class TelemetryBatchConsumer {

    private final TelemetryRepository telemetryRepository;

    @KafkaListener(
            topics = KafkaTopicConstants.TELEMETRY_PROCESSED,
            groupId = KafkaTopicConstants.GROUP_STORE,
            batch = "true",
            concurrency = "4"
    )
    public void consumeBatch(List<ConsumerRecord<String, String>> records) {
        if (records.isEmpty()) return;

        List<TelemetryMessage> batch = new ArrayList<>(records.size());
        for (ConsumerRecord<String, String> record : records) {
            try {
                TelemetryMessage msg = JsonUtil.parse(record.value(), TelemetryMessage.class);
                batch.add(msg);
            } catch (Exception e) {
                log.warn("[Store] Failed to parse telemetry record: {}", e.getMessage());
            }
        }

        if (!batch.isEmpty()) {
            int saved = telemetryRepository.batchInsert(batch);
            log.debug("[Store] Batch saved: {} / {} records", saved, records.size());
        }
    }
}
