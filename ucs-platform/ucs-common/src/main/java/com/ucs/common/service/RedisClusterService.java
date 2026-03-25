package com.ucs.common.service;

import com.ucs.common.config.RedisKeyConstants;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.*;

/**
 * Redis Cluster service shared across microservices.
 * Provides drone state management, partition routing, and heartbeat operations.
 * Compatible with both single-instance and cluster mode Redis.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RedisClusterService {

    private final StringRedisTemplate redisTemplate;

    private static final Duration DRONE_ONLINE_TTL = Duration.ofSeconds(30);
    private static final Duration DRONE_STATE_TTL = Duration.ofSeconds(30);

    // ---- Drone Online Heartbeat ----

    public void setDroneOnline(String uavId) {
        try {
            redisTemplate.opsForValue().set(
                    RedisKeyConstants.droneOnlineKey(uavId), "1", DRONE_ONLINE_TTL);
        } catch (Exception e) {
            log.debug("Redis unavailable for setDroneOnline({})", uavId);
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

    public Set<String> getAllOnlineDroneIds() {
        Set<String> onlineDrones = new HashSet<>();
        try {
            Set<String> keys = redisTemplate.keys("drone:*:online");
            if (keys != null) {
                for (String key : keys) {
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
}
