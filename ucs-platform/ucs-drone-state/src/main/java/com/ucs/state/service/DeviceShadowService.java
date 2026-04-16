package com.ucs.state.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * T-57: Device Shadow Service (AWS IoT Shadow pattern).
 *
 * Maintains a virtual representation ("shadow") of each drone's state in Redis,
 * enabling queries even when the drone is offline.
 *
 * Shadow structure:
 *   - reported: Last known state reported by the drone (telemetry)
 *   - desired:  Target state set by the operator (commands)
 *   - delta:    Difference between desired and reported (pending changes)
 *   - metadata: Timestamps for each field update
 *
 * Redis key pattern: shadow:{uavId}
 * TTL: 24 hours (offline drones' shadows expire after 24h)
 *
 * Use cases:
 *   1. Query drone state when offline (last known position, battery, mode)
 *   2. Queue commands for offline drones (desired state)
 *   3. Detect config drift (delta between desired and reported)
 *   4. Audit trail (metadata timestamps)
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DeviceShadowService {

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    private static final String SHADOW_KEY_PREFIX = "shadow:";
    private static final Duration SHADOW_TTL = Duration.ofHours(24);

    /** In-memory cache of recent shadows for fast access */
    private final ConcurrentHashMap<String, Map<String, Object>> shadowCache = new ConcurrentHashMap<>();

    /**
     * Update the "reported" state of a drone shadow.
     * Called when telemetry data arrives from the drone.
     *
     * @param uavId   Drone identifier
     * @param reported Map of reported state fields (lat, lon, alt, armed, flightMode, etc.)
     */
    public void updateReported(String uavId, Map<String, Object> reported) {
        try {
            String key = SHADOW_KEY_PREFIX + uavId;
            Map<String, Object> shadow = getShadowInternal(uavId);

            shadow.put("reported", reported);
            shadow.put("lastReportedAt", Instant.now().toString());

            // Compute delta: fields in desired that differ from reported
            computeDelta(shadow);

            String json = objectMapper.writeValueAsString(shadow);
            redisTemplate.opsForValue().set(key, json, SHADOW_TTL);
            shadowCache.put(uavId, shadow);

            log.debug("[DeviceShadow] Updated reported state for {}", uavId);
        } catch (Exception e) {
            log.warn("[DeviceShadow] Failed to update reported for {}: {}", uavId, e.getMessage());
        }
    }

    /**
     * Update the "desired" state of a drone shadow.
     * Called when an operator sends a command or configuration change.
     *
     * @param uavId  Drone identifier
     * @param desired Map of desired state fields (e.g., targetAlt, flightMode, armed)
     */
    public void updateDesired(String uavId, Map<String, Object> desired) {
        try {
            String key = SHADOW_KEY_PREFIX + uavId;
            Map<String, Object> shadow = getShadowInternal(uavId);

            shadow.put("desired", desired);
            shadow.put("lastDesiredAt", Instant.now().toString());

            computeDelta(shadow);

            String json = objectMapper.writeValueAsString(shadow);
            redisTemplate.opsForValue().set(key, json, SHADOW_TTL);
            shadowCache.put(uavId, shadow);

            log.debug("[DeviceShadow] Updated desired state for {}", uavId);
        } catch (Exception e) {
            log.warn("[DeviceShadow] Failed to update desired for {}: {}", uavId, e.getMessage());
        }
    }

    /**
     * Get the full shadow document for a drone.
     *
     * @param uavId Drone identifier
     * @return Shadow document with reported, desired, delta, and metadata
     */
    public Map<String, Object> getShadow(String uavId) {
        // Try in-memory cache first
        Map<String, Object> cached = shadowCache.get(uavId);
        if (cached != null) {
            return cached;
        }
        return getShadowInternal(uavId);
    }

    /**
     * Get the delta (pending changes) for a drone.
     *
     * @param uavId Drone identifier
     * @return Delta map (fields where desired != reported), empty if in sync
     */
    public Map<String, Object> getDelta(String uavId) {
        Map<String, Object> shadow = getShadow(uavId);
        Object delta = shadow.get("delta");
        if (delta instanceof Map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> deltaMap = (Map<String, Object>) delta;
            return deltaMap;
        }
        return Collections.emptyMap();
    }

    /**
     * Delete a drone's shadow (e.g., when drone is deregistered).
     */
    public void deleteShadow(String uavId) {
        String key = SHADOW_KEY_PREFIX + uavId;
        redisTemplate.delete(key);
        shadowCache.remove(uavId);
        log.info("[DeviceShadow] Deleted shadow for {}", uavId);
    }

    /**
     * List all drone IDs that have active shadows.
     */
    public Set<String> listShadowedDrones() {
        Set<String> keys = redisTemplate.keys(SHADOW_KEY_PREFIX + "*");
        if (keys == null) return Collections.emptySet();
        Set<String> uavIds = new HashSet<>();
        for (String key : keys) {
            uavIds.add(key.substring(SHADOW_KEY_PREFIX.length()));
        }
        return uavIds;
    }

    // ---- Internal helpers ----

    @SuppressWarnings("unchecked")
    private Map<String, Object> getShadowInternal(String uavId) {
        try {
            String key = SHADOW_KEY_PREFIX + uavId;
            String json = redisTemplate.opsForValue().get(key);
            if (json != null) {
                Map<String, Object> shadow = objectMapper.readValue(json,
                        new TypeReference<Map<String, Object>>() {});
                shadowCache.put(uavId, shadow);
                return shadow;
            }
        } catch (Exception e) {
            log.warn("[DeviceShadow] Failed to read shadow for {}: {}", uavId, e.getMessage());
        }
        // Return empty shadow structure
        Map<String, Object> empty = new LinkedHashMap<>();
        empty.put("uavId", uavId);
        empty.put("reported", new LinkedHashMap<>());
        empty.put("desired", new LinkedHashMap<>());
        empty.put("delta", new LinkedHashMap<>());
        empty.put("createdAt", Instant.now().toString());
        return empty;
    }

    @SuppressWarnings("unchecked")
    private void computeDelta(Map<String, Object> shadow) {
        Object desiredObj = shadow.get("desired");
        Object reportedObj = shadow.get("reported");
        if (!(desiredObj instanceof Map) || !(reportedObj instanceof Map)) {
            shadow.put("delta", new LinkedHashMap<>());
            return;
        }

        Map<String, Object> desired = (Map<String, Object>) desiredObj;
        Map<String, Object> reported = (Map<String, Object>) reportedObj;
        Map<String, Object> delta = new LinkedHashMap<>();

        for (Map.Entry<String, Object> entry : desired.entrySet()) {
            String field = entry.getKey();
            Object desiredVal = entry.getValue();
            Object reportedVal = reported.get(field);
            if (!Objects.equals(desiredVal, reportedVal)) {
                delta.put(field, desiredVal);
            }
        }
        shadow.put("delta", delta);
    }
}
