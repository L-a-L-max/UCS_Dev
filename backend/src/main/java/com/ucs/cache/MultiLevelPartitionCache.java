package com.ucs.cache;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.ucs.repository.DronePartitionMapRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.ReentrantLock;

/**
 * T-23: 三级缓存架构 — Caffeine (L1) -> Redis (L2) -> Database (L3)
 * T-24: 缓存击穿防护 — 互斥锁 + 逻辑过期
 * T-25: 缓存雪崩防护 — TTL随机化 + 降级策略
 *
 * <h3>三级缓存读取流程</h3>
 * <pre>
 *   查询 → L1 Caffeine (JVM本地, <0.01ms)
 *        → L2 Redis (分布式, ~1ms)
 *        → L3 Database (持久化, ~5-20ms)
 * </pre>
 *
 * <h3>T-24: 缓存击穿防护</h3>
 * <p>当单个热Key过期时，大量并发请求同时穿透到DB（thundering herd）。</p>
 * <p>解决方案：互斥锁 + 逻辑过期</p>
 * <ul>
 *   <li>互斥锁：同一uavId只允许一个线程回源DB，其余线程等待或返回旧值</li>
 *   <li>逻辑过期：缓存值中存储逻辑过期时间，过期后异步刷新，读取时仍返回旧值</li>
 * </ul>
 *
 * <h3>T-25: 缓存雪崩防护</h3>
 * <p>大量Key同时过期导致DB压力骤增。</p>
 * <p>解决方案：TTL随机化 + 降级策略</p>
 * <ul>
 *   <li>TTL随机化：基础TTL ± 随机偏移，打散过期时间</li>
 *   <li>降级策略：Redis不可用时退化为 Caffeine + DB 两级</li>
 * </ul>
 */
@Slf4j
@Component
public class MultiLevelPartitionCache {

    private final StringRedisTemplate stringRedisTemplate;
    private final DronePartitionMapRepository dronePartitionMapRepository;

    /** Redis缓存Key前缀 */
    private static final String CACHE_KEY_PREFIX = "partition:cache:";

    /** L1 Caffeine本地缓存: 最大10000条, 1分钟过期 */
    private final Cache<String, CacheEntry> l1Cache = Caffeine.newBuilder()
            .maximumSize(10_000)
            .expireAfterWrite(1, TimeUnit.MINUTES)
            .recordStats()
            .build();

    /** T-24: 互斥锁Map — 防止同一Key的并发回源 */
    private final ConcurrentHashMap<String, ReentrantLock> lockMap = new ConcurrentHashMap<>();

    /** 缓存命中率统计 */
    private final AtomicLong l1Hits = new AtomicLong(0);
    private final AtomicLong l2Hits = new AtomicLong(0);
    private final AtomicLong l3Hits = new AtomicLong(0);
    private final AtomicLong totalRequests = new AtomicLong(0);

    /** L2 Redis基础TTL: 5分钟 */
    private static final long BASE_TTL_SECONDS = 300;
    /** T-25: TTL随机偏移范围: ±30秒 */
    private static final long TTL_JITTER_SECONDS = 30;
    /** T-24: 逻辑过期提前量: 比物理TTL提前60秒标记为逻辑过期 */
    private static final long LOGICAL_EXPIRE_AHEAD_SECONDS = 60;

    public MultiLevelPartitionCache(StringRedisTemplate stringRedisTemplate,
                                    DronePartitionMapRepository dronePartitionMapRepository) {
        this.stringRedisTemplate = stringRedisTemplate;
        this.dronePartitionMapRepository = dronePartitionMapRepository;
    }

    /**
     * 三级缓存读取: L1 → L2 → L3
     *
     * @param uavId 无人机唯一标识
     * @return 该无人机的分区集合, 如果不存在则返回空集合
     */
    public Set<String> getPartitions(String uavId) {
        totalRequests.incrementAndGet();

        // === L1: Caffeine本地缓存 (<0.01ms) ===
        CacheEntry l1Entry = l1Cache.getIfPresent(uavId);
        if (l1Entry != null && !l1Entry.isLogicallyExpired()) {
            l1Hits.incrementAndGet();
            return l1Entry.partitions();
        }

        // L1逻辑过期 → 异步刷新，返回旧值 (T-24)
        if (l1Entry != null && l1Entry.isLogicallyExpired()) {
            l1Hits.incrementAndGet();
            asyncRefresh(uavId);
            return l1Entry.partitions();
        }

        // === L2: Redis分布式缓存 (~1ms) ===
        try {
            String redisKey = CACHE_KEY_PREFIX + uavId;
            Set<String> redisMembers = stringRedisTemplate.opsForSet().members(redisKey);
            if (redisMembers != null && !redisMembers.isEmpty()) {
                l2Hits.incrementAndGet();
                // 回填L1
                putL1(uavId, redisMembers);
                return redisMembers;
            }
        } catch (Exception e) {
            // T-25: Redis不可用，降级到L3
            log.warn("[Cache] Redis unavailable for {}, degrading to DB: {}", uavId, e.getMessage());
        }

        // === L3: Database (5-20ms) — 带互斥锁 (T-24) ===
        return loadFromDbWithLock(uavId);
    }

    /**
     * T-24: 互斥锁保护的DB回源
     * 同一uavId只允许一个线程查DB，其余线程等待结果
     */
    private Set<String> loadFromDbWithLock(String uavId) {
        ReentrantLock lock = lockMap.computeIfAbsent(uavId, k -> new ReentrantLock());

        boolean acquired = false;
        try {
            // 尝试获取锁，最多等待500ms
            acquired = lock.tryLock(500, TimeUnit.MILLISECONDS);
            if (!acquired) {
                // 获取锁超时，返回空集合而非阻塞
                log.debug("[Cache] Lock timeout for {}, returning empty", uavId);
                return Collections.emptySet();
            }

            // 双检锁：获取锁后再检查L1/L2
            CacheEntry l1Recheck = l1Cache.getIfPresent(uavId);
            if (l1Recheck != null) {
                return l1Recheck.partitions();
            }

            // 查询DB
            List<String> dbPartitions = dronePartitionMapRepository.findActivePartitionNamesByUavId(uavId);
            Set<String> partitionSet = dbPartitions.isEmpty()
                    ? Collections.emptySet()
                    : new LinkedHashSet<>(dbPartitions);

            l3Hits.incrementAndGet();

            // 回填L1和L2
            if (!partitionSet.isEmpty()) {
                putL1(uavId, partitionSet);
                putL2(uavId, partitionSet);
            }

            return partitionSet;

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.warn("[Cache] Lock interrupted for {}", uavId);
            return Collections.emptySet();
        } finally {
            if (acquired) {
                lock.unlock();
            }
            // 清理不再使用的锁对象，防止内存泄漏
            lockMap.remove(uavId, lock);
        }
    }

    /**
     * T-24: 异步刷新逻辑过期的缓存
     * 当L1中的数据逻辑过期时，异步从L2/L3加载新数据，
     * 当前请求仍返回旧值（不阻塞）
     */
    private void asyncRefresh(String uavId) {
        ReentrantLock lock = lockMap.computeIfAbsent(uavId, k -> new ReentrantLock());
        if (lock.tryLock()) {
            try {
                // 在虚拟线程中异步执行刷新
                Thread.startVirtualThread(() -> {
                    try {
                        List<String> dbPartitions = dronePartitionMapRepository
                                .findActivePartitionNamesByUavId(uavId);
                        if (!dbPartitions.isEmpty()) {
                            Set<String> partitionSet = new LinkedHashSet<>(dbPartitions);
                            putL1(uavId, partitionSet);
                            putL2(uavId, partitionSet);
                        }
                    } catch (Exception e) {
                        log.debug("[Cache] Async refresh failed for {}: {}", uavId, e.getMessage());
                    } finally {
                        lockMap.remove(uavId);
                    }
                });
            } finally {
                lock.unlock();
            }
        }
        // 如果获取锁失败，说明已有线程在刷新，跳过
    }

    /** 写入L1 Caffeine，附带逻辑过期时间 */
    private void putL1(String uavId, Set<String> partitions) {
        long logicalExpireAt = System.currentTimeMillis()
                + TimeUnit.SECONDS.toMillis(BASE_TTL_SECONDS - LOGICAL_EXPIRE_AHEAD_SECONDS);
        l1Cache.put(uavId, new CacheEntry(partitions, logicalExpireAt));
    }

    /**
     * 写入L2 Redis
     * T-25: TTL随机化防雪崩 (基础300s ± 30s随机偏移)
     */
    private void putL2(String uavId, Set<String> partitions) {
        try {
            String redisKey = CACHE_KEY_PREFIX + uavId;
            stringRedisTemplate.delete(redisKey);
            stringRedisTemplate.opsForSet().add(redisKey, partitions.toArray(new String[0]));
            // T-25: 随机化TTL
            long ttl = BASE_TTL_SECONDS + ThreadLocalRandom.current().nextLong(
                    -TTL_JITTER_SECONDS, TTL_JITTER_SECONDS + 1);
            stringRedisTemplate.expire(redisKey, Duration.ofSeconds(ttl));
        } catch (Exception e) {
            // T-25: Redis写入失败不影响L1
            log.debug("[Cache] Failed to write L2 for {}: {}", uavId, e.getMessage());
        }
    }

    /**
     * 主动失效缓存（由CDC消费者或业务变更触发）
     */
    public void invalidate(String uavId) {
        l1Cache.invalidate(uavId);
        try {
            stringRedisTemplate.delete(CACHE_KEY_PREFIX + uavId);
        } catch (Exception e) {
            log.debug("[Cache] Failed to invalidate L2 for {}: {}", uavId, e.getMessage());
        }
        log.debug("[Cache] Invalidated all levels for {}", uavId);
    }

    /**
     * 获取缓存命中率统计
     */
    public Map<String, Object> getStats() {
        long total = totalRequests.get();
        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("totalRequests", total);
        stats.put("l1Hits", l1Hits.get());
        stats.put("l2Hits", l2Hits.get());
        stats.put("l3Hits", l3Hits.get());
        if (total > 0) {
            stats.put("l1HitRate", String.format("%.2f%%", l1Hits.get() * 100.0 / total));
            stats.put("l2HitRate", String.format("%.2f%%", l2Hits.get() * 100.0 / total));
            stats.put("overallCacheHitRate", String.format("%.2f%%",
                    (l1Hits.get() + l2Hits.get()) * 100.0 / total));
        }
        stats.put("caffeineStats", l1Cache.stats().toString());
        return stats;
    }

    /**
     * 缓存条目：包含分区数据和逻辑过期时间
     */
    private record CacheEntry(Set<String> partitions, long logicalExpireAt) {
        boolean isLogicallyExpired() {
            return System.currentTimeMillis() > logicalExpireAt;
        }
    }
}
