package com.ucs.business.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * T-21: Thread pool isolation — separate pools for different workload types.
 *
 * Two isolated thread pools to prevent one workload type from starving another:
 *
 * <ul>
 *   <li><b>telemetryProcessorPool</b> — CPU-intensive telemetry data processing.
 *       Core=8, Max=32, Queue=1024, DiscardOldestPolicy (drop oldest on overflow,
 *       acceptable for telemetry since only the latest data matters).</li>
 *   <li><b>websocketPushPool</b> — IO-intensive WebSocket push operations.
 *       Core=4, Max=16, Queue=512, CallerRunsPolicy (backpressure to Kafka consumer
 *       when push cannot keep up, preventing OOM).</li>
 * </ul>
 *
 * Thread naming convention: pool-{type}-{n} for monitoring/tracing.
 */
@Slf4j
@Configuration
public class ThreadPoolConfig {

    @Bean(name = "telemetryProcessorPool")
    public ThreadPoolExecutor telemetryProcessorPool() {
        ThreadPoolExecutor executor = new ThreadPoolExecutor(
                8,                  // corePoolSize: matches typical CPU core count
                32,                 // maximumPoolSize: burst capacity
                60L, TimeUnit.SECONDS,
                new LinkedBlockingQueue<>(1024),
                namedThreadFactory("telemetry-processor"),
                new ThreadPoolExecutor.DiscardOldestPolicy()  // Drop stale data on overflow
        );
        executor.allowCoreThreadTimeOut(true);
        log.info("[T-21] telemetryProcessorPool initialized: core=8, max=32, queue=1024, policy=DiscardOldest");
        return executor;
    }

    @Bean(name = "websocketPushPool")
    public ThreadPoolExecutor websocketPushPool() {
        ThreadPoolExecutor executor = new ThreadPoolExecutor(
                4,                  // corePoolSize: WebSocket is IO-bound, fewer cores needed
                16,                 // maximumPoolSize: burst capacity for concurrent pushes
                60L, TimeUnit.SECONDS,
                new LinkedBlockingQueue<>(512),
                namedThreadFactory("ws-push"),
                new ThreadPoolExecutor.CallerRunsPolicy()  // Backpressure to caller on overflow
        );
        executor.allowCoreThreadTimeOut(true);
        log.info("[T-21] websocketPushPool initialized: core=4, max=16, queue=512, policy=CallerRuns");
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
