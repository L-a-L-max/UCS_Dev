package com.ucs.strategy.map;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

/**
 * T-30: Mapbox 提供商策略实现。
 *
 * Mapbox 适用于需要高度自定义地图样式的场景：
 *   - 自定义样式编辑器（Mapbox Studio）
 *   - 3D地形渲染
 *   - 矢量瓦片（体积更小、渲染更快）
 *   - 坐标系：WGS84
 *
 * 瓦片URL格式：
 *   栅格瓦片: https://api.mapbox.com/styles/v1/{style_id}/tiles/{z}/{x}/{y}?access_token={token}
 *   卫星影像: https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg?access_token={token}
 *
 * 通过 @ConditionalOnProperty 控制激活：
 *   application.properties 中设置 map.provider=MAPBOX 即激活此策略。
 */
@Slf4j
@Component
@ConditionalOnProperty(name = "map.provider", havingValue = "MAPBOX")
public class MapboxProviderStrategy implements MapProviderStrategy {

    @Value("${mapbox.access.token:}")
    private String accessToken;

    private final RestTemplate restTemplate = new RestTemplate();

    @Override
    public String getProviderName() {
        return "MAPBOX";
    }

    @Override
    public String getDisplayName() {
        return "Mapbox";
    }

    /**
     * Mapbox 瓦片URL生成。
     *
     * style映射：
     *   "normal" → mapbox/streets-v12（街道地图）
     *   "satellite" → mapbox.satellite（卫星影像）
     *   "terrain" → mapbox/outdoors-v12（户外/地形）
     *   "dark" → mapbox/dark-v11（暗色主题，适合夜间监控）
     */
    @Override
    public String getTileUrl(int x, int y, int z, String style) {
        if ("satellite".equalsIgnoreCase(style)) {
            return String.format(
                    "https://api.mapbox.com/v4/mapbox.satellite/%d/%d/%d@2x.jpg?access_token=%s",
                    z, x, y, accessToken);
        }

        String styleId = mapStyleId(style);
        return String.format(
                "https://api.mapbox.com/styles/v1/%s/tiles/256/%d/%d/%d?access_token=%s",
                styleId, z, x, y, accessToken);
    }

    @Override
    public double[] geocode(String address) {
        if (accessToken == null || accessToken.isEmpty()) {
            log.warn("[Mapbox] Geocode failed: access token not configured");
            return null;
        }
        try {
            String url = String.format(
                    "https://api.mapbox.com/geocoding/v5/mapbox.places/%s.json?access_token=%s&limit=1",
                    address, accessToken);
            String response = restTemplate.getForObject(url, String.class);
            if (response != null && response.contains("\"coordinates\"")) {
                int coordStart = response.indexOf("\"coordinates\":[") + 15;
                int coordEnd = response.indexOf("]", coordStart);
                String coords = response.substring(coordStart, coordEnd);
                String[] parts = coords.split(",");
                return new double[]{Double.parseDouble(parts[0].trim()), Double.parseDouble(parts[1].trim())};
            }
        } catch (Exception e) {
            log.error("[Mapbox] Geocode failed for '{}': {}", address, e.getMessage());
        }
        return null;
    }

    @Override
    public String reverseGeocode(double lat, double lng) {
        if (accessToken == null || accessToken.isEmpty()) {
            log.warn("[Mapbox] Reverse geocode failed: access token not configured");
            return null;
        }
        try {
            String url = String.format(
                    "https://api.mapbox.com/geocoding/v5/mapbox.places/%.6f,%.6f.json?access_token=%s&limit=1",
                    lng, lat, accessToken);
            String response = restTemplate.getForObject(url, String.class);
            if (response != null && response.contains("\"place_name\"")) {
                int nameStart = response.indexOf("\"place_name\":\"") + 14;
                int nameEnd = response.indexOf("\"", nameStart);
                return response.substring(nameStart, nameEnd);
            }
        } catch (Exception e) {
            log.error("[Mapbox] Reverse geocode failed for ({},{}): {}", lat, lng, e.getMessage());
        }
        return null;
    }

    @Override
    public String getCoordinateSystem() {
        return "WGS84";
    }

    @Override
    public int getMaxZoom() {
        return 22;
    }

    private String mapStyleId(String style) {
        if (style == null) return "mapbox/streets-v12";
        return switch (style.toLowerCase()) {
            case "dark" -> "mapbox/dark-v11";
            case "light" -> "mapbox/light-v11";
            case "terrain", "outdoors" -> "mapbox/outdoors-v12";
            default -> "mapbox/streets-v12"; // normal
        };
    }
}
