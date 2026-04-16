package com.ucs.gateway.filter;

import io.github.resilience4j.ratelimiter.RateLimiter;
import io.github.resilience4j.ratelimiter.RateLimiterConfig;
import io.github.resilience4j.ratelimiter.RateLimiterRegistry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import jakarta.annotation.PostConstruct;
import java.time.Duration;

/**
 * T-47: API Gateway 全局限流过滤器。
 * <p>
 * 基于 Resilience4j RateLimiter 实现两级限流：
 * <ul>
 *   <li>默认 API：{@code ucs.rate-limit.default-qps} (默认 100 QPS)</li>
 *   <li>命令类 API（/api/v1/command）：{@code ucs.rate-limit.command-qps} (默认 10 QPS)</li>
 * </ul>
 * 超限返回 429 Too Many Requests。
 * </p>
 */
@Slf4j
@Component
public class RateLimitFilter implements GlobalFilter, Ordered {

    @Value("${ucs.rate-limit.default-qps:100}")
    private int defaultQps;

    @Value("${ucs.rate-limit.command-qps:10}")
    private int commandQps;

    private RateLimiter defaultLimiter;
    private RateLimiter commandLimiter;

    @PostConstruct
    public void init() {
        RateLimiterConfig defaultConfig = RateLimiterConfig.custom()
                .limitRefreshPeriod(Duration.ofSeconds(1))
                .limitForPeriod(defaultQps)
                .timeoutDuration(Duration.ZERO)
                .build();

        RateLimiterConfig commandConfig = RateLimiterConfig.custom()
                .limitRefreshPeriod(Duration.ofSeconds(1))
                .limitForPeriod(commandQps)
                .timeoutDuration(Duration.ZERO)
                .build();

        RateLimiterRegistry registry = RateLimiterRegistry.ofDefaults();
        this.defaultLimiter = registry.rateLimiter("default-api", defaultConfig);
        this.commandLimiter = registry.rateLimiter("command-api", commandConfig);

        log.info("[RateLimit] Initialized: default={}QPS, command={}QPS", defaultQps, commandQps);
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getURI().getPath();

        // 健康检查/Actuator 不限流
        if (path.startsWith("/actuator")) {
            return chain.filter(exchange);
        }

        RateLimiter limiter = path.startsWith("/api/v1/command") ? commandLimiter : defaultLimiter;

        if (limiter.acquirePermission()) {
            return chain.filter(exchange);
        }

        log.warn("[RateLimit] Rate limit exceeded for path: {}", path);
        exchange.getResponse().setStatusCode(HttpStatus.TOO_MANY_REQUESTS);
        return exchange.getResponse().setComplete();
    }

    @Override
    public int getOrder() {
        return -200; // Execute before JWT filter
    }
}
