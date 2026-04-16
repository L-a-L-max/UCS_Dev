package com.ucs.business.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.net.InetAddress;
import java.util.UUID;

/**
 * T-28: Multi-instance deployment configuration.
 *
 * Provides instance-level identity and configuration for multi-instance deployments.
 * Each instance gets a unique ID used for:
 *   1. ShedLock distributed lock identification
 *   2. Redis Pub/Sub message deduplication (avoid self-echo)
 *   3. Health check / monitoring instance tagging
 *   4. Kafka consumer group instance ID (static membership)
 *
 * Configuration:
 *   - UCS_INSTANCE_ID env var overrides auto-generated ID
 *   - Auto-generated ID format: {hostname}-{random-8-chars}
 */
@Slf4j
@Configuration
public class MultiInstanceConfig {

    @Value("${ucs.instance.id:#{null}}")
    private String configuredInstanceId;

    @Value("${server.port:8086}")
    private int serverPort;

    /**
     * Unique instance identifier, used across all multi-instance coordination.
     */
    @Bean
    public String instanceId() {
        String id = configuredInstanceId;
        if (id == null || id.isBlank()) {
            String hostname;
            try {
                hostname = InetAddress.getLocalHost().getHostName();
            } catch (Exception e) {
                hostname = "unknown";
            }
            id = hostname + "-" + UUID.randomUUID().toString().substring(0, 8);
        }
        log.info("[MultiInstance] Instance ID: {}, port: {}", id, serverPort);
        return id;
    }
}
