package com.ucs.strategy.map;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

/**
 * T-30: Google Maps 提供商策略实现。
 *
 * Google Maps 适用于国际场景（海外无人机管控）：
 *   - 全球卫星影像覆盖
 *   - 精确地理编码
 *   - 坐标系：WGS84（GPS原始坐标，无偏移）
 *
 * 瓦片URL格式：
 *   标准地图: https://mt{0-3}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}
 *   卫星影像: https://mt{0-3}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}
 *   混合模式: https://mt{0-3}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}
 *
 * 通过 @ConditionalOnProperty 控制激活：
 *   application.properties 中设置 map.provider=GOOGLE 即激活此策略。
 */
@Slf4j
@Component
@ConditionalOnProperty(name = "map.provider", havingValue = "GOOGLE")
public class GoogleMapsProviderStrategy implements MapProviderStrategy {

    @Value("${google.maps.api.key:}")
    private String apiKey;

    private final RestTemplate restTemplate = new RestTemplate();

    @Override
    public String getProviderName() {
        return "GOOGLE";
    }

    @Override
    public String getDisplayName() {
        return "Google Maps";
    }

    /**
     * Google Maps 瓦片URL生成。
     * 使用 (x+y)%4 在4台瓦片服务器间负载均衡（mt0-mt3）。
     *
     * lyrs参数映射：
     *   m → 标准地图
     *   s → 卫星影像
     *   y → 混合模式（卫星+标注）
     *   t → 地形图
     *   p → 地形+标注
     */
    @Override
    public String getTileUrl(int x, int y, int z, String style) {
        int serverIndex = (x + y) % 4;
        String lyrs = mapLayerType(style);

        return String.format(
                "https://mt%d.google.com/vt/lyrs=%s&x=%d&y=%d&z=%d",
                serverIndex, lyrs, x, y, z);
    }

    @Override
    public double[] geocode(String address) {
        if (apiKey == null || apiKey.isEmpty()) {
            log.warn("[GoogleMaps] Geocode failed: API key not configured");
            return null;
        }
        try {
            String url = String.format(
                    "https://maps.googleapis.com/maps/api/geocode/json?address=%s&key=%s",
                    address, apiKey);
            String response = restTemplate.getForObject(url, String.class);
            if (response != null && response.contains("\"lat\"")) {
                // 简化解析：实际应使用Jackson
                int latStart = response.indexOf("\"lat\" :") + 7;
                int latEnd = response.indexOf(",", latStart);
                double lat = Double.parseDouble(response.substring(latStart, latEnd).trim());

                int lngStart = response.indexOf("\"lng\" :", latEnd) + 7;
                int lngEnd = response.indexOf("\n", lngStart);
                if (lngEnd == -1) lngEnd = response.indexOf("}", lngStart);
                double lng = Double.parseDouble(response.substring(lngStart, lngEnd).trim());

                return new double[]{lng, lat};
            }
        } catch (Exception e) {
            log.error("[GoogleMaps] Geocode failed for '{}': {}", address, e.getMessage());
        }
        return null;
    }

    @Override
    public String reverseGeocode(double lat, double lng) {
        if (apiKey == null || apiKey.isEmpty()) {
            log.warn("[GoogleMaps] Reverse geocode failed: API key not configured");
            return null;
        }
        try {
            String url = String.format(
                    "https://maps.googleapis.com/maps/api/geocode/json?latlng=%.6f,%.6f&key=%s",
                    lat, lng, apiKey);
            String response = restTemplate.getForObject(url, String.class);
            if (response != null && response.contains("\"formatted_address\"")) {
                int addrStart = response.indexOf("\"formatted_address\" : \"") + 23;
                int addrEnd = response.indexOf("\"", addrStart);
                return response.substring(addrStart, addrEnd);
            }
        } catch (Exception e) {
            log.error("[GoogleMaps] Reverse geocode failed for ({},{}): {}", lat, lng, e.getMessage());
        }
        return null;
    }

    @Override
    public String getCoordinateSystem() {
        return "WGS84";
    }

    @Override
    public int getMaxZoom() {
        return 21;
    }

    private String mapLayerType(String style) {
        if (style == null) return "m";
        return switch (style.toLowerCase()) {
            case "satellite" -> "s";
            case "hybrid" -> "y";
            case "terrain" -> "t";
            default -> "m"; // normal
        };
    }
}
