package com.ucs.gateway.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.util.Map;

/**
 * API Gateway 本地健康检查端点。
 * DDS Gateway 启动时通过 /api/v1/dds-gateway/health 检查后端可达性。
 * 该端点在 API Gateway 本地处理，不转发到下游微服务。
 */
@RestController
@RequestMapping("/api/v1/dds-gateway")
public class GatewayHealthController {

    @GetMapping("/health")
    public Mono<Map<String, Object>> health() {
        return Mono.just(Map.of(
                "status", "ok",
                "timestamp", Instant.now().toString(),
                "service", "ucs-api-gateway",
                "architecture", "microservice"
        ));
    }
}
