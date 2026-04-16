package com.ucs.common.cache;

import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * T-71: Publishes cache invalidation events to Redis PubSub.
 *
 * After a service writes to the database, it should call:
 *   cacheInvalidationPublisher.publish("partition-map", "drone:px4_1:partitions");
 *
 * This notifies all other instances to evict their L1 cache for the given key.
 */
@Slf4j
@Component
public class CacheInvalidationPublisher {

    private final StringRedisTemplate redisTemplate;

    public CacheInvalidationPublisher(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /**
     * Publish a cache invalidation event.
     *
     * @param region Cache region name (e.g., "partition-map", "drone-state")
     * @param key    The cache key to invalidate across all instances
     */
    public void publish(String region, String key) {
        try {
            String payload = region + ":" + key;
            redisTemplate.convertAndSend(CacheInvalidationListener.INVALIDATION_CHANNEL, payload);
            log.debug("[CacheInvalidation] Published invalidation: {}", payload);
        } catch (Exception e) {
            log.debug("[CacheInvalidation] Failed to publish invalidation for {}:{} - {}", region, key, e.getMessage());
        }
    }
}
