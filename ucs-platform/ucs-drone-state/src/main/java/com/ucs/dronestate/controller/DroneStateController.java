package com.ucs.dronestate.controller;

import com.ucs.common.service.GeoSpatialService;
import com.ucs.common.service.RedisClusterService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.Set;

/**
 * 无人机状态查询REST控制器。
 * 提供分区路由缓存查询、在线状态查询、视口范围无人机查询。
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/drones")
@RequiredArgsConstructor
public class DroneStateController {

    private final RedisClusterService redisService;
    private final GeoSpatialService geoService;

    /**
     * GET /api/v1/drones/{uavId}/state
     * 查询单架无人机实时状态（从Redis Cluster读取）
     */
    @GetMapping("/{uavId}/state")
    public ResponseEntity<Map<String, String>> getDroneState(@PathVariable String uavId) {
        Map<String, String> state = redisService.getDroneState(uavId);
        if (state.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(state);
    }

    /**
     * GET /api/v1/drones/{uavId}/online
     * 检查无人机是否在线
     */
    @GetMapping("/{uavId}/online")
    public ResponseEntity<Map<String, Object>> isDroneOnline(@PathVariable String uavId) {
        boolean online = redisService.isDroneOnline(uavId);
        return ResponseEntity.ok(Map.of("uavId", uavId, "online", online));
    }

    /**
     * GET /api/v1/drones/online
     * 获取所有在线无人机ID列表
     */
    @GetMapping("/online")
    public ResponseEntity<Set<String>> getAllOnlineDrones() {
        return ResponseEntity.ok(redisService.getAllOnlineDroneIds());
    }

    /**
     * GET /api/v1/drones/viewport?minLat=&maxLat=&minLon=&maxLon=
     * 查询视口范围内的无人机（GeoHash空间索引 Phase 4.5）
     */
    @GetMapping("/viewport")
    public ResponseEntity<Set<String>> getDronesInViewport(
            @RequestParam double minLat,
            @RequestParam double maxLat,
            @RequestParam double minLon,
            @RequestParam double maxLon) {
        Set<String> drones = geoService.getDronesInViewport(minLat, maxLat, minLon, maxLon);
        return ResponseEntity.ok(drones);
    }

    /**
     * GET /api/v1/drones/nearby?lat=&lon=&radiusKm=
     * 查询附近范围内的无人机
     */
    @GetMapping("/nearby")
    public ResponseEntity<Set<String>> getDronesNearby(
            @RequestParam double lat,
            @RequestParam double lon,
            @RequestParam(defaultValue = "10") double radiusKm) {
        Set<String> drones = geoService.getDronesNearby(lat, lon, radiusKm);
        return ResponseEntity.ok(drones);
    }

    /**
     * GET /api/v1/drones/{uavId}/partitions
     * 查询无人机所属分区
     */
    @GetMapping("/{uavId}/partitions")
    public ResponseEntity<Set<String>> getDronePartitions(@PathVariable String uavId) {
        return ResponseEntity.ok(redisService.getDronePartitions(uavId));
    }

    /**
     * GET /api/v1/drones/partition/{partitionName}
     * 查询分区内所有无人机
     */
    @GetMapping("/partition/{partitionName}")
    public ResponseEntity<Set<String>> getDronesInPartition(@PathVariable String partitionName) {
        return ResponseEntity.ok(redisService.getDronesInPartition(partitionName));
    }
}
