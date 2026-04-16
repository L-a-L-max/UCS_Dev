package com.ucs.common.config;

import io.github.resilience4j.circuitbreaker.CircuitBreakerConfig;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import io.github.resilience4j.retry.RetryConfig;
import io.github.resilience4j.retry.RetryRegistry;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

/**
 * T-68: Resilience4j circuit breaker and retry configuration for cross-service communication.
 *
 * Circuit Breaker defaults:
 * - Failure rate threshold: 50% (open circuit after half of calls fail)
 * - Slow call threshold: 100% (don't open for slow calls alone)
 * - Wait duration in open state: 30s before half-open
 * - Sliding window: 10 calls
 * - Minimum calls: 5 before evaluating
 *
 * Retry defaults:
 * - Max attempts: 3
 * - Wait between retries: 500ms
 * - Retry on: any Exception
 */
@Configuration
public class Resilience4jConfig {

    @Bean
    public CircuitBreakerRegistry circuitBreakerRegistry() {
        CircuitBreakerConfig defaultConfig = CircuitBreakerConfig.custom()
                .failureRateThreshold(50)
                .slowCallRateThreshold(100)
                .slowCallDurationThreshold(Duration.ofSeconds(5))
                .waitDurationInOpenState(Duration.ofSeconds(30))
                .permittedNumberOfCallsInHalfOpenState(3)
                .slidingWindowSize(10)
                .minimumNumberOfCalls(5)
                .build();

        return CircuitBreakerRegistry.of(defaultConfig);
    }

    @Bean
    public RetryRegistry retryRegistry() {
        RetryConfig defaultConfig = RetryConfig.custom()
                .maxAttempts(3)
                .waitDuration(Duration.ofMillis(500))
                .build();

        return RetryRegistry.of(defaultConfig);
    }
}
