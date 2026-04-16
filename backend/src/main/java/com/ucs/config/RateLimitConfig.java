package com.ucs.config;

import io.github.resilience4j.ratelimiter.RateLimiter;
import io.github.resilience4j.ratelimiter.RateLimiterConfig;
import io.github.resilience4j.ratelimiter.RateLimiterRegistry;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.time.Duration;

/**
 * T-47: API 限流配置。
 *
 * 基于 Resilience4j RateLimiter 实现令牌桶限流:
 * - 默认限流: 100 QPS (遥测查询、列表等高频接口)
 * - 控制命令限流: 10 QPS (ARM/TAKEOFF/GOTO 等安全敏感操作)
 *
 * 超过限流阈值时返回 HTTP 429 Too Many Requests。
 * 多实例部署时每个实例独立限流；如需全局限流可改用 Redis 滑动窗口。
 */
@Slf4j
@Configuration
public class RateLimitConfig implements WebMvcConfigurer {

    @Value("${ucs.rate-limit.default-qps:100}")
    private int defaultQps;

    @Value("${ucs.rate-limit.command-qps:10}")
    private int commandQps;

    @Bean
    public RateLimiterRegistry rateLimiterRegistry() {
        return RateLimiterRegistry.of(
                RateLimiterConfig.custom()
                        .limitForPeriod(defaultQps)
                        .limitRefreshPeriod(Duration.ofSeconds(1))
                        .timeoutDuration(Duration.ZERO)
                        .build()
        );
    }

    @Bean
    public RateLimiter defaultRateLimiter(RateLimiterRegistry registry) {
        return registry.rateLimiter("default");
    }

    @Bean
    public RateLimiter commandRateLimiter(RateLimiterRegistry registry) {
        return registry.rateLimiter("command",
                RateLimiterConfig.custom()
                        .limitForPeriod(commandQps)
                        .limitRefreshPeriod(Duration.ofSeconds(1))
                        .timeoutDuration(Duration.ZERO)
                        .build()
        );
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new RateLimitInterceptor(
                        defaultRateLimiter(rateLimiterRegistry()),
                        commandRateLimiter(rateLimiterRegistry())))
                .addPathPatterns("/api/**");
    }

    /**
     * 限流拦截器：根据请求路径选择不同的限流策略。
     */
    @Slf4j
    static class RateLimitInterceptor implements HandlerInterceptor {

        private final RateLimiter defaultLimiter;
        private final RateLimiter commandLimiter;

        RateLimitInterceptor(RateLimiter defaultLimiter, RateLimiter commandLimiter) {
            this.defaultLimiter = defaultLimiter;
            this.commandLimiter = commandLimiter;
        }

        @Override
        public boolean preHandle(HttpServletRequest request, HttpServletResponse response,
                                 Object handler) throws Exception {
            String path = request.getRequestURI();
            RateLimiter limiter = path.contains("/control/") ? commandLimiter : defaultLimiter;

            if (!RateLimiter.waitForPermission(limiter, Duration.ZERO)) {
                log.warn("[RateLimit] Request rejected: {} {}", request.getMethod(), path);
                response.setStatus(429);
                response.setContentType("application/json");
                response.getWriter().write(
                        "{\"code\":429,\"msg\":\"Too many requests, please retry later\",\"data\":null}");
                return false;
            }
            return true;
        }
    }
}
