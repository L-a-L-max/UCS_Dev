package com.ucs.ingest.consumer;

import com.ucs.common.config.KafkaTopicConstants;
import com.ucs.common.dto.TelemetryMessage;
import com.ucs.common.service.EpochValidationService;
import com.ucs.common.service.GeoSpatialService;
import com.ucs.common.service.RedisClusterService;
import com.ucs.common.util.JsonUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;

/**
 * 遥测原始数据消费者。
 * 消费 Kafka telemetry.raw，16线程并发处理。
 * 职责：Epoch校验 → Redis状态更新 → GeoHash索引更新 → 转发至 telemetry.processed
 *
 * 数据链路：
 *   telemetry.raw → [本服务: 校验/清洗/Redis] → telemetry.processed → push/store 服务
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class TelemetryRawConsumer {

    private final EpochValidationService epochService;
    private final RedisClusterService redisService;
    private final GeoSpatialService geoService;
    private final KafkaTemplate<String, String> kafkaTemplate;

    @KafkaListener(
            topics = KafkaTopicConstants.TELEMETRY_RAW,
            groupId = KafkaTopicConstants.GROUP_INGEST,
            concurrency = "16"
    )
    public void consume(ConsumerRecord<String, String> record) {
        try {
            TelemetryMessage msg = JsonUtil.parse(record.value(), TelemetryMessage.class);
            String uavId = msg.getUavId();

            // 1. Epoch validation — discard stale messages
            if (!epochService.validate(uavId, msg.getEpoch())) {
                return;
            }

            // 2. Update Redis drone state (Hash structure)
            Map<String, String> stateMap = new HashMap<>();
            stateMap.put("lat", String.valueOf(msg.getLat()));
            stateMap.put("lon", String.valueOf(msg.getLon()));
            stateMap.put("alt", String.valueOf(msg.getAlt()));
            stateMap.put("speed", String.valueOf(msg.getGroundSpeed()));
            stateMap.put("heading", String.valueOf(msg.getHeading()));
            stateMap.put("battery", String.valueOf(msg.getBatteryPercent()));
            stateMap.put("armed", String.valueOf(msg.isArmed()));
            stateMap.put("flightMode", msg.getFlightMode() != null ? msg.getFlightMode() : "UNKNOWN");
            stateMap.put("epoch", String.valueOf(msg.getEpoch()));
            stateMap.put("timestamp", String.valueOf(msg.getTimestamp()));

            redisService.updateDroneState(uavId, stateMap);
            redisService.setDroneOnline(uavId);

            // 3. Update GeoHash spatial index (Phase 4.5)
            if (msg.getLat() != 0.0 || msg.getLon() != 0.0) {
                geoService.updateDronePosition(uavId, msg.getLat(), msg.getLon());
            }

            // 4. Forward validated/cleaned message to telemetry.processed
            //    Downstream services (push, store) consume from this topic.
            kafkaTemplate.send(KafkaTopicConstants.TELEMETRY_PROCESSED, uavId, record.value());

            log.trace("[Ingest] Processed telemetry: uavId={}, epoch={}", uavId, msg.getEpoch());

        } catch (Exception e) {
            log.error("[Ingest] Failed to process telemetry record: {}", e.getMessage());
        }
    }
}
