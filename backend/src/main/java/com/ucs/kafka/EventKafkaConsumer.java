package com.ucs.kafka;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ucs.service.EventService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * Kafka 无人机事件消费者。
 *
 * 消费 events.drone topic，处理无人机事件（上线/离线/告警/模式切换等）。
 * 事件与遥测流分离，避免高频遥测数据淹没低频但重要的事件通知。
 *
 * 事件类型：
 *   - DRONE_ONLINE    无人机上线
 *   - DRONE_OFFLINE   无人机离线（心跳超时）
 *   - MODE_CHANGE     飞行模式切换
 *   - LOW_BATTERY     低电量告警
 *   - GEOFENCE_BREACH 越界告警
 *   - COMMAND_TIMEOUT  指令超时
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "kafka.enabled", havingValue = "true", matchIfMissing = true)
public class EventKafkaConsumer {

    private final ObjectMapper objectMapper;
    private final EventService eventService;
    private final SimpMessagingTemplate messagingTemplate;

    @KafkaListener(
            topics = "${kafka.topic.events-drone:events.drone}",
            groupId = "ucs-event-consumer",
            concurrency = "2"
    )
    public void consumeEvent(String message) {
        try {
            Map<String, Object> payload = objectMapper.readValue(
                    message, new TypeReference<Map<String, Object>>() {});

            String eventType = String.valueOf(payload.getOrDefault("eventType", "UNKNOWN"));
            String uavId = String.valueOf(payload.getOrDefault("uavId", ""));
            String detail = String.valueOf(payload.getOrDefault("detail", ""));
            String level = String.valueOf(payload.getOrDefault("level", "INFO"));

            log.info("[EventConsumer] type={}, uavId={}, level={}, detail={}",
                    eventType, uavId, level, detail);

            // 持久化事件
            eventService.createEvent(eventType, null, null, level, "[" + uavId + "] " + detail);

            // 通过 WebSocket 广播事件给前端
            messagingTemplate.convertAndSend("/topic/events", payload);

        } catch (Exception e) {
            log.error("[EventConsumer] Failed to process event: {}", e.getMessage(), e);
        }
    }
}
