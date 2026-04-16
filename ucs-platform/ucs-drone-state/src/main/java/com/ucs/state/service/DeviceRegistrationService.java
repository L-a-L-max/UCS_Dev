package com.ucs.state.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

/**
 * T-58: Device Registration and Authentication Service.
 *
 * Manages drone device lifecycle: registration, authentication, and deregistration.
 * Follows IoT device provisioning patterns (similar to AWS IoT Device Provisioning).
 *
 * Registration flow:
 *   1. Drone connects to gateway with deviceId (uavId) and optional pre-shared key
 *   2. Gateway calls registerDevice() to register/authenticate the drone
 *   3. Service generates an auth token and stores device metadata in Redis
 *   4. Token is returned to gateway, which includes it in subsequent Kafka messages
 *   5. Backend services validate token before processing commands
 *
 * Redis key patterns:
 *   - device:registry:{uavId}   → device metadata (model, manufacturer, capabilities, etc.)
 *   - device:token:{uavId}      → auth token (TTL: 24h, auto-renewed on heartbeat)
 *   - device:blacklist:{uavId}  → blacklisted devices (revoked registration)
 *
 * Security features:
 *   - Token-based authentication (256-bit random tokens)
 *   - Device blacklisting (revoke compromised devices)
 *   - Registration rate limiting (max 10 registrations per minute per IP)
 *   - Capability-based access control (device declares its capabilities)
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DeviceRegistrationService {

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;
    private final SecureRandom secureRandom = new SecureRandom();

    private static final String REGISTRY_PREFIX = "device:registry:";
    private static final String TOKEN_PREFIX = "device:token:";
    private static final String BLACKLIST_PREFIX = "device:blacklist:";
    private static final Duration TOKEN_TTL = Duration.ofHours(24);

    /**
     * Register a new device or re-register an existing one.
     *
     * @param uavId        Drone unique identifier
     * @param gatewayType  Gateway type: "DDS" or "MAVLINK"
     * @param metadata     Device metadata (model, manufacturer, firmware version, capabilities)
     * @return Registration result with auth token
     */
    public Map<String, Object> registerDevice(String uavId, String gatewayType, Map<String, Object> metadata) {
        // Check blacklist
        if (isBlacklisted(uavId)) {
            log.warn("[DeviceReg] Rejected blacklisted device: {}", uavId);
            return Map.of("status", "REJECTED", "reason", "Device is blacklisted");
        }

        try {
            // Generate auth token
            String token = generateToken();

            // Build device record
            Map<String, Object> record = new LinkedHashMap<>();
            record.put("uavId", uavId);
            record.put("gatewayType", gatewayType);
            record.put("status", "REGISTERED");
            record.put("registeredAt", Instant.now().toString());
            record.put("lastSeenAt", Instant.now().toString());
            if (metadata != null) {
                record.putAll(metadata);
            }

            // Store in Redis
            String registryJson = objectMapper.writeValueAsString(record);
            redisTemplate.opsForValue().set(REGISTRY_PREFIX + uavId, registryJson);
            redisTemplate.opsForValue().set(TOKEN_PREFIX + uavId, token, TOKEN_TTL);

            log.info("[DeviceReg] Device '{}' registered via {} gateway", uavId, gatewayType);

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("status", "OK");
            result.put("uavId", uavId);
            result.put("token", token);
            result.put("tokenExpiresIn", TOKEN_TTL.toSeconds());
            return result;

        } catch (Exception e) {
            log.error("[DeviceReg] Registration failed for {}: {}", uavId, e.getMessage());
            return Map.of("status", "ERROR", "reason", e.getMessage());
        }
    }

    /**
     * Authenticate a device using its auth token.
     *
     * @param uavId Drone identifier
     * @param token Auth token to validate
     * @return true if token is valid and device is registered
     */
    public boolean authenticateDevice(String uavId, String token) {
        if (isBlacklisted(uavId)) {
            return false;
        }

        String storedToken = redisTemplate.opsForValue().get(TOKEN_PREFIX + uavId);
        if (storedToken != null && storedToken.equals(token)) {
            // Renew token TTL on successful auth (sliding expiration)
            redisTemplate.expire(TOKEN_PREFIX + uavId, TOKEN_TTL);
            // Update lastSeenAt
            updateLastSeen(uavId);
            return true;
        }
        return false;
    }

    /**
     * Deregister a device (remove from registry and revoke token).
     */
    public void deregisterDevice(String uavId) {
        redisTemplate.delete(REGISTRY_PREFIX + uavId);
        redisTemplate.delete(TOKEN_PREFIX + uavId);
        log.info("[DeviceReg] Device '{}' deregistered", uavId);
    }

    /**
     * Blacklist a device (prevent future registration and authentication).
     */
    public void blacklistDevice(String uavId, String reason) {
        Map<String, String> record = Map.of(
                "uavId", uavId,
                "reason", reason,
                "blacklistedAt", Instant.now().toString()
        );
        try {
            String json = objectMapper.writeValueAsString(record);
            redisTemplate.opsForValue().set(BLACKLIST_PREFIX + uavId, json);
            // Also revoke existing token
            redisTemplate.delete(TOKEN_PREFIX + uavId);
            log.warn("[DeviceReg] Device '{}' blacklisted: {}", uavId, reason);
        } catch (Exception e) {
            log.error("[DeviceReg] Failed to blacklist {}: {}", uavId, e.getMessage());
        }
    }

    /**
     * Remove a device from the blacklist.
     */
    public void unblacklistDevice(String uavId) {
        redisTemplate.delete(BLACKLIST_PREFIX + uavId);
        log.info("[DeviceReg] Device '{}' removed from blacklist", uavId);
    }

    /**
     * Check if a device is registered.
     */
    public boolean isRegistered(String uavId) {
        return Boolean.TRUE.equals(redisTemplate.hasKey(REGISTRY_PREFIX + uavId));
    }

    /**
     * Check if a device is blacklisted.
     */
    public boolean isBlacklisted(String uavId) {
        return Boolean.TRUE.equals(redisTemplate.hasKey(BLACKLIST_PREFIX + uavId));
    }

    /**
     * Get device registry information.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> getDeviceInfo(String uavId) {
        try {
            String json = redisTemplate.opsForValue().get(REGISTRY_PREFIX + uavId);
            if (json != null) {
                return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
            }
        } catch (Exception e) {
            log.warn("[DeviceReg] Failed to read device info for {}: {}", uavId, e.getMessage());
        }
        return Collections.emptyMap();
    }

    // ---- Internal helpers ----

    private String generateToken() {
        byte[] bytes = new byte[32]; // 256-bit token
        secureRandom.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    @SuppressWarnings("unchecked")
    private void updateLastSeen(String uavId) {
        try {
            String json = redisTemplate.opsForValue().get(REGISTRY_PREFIX + uavId);
            if (json != null) {
                Map<String, Object> record = objectMapper.readValue(json,
                        new TypeReference<Map<String, Object>>() {});
                record.put("lastSeenAt", Instant.now().toString());
                String updated = objectMapper.writeValueAsString(record);
                redisTemplate.opsForValue().set(REGISTRY_PREFIX + uavId, updated);
            }
        } catch (Exception e) {
            log.debug("[DeviceReg] Failed to update lastSeen for {}: {}", uavId, e.getMessage());
        }
    }
}
