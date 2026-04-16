package com.ucs.common.service;

import com.ucs.common.config.RedisKeyConstants;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.*;

/**
 * T-64: Unified Redis service shared across all microservices.
 *
 * Merges functionality from ucs-business RedisService into this shared service.
 * All Redis operations across microservices MUST go through this class.
 *
 * Key changes (T-64):
 *   - KEYS command replaced with SCAN (cluster-safe, non-blocking)
 *   - Heartbeat ZSet operations merged from RedisService
 *   - Controller assignment operations merged from RedisService
 *   - Home position cache merged from RedisService
 *   - Distributed lock operations merged from RedisService
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RedisClusterService {

    private final StringRedisTemplate redisTemplate;

    private static final Duration DRONE_ONLINE_TTL = Duration.ofSeconds(30);
    private static final Duration DRONE_STATE_TTL = Duration.ofSeconds(30);
    private static final Duration LOCK_TTL = Duration.ofSeconds(5);

    // ---- Drone Online Heartbeat ----

    public void setDroneOnline(String uavId) {
        try {
            redisTemplate.opsForValue().set(
                    RedisKeyConstants.droneOnlineKey(uavId), "1", DRONE_ONLINE_TTL);
        } catch (Exception e) {
            log.debug("Redis unavailable for setDroneOnline({})", uavId);
        }
    }

    public void setDroneOffline(String uavId) {
        try {
            redisTemplate.delete(RedisKeyConstants.droneOnlineKey(uavId));
        } catch (Exception e) {
            log.debug("Redis unavailable for setDroneOffline({})", uavId);
        }
    }

    public boolean isDroneOnline(String uavId) {
        try {
            return Boolean.TRUE.equals(
                    redisTemplate.hasKey(RedisKeyConstants.droneOnlineKey(uavId)));
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * T-64: Get all online drone IDs using SCAN instead of KEYS.
     * SCAN is cluster-safe and non-blocking.
     */
    public Set<String> getAllOnlineDroneIds() {
        Set<String> onlineDrones = new HashSet<>();
        try {
            ScanOptions options = ScanOptions.scanOptions()
                    .match("drone:*:online")
                    .count(100)
                    .build();
            try (Cursor<String> cursor = redisTemplate.scan(options)) {
                while (cursor.hasNext()) {
                    String key = cursor.next();
                    String[] parts = key.split(":");
                    if (parts.length >= 3) {
                        onlineDrones.add(parts[1]);
                    }
                }
            }
        } catch (Exception e) {
            log.debug("Redis unavailable for getAllOnlineDroneIds()");
        }
        return onlineDrones;
    }

    // ---- Heartbeat ZSet (merged from RedisService T-64) ----

    public void updateDroneHeartbeat(String uavId) {
        try {
            double nowMs = System.currentTimeMillis();
            redisTemplate.opsForZSet().add(RedisKeyConstants.DRONE_HEARTBEAT_ZSET, uavId, nowMs);
        } catch (Exception e) {
            log.debug("Redis unavailable for updateDroneHeartbeat({})", uavId);
        }
    }

    public Set<String> getTimedOutDrones(long timeoutMs) {
        try {
            double cutoff = System.currentTimeMillis() - timeoutMs;
            Set<String> timedOut = redisTemplate.opsForZSet()
                    .rangeByScore(RedisKeyConstants.DRONE_HEARTBEAT_ZSET, 0, cutoff);
            return timedOut != null ? timedOut : Collections.emptySet();
        } catch (Exception e) {
            log.debug("Redis unavailable for getTimedOutDrones()");
            return Collections.emptySet();
        }
    }

    public void removeDroneHeartbeat(String uavId) {
        try {
            redisTemplate.opsForZSet().remove(RedisKeyConstants.DRONE_HEARTBEAT_ZSET, uavId);
        } catch (Exception e) {
            log.debug("Redis unavailable for removeDroneHeartbeat({})", uavId);
        }
    }

    // ---- Drone State (Hash) ----

    public void updateDroneState(String uavId, Map<String, String> stateMap) {
        try {
            String key = RedisKeyConstants.droneStateKey(uavId);
            redisTemplate.opsForHash().putAll(key, stateMap);
            redisTemplate.expire(key, DRONE_STATE_TTL);
        } catch (Exception e) {
            log.debug("Redis unavailable for updateDroneState({})", uavId);
        }
    }

    @SuppressWarnings("unchecked")
    public Map<String, String> getDroneState(String uavId) {
        try {
            Map<Object, Object> raw = redisTemplate.opsForHash()
                    .entries(RedisKeyConstants.droneStateKey(uavId));
            Map<String, String> result = new HashMap<>();
            raw.forEach((k, v) -> result.put(k.toString(), v.toString()));
            return result;
        } catch (Exception e) {
            return Collections.emptyMap();
        }
    }

    // ---- Partition Routing ----

    public void setDronePartitions(String uavId, Set<String> partitions) {
        try {
            String key = RedisKeyConstants.dronePartitionsKey(uavId);
            redisTemplate.delete(key);
            if (!partitions.isEmpty()) {
                redisTemplate.opsForSet().add(key, partitions.toArray(new String[0]));
            }
        } catch (Exception e) {
            log.debug("Redis unavailable for setDronePartitions({})", uavId);
        }
    }

    public Set<String> getDronePartitions(String uavId) {
        try {
            Set<String> members = redisTemplate.opsForSet()
                    .members(RedisKeyConstants.dronePartitionsKey(uavId));
            return members != null ? members : Collections.emptySet();
        } catch (Exception e) {
            return Collections.emptySet();
        }
    }

    public void addDroneToPartition(String uavId, String partitionName) {
        try {
            redisTemplate.opsForSet().add(
                    RedisKeyConstants.partitionDronesKey(partitionName), uavId);
        } catch (Exception e) {
            log.debug("Redis unavailable for addDroneToPartition({}, {})", uavId, partitionName);
        }
    }

    public void removeDroneFromPartition(String uavId, String partitionName) {
        try {
            redisTemplate.opsForSet().remove(
                    RedisKeyConstants.partitionDronesKey(partitionName), uavId);
        } catch (Exception e) {
            log.debug("Redis unavailable for removeDroneFromPartition({}, {})", uavId, partitionName);
        }
    }

    public Set<String> getDronesInPartition(String partitionName) {
        try {
            Set<String> members = redisTemplate.opsForSet()
                    .members(RedisKeyConstants.partitionDronesKey(partitionName));
            return members != null ? members : Collections.emptySet();
        } catch (Exception e) {
            return Collections.emptySet();
        }
    }

    // ---- Drone Controller Assignment (merged from RedisService T-64) ----

    public void setDroneController(String uavId, Long userId) {
        try {
            redisTemplate.opsForValue().set(
                    RedisKeyConstants.droneControllerKey(uavId), userId.toString());
        } catch (Exception e) {
            log.debug("Redis unavailable for setDroneController({})", uavId);
        }
    }

    public Long getDroneController(String uavId) {
        try {
            String value = redisTemplate.opsForValue()
                    .get(RedisKeyConstants.droneControllerKey(uavId));
            return value != null ? Long.parseLong(value) : null;
        } catch (Exception e) {
            log.debug("Redis unavailable for getDroneController({})", uavId);
            return null;
        }
    }

    public void removeDroneController(String uavId) {
        try {
            redisTemplate.delete(RedisKeyConstants.droneControllerKey(uavId));
        } catch (Exception e) {
            log.debug("Redis unavailable for removeDroneController({})", uavId);
        }
    }

    // ---- Drone Home Position Cache (merged from RedisService T-64) ----

    public void setDroneHome(String uavId, double lat, double lon, double alt) {
        try {
            String value = String.format("%.8f,%.8f,%.4f", lat, lon, alt);
            redisTemplate.opsForValue().set(
                    RedisKeyConstants.droneHomeKey(uavId), value);
            log.debug("Cached home for drone {}: {}", uavId, value);
        } catch (Exception e) {
            log.debug("Redis unavailable for setDroneHome({})", uavId);
        }
    }

    public double[] getDroneHome(String uavId) {
        try {
            String value = redisTemplate.opsForValue()
                    .get(RedisKeyConstants.droneHomeKey(uavId));
            if (value != null) {
                String[] parts = value.split(",");
                if (parts.length == 3) {
                    return new double[]{
                            Double.parseDouble(parts[0]),
                            Double.parseDouble(parts[1]),
                            Double.parseDouble(parts[2])
                    };
                }
            }
            return null;
        } catch (Exception e) {
            log.debug("Redis unavailable for getDroneHome({})", uavId);
            return null;
        }
    }

    public void removeDroneHome(String uavId) {
        try {
            redisTemplate.delete(RedisKeyConstants.droneHomeKey(uavId));
        } catch (Exception e) {
            log.debug("Redis unavailable for removeDroneHome({})", uavId);
        }
    }

    // ---- Distributed Lock (merged from RedisService T-64) ----

    public boolean tryAcquireLock(String uavId, String lockValue) {
        try {
            String key = RedisKeyConstants.droneLockKey(uavId);
            Boolean acquired = redisTemplate.opsForValue()
                    .setIfAbsent(key, lockValue, LOCK_TTL);
            if (Boolean.TRUE.equals(acquired)) {
                log.debug("Lock acquired for drone {}", uavId);
                return true;
            }
            log.debug("Failed to acquire lock for drone {}", uavId);
            return false;
        } catch (Exception e) {
            log.debug("Redis unavailable for tryAcquireLock({})", uavId);
            return false;
        }
    }

    public boolean releaseLock(String uavId, String lockValue) {
        try {
            String key = RedisKeyConstants.droneLockKey(uavId);
            String script = "if redis.call('get', KEYS[1]) == ARGV[1] then " +
                    "return redis.call('del', KEYS[1]) else return 0 end";
            Long result = redisTemplate.execute(
                    new DefaultRedisScript<>(script, Long.class),
                    List.of(key),
                    lockValue
            );
            boolean released = result != null && result > 0;
            if (released) {
                log.debug("Lock released for drone {}", uavId);
            } else {
                log.warn("Lock release failed for drone {} - value mismatch", uavId);
            }
            return released;
        } catch (Exception e) {
            log.debug("Redis unavailable for releaseLock({})", uavId);
            return false;
        }
    }
}
