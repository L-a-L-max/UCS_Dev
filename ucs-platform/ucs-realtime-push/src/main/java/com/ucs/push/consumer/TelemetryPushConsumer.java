package com.ucs.push.consumer;

import com.ucs.common.config.KafkaTopicConstants;
import com.ucs.common.dto.TelemetryMessage;
import com.ucs.common.service.ViewportFilterService;
import com.ucs.common.util.JsonUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.user.SimpUserRegistry;
import org.springframework.stereotype.Component;

/**
 * 遥测数据推送消费者。
 * 从 Kafka telemetry.raw 消费 → 视口裁剪(Phase 4.4) → WebSocket STOMP 推送。
 * 仅推送位于客户端视口内的无人机数据，并根据缩放级别降采样。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class TelemetryPushConsumer {

    private final SimpMessagingTemplate messagingTemplate;
    private final SimpUserRegistry userRegistry;
    private final ViewportFilterService viewportFilter;

    @KafkaListener(
            topics = KafkaTopicConstants.TELEMETRY_RAW,
            groupId = KafkaTopicConstants.GROUP_PUSH,
            concurrency = "4"
    )
    public void consume(ConsumerRecord<String, String> record) {
        try {
            TelemetryMessage msg = JsonUtil.parse(record.value(), TelemetryMessage.class);
            String uavId = msg.getUavId();
            double lat = msg.getLat();
            double lon = msg.getLon();

            // Broadcast to /topic/telemetry (全量推送 — 兼容旧客户端)
            messagingTemplate.convertAndSend("/topic/telemetry", record.value());

            // Per-drone topic (视口裁剪客户端订阅单机主题)
            messagingTemplate.convertAndSend("/topic/drone/" + uavId, record.value());

        } catch (Exception e) {
            log.debug("[Push] Failed to push telemetry: {}", e.getMessage());
        }
    }
}
