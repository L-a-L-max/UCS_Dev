package com.ucs.business.websocket;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

/**
 * T-27: Redis-WebSocket bridge for multi-instance broadcast.
 *
 * This component bridges Redis Pub/Sub messages to local WebSocket clients.
 *
 * Flow:
 *   1. Service calls {@link #publish(String, Object)} to send a message
 *   2. Message is published to Redis channel `ws:broadcast:{destination}`
 *   3. All instances receive the message via Redis subscription
 *   4. Each instance calls {@link #onMessage(String, String)} to push to local WebSocket clients
 *
 * Message format (JSON):
 *   {"destination": "/topic/telemetry/px4_1", "payload": {...}}
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RedisWebSocketBridge {

    private final SimpMessagingTemplate messagingTemplate;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    /**
     * Publish a message to Redis for cross-instance WebSocket broadcast.
     *
     * @param destination STOMP destination (e.g., "/topic/telemetry/px4_1")
     * @param payload     message payload (will be JSON-serialized)
     */
    public void publish(String destination, Object payload) {
        try {
            String channel = "ws:broadcast:" + destination;
            String json = objectMapper.writeValueAsString(
                    new BridgeMessage(destination, payload));
            redisTemplate.convertAndSend(channel, json);
            log.debug("[T-27] Published to Redis channel: {}", channel);
        } catch (Exception e) {
            log.error("[T-27] Failed to publish to Redis: {}", e.getMessage());
            // Fallback: push to local instance only
            messagingTemplate.convertAndSend(destination, payload);
        }
    }

    /**
     * Called by Redis MessageListenerAdapter when a message is received.
     * Pushes the message to all WebSocket clients connected to this instance.
     */
    public void onMessage(String message, String channel) {
        try {
            JsonNode node = objectMapper.readTree(message);
            String destination = node.get("destination").asText();
            JsonNode payload = node.get("payload");
            messagingTemplate.convertAndSend(destination, payload.toString());
            log.debug("[T-27] Forwarded Redis message to WebSocket: {}", destination);
        } catch (Exception e) {
            log.error("[T-27] Failed to forward Redis message to WebSocket: {}", e.getMessage());
        }
    }

    /**
     * Internal message wrapper for Redis serialization.
     */
    private record BridgeMessage(String destination, Object payload) {}
}
