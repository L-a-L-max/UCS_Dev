package com.ucs.controller;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
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
    
    // Gaode Map API credentials from application properties
    @Value("${gaode.api.key:}")
    private String gaodeApiKey;
    
    @Value("${gaode.security.key:}")
    private String gaodeSecurityKey;
    
    // Tile server URLs
    private static final String[] GAODE_TILE_SERVERS = {
        "https://wprd01.is.autonavi.com",
        "https://wprd02.is.autonavi.com",
        "https://wprd03.is.autonavi.com",
        "https://wprd04.is.autonavi.com"
    };
    
    private final RestTemplate restTemplate;
    
    // Simple in-memory cache for tiles (in production, use Redis or similar)
    private final ConcurrentHashMap<String, byte[]> tileCache = new ConcurrentHashMap<>();
    
    public MapTileController() {
        this.restTemplate = new RestTemplate();
    }
    
    @PostConstruct
    public void init() {
        boolean apiKeyPresent = gaodeApiKey != null && !gaodeApiKey.isEmpty();
        boolean securityKeyPresent = gaodeSecurityKey != null && !gaodeSecurityKey.isEmpty();
        
        logger.info("=== 高德地图瓦片代理配置 ===");
        logger.info("API Key 已配置: {}", apiKeyPresent ? "是" : "否");
        logger.info("安全密钥已配置: {}", securityKeyPresent ? "是" : "否");
        
        if (!apiKeyPresent || !securityKeyPresent) {
            logger.warn("警告: 高德地图 API 密钥未完整配置！");
            logger.warn("请设置环境变量 GAODE_API_KEY 和 GAODE_SECURITY_KEY");
            logger.warn("地图瓦片功能将无法正常工作");
        } else {
            logger.info("高德地图瓦片代理已启用");
        }
    }
    
    private boolean isConfigured() {
        return gaodeApiKey != null && !gaodeApiKey.isEmpty() 
            && gaodeSecurityKey != null && !gaodeSecurityKey.isEmpty();
    }
    
    /**
     * Health check endpoint for map tiles configuration
     * Returns configuration status and any error messages
     */
    @GetMapping("/tiles/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        Map<String, Object> health = new HashMap<>();
        boolean configured = isConfigured();
        
        health.put("configured", configured);
        health.put("apiKeyPresent", gaodeApiKey != null && !gaodeApiKey.isEmpty());
        health.put("securityKeyPresent", gaodeSecurityKey != null && !gaodeSecurityKey.isEmpty());
        
        if (configured) {
            health.put("status", "ok");
            health.put("message", "高德地图瓦片代理已配置");
        } else {
            health.put("status", "error");
            health.put("message", "高德地图 API 密钥未配置。请设置环境变量 GAODE_API_KEY 和 GAODE_SECURITY_KEY 后重启后端服务。");
        }
        
        return ResponseEntity.ok(health);
    }
    
    /**
     * Proxy endpoint for Gaode map tiles
     * This endpoint fetches tiles from Gaode servers with proper authentication
     * and returns them to the frontend, avoiding CORS issues
     */
    @GetMapping("/tiles/{z}/{x}/{y}.png")
    public ResponseEntity<byte[]> getGaodeTile(
            @PathVariable int z,
            @PathVariable int x,
            @PathVariable int y,
            @RequestParam(defaultValue = "7") int style) {
        
        // Check if API keys are configured
        if (!isConfigured()) {
            logger.warn("地图瓦片请求失败: API 密钥未配置");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
        
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
        
        // Build Gaode tile URL with authentication
        // style=7: vector map with labels
        // style=6: satellite imagery
        // style=8: satellite with roads
        String tileUrl = String.format(
            "%s/appmaptile?x=%d&y=%d&z=%d&lang=zh_cn&size=1&scl=1&style=%d&key=%s&jscode=%s",
            baseUrl, x, y, z, style, gaodeApiKey, gaodeSecurityKey
        );
        
        try {
            logger.debug("请求高德瓦片: z={}, x={}, y={}, style={}", z, x, y, style);
            
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
            
            logger.debug("高德瓦片响应: status={}, contentType={}, bodyLength={}", 
                response.getStatusCode(), 
                response.getHeaders().getContentType(),
                response.getBody() != null ? response.getBody().length : 0);
            
            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                byte[] tileData = response.getBody();
                
                // Check if response is actually a PNG (starts with PNG header)
                if (tileData.length < 8 || tileData[0] != (byte)0x89 || tileData[1] != 'P' || tileData[2] != 'N' || tileData[3] != 'G') {
                    logger.warn("高德瓦片响应不是有效的 PNG 图片，可能是错误信息: {}", new String(tileData, 0, Math.min(200, tileData.length)));
                    return ResponseEntity.status(HttpStatus.BAD_GATEWAY).build();
                }
                
                // Cache the tile (limit cache size to prevent memory issues)
                if (tileCache.size() < 10000) {
                    tileCache.put(cacheKey, tileData);
                }
                
                return ResponseEntity.ok()
                        .contentType(MediaType.IMAGE_PNG)
                        .cacheControl(CacheControl.maxAge(java.time.Duration.ofHours(24)))
                        .body(tileData);
            } else {
                logger.warn("高德瓦片请求失败: status={}", response.getStatusCode());
                return ResponseEntity.status(response.getStatusCode()).build();
            }
        } catch (Exception e) {
            logger.error("获取高德瓦片异常: {}", e.getMessage(), e);
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
