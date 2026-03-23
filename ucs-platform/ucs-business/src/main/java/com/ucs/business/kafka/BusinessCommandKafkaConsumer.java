package com.ucs.business.kafka;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Kafka 指令回执消费者。
 *
 * 消费 commands.ack topic，接收 PX4 通过 Gateway 转发的指令回执，
 * 并通过 WebSocket 推送给前端，实现两阶段指令反馈：
 *   Stage 1: 指令已发送（后端 → Gateway）
 *   Stage 2: PX4 已确认（Gateway → Kafka → 后端 → WebSocket → 前端）
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "kafka.enabled", havingValue = "true", matchIfMissing = true)
public class BusinessCommandKafkaConsumer {

    private final ObjectMapper objectMapper;
    private final SimpMessagingTemplate messagingTemplate;
    private final EpochManager epochManager;

    @KafkaListener(
            topics = "${kafka.topic.commands-ack:commands.ack}",
            groupId = "ucs-business-command-ack-consumer",
            concurrency = "2"
    )
    public void consumeCommandAck(String message) {
        try {
            Map<String, Object> payload = objectMapper.readValue(
                    message, new TypeReference<Map<String, Object>>() {});

            String uavId = String.valueOf(payload.getOrDefault("uavId", ""));
            int command = ((Number) payload.getOrDefault("command", 0)).intValue();
            int result = ((Number) payload.getOrDefault("result", -1)).intValue();

            // Epoch validation: discard ack from stale drone session
            Object epochObj = payload.get("epoch");
            if (epochObj != null) {
                long msgEpoch = ((Number) epochObj).longValue();
                if (!epochManager.validateEpoch(uavId, msgEpoch)) {
                    log.warn("[CommandAckConsumer] Stale ack discarded: uavId={}, epoch={}",
                            uavId, msgEpoch);
                    return;
                }
            }

            log.info("[CommandAckConsumer] uavId={}, command={}, result={}", uavId, command, result);

            // 构建 WebSocket 推送消息
            Map<String, Object> ackMessage = new LinkedHashMap<>();
            ackMessage.put("type", "command_ack");
            ackMessage.put("uavId", uavId);
            ackMessage.put("command", command);
            ackMessage.put("result", result);
            ackMessage.put("resultText", commandResultToText(result));
            ackMessage.put("timestamp", Instant.now().toString());

            // 广播到全局和分区 topic
            messagingTemplate.convertAndSend("/topic/command-ack", ackMessage);

        } catch (Exception e) {
            log.error("[CommandAckConsumer] Failed to process command ack: {}", e.getMessage(), e);
        }
    }

    private static String commandResultToText(int result) {
        return switch (result) {
            case 0 -> "ACCEPTED";
            case 1 -> "TEMPORARILY_REJECTED";
            case 2 -> "DENIED";
            case 3 -> "UNSUPPORTED";
            case 4 -> "FAILED";
            case 5 -> "IN_PROGRESS";
            case 6 -> "CANCELLED";
            default -> "UNKNOWN(" + result + ")";
        };
    }
}
