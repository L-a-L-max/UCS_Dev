package com.ucs.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.*;
import java.util.concurrent.TimeUnit;

/**
 * Redis service for Zenoh drone cache management.
 * 
 * Key patterns:
 * - drone:{uavId}:online        → "true"/"false" with TTL (heartbeat-based)
 * - drone:{uavId}:partitions    → Set of partition names
 * - drone:{uavId}:controller    → userId of current controller
 * - partition:{name}:drones     → Set of uavIds in this partition
 * - lock:drone:{uavId}          → Distributed lock for permission transfer (5s TTL)
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RedisService {
    
    private final RedisTemplate<String, Object> redisTemplate;
    private final StringRedisTemplate stringRedisTemplate;
    
    private static final String DRONE_ONLINE_PREFIX = "drone:%s:online";
    private static final String DRONE_PARTITIONS_PREFIX = "drone:%s:partitions";
    private static final String DRONE_CONTROLLER_PREFIX = "drone:%s:controller";
    private static final String PARTITION_DRONES_PREFIX = "partition:%s:drones";
    private static final String LOCK_DRONE_PREFIX = "lock:drone:%s";
    private static final Duration HEARTBEAT_TTL = Duration.ofSeconds(30);
    private static final Duration LOCK_TTL = Duration.ofSeconds(5);
    
    // ========== Drone Online Status ==========
    
    /**
     * Mark drone as online with TTL-based heartbeat.
     */
    public void setDroneOnline(String uavId) {
        String key = String.format(DRONE_ONLINE_PREFIX, uavId);
        stringRedisTemplate.opsForValue().set(key, "true", HEARTBEAT_TTL);
    }
    
    /**
     * Mark drone as offline explicitly.
     */
    public void setDroneOffline(String uavId) {
        String key = String.format(DRONE_ONLINE_PREFIX, uavId);
        stringRedisTemplate.delete(key);
    }
    
    /**
     * Check if drone is online (key exists and not expired).
     */
    public boolean isDroneOnline(String uavId) {
        try {
            String key = String.format(DRONE_ONLINE_PREFIX, uavId);
            return Boolean.TRUE.equals(stringRedisTemplate.hasKey(key));
        } catch (Exception e) {
            log.debug("Redis unavailable for isDroneOnline({}), returning false", uavId);
            return false;
        }
    }
    
    // ========== Drone Partition Mapping ==========
    
    /**
     * Set the partitions a drone belongs to.
     */
    public void setDronePartitions(String uavId, Set<String> partitionNames) {
        String key = String.format(DRONE_PARTITIONS_PREFIX, uavId);
        stringRedisTemplate.delete(key);
        if (!partitionNames.isEmpty()) {
            stringRedisTemplate.opsForSet().add(key, partitionNames.toArray(new String[0]));
        }
    }
    
    /**
     * Get all partitions for a drone.
     */
    public Set<String> getDronePartitions(String uavId) {
        String key = String.format(DRONE_PARTITIONS_PREFIX, uavId);
        Set<String> members = stringRedisTemplate.opsForSet().members(key);
        return members != null ? members : Collections.emptySet();
    }
    
    /**
     * Add a drone to a partition.
     */
    public void addDroneToPartition(String uavId, String partitionName) {
        String droneKey = String.format(DRONE_PARTITIONS_PREFIX, uavId);
        String partKey = String.format(PARTITION_DRONES_PREFIX, partitionName);
        stringRedisTemplate.opsForSet().add(droneKey, partitionName);
        stringRedisTemplate.opsForSet().add(partKey, uavId);
    }
    
    /**
     * Remove a drone from a specific partition (reverse index cleanup).
     */
    public void removeDroneFromPartition(String uavId, String partitionName) {
        String droneKey = String.format(DRONE_PARTITIONS_PREFIX, uavId);
        String partKey = String.format(PARTITION_DRONES_PREFIX, partitionName);
        stringRedisTemplate.opsForSet().remove(droneKey, partitionName);
        stringRedisTemplate.opsForSet().remove(partKey, uavId);
    }

    /**
     * Get all drones in a partition.
     */
    public Set<String> getDronesInPartition(String partitionName) {
        String key = String.format(PARTITION_DRONES_PREFIX, partitionName);
        Set<String> members = stringRedisTemplate.opsForSet().members(key);
        return members != null ? members : Collections.emptySet();
    }
    
    // ========== Drone Controller (who controls this drone) ==========
    
    /**
     * Set the current controller (user ID) for a drone.
     */
    public void setDroneController(String uavId, Long userId) {
        String key = String.format(DRONE_CONTROLLER_PREFIX, uavId);
        stringRedisTemplate.opsForValue().set(key, userId.toString());
    }
    
    /**
     * Get the current controller user ID for a drone.
     */
    public Long getDroneController(String uavId) {
        try {
            String key = String.format(DRONE_CONTROLLER_PREFIX, uavId);
            String value = stringRedisTemplate.opsForValue().get(key);
            return value != null ? Long.parseLong(value) : null;
        } catch (Exception e) {
            log.debug("Redis unavailable for getDroneController({}), returning null", uavId);
            return null;
        }
    }
    
    /**
     * Remove controller assignment from a drone.
     */
    public void removeDroneController(String uavId) {
        String key = String.format(DRONE_CONTROLLER_PREFIX, uavId);
        stringRedisTemplate.delete(key);
    }
    
    // ========== Drone Home Position Cache ==========
    
    private static final String DRONE_HOME_PREFIX = "drone:%s:home";
    
    /**
     * Cache drone home position in Redis.
     * Stored as "lat,lon,alt" string for fast retrieval.
     */
    public void setDroneHome(String uavId, double lat, double lon, double alt) {
        String key = String.format(DRONE_HOME_PREFIX, uavId);
        String value = String.format("%.8f,%.8f,%.4f", lat, lon, alt);
        stringRedisTemplate.opsForValue().set(key, value);
        log.debug("Cached home for drone {}: {}", uavId, value);
    }
    
    /**
     * Get cached drone home position from Redis.
     * @return double array [lat, lon, alt] or null if not cached
     */
    public double[] getDroneHome(String uavId) {
        try {
            String key = String.format(DRONE_HOME_PREFIX, uavId);
            String value = stringRedisTemplate.opsForValue().get(key);
            if (value != null) {
                String[] parts = value.split(",");
                if (parts.length == 3) {
                    return new double[] {
                        Double.parseDouble(parts[0]),
                        Double.parseDouble(parts[1]),
                        Double.parseDouble(parts[2])
                    };
                }
            }
            return null;
        } catch (Exception e) {
            log.debug("Redis unavailable for getDroneHome({}), returning null", uavId);
            return null;
        }
    }
    
    /**
     * Remove cached home position for a drone.
     */
    public void removeDroneHome(String uavId) {
        String key = String.format(DRONE_HOME_PREFIX, uavId);
        stringRedisTemplate.delete(key);
    }
    
    // ========== Distributed Lock ==========
    
    /**
     * Try to acquire a distributed lock for drone permission transfer.
     * Uses Redis SETNX with 5-second TTL to prevent deadlock.
     * 
     * @param uavId The drone's unique identifier
     * @param lockValue Unique lock value (e.g., UUID) for safe release
     * @return true if lock acquired, false otherwise
     */
    public boolean tryAcquireLock(String uavId, String lockValue) {
        String key = String.format(LOCK_DRONE_PREFIX, uavId);
        Boolean acquired = stringRedisTemplate.opsForValue()
                .setIfAbsent(key, lockValue, LOCK_TTL);
        if (Boolean.TRUE.equals(acquired)) {
            log.debug("Lock acquired for drone {}", uavId);
            return true;
        }
        log.debug("Failed to acquire lock for drone {}", uavId);
        return false;
    }
    
    /**
     * Release the distributed lock.
     * Only releases if the lock value matches (prevents releasing someone else's lock).
     * 
     * @param uavId The drone's unique identifier
     * @param lockValue The lock value used when acquiring
     * @return true if lock was released, false if not owned
     */
    public boolean releaseLock(String uavId, String lockValue) {
        String key = String.format(LOCK_DRONE_PREFIX, uavId);
        // Use Lua script for atomic compare-and-delete to prevent race conditions
        String script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
        Long result = stringRedisTemplate.execute(
                new org.springframework.data.redis.core.script.DefaultRedisScript<>(script, Long.class),
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
    }
}
