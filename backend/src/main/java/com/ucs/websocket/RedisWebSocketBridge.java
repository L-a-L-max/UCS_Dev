package com.ucs.websocket;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

/**
 * T-27: WebSocket 多实例消息桥接 — Redis Pub/Sub
 *
 * 解决多实例部署时 SimpleBroker 只在本地JVM内广播的问题。
 *
 * 发布流程：
 *   Service调用 publish(topic, message)
 *     → Redis PUBLISH ws:broadcast:{topic} message
 *     → 所有订阅了 ws:broadcast:* 的实例收到消息
 *     → 各实例通过本地 SimpMessagingTemplate 推送给各自的 WebSocket 客户端
 *
 * 注意：发布时同时在本地推送（减少延迟），远程实例通过 Redis 收到后也推送。
 * 为避免本地重复推送，onMessage 中会跳过自己发布的消息（通过 instanceId 判断）。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RedisWebSocketBridge {

    private final StringRedisTemplate stringRedisTemplate;
    private final SimpMessagingTemplate messagingTemplate;

    /** 当前实例唯一标识，用于避免自己发布的消息被自己再次消费 */
    private static final String INSTANCE_ID = java.util.UUID.randomUUID().toString().substring(0, 8);
    private static final String CHANNEL_PREFIX = "ws:broadcast:";
    private static final String SEPARATOR = "||";

    /**
     * 发布WebSocket消息到Redis，同时在本地推送。
     *
     * @param topic   WebSocket topic (e.g., "/topic/drones")
     * @param message JSON消息内容
     */
    public void publish(String topic, String message) {
        // 本地推送（零延迟）
        messagingTemplate.convertAndSend(topic, message);

        // 发布到 Redis Pub/Sub（其他实例接收）
        try {
            String channel = CHANNEL_PREFIX + topic;
            // 消息格式: instanceId||payload — 接收端据此跳过自己的消息
            String redisMessage = INSTANCE_ID + SEPARATOR + message;
            stringRedisTemplate.convertAndSend(channel, redisMessage);
        } catch (Exception e) {
            log.debug("[WS-Bridge] Redis publish failed for topic={}, local push already done: {}",
                    topic, e.getMessage());
        }
    }

    /**
     * Redis消息回调 — 收到其他实例发布的消息后，通过本地 SimpMessagingTemplate 推送。
     * 由 RedisMessageBrokerConfig 中的 MessageListenerAdapter 调用。
     *
     * @param message Redis消息内容 (格式: instanceId||payload)
     * @param channel Redis频道 (格式: ws:broadcast:/topic/xxx)
     */
    public void onMessage(String message, String channel) {
        try {
            // 跳过自己发布的消息（已在 publish() 中本地推送过）
            int separatorIdx = message.indexOf(SEPARATOR);
            if (separatorIdx > 0) {
                String sourceInstance = message.substring(0, separatorIdx);
                if (INSTANCE_ID.equals(sourceInstance)) {
                    return; // 自己的消息，跳过
                }
                message = message.substring(separatorIdx + SEPARATOR.length());
            }

            // 从 channel 中提取 WebSocket topic
            String topic = channel.substring(CHANNEL_PREFIX.length());
            messagingTemplate.convertAndSend(topic, message);

        } catch (Exception e) {
            log.debug("[WS-Bridge] Failed to relay Redis message: {}", e.getMessage());
        }
    }
}
