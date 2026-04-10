package com.ucs.common.service;

import com.ucs.common.config.RedisKeyConstants;
import com.ucs.common.util.GeoHashUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.geo.*;
import org.springframework.data.redis.connection.RedisGeoCommands;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.util.HashSet;
import java.util.Set;

/**
 * GeoSpatial service for drone position indexing (Phase 4.5).
 * Uses Redis GEO commands + GeoHash reverse index for viewport queries.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GeoSpatialService {

    private final StringRedisTemplate redisTemplate;

    /**
     * Update drone position in Redis GEO index and GeoHash reverse index.
     */
    public void updateDronePosition(String uavId, double lat, double lon) {
        try {
            // 1. Redis GEO command: GEOADD drone:positions lon lat uavId
            redisTemplate.opsForGeo().add(
                    RedisKeyConstants.DRONE_POSITIONS_GEO,
                    new Point(lon, lat),
                    uavId
            );

            // 2. GeoHash reverse index: geohash:{hash} -> set of uavIds
            String geoHash = GeoHashUtil.encode(lat, lon);
            redisTemplate.opsForSet().add(RedisKeyConstants.geohashKey(geoHash), uavId);
        } catch (Exception e) {
            log.debug("[GeoSpatial] Failed to update position for {}: {}", uavId, e.getMessage());
        }
    }

    /**
     * Remove drone from GeoHash index (e.g., when drone goes offline).
     */
    public void removeDronePosition(String uavId, double lastLat, double lastLon) {
        try {
            redisTemplate.opsForGeo().remove(RedisKeyConstants.DRONE_POSITIONS_GEO, uavId);
            String geoHash = GeoHashUtil.encode(lastLat, lastLon);
            redisTemplate.opsForSet().remove(RedisKeyConstants.geohashKey(geoHash), uavId);
        } catch (Exception e) {
            log.debug("[GeoSpatial] Failed to remove position for {}: {}", uavId, e.getMessage());
        }
    }

    /**
     * Query drones within a viewport bounding box using GeoHash index.
     * This is O(k) where k = number of GeoHash cells covering the viewport.
     */
    public Set<String> getDronesInViewport(double minLat, double maxLat,
                                            double minLon, double maxLon) {
        Set<String> result = new HashSet<>();
        try {
            Set<String> geoHashes = GeoHashUtil.coverBoundingBox(minLat, maxLat, minLon, maxLon);
            for (String hash : geoHashes) {
                Set<String> members = redisTemplate.opsForSet()
                        .members(RedisKeyConstants.geohashKey(hash));
                if (members != null) {
                    result.addAll(members);
                }
            }
        } catch (Exception e) {
            log.debug("[GeoSpatial] Viewport query failed: {}", e.getMessage());
        }
        return result;
    }

    /**
     * Query drones within a radius using Redis GEO GEORADIUS command.
     * Useful for proximity-based queries.
     */
    public Set<String> getDronesNearby(double lat, double lon, double radiusKm) {
        Set<String> result = new HashSet<>();
        try {
            GeoResults<RedisGeoCommands.GeoLocation<String>> geoResults =
                    redisTemplate.opsForGeo().radius(
                            RedisKeyConstants.DRONE_POSITIONS_GEO,
                            new Circle(new Point(lon, lat), new Distance(radiusKm, Metrics.KILOMETERS))
                    );
            if (geoResults != null) {
                geoResults.forEach(geoResult ->
                        result.add(geoResult.getContent().getName())
                );
            }
        } catch (Exception e) {
            log.debug("[GeoSpatial] Nearby query failed: {}", e.getMessage());
        }
        return result;
    }
}
