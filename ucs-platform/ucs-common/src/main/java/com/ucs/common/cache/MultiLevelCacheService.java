package com.ucs.common.cache;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.function.Supplier;

/**
 * T-70: Per-service multi-level cache with Caffeine L1 + Redis L2 + DB L3 fallback.
 *
 * <h3>Cache Hierarchy</h3>
 * <ol>
 *   <li><b>L1 — Caffeine (in-process)</b>: Sub-millisecond reads, short TTL (10s default),
 *       bounded by max entries. Ideal for hot data like drone state lookups.</li>
 *   <li><b>L2 — Redis (distributed)</b>: Millisecond reads, shared across instances,
 *       medium TTL (5min default). Handles cross-instance consistency.</li>
 *   <li><b>L3 — Database (source of truth)</b>: Provided by caller as a Supplier.
 *       Only queried on L1+L2 cache miss.</li>
 * </ol>
 *
 * <h3>Write Strategy</h3>
 * Write-through: on put(), data is written to both L1 and L2 simultaneously.
 * On invalidation (via Redis PubSub from T-71), L1 is evicted immediately.
 *
 * <h3>Usage</h3>
 * <pre>
 * String value = multiLevelCache.get("drone-state", "drone:px4_1:state",
 *     () -> droneStateRepository.findByUavId("px4_1").toString());
 * </pre>
 */
@Slf4j
@Service
public class MultiLevelCacheService {

    private final StringRedisTemplate redisTemplate;

    /** Named L1 cache instances, one per logical cache region */
    private final ConcurrentMap<String, Cache<String, String>> l1Caches = new ConcurrentHashMap<>();

    private static final Duration L1_TTL = Duration.ofSeconds(10);
    private static final long L1_MAX_SIZE = 10_000;
    private static final Duration L2_TTL = Duration.ofMinutes(5);

    public MultiLevelCacheService(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /**
     * Get a value from the multi-level cache hierarchy.
     *
     * @param region   Logical cache region name (e.g., "drone-state", "partition-map")
     * @param key      Cache key
     * @param dbLoader Supplier that loads from database (L3) on full cache miss
     * @return cached or freshly loaded value, or null if dbLoader returns null
     */
    public String get(String region, String key, Supplier<String> dbLoader) {
        // L1: Caffeine
        Cache<String, String> l1 = getOrCreateL1(region);
        String value = l1.getIfPresent(key);
        if (value != null) {
            log.debug("[Cache] L1 HIT region={} key={}", region, key);
            return value;
        }

        // L2: Redis
        try {
            value = redisTemplate.opsForValue().get(key);
            if (value != null) {
                log.debug("[Cache] L2 HIT region={} key={}", region, key);
                l1.put(key, value); // Populate L1
                return value;
            }
        } catch (Exception e) {
            log.debug("[Cache] L2 unavailable for key={}: {}", key, e.getMessage());
        }

        // L3: Database
        if (dbLoader != null) {
            value = dbLoader.get();
            if (value != null) {
                log.debug("[Cache] L3 HIT region={} key={}", region, key);
                put(region, key, value);
                return value;
            }
        }

        log.debug("[Cache] MISS all levels region={} key={}", region, key);
        return null;
    }

    /**
     * Write-through put: writes to both L1 and L2.
     */
    public void put(String region, String key, String value) {
        Cache<String, String> l1 = getOrCreateL1(region);
        l1.put(key, value);
        try {
            redisTemplate.opsForValue().set(key, value, L2_TTL);
        } catch (Exception e) {
            log.debug("[Cache] L2 write failed for key={}: {}", key, e.getMessage());
        }
    }

    /**
     * Invalidate a key from both L1 and L2.
     * Called by Redis PubSub listener (T-71) for cross-instance invalidation.
     */
    public void invalidate(String region, String key) {
        Cache<String, String> l1 = getOrCreateL1(region);
        l1.invalidate(key);
        try {
            redisTemplate.delete(key);
        } catch (Exception e) {
            log.debug("[Cache] L2 invalidate failed for key={}: {}", key, e.getMessage());
        }
    }

    /**
     * Invalidate only L1 for a key (used when receiving PubSub events from other instances).
     */
    public void invalidateL1(String region, String key) {
        Cache<String, String> l1 = getOrCreateL1(region);
        l1.invalidate(key);
    }

    /**
     * Invalidate all entries in a region's L1 cache.
     */
    public void invalidateRegion(String region) {
        Cache<String, String> l1 = l1Caches.get(region);
        if (l1 != null) {
            l1.invalidateAll();
        }
    }

    private Cache<String, String> getOrCreateL1(String region) {
        return l1Caches.computeIfAbsent(region, r ->
                Caffeine.newBuilder()
                        .maximumSize(L1_MAX_SIZE)
                        .expireAfterWrite(L1_TTL)
                        .recordStats()
                        .build()
        );
    }
}
