package com.ucs.common.cache;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/**
 * T-70: Per-service multi-level cache with Caffeine L1 + Redis L2 + DB L3 fallback.
 * T-24: Enhanced with mutex lock + logical expiration to prevent cache stampede.
 * T-25: Enhanced with TTL randomization + degradation to prevent cache avalanche.
 *
 * <h3>Cache Hierarchy</h3>
 * <ol>
 *   <li><b>L1 — Caffeine (in-process)</b>: Sub-millisecond reads, short TTL (10s default),
 *       bounded by max entries. Ideal for hot data like drone state lookups.</li>
 *   <li><b>L2 — Redis (distributed)</b>: Millisecond reads, shared across instances,
 *       medium TTL (5min +/- 30s randomized). Handles cross-instance consistency.</li>
 *   <li><b>L3 — Database (source of truth)</b>: Provided by caller as a Supplier.
 *       Only queried on L1+L2 cache miss, protected by mutex lock.</li>
 * </ol>
 *
 * <h3>T-24: Cache Stampede Protection</h3>
 * <ul>
 *   <li><b>Mutex Lock</b>: When L1+L2 miss, only one thread loads from DB.
 *       Other threads wait with timeout (500ms), then return stale/null.</li>
 *   <li><b>Logical Expiration</b>: L2 entries include a logical expiry timestamp.
 *       When logically expired, the value is still returned immediately while
 *       an async refresh is triggered in the background (virtual thread).</li>
 * </ul>
 *
 * <h3>T-25: Cache Avalanche Prevention</h3>
 * <ul>
 *   <li><b>TTL Randomization</b>: Redis TTL = base +/- jitter (default 300s +/- 30s).
 *       Prevents mass expiration at the same moment.</li>
 *   <li><b>Degradation</b>: If Redis is down, returns stale L1 data or null gracefully.
 *       Does not propagate exceptions to callers.</li>
 * </ul>
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

    /** T-24: Per-key mutex locks to prevent cache stampede */
    private final ConcurrentMap<String, ReentrantLock> keyLocks = new ConcurrentHashMap<>();

    /** T-24: Logical expiration timestamps stored alongside L2 values */
    private static final String LOGICAL_EXPIRY_SUFFIX = ":logicalExpiry";

    private static final Duration L1_TTL = Duration.ofSeconds(10);
    private static final long L1_MAX_SIZE = 10_000;
    /** T-25: Base L2 TTL before randomization */
    private static final long L2_BASE_TTL_SECONDS = 300;
    /** T-25: TTL jitter range (+/- 30s) */
    private static final long L2_TTL_JITTER_SECONDS = 30;
    /** T-24: Logical expiration = base TTL * 0.8 (refresh before physical expiry) */
    private static final double LOGICAL_EXPIRY_RATIO = 0.8;
    /** T-24: Mutex lock timeout */
    private static final long LOCK_TIMEOUT_MS = 500;

    public MultiLevelCacheService(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /**
     * Get a value from the multi-level cache hierarchy.
     * Enhanced with T-24 mutex lock and T-25 degradation.
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

        // L2: Redis (with logical expiration check — T-24)
        try {
            value = redisTemplate.opsForValue().get(key);
            if (value != null) {
                log.debug("[Cache] L2 HIT region={} key={}", region, key);
                l1.put(key, value); // Populate L1

                // T-24: Check logical expiration — trigger async refresh if expired
                if (isLogicallyExpired(key)) {
                    asyncRefresh(region, key, dbLoader);
                }
                return value;
            }
        } catch (Exception e) {
            // T-25: Degradation — Redis down, proceed to DB gracefully
            log.debug("[Cache] L2 unavailable for key={}: {}", key, e.getMessage());
        }

        // L3: Database with mutex lock (T-24)
        if (dbLoader != null) {
            value = loadFromDbWithLock(region, key, dbLoader);
            return value;
        }

        log.debug("[Cache] MISS all levels region={} key={}", region, key);
        return null;
    }

    /**
     * T-24: Load from DB with mutex lock — only one thread queries DB per key.
     * Other threads wait up to LOCK_TIMEOUT_MS, then return null (avoid thundering herd).
     */
    private String loadFromDbWithLock(String region, String key, Supplier<String> dbLoader) {
        ReentrantLock lock = keyLocks.computeIfAbsent(key, k -> new ReentrantLock());
        boolean acquired = false;
        try {
            acquired = lock.tryLock(LOCK_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            if (acquired) {
                // Double-check: another thread may have loaded while we waited
                Cache<String, String> l1 = getOrCreateL1(region);
                String cached = l1.getIfPresent(key);
                if (cached != null) {
                    return cached;
                }

                // Actually load from DB
                String value = dbLoader.get();
                if (value != null) {
                    log.debug("[Cache] L3 HIT region={} key={}", region, key);
                    put(region, key, value);
                    return value;
                }
            } else {
                // T-24: Lock timeout — return null rather than thundering herd
                log.debug("[Cache] Lock timeout for key={}, returning null", key);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.debug("[Cache] Lock interrupted for key={}", key);
        } finally {
            if (acquired) {
                lock.unlock();
            }
            keyLocks.remove(key, lock);
        }

        log.debug("[Cache] MISS all levels region={} key={}", region, key);
        return null;
    }

    /**
     * T-24: Check if a key is logically expired (physical entry still exists in Redis).
     */
    private boolean isLogicallyExpired(String key) {
        try {
            String expiryStr = redisTemplate.opsForValue().get(key + LOGICAL_EXPIRY_SUFFIX);
            if (expiryStr != null) {
                long expiryMs = Long.parseLong(expiryStr);
                return System.currentTimeMillis() > expiryMs;
            }
        } catch (Exception e) {
            // Ignore — treat as not expired
        }
        return false;
    }

    /**
     * T-24: Async refresh — triggers background DB load using virtual thread.
     * The stale value is returned immediately to the caller.
     */
    private void asyncRefresh(String region, String key, Supplier<String> dbLoader) {
        if (dbLoader == null) return;
        Thread.ofVirtual().name("cache-refresh-" + key).start(() -> {
            try {
                String freshValue = dbLoader.get();
                if (freshValue != null) {
                    put(region, key, freshValue);
                    log.debug("[Cache] Async refresh completed for key={}", key);
                }
            } catch (Exception e) {
                log.warn("[Cache] Async refresh failed for key={}: {}", key, e.getMessage());
            }
        });
    }

    /**
     * Write-through put: writes to both L1 and L2 with TTL randomization (T-25).
     */
    public void put(String region, String key, String value) {
        Cache<String, String> l1 = getOrCreateL1(region);
        l1.put(key, value);
        try {
            // T-25: TTL randomization — base +/- jitter to prevent mass expiration
            long ttlSeconds = L2_BASE_TTL_SECONDS +
                    ThreadLocalRandom.current().nextLong(-L2_TTL_JITTER_SECONDS, L2_TTL_JITTER_SECONDS + 1);
            redisTemplate.opsForValue().set(key, value, Duration.ofSeconds(ttlSeconds));

            // T-24: Set logical expiration (80% of physical TTL)
            long logicalExpiryMs = System.currentTimeMillis() + (long)(ttlSeconds * LOGICAL_EXPIRY_RATIO * 1000);
            redisTemplate.opsForValue().set(key + LOGICAL_EXPIRY_SUFFIX,
                    String.valueOf(logicalExpiryMs), Duration.ofSeconds(ttlSeconds));
        } catch (Exception e) {
            // T-25: Degradation — L1 write succeeded, L2 failure is non-fatal
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
            redisTemplate.delete(key + LOGICAL_EXPIRY_SUFFIX);
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
