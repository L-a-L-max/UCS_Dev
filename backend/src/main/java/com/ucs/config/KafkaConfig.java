package com.ucs.config;

import com.ucs.kafka.TelemetryMessage;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.apache.kafka.common.serialization.StringSerializer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.ConcurrentKafkaListenerContainerFactory;
import org.springframework.kafka.config.TopicBuilder;
import org.springframework.kafka.core.*;
import org.springframework.kafka.listener.ContainerProperties;
import org.springframework.kafka.support.serializer.JsonDeserializer;

import java.util.HashMap;
import java.util.Map;

/**
 * Kafka 配置类：Topic创建 + 生产者/消费者策略配置。
 *
 * 架构升级2.1变更:
 *   T-08: 副本因子从1升级到3 (3-Broker KRaft集群)
 *   T-09: 所有Topic replication_factor=3, min.insync.replicas=2
 *   T-10: 生产者策略 — 遥测:acks=1, 指令:acks=all+幂等
 *   T-11: 消费者策略 — MANUAL_IMMEDIATE ack模式, concurrency=8
 *
 * Topic 设计：
 *   telemetry.raw        — 遥测原始数据（key=uavId，保证同一架无人机消息有序）
 *   events.drone         — 无人机事件（上线/离线/告警/模式切换等）
 *   commands.down        — DDS下行指令（后端 → DDS Gateway → PX4）
 *   commands.mavlink.down — MAVLink下行指令（后端 → MAVLink Gateway → 无人机）
 *   commands.ack         — 指令回执（PX4/无人机 → Gateway → 后端）
 *
 * 分区策略：
 *   - 默认 16 个分区，Kafka 对 key 做 murmur2 哈希取模
 *   - 同一个 uav_id 的消息始终进入同一个分区，保证单机有序
 */
@Configuration
@ConditionalOnProperty(name = "kafka.enabled", havingValue = "true", matchIfMissing = true)
public class KafkaConfig {

    @Value("${spring.kafka.bootstrap-servers:localhost:9092}")
    private String bootstrapServers;

    @Value("${kafka.topic.telemetry-raw:telemetry.raw}")
    private String telemetryRawTopic;

    @Value("${kafka.topic.events-drone:events.drone}")
    private String eventsDroneTopic;

    @Value("${kafka.topic.commands-down:commands.down}")
    private String commandsDownTopic;

    @Value("${kafka.topic.commands-mavlink-down:commands.mavlink.down}")
    private String commandsMavlinkDownTopic;

    @Value("${kafka.topic.commands-ack:commands.ack}")
    private String commandsAckTopic;

    // ================================================================
    // T-09: Topic 定义 (replication_factor=3, min.insync.replicas=2)
    // ================================================================

    @Bean
    public NewTopic telemetryRawTopic() {
        return TopicBuilder.name(telemetryRawTopic)
                .partitions(16)
                .replicas(3)
                .config("min.insync.replicas", "2")
                .build();
    }

    @Bean
    public NewTopic eventsDroneTopic() {
        return TopicBuilder.name(eventsDroneTopic)
                .partitions(8)
                .replicas(3)
                .config("min.insync.replicas", "2")
                .build();
    }

    @Bean
    public NewTopic commandsDownTopic() {
        return TopicBuilder.name(commandsDownTopic)
                .partitions(16)
                .replicas(3)
                .config("min.insync.replicas", "2")
                .build();
    }

    @Bean
    public NewTopic commandsMavlinkDownTopic() {
        return TopicBuilder.name(commandsMavlinkDownTopic)
                .partitions(16)
                .replicas(3)
                .config("min.insync.replicas", "2")
                .build();
    }

    @Bean
    public NewTopic commandsAckTopic() {
        return TopicBuilder.name(commandsAckTopic)
                .partitions(8)
                .replicas(3)
                .config("min.insync.replicas", "2")
                .build();
    }

    // ================================================================
    // T-10: 指令生产者 — acks=all + 幂等 (保证指令不丢失不重复)
    // ================================================================

    @Bean
    public ProducerFactory<String, String> commandProducerFactory() {
        Map<String, Object> props = new HashMap<>();
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        props.put(ProducerConfig.ACKS_CONFIG, "all");
        props.put(ProducerConfig.RETRIES_CONFIG, 5);
        props.put(ProducerConfig.RETRY_BACKOFF_MS_CONFIG, 200);
        props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
        props.put(ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION, 1);
        return new DefaultKafkaProducerFactory<>(props);
    }

    @Bean
    public KafkaTemplate<String, String> kafkaTemplate(ProducerFactory<String, String> commandProducerFactory) {
        return new KafkaTemplate<>(commandProducerFactory);
    }

    // ================================================================
    // T-11: 消费者配置 — MANUAL_IMMEDIATE ack + concurrency=8
    // ================================================================

    @Bean
    public ConsumerFactory<String, String> consumerFactory() {
        Map<String, Object> props = new HashMap<>();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
        props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
        props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "latest");
        // T-11: 关闭自动提交，由业务代码手动提交
        props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);
        props.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, 500);
        props.put(ConsumerConfig.FETCH_MIN_BYTES_CONFIG, 1);
        props.put(ConsumerConfig.FETCH_MAX_WAIT_MS_CONFIG, 100);
        return new DefaultKafkaConsumerFactory<>(props);
    }

    /**
     * T-11: 遥测消费者容器工厂 — MANUAL_IMMEDIATE ack模式。
     *
     * MANUAL_IMMEDIATE: 业务代码处理成功后立即调用 ack.acknowledge()，
     * 处理失败不调用 ack，消息将在下次 poll 时重新投递。
     * concurrency=8: 8个消费者线程并行处理16个分区（每线程2个分区）。
     */
    @Bean
    public ConcurrentKafkaListenerContainerFactory<String, String> kafkaListenerContainerFactory(
            ConsumerFactory<String, String> consumerFactory) {
        ConcurrentKafkaListenerContainerFactory<String, String> factory =
                new ConcurrentKafkaListenerContainerFactory<>();
        factory.setConsumerFactory(consumerFactory);
        factory.setConcurrency(8);
        factory.getContainerProperties().setAckMode(ContainerProperties.AckMode.MANUAL_IMMEDIATE);
        factory.getContainerProperties().setPollTimeout(3000);
        return factory;
    }

    // ================================================================
    // T-20: POJO 反序列化消费者工厂 — Jackson 自动反序列化为 TelemetryMessage
    // ================================================================

    /**
     * T-20: 基于 Jackson 的 Kafka 消费者工厂。
     * 将 Kafka 消息 Value 自动反序列化为 TelemetryMessage POJO，
     * 替代手动 objectMapper.readValue(message, TypeReference) 方式。
     *
     * 优势:
     *   1. 类型安全 — 编译期检查，避免 ClassCastException
     *   2. 性能提升 — Jackson 直接反序列化到 POJO 比 Map 快约 30%
     *   3. @JsonIgnoreProperties(ignoreUnknown=true) — 兼容网关新增字段
     */
    @Bean
    public ConsumerFactory<String, TelemetryMessage> telemetryConsumerFactory() {
        Map<String, Object> props = new HashMap<>();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
        props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, JsonDeserializer.class);
        props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "latest");
        props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);
        props.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, 500);
        props.put(ConsumerConfig.FETCH_MIN_BYTES_CONFIG, 1);
        props.put(ConsumerConfig.FETCH_MAX_WAIT_MS_CONFIG, 100);

        JsonDeserializer<TelemetryMessage> deserializer = new JsonDeserializer<>(TelemetryMessage.class);
        deserializer.addTrustedPackages("com.ucs.kafka");
        deserializer.setUseTypeMapperForKey(false);

        return new DefaultKafkaConsumerFactory<>(props, new StringDeserializer(), deserializer);
    }

    /**
     * T-20: POJO 遥测消费者容器工厂 — 用于新版 TelemetryMessage 反序列化消费者。
     * 与 kafkaListenerContainerFactory 并行存在，逐步迁移。
     */
    @Bean
    public ConcurrentKafkaListenerContainerFactory<String, TelemetryMessage> telemetryPojoListenerContainerFactory(
            ConsumerFactory<String, TelemetryMessage> telemetryConsumerFactory) {
        ConcurrentKafkaListenerContainerFactory<String, TelemetryMessage> factory =
                new ConcurrentKafkaListenerContainerFactory<>();
        factory.setConsumerFactory(telemetryConsumerFactory);
        factory.setConcurrency(8);
        factory.getContainerProperties().setAckMode(ContainerProperties.AckMode.MANUAL_IMMEDIATE);
        factory.getContainerProperties().setPollTimeout(3000);
        return factory;
    }
}
