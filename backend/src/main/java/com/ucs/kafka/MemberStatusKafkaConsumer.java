package com.ucs.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * Kafka consumer for member online status events.
 *
 * Listens to the member.status Kafka topic and forwards events
 * to all connected WebSocket clients via /topic/member-status.
 *
 * Frontend clients subscribe to /topic/member-status to receive
 * real-time member online/offline notifications.
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "kafka.enabled", havingValue = "true", matchIfMissing = true)
public class MemberStatusKafkaConsumer {

    private final SimpMessagingTemplate messagingTemplate;
    private final ObjectMapper objectMapper;

    @KafkaListener(
            topics = "${kafka.topic.member-status:member.status}",
            groupId = "ucs-member-status"
    )
    public void consumeMemberStatus(String message) {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> payload = objectMapper.readValue(message, Map.class);

            // Broadcast to all WebSocket subscribers
            messagingTemplate.convertAndSend("/topic/member-status", payload);

            log.info("[MemberStatus] Forwarded {} event for user {} to WebSocket",
                    Boolean.TRUE.equals(payload.get("online")) ? "ONLINE" : "OFFLINE",
                    payload.get("username"));
        } catch (Exception e) {
            log.error("[MemberStatus] Failed to process member status message: {}", e.getMessage(), e);
        }
    }
}
