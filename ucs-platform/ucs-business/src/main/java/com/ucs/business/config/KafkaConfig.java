package com.ucs.business.config;

import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.admin.NewTopic;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;
import org.springframework.kafka.listener.CommonErrorHandler;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.FixedBackOff;

/**
 * Kafka 配置类：自动创建所需的 Topic。
 *
 * Topic 设计：
 *   telemetry.raw   — 遥测原始数据（key=uavId，保证同一架无人机消息有序）
 *   events.drone    — 无人机事件（上线/离线/告警/模式切换等，与遥测流分离）
 *   commands.down   — 下行指令（后端 → Gateway → PX4）
 *   commands.ack    — 指令回执（PX4 → Gateway → 后端）
 *
 * 分区策略：
 *   - 默认 16 个分区，Kafka 对 key 做 murmur2 哈希取模
 *   - 同一个 uav_id 的消息始终进入同一个分区，保证单机有序
 */
@Slf4j
@Configuration
@ConditionalOnProperty(name = "kafka.enabled", havingValue = "true", matchIfMissing = true)
public class KafkaConfig {

    @Value("${kafka.topic.telemetry-raw:telemetry.raw}")
    private String telemetryRawTopic;

    @Value("${kafka.topic.telemetry-processed:telemetry.processed}")
    private String telemetryProcessedTopic;

    @Value("${kafka.topic.events-drone:events.drone}")
    private String eventsDroneTopic;

    @Value("${kafka.topic.commands-down:commands.down}")
    private String commandsDownTopic;

    @Value("${kafka.topic.commands-ack:commands.ack}")
    private String commandsAckTopic;

    /**
     * Error handler that retries 3 times with 1s interval, then logs and skips.
     * NEVER stops the container — ensures consumer threads stay alive.
     */
    @Bean
    public CommonErrorHandler kafkaErrorHandler() {
        DefaultErrorHandler handler = new DefaultErrorHandler(
                (record, exception) -> {
                    log.error("[Business] Consumer error after retries exhausted: topic={}, partition={}, offset={}, error={}",
                            record.topic(), record.partition(), record.offset(),
                            exception.getMessage(), exception);
                },
                new FixedBackOff(1000L, 3L)
        );
        handler.setAckAfterHandle(true);
        return handler;
    }

    @Bean
    public NewTopic telemetryRawTopic() {
        return TopicBuilder.name(telemetryRawTopic)
                .partitions(16)
                .replicas(1)
                .build();
    }

    @Bean
    public NewTopic telemetryProcessedTopic() {
        return TopicBuilder.name(telemetryProcessedTopic)
                .partitions(16)
                .replicas(1)
                .build();
    }

    @Bean
    public NewTopic eventsDroneTopic() {
        return TopicBuilder.name(eventsDroneTopic)
                .partitions(8)
                .replicas(1)
                .build();
    }

    @Bean
    public NewTopic commandsDownTopic() {
        return TopicBuilder.name(commandsDownTopic)
                .partitions(16)
                .replicas(1)
                .build();
    }

    @Bean
    public NewTopic commandsAckTopic() {
        return TopicBuilder.name(commandsAckTopic)
                .partitions(8)
                .replicas(1)
                .build();
    }
}
