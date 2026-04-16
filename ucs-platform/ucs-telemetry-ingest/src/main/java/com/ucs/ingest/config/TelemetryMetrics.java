package com.ucs.ingest.config;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import lombok.Getter;
import org.springframework.stereotype.Component;

/**
 * T-44: 遥测数据处理性能指标埋点。
 * <p>
 * 提供 Micrometer Timer / Counter，供 Kafka 消费者在处理遥测消息时记录：
 * <ul>
 *   <li>处理耗时（P50/P95/P99）</li>
 *   <li>消费消息总数</li>
 *   <li>缓存命中 / 未命中</li>
 *   <li>WebSocket 推送计数</li>
 * </ul>
 * Prometheus 端点 /actuator/prometheus 自动暴露这些指标。
 */
@Getter
@Component
public class TelemetryMetrics {

    private final Timer telemetryProcessTimer;
    private final Counter telemetryConsumedCounter;
    private final Counter cacheHitCounter;
    private final Counter cacheMissCounter;
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
                .description("Redis cache hits for drone state lookups")
                .register(registry);

        this.cacheMissCounter = Counter.builder("ucs.cache.miss.total")
                .description("Redis cache misses for drone state lookups")
                .register(registry);

        this.websocketPushCounter = Counter.builder("ucs.websocket.push.total")
                .description("Total WebSocket STOMP push messages sent")
                .register(registry);
    }
}
