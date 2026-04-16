package com.ucs.common.cache;

import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.stereotype.Component;

/**
 * T-71: Redis PubSub listener for cross-instance cache invalidation.
 *
 * When any microservice instance writes to the database (CDC source), it publishes
 * an invalidation event to the Redis PubSub channel "cache:invalidate".
 * All other instances receive this event and evict the corresponding L1 cache entry.
 *
 * Message format: "region:key" (e.g., "partition-map:drone:px4_1:partitions")
 *
 * This ensures L1 (Caffeine) caches across multiple instances converge quickly
 * without relying on TTL expiration alone.
 */
@Slf4j
@Component
public class CacheInvalidationListener implements MessageListener {

    public static final String INVALIDATION_CHANNEL = "cache:invalidate";

    private final MultiLevelCacheService cacheService;

    public CacheInvalidationListener(MultiLevelCacheService cacheService) {
        this.cacheService = cacheService;
    }

    @Override
    public void onMessage(Message message, byte[] pattern) {
        try {
            String payload = new String(message.getBody());
            int sep = payload.indexOf(':');
            if (sep > 0) {
                String region = payload.substring(0, sep);
                String key = payload.substring(sep + 1);
                log.debug("[CacheInvalidation] Received invalidation: region={}, key={}", region, key);
                // Only invalidate L1 — L2 (Redis) was already updated by the writer
                cacheService.invalidateL1(region, key);
            } else {
                log.debug("[CacheInvalidation] Invalid payload format: {}", payload);
            }
        } catch (Exception e) {
            log.debug("[CacheInvalidation] Error processing message: {}", e.getMessage());
        }
    }
}
