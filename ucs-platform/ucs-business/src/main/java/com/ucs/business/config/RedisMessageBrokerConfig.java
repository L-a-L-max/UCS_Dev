package com.ucs.business.config;

import com.ucs.business.websocket.RedisWebSocketBridge;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.PatternTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.data.redis.listener.adapter.MessageListenerAdapter;

/**
 * T-27: Redis Pub/Sub configuration for WebSocket multi-instance broadcast.
 *
 * Problem: When deploying multiple backend instances behind a load balancer,
 * a WebSocket client connected to Instance-A won't receive messages published
 * from Instance-B's SimpMessagingTemplate.
 *
 * Solution: Use Redis Pub/Sub as a bridge:
 *   1. All instances publish WebSocket messages to Redis channel `ws:broadcast:*`
 *   2. All instances subscribe to `ws:broadcast:*` pattern
 *   3. On receiving a Redis message, each instance pushes to its local WebSocket clients
 *
 * This ensures ALL connected clients receive the message regardless of which
 * instance they are connected to.
 */
@Slf4j
@Configuration
public class RedisMessageBrokerConfig {

    @Bean
    public RedisMessageListenerContainer redisMessageListenerContainer(
            RedisConnectionFactory connectionFactory,
            MessageListenerAdapter webSocketBridgeAdapter) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        container.addMessageListener(webSocketBridgeAdapter, new PatternTopic("ws:broadcast:*"));
        log.info("[T-27] Redis message listener subscribed to pattern: ws:broadcast:*");
        return container;
    }

    @Bean
    public MessageListenerAdapter webSocketBridgeAdapter(RedisWebSocketBridge bridge) {
        return new MessageListenerAdapter(bridge, "onMessage");
    }
}
