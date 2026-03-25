package com.ucs.command.consumer;

import com.ucs.common.config.KafkaTopicConstants;
import com.ucs.common.dto.CommandAckMessage;
import com.ucs.common.service.EpochValidationService;
import com.ucs.common.util.JsonUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * 指令回执消费者。
 * 从 Kafka commands.ack 消费 → Epoch校验 → 记录回执结果。
 *
 * 注意：WebSocket 广播由 ucs-business 的 BusinessCommandKafkaConsumer 负责。
 * 本消费者只做 Epoch 校验和日志记录，不依赖 SimpMessagingTemplate，
 * 避免因缺少 WebSocket 配置导致服务启动失败。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class CommandAckConsumer {

    private final EpochValidationService epochService;

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

            // WebSocket 广播由 ucs-business 的 BusinessCommandKafkaConsumer 负责
            // 本消费者仅记录 ACK 信息用于指令状态跟踪
            log.info("[CommandAck] Received: uavId={}, cmd={}, success={}, commandId={}",
                    ack.getUavId(), ack.getCommand(), ack.isSuccess(), ack.getCommandId());

        } catch (Exception e) {
            log.error("[CommandAck] Failed to process ack: {}", e.getMessage());
        }
    }
}
