package com.ucs.store.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.listener.CommonErrorHandler;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.FixedBackOff;

/**
 * Kafka consumer error handling configuration.
 * Prevents consumer container from stopping on processing exceptions.
 */
@Slf4j
@Configuration
public class KafkaConsumerConfig {

    /**
     * Error handler that retries 3 times with 1s interval, then logs and skips.
     * NEVER stops the container — ensures consumer threads stay alive.
     */
    @Bean
    public CommonErrorHandler kafkaErrorHandler() {
        DefaultErrorHandler handler = new DefaultErrorHandler(
                (record, exception) -> {
                    log.error("[Store] Consumer error after retries exhausted: topic={}, partition={}, offset={}, error={}",
                            record.topic(), record.partition(), record.offset(),
                            exception.getMessage(), exception);
                },
                new FixedBackOff(1000L, 3L)
        );
        handler.setAckAfterHandle(true);
        return handler;
    }
}
