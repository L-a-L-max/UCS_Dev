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
 * Kafka 指令下发生产者。
 *
 * 将控制指令发送到 commands.down topic，Gateway 消费后转发给 PX4。
 * 替代原先的直接 HTTP 调用 Gateway 的方式，实现指令的可靠投递和解耦。
 *
 * 指令消息格式：
 * {
 *   "uavId": "px4_1",
 *   "commandType": "ARM",
 *   "params": "{}",
 *   "timestamp": "2024-01-01T00:00:00Z",
 *   "userId": 1,
 *   "commandLogId": 123,
 *   "epoch": 3
 * }
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "kafka.enabled", havingValue = "true", matchIfMissing = true)
public class CommandKafkaProducer {

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper;
    private final EpochManager epochManager;

    @Value("${kafka.topic.commands-down:commands.down}")
    private String commandsDownTopic;

    /**
     * 发送控制指令到 Kafka。
     *
     * @param uavId       目标无人机 ID（同时作为 Kafka 消息 Key，保证同一架无人机指令有序）
     * @param commandType 指令类型（ARM / DISARM / TAKEOFF / LAND / RTL / GOTO 等）
     * @param params      指令参数 JSON
     * @param userId      操作人 ID
     * @param commandLogId 指令日志 ID（用于回执关联）
     */
    public void sendCommand(String uavId, String commandType, String params,
                            Long userId, Long commandLogId) {
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("uavId", uavId);
            payload.put("commandType", commandType);
            payload.put("params", params != null ? params : "{}");
            payload.put("timestamp", Instant.now().toString());
            payload.put("userId", userId);
            payload.put("commandLogId", commandLogId);
            payload.put("epoch", epochManager.getCurrentEpoch(uavId));

            String json = objectMapper.writeValueAsString(payload);

            // 以 uavId 作为 Key，确保同一架无人机的指令进入同一分区（有序）
            kafkaTemplate.send(commandsDownTopic, uavId, json)
                    .whenComplete((result, ex) -> {
                        if (ex != null) {
                            log.error("[CommandProducer] Failed to send command {} -> {}: {}",
                                    commandType, uavId, ex.getMessage());
                        } else {
                            log.info("[CommandProducer] Command {} -> {} sent to partition {}",
                                    commandType, uavId,
                                    result.getRecordMetadata().partition());
                        }
                    });
        } catch (Exception e) {
            log.error("[CommandProducer] Failed to serialize command: {}", e.getMessage(), e);
        }
    }
}
