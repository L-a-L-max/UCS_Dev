package com.ucs.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.concurrent.ConcurrentHashMap;

@RestController
@RequestMapping("/api/v1/map")
public class MapTileController {
    
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
                
                // Cache the tile (limit cache size to prevent memory issues)
                if (tileCache.size() < 10000) {
                    tileCache.put(cacheKey, tileData);
                }
                
                return ResponseEntity.ok()
                        .contentType(MediaType.IMAGE_PNG)
                        .cacheControl(CacheControl.maxAge(java.time.Duration.ofHours(24)))
                        .body(tileData);
            } else {
                return ResponseEntity.status(response.getStatusCode()).build();
            }
        } catch (Exception e) {
            System.err.println("Failed to fetch Gaode tile: " + e.getMessage());
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
