package com.ucs.command.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.listener.CommonErrorHandler;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.FixedBackOff;

/**
 * Kafka consumer error handler for ucs-command service.
 * Prevents consumer thread death on processing errors.
 */
@Slf4j
@Configuration
public class KafkaConsumerConfig {

    @Bean
    public CommonErrorHandler kafkaErrorHandler() {
        // 3 retries, 1s interval, then skip the problematic record
        DefaultErrorHandler handler = new DefaultErrorHandler(
                (record, ex) -> log.error("[CommandKafka] Skipping record after retries: topic={}, partition={}, offset={}, error={}",
                        record.topic(), record.partition(), record.offset(), ex.getMessage()),
                new FixedBackOff(1000L, 3L)
        );
        return handler;
    }
}
