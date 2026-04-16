package com.ucs.gateway.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.route.RouteLocator;
import org.springframework.cloud.gateway.route.builder.RouteLocatorBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

/**
 * T-69: Nacos service discovery and dynamic gateway routing.
 *
 * When the 'nacos' profile is active, this configuration replaces static URIs
 * with Nacos service-discovery-based load-balanced URIs (lb://service-name).
 *
 * In non-Nacos environments (default), the static routes in application.yml are used.
 *
 * Activation:
 *   spring.profiles.active=nacos
 *   spring.cloud.nacos.discovery.server-addr=nacos-server:8848
 */
@Slf4j
@Configuration
@Profile("nacos")
public class NacosDiscoveryRouteConfig {

    @Value("${spring.cloud.nacos.discovery.server-addr:localhost:8848}")
    private String nacosServerAddr;

    @Bean
    public RouteLocator nacosRouteLocator(RouteLocatorBuilder builder) {
        log.info("[T-69] Nacos discovery routes enabled, server: {}", nacosServerAddr);
        return builder.routes()
                // Drone state service — load balanced via Nacos
                .route("drone-state-lb", r -> r
                        .path("/api/v1/drones/**")
                        .uri("lb://ucs-drone-state"))
                // Command service — load balanced via Nacos
                .route("command-lb", r -> r
                        .path("/api/v1/commands/**")
                        .uri("lb://ucs-command"))
                // Business service — load balanced via Nacos
                .route("business-lb", r -> r
                        .path("/api/v1/users/**", "/api/v1/user/**", "/api/v1/auth/**",
                               "/api/v1/teams/**", "/api/v1/events/**", "/api/v1/tasks/**",
                               "/api/v1/rally-points/**", "/api/v1/screen/**", "/api/v1/pilot/**",
                               "/api/v1/leader/**", "/api/v1/commander/**", "/api/v1/operations/**",
                               "/api/v1/public/**", "/api/v1/map/**", "/api/v1/control/**")
                        .uri("lb://ucs-business"))
                // Business WebSocket — load balanced via Nacos
                .route("business-ws-lb", r -> r
                        .path("/ws/**")
                        .uri("lb:ws://ucs-business"))
                // Telemetry ingest fallback — load balanced via Nacos
                .route("dds-gateway-ingest-lb", r -> r
                        .path("/api/v1/dds-gateway/telemetry", "/api/v1/dds-gateway/command-ack")
                        .uri("lb://ucs-telemetry-ingest"))
                // Telemetry store — load balanced via Nacos
                .route("telemetry-store-lb", r -> r
                        .path("/api/v1/telemetry/**")
                        .uri("lb://ucs-telemetry-store"))
                .build();
    }
}
