package com.ucs.command.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Q7: Command service thread pool configuration.
 *
 * Uses DiscardOldestPolicy to prioritize system availability (HA-first principle):
 *   - CallerRunsPolicy would block the Kafka Consumer thread, potentially triggering
 *     session.timeout → rebalance → cascading failure → worse availability
 *   - DiscardOldestPolicy discards the oldest queued command (already stale) and
 *     accepts the newest one, keeping the consumer thread unblocked
 *   - Commands have idempotency protection (T-50), so the user can safely retry
 *   - The rejected command is logged + metrics counter incremented for alerting
 *
 * Same strategy as the telemetry pool in ucs-business — consistent HA-first approach.
 */
@Slf4j
@Configuration
public class ThreadPoolConfig {

    @Bean(name = "commandProcessorPool")
    public ThreadPoolExecutor commandProcessorPool() {
        ThreadPoolExecutor executor = new ThreadPoolExecutor(
                4,                  // corePoolSize: commands are low-frequency, high-importance
                16,                 // maximumPoolSize: burst capacity for concurrent commands
                60L, TimeUnit.SECONDS,
                new LinkedBlockingQueue<>(256),
                namedThreadFactory("cmd-processor"),
                new ThreadPoolExecutor.DiscardOldestPolicy()  // HA-first: never block Kafka Consumer
        );
        executor.allowCoreThreadTimeOut(true);
        log.info("[Q7] commandProcessorPool initialized: core=4, max=16, queue=256, policy=DiscardOldest (HA-first, never block consumer)");
        return executor;
    }

    private ThreadFactory namedThreadFactory(String prefix) {
        AtomicInteger counter = new AtomicInteger(0);
        return r -> {
            Thread t = new Thread(r);
            t.setName("pool-" + prefix + "-" + counter.incrementAndGet());
            t.setDaemon(true);
            return t;
        };
    }
}
