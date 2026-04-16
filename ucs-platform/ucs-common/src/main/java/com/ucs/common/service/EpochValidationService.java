package com.ucs.common.service;

import com.ucs.common.config.RedisKeyConstants;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.concurrent.TimeUnit;

/**
 * T-65: Redis-backed Epoch validation service shared across all microservices.
 *
 * Replaces in-memory ConcurrentHashMap with Redis, making Epoch data
 * consistent across multiple instances of the same service.
 *
 * Key pattern:
 *   - epoch:{uavId}           -> current epoch value (String of long)
 *   - epoch:{uavId}:lastUpdate -> last update timestamp ms (String of long)
 *
 * Both keys use 24h TTL as automatic idle eviction.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class EpochValidationService {

    private final StringRedisTemplate redisTemplate;

    private static final long EPOCH_SOFT_LIMIT = 10_000L;
    private static final long TTL_HOURS = 24L;

    /**
     * Validate and update the epoch for a drone.
     * Returns true if the message epoch is valid (>= current epoch).
     */
    public boolean validate(String uavId, long msgEpoch) {
        try {
            String epochKey = RedisKeyConstants.epochKey(uavId);
            String lastUpdateKey = RedisKeyConstants.epochLastUpdateKey(uavId);

            String currentStr = redisTemplate.opsForValue().get(epochKey);
            long current = (currentStr != null) ? Long.parseLong(currentStr) : 0L;

            if (msgEpoch < current) {
                log.warn("[Epoch] Stale message discarded: uavId={}, msgEpoch={}, currentEpoch={}",
                        uavId, msgEpoch, current);
                return false;
            }
            if (msgEpoch > current) {
                redisTemplate.opsForValue().set(epochKey, String.valueOf(msgEpoch),
                        TTL_HOURS, TimeUnit.HOURS);
            } else {
                redisTemplate.expire(epochKey, TTL_HOURS, TimeUnit.HOURS);
            }
            redisTemplate.opsForValue().set(lastUpdateKey,
                    String.valueOf(System.currentTimeMillis()), TTL_HOURS, TimeUnit.HOURS);
            return true;
        } catch (Exception e) {
            log.debug("[Epoch] Redis unavailable for validate({}, {}), allowing message", uavId, msgEpoch);
            return true;
        }
    }

    /**
     * Get current epoch for a drone.
     */
    public long getCurrentEpoch(String uavId) {
        try {
            String val = redisTemplate.opsForValue().get(RedisKeyConstants.epochKey(uavId));
            return (val != null) ? Long.parseLong(val) : 0L;
        } catch (Exception e) {
            return 0L;
        }
    }

    /**
     * Reset epoch for a drone (e.g., on reconnection).
     */
    public void resetEpoch(String uavId, long newEpoch) {
        try {
            redisTemplate.opsForValue().set(RedisKeyConstants.epochKey(uavId),
                    String.valueOf(newEpoch), TTL_HOURS, TimeUnit.HOURS);
            redisTemplate.opsForValue().set(RedisKeyConstants.epochLastUpdateKey(uavId),
                    String.valueOf(System.currentTimeMillis()), TTL_HOURS, TimeUnit.HOURS);
            log.info("[Epoch] Reset drone {} epoch to {}", uavId, newEpoch);
        } catch (Exception e) {
            log.debug("[Epoch] Redis unavailable for resetEpoch({})", uavId);
        }
    }

    /**
     * T-65/T-66: Periodic maintenance with ShedLock.
     * Normalizes large epochs to prevent overflow.
     * Idle eviction is handled by Redis TTL (24h) automatically.
     */
    @Scheduled(fixedRate = 6 * 60 * 60 * 1000)
    @SchedulerLock(name = "epochMaintenance", lockAtLeastFor = "5m", lockAtMostFor = "30m")
    public void periodicMaintenance() {
        int normalized = 0;
        try {
            ScanOptions options = ScanOptions.scanOptions()
                    .match("epoch:*")
                    .count(200)
                    .build();
            try (Cursor<String> cursor = redisTemplate.scan(options)) {
                while (cursor.hasNext()) {
                    String key = cursor.next();
                    if (key.contains(":lastUpdate")) {
                        continue;
                    }
                    String val = redisTemplate.opsForValue().get(key);
                    if (val != null) {
                        long epoch = Long.parseLong(val);
                        if (epoch > EPOCH_SOFT_LIMIT) {
                            redisTemplate.opsForValue().set(key, "1", TTL_HOURS, TimeUnit.HOURS);
                            normalized++;
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.debug("[Epoch] Maintenance scan failed: {}", e.getMessage());
        }
        if (normalized > 0) {
            log.info("[Epoch] Maintenance: normalized={}", normalized);
        }
    }
}
