package com.ucs.controller;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@RestController
@RequestMapping("/api/v1/map")
public class MapTileController {
    
    private static final Logger logger = LoggerFactory.getLogger(MapTileController.class);
    
    // Gaode public tile servers (no authentication required for basic tiles)
    // Using HTTP instead of HTTPS for better compatibility
    private static final String[] GAODE_TILE_SERVERS = {
        "http://wprd01.is.autonavi.com",
        "http://wprd02.is.autonavi.com",
        "http://wprd03.is.autonavi.com",
        "http://wprd04.is.autonavi.com"
    };
    
    private final RestTemplate restTemplate;
    
    // Simple in-memory cache for tiles (in production, use Redis or similar)
    private final ConcurrentHashMap<String, byte[]> tileCache = new ConcurrentHashMap<>();
    
    public MapTileController() {
        this.restTemplate = new RestTemplate();
    }
    
    @PostConstruct
    public void init() {
        logger.info("=== 高德地图瓦片代理 ===");
        logger.info("高德地图瓦片代理已启用（使用公共瓦片服务，无需 API 密钥）");
        logger.info("瓦片服务器: wprd01-04.is.autonavi.com");
    }
    
    /**
     * Health check endpoint for map tiles
     * Always returns configured=true since we use public tile servers
     */
    @GetMapping("/tiles/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        Map<String, Object> health = new HashMap<>();
        
        health.put("configured", true);
        health.put("status", "ok");
        health.put("message", "高德地图瓦片代理已启用（使用公共瓦片服务）");
        health.put("servers", GAODE_TILE_SERVERS.length);
        
        return ResponseEntity.ok(health);
    }
    
    /**
     * Proxy endpoint for Gaode map tiles
     * This endpoint fetches tiles from Gaode public servers
     * and returns them to the frontend, avoiding CORS issues
     * 
     * Note: Gaode public tile servers do not require authentication
     */
    @GetMapping("/tiles/{z}/{x}/{y}.png")
    public ResponseEntity<byte[]> getGaodeTile(
            @PathVariable int z,
            @PathVariable int x,
            @PathVariable int y,
            @RequestParam(defaultValue = "7") int style) {
        
        String cacheKey = String.format("%d/%d/%d/%d", z, x, y, style);
        
        // Check cache first
        byte[] cachedTile = tileCache.get(cacheKey);
        if (cachedTile != null) {
            return ResponseEntity.ok()
                    .contentType(MediaType.IMAGE_PNG)
                    .cacheControl(CacheControl.maxAge(java.time.Duration.ofHours(24)))
                    .body(cachedTile);
        }
        
        // Select server based on coordinates for load balancing
        int serverIndex = (x + y) % GAODE_TILE_SERVERS.length;
        String baseUrl = GAODE_TILE_SERVERS[serverIndex];
        
        // Build Gaode tile URL (no authentication needed for public tiles)
        // style=7: vector map with labels (default)
        // style=6: satellite imagery
        // style=8: satellite with roads
        String tileUrl = String.format(
            "%s/appmaptile?x=%d&y=%d&z=%d&lang=zh_cn&size=1&scl=1&style=%d",
            baseUrl, x, y, z, style
        );
        
        try {
            logger.debug("请求高德瓦片: z={}, x={}, y={}, style={}, server={}", z, x, y, style, serverIndex);
            
            HttpHeaders headers = new HttpHeaders();
            headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
            headers.set("Referer", "https://www.amap.com/");
            
            HttpEntity<String> entity = new HttpEntity<>(headers);
            
            ResponseEntity<byte[]> response = restTemplate.exchange(
                tileUrl,
                HttpMethod.GET,
                entity,
                byte[].class
            );
            
            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                byte[] tileData = response.getBody();
                
                // Check if response is actually a PNG (starts with PNG header: 0x89 P N G)
                if (tileData.length < 8 || tileData[0] != (byte)0x89 || tileData[1] != 'P' || tileData[2] != 'N' || tileData[3] != 'G') {
                    logger.warn("高德瓦片响应不是有效的 PNG 图片: z={}, x={}, y={}, 响应内容: {}", 
                        z, x, y, new String(tileData, 0, Math.min(200, tileData.length)));
                    return ResponseEntity.status(HttpStatus.BAD_GATEWAY).build();
                }
                
                // Cache the tile (limit cache size to prevent memory issues)
                if (tileCache.size() < 10000) {
                    tileCache.put(cacheKey, tileData);
                }
                
                logger.debug("高德瓦片成功: z={}, x={}, y={}, size={} bytes", z, x, y, tileData.length);
                
                return ResponseEntity.ok()
                        .contentType(MediaType.IMAGE_PNG)
                        .cacheControl(CacheControl.maxAge(java.time.Duration.ofHours(24)))
                        .body(tileData);
            } else {
                logger.warn("高德瓦片请求失败: z={}, x={}, y={}, status={}", z, x, y, response.getStatusCode());
                return ResponseEntity.status(response.getStatusCode()).build();
            }
        } catch (Exception e) {
            logger.error("获取高德瓦片异常: z={}, x={}, y={}, error={}", z, x, y, e.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).build();
        }
    }
    
    /**
     * Clear tile cache (for admin use)
     */
    @DeleteMapping("/tiles/cache")
    public ResponseEntity<String> clearCache() {
        tileCache.clear();
        return ResponseEntity.ok("Cache cleared");
    }
}
