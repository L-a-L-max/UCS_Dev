package com.ucs.push.consumer;

import com.ucs.common.config.KafkaTopicConstants;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

/**
 * 事件推送消费者。
 * 从 Kafka events.drone 消费 → WebSocket STOMP /topic/events 推送。
 * 包含：状态变更、告警、网关离线/恢复等事件。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class EventPushConsumer {

    private final SimpMessagingTemplate messagingTemplate;

    @KafkaListener(
            topics = KafkaTopicConstants.EVENTS_DRONE,
            groupId = "push-event-group",
            concurrency = "2"
    )
    public void consume(ConsumerRecord<String, String> record) {
        try {
            // Broadcast event to all connected clients
            messagingTemplate.convertAndSend("/topic/events", record.value());

            // Also send to drone-specific topic
            String key = record.key();
            if (key != null) {
                messagingTemplate.convertAndSend("/topic/drone-events/" + key, record.value());
            }

            log.trace("[Push] Event pushed: key={}", record.key());
        } catch (Exception e) {
            log.debug("[Push] Failed to push event: {}", e.getMessage());
        }
    }
}
