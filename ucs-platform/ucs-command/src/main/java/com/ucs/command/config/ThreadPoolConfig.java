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
 * Uses CallerRunsPolicy because command messages MUST NOT be dropped.
 * When the pool is saturated, the Kafka consumer thread itself processes the command,
 * providing natural backpressure to Kafka (consumer slows down polling).
 *
 * This is the opposite of the telemetry pool (in ucs-business) which uses
 * DiscardOldestPolicy because stale telemetry data has no value.
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
                new ThreadPoolExecutor.CallerRunsPolicy()  // NEVER drop commands
        );
        executor.allowCoreThreadTimeOut(true);
        log.info("[Q7] commandProcessorPool initialized: core=4, max=16, queue=256, policy=CallerRuns (commands must not be dropped)");
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
