package com.ucs.gateway;

import com.ucs.kafka.CommandKafkaProducer;
import com.ucs.service.DdsCommandService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * T-03: DDS网关策略实现。
 *
 * 负责通过DDS/ROS2协议控制仿真无人机（PX4 SITL）。
 * 指令通过 Kafka commands.down topic 下发，DDS Tx Gateway 消费后转为 ROS2 消息。
 *
 * uavId 格式: px4_1, px4_2, ... (不带 mavlink_ 前缀的均归属 DDS)
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DdsGatewayStrategy implements GatewayStrategy {

    private final DdsCommandService ddsCommandService;

    @Autowired(required = false)
    private CommandKafkaProducer commandKafkaProducer;

    @Override
    public String getGatewayType() {
        return "DDS";
    }

    @Override
    public boolean supports(String uavId) {
        // DDS handles all drones that are NOT MAVLink
        return uavId != null && !uavId.startsWith("mavlink_");
    }

    @Override
    public boolean sendCommand(String uavId, String commandType, String params,
                                Long userId, Long commandLogId) {
        // Kafka first
        if (commandKafkaProducer != null) {
            try {
                commandKafkaProducer.sendCommand(uavId, commandType, params, userId, commandLogId);
                log.info("[DdsStrategy] Sent via Kafka: {} -> {} (cmdLogId={})",
                        commandType, uavId, commandLogId);
                return true;
            } catch (Exception e) {
                log.warn("[DdsStrategy] Kafka failed, falling back to HTTP: {}", e.getMessage());
            }
        }
        // HTTP fallback
        return ddsCommandService.sendCommand(uavId, commandType, params);
    }

    @Override
    public String getCommandTopic() {
        return "commands.down";
    }

    @Override
    public void startHeartbeat(String uavId) {
        ddsCommandService.startHeartbeat(uavId);
    }

    @Override
    public void stopHeartbeat(String uavId) {
        ddsCommandService.stopHeartbeat(uavId);
    }

    @Override
    public boolean isAvailable() {
        return ddsCommandService.isGatewayAvailable();
    }
}
