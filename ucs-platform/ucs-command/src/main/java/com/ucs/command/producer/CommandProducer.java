package com.ucs.command.producer;

import com.ucs.common.config.KafkaTopicConstants;
import com.ucs.common.dto.CommandMessage;
import com.ucs.common.service.EpochValidationService;
import com.ucs.common.util.JsonUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

/**
 * 指令 Kafka 生产者。
 * 发送指令到 Kafka commands.down，附带 epoch 用于过期校验。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CommandProducer {

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final EpochValidationService epochService;

    /**
     * Send a command to Kafka commands.down topic.
     * Key = uavId (for partition affinity).
     */
    public boolean send(CommandMessage command) {
        try {
            // Attach current epoch
            long epoch = epochService.getCurrentEpoch(command.getUavId());
            command.setEpoch(epoch);

            String json = JsonUtil.toJson(command);
            kafkaTemplate.send(KafkaTopicConstants.COMMANDS_DOWN, command.getUavId(), json);

            log.info("[Command] Sent command: uavId={}, cmdType={}, commandId={}",
                    command.getUavId(), command.getCommandType(), command.getCommandId());
            return true;
        } catch (Exception e) {
            log.error("[Command] Failed to send command: {}", e.getMessage());
            return false;
        }
    }
}
