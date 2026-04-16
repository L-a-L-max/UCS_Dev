package com.ucs.config;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import lombok.Getter;
import org.springframework.stereotype.Component;

/**
 * T-44: 遥测性能指标埋点 (Micrometer)
 *
 * 提供以下关键指标:
 * - ucs.telemetry.process.duration  Timer    遥测消息处理耗时 (P50/P95/P99)
 * - ucs.telemetry.consumed.total    Counter  累计消费遥测消息数
 * - ucs.cache.hit.total             Counter  缓存命中次数
 * - ucs.cache.miss.total            Counter  缓存未命中次数
 * - ucs.command.dispatched.total    Counter  控制命令下发次数
 * - ucs.command.failed.total        Counter  控制命令失败次数
 * - ucs.websocket.push.total        Counter  WebSocket 推送次数
 *
 * Prometheus 自动采集的 JVM / Hikari / Kafka 指标:
 * - jvm_memory_used_bytes, system_cpu_usage
 * - hikaricp_connections_active
 * - kafka_consumer_fetch_manager_records_consumed_total
 */
@Getter
@Component
public class TelemetryMetrics {

    private final Timer telemetryProcessTimer;
    private final Counter telemetryConsumedCounter;
    private final Counter cacheHitCounter;
    private final Counter cacheMissCounter;
    private final Counter commandDispatchedCounter;
    private final Counter commandFailedCounter;
    private final Counter websocketPushCounter;

    public TelemetryMetrics(MeterRegistry registry) {
        this.telemetryProcessTimer = Timer.builder("ucs.telemetry.process.duration")
                .description("Time to process a single telemetry message")
                .publishPercentiles(0.5, 0.95, 0.99)
                .register(registry);

        this.telemetryConsumedCounter = Counter.builder("ucs.telemetry.consumed.total")
                .description("Total telemetry messages consumed from Kafka")
                .register(registry);

        this.cacheHitCounter = Counter.builder("ucs.cache.hit.total")
                .description("Cache hit count (Redis/local)")
                .register(registry);

        this.cacheMissCounter = Counter.builder("ucs.cache.miss.total")
                .description("Cache miss count")
                .register(registry);

        this.commandDispatchedCounter = Counter.builder("ucs.command.dispatched.total")
                .description("Total control commands dispatched to gateway")
                .register(registry);

        this.commandFailedCounter = Counter.builder("ucs.command.failed.total")
                .description("Total control commands that failed")
                .register(registry);

        this.websocketPushCounter = Counter.builder("ucs.websocket.push.total")
                .description("Total WebSocket messages pushed to clients")
                .register(registry);
    }
}
