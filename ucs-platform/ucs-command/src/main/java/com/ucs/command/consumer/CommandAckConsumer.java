package com.ucs.command.consumer;

import com.ucs.common.config.KafkaTopicConstants;
import com.ucs.common.dto.CommandAckMessage;
import com.ucs.common.service.EpochValidationService;
import com.ucs.common.util.JsonUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

/**
 * 指令回执消费者。
 * 从 Kafka commands.ack 消费 → Epoch校验 → 通知前端指令执行结果。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class CommandAckConsumer {

    private final EpochValidationService epochService;
    private final SimpMessagingTemplate messagingTemplate;

    @KafkaListener(
            topics = KafkaTopicConstants.COMMANDS_ACK,
            groupId = KafkaTopicConstants.GROUP_COMMAND,
            concurrency = "2"
    )
    public void consume(ConsumerRecord<String, String> record) {
        try {
            CommandAckMessage ack = JsonUtil.parse(record.value(), CommandAckMessage.class);

            // Epoch validation — discard stale acks
            if (!epochService.validate(ack.getUavId(), ack.getEpoch())) {
                log.warn("[CommandAck] Stale ack discarded: uavId={}, epoch={}",
                        ack.getUavId(), ack.getEpoch());
                return;
            }

            // Push ack to frontend via WebSocket
            messagingTemplate.convertAndSend("/topic/command-ack/" + ack.getUavId(), record.value());
            messagingTemplate.convertAndSend("/topic/command-ack", record.value());

            log.info("[CommandAck] Received: uavId={}, cmd={}, success={}, commandId={}",
                    ack.getUavId(), ack.getCommand(), ack.isSuccess(), ack.getCommandId());

        } catch (Exception e) {
            log.error("[CommandAck] Failed to process ack: {}", e.getMessage());
        }
    }
}
