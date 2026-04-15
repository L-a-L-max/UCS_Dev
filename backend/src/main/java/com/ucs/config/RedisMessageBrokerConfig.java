package com.ucs.config;

import com.ucs.websocket.RedisWebSocketBridge;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.PatternTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.data.redis.listener.adapter.MessageListenerAdapter;

/**
 * T-27: WebSocket 多实例广播 — Redis Pub/Sub 消息桥接
 *
 * 问题：SimpleBroker 是内存级别的，只在当前JVM实例内广播。
 * 当后端部署多个实例时，用户A连接在实例1、用户B连接在实例2，
 * 实例1推送的消息无法到达实例2的WebSocket客户端。
 *
 * 解决方案：使用 Redis Pub/Sub 作为消息桥接层
 * 1. WebSocket推送时，先发布到 Redis Channel（ws:broadcast:{topic}）
 * 2. 所有实例订阅该Channel，收到消息后通过本地SimpleBroker推送给各自的WebSocket客户端
 *
 * 数据流：
 *   Service → RedisWebSocketBridge.publish() → Redis Pub/Sub
 *     → 所有实例的 RedisWebSocketBridge.onMessage() → SimpMessagingTemplate → WebSocket客户端
 */
@Configuration
public class RedisMessageBrokerConfig {

    /**
     * Redis消息监听容器 — 订阅 ws:broadcast:* 频道
     */
    @Bean
    public RedisMessageListenerContainer redisMessageListenerContainer(
            RedisConnectionFactory connectionFactory,
            MessageListenerAdapter webSocketBridgeAdapter) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        // 订阅所有 ws:broadcast:* 频道
        container.addMessageListener(webSocketBridgeAdapter, new PatternTopic("ws:broadcast:*"));
        return container;
    }

    /**
     * 消息监听适配器 — 将 Redis 消息转发给 RedisWebSocketBridge
     */
    @Bean
    public MessageListenerAdapter webSocketBridgeAdapter(RedisWebSocketBridge bridge) {
        return new MessageListenerAdapter(bridge, "onMessage");
    }
}
