package com.ucs.business.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.ucs.common.service.EpochValidationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Kafka 指令下发生产者（业务微服务内部版本）。
 *
 * 将控制指令发送到 commands.down topic，Gateway 消费后转发给 PX4。
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "kafka.enabled", havingValue = "true", matchIfMissing = true)
public class CommandKafkaProducer {

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper;
    // T-63/T-65: Use shared EpochValidationService from ucs-common instead of local EpochManager
    private final EpochValidationService epochValidationService;

    @Value("${kafka.topic.commands-down:commands.down}")
    private String commandsDownTopic;

    /**
     * 发送控制指令到 Kafka。
     *
     * @param uavId        目标无人机 ID
     * @param commandType  指令类型（ARM / DISARM / TAKEOFF / LAND / RTL / GOTO 等）
     * @param params       指令参数 JSON
     * @param userId       操作人 ID
     * @param commandLogId 指令日志 ID（用于回执关联）
     */
    public void sendCommand(String uavId, String commandType, String params,
                            Long userId, Long commandLogId) throws Exception {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("uavId", uavId);
        payload.put("commandType", commandType);
        payload.put("params", params != null ? params : "{}");
        payload.put("timestamp", Instant.now().toString());
        payload.put("userId", userId);
        payload.put("commandLogId", commandLogId);
        payload.put("epoch", epochValidationService.getCurrentEpoch(uavId));

        String json = objectMapper.writeValueAsString(payload);

        // 同步等待 Kafka 发送结果（最多5秒），确保命令真正到达 Kafka
        // 失败时抛出异常，由 ControlService 捕获并降级到 HTTP
        var sendResult = kafkaTemplate.send(commandsDownTopic, uavId, json)
                .get(5, TimeUnit.SECONDS);
        // T-73: Downgrade per-command log from INFO to DEBUG
        log.debug("[CommandProducer] Command {} -> {} sent to partition {} offset {} epoch {}",
                commandType, uavId,
                sendResult.getRecordMetadata().partition(),
                sendResult.getRecordMetadata().offset(),
                payload.get("epoch"));
    }
}
