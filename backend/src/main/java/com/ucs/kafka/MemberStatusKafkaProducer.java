package com.ucs.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Kafka producer for member online status events.
 *
 * Publishes member login/logout events to the member-status topic.
 * Frontend clients consume these events via WebSocket to update
 * the member online status panel in real-time.
 *
 * Message format:
 * {
 *   "userId": 1,
 *   "username": "zhangsan",
 *   "realName": "张三",
 *   "online": true,
 *   "timestamp": "2024-01-01T00:00:00Z"
 * }
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "kafka.enabled", havingValue = "true", matchIfMissing = true)
public class MemberStatusKafkaProducer {

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper;

    @Value("${kafka.topic.member-status:member.status}")
    private String memberStatusTopic;

    /**
     * Publish a member online status event to Kafka.
     *
     * @param userId   User ID
     * @param username Username
     * @param realName User's real name
     * @param online   true = online (login), false = offline (logout)
     */
    public void publishStatusChange(Long userId, String username, String realName, boolean online) {
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("userId", userId);
            payload.put("username", username);
            payload.put("realName", realName != null ? realName : username);
            payload.put("online", online);
            payload.put("timestamp", Instant.now().toString());

            String json = objectMapper.writeValueAsString(payload);

            // Use userId as key to ensure ordering per user
            kafkaTemplate.send(memberStatusTopic, String.valueOf(userId), json)
                    .whenComplete((result, ex) -> {
                        if (ex != null) {
                            log.error("[MemberStatus] Failed to publish status for user {}: {}",
                                    username, ex.getMessage());
                        } else {
                            log.info("[MemberStatus] Published {} event for user {} (id={})",
                                    online ? "ONLINE" : "OFFLINE", username, userId);
                        }
                    });
        } catch (Exception e) {
            log.error("[MemberStatus] Failed to serialize status event: {}", e.getMessage(), e);
        }
    }
}
