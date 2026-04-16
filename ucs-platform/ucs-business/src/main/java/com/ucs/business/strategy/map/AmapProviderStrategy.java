package com.ucs.business.strategy.map;

import com.ucs.common.strategy.map.MapProviderStrategy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

/**
 * T-30: AMap (Gaode) provider strategy implementation.
 *
 * Domestic preferred map service. Coordinate system: GCJ02.
 * Activated when map.provider=AMAP (default).
 */
@Slf4j
@Component
@ConditionalOnProperty(name = "map.provider", havingValue = "AMAP", matchIfMissing = true)
public class AmapProviderStrategy implements MapProviderStrategy {

    @Value("${amap.api.key:}")
    private String apiKey;

    private final RestTemplate restTemplate = new RestTemplate();

    @Override
    public String getProviderName() { return "AMAP"; }

    @Override
    public String getDisplayName() { return "高德地图"; }

    @Override
    public String getTileUrl(int x, int y, int z, String style) {
        int serverIndex = (x + y) % 4 + 1;
        String styleCode = mapStyleCode(style);
        if ("6".equals(styleCode)) {
            return String.format("https://webst0%d.is.autonavi.com/appmaptile?x=%d&y=%d&z=%d&style=%s",
                    serverIndex, x, y, z, styleCode);
        }
        return String.format("https://webrd0%d.is.autonavi.com/appmaptile?x=%d&y=%d&z=%d&style=%s",
                serverIndex, x, y, z, styleCode);
    }

    @Override
    public double[] geocode(String address) {
        if (apiKey == null || apiKey.isEmpty()) {
            log.warn("[AMap] Geocode failed: API key not configured");
            return null;
        }
        try {
            String url = String.format(
                    "https://restapi.amap.com/v3/geocode/geo?address=%s&key=%s&output=JSON",
                    address, apiKey);
            String response = restTemplate.getForObject(url, String.class);
            if (response != null && response.contains("\"location\"")) {
                int locStart = response.indexOf("\"location\":\"") + 12;
                int locEnd = response.indexOf("\"", locStart);
                String location = response.substring(locStart, locEnd);
                String[] parts = location.split(",");
                return new double[]{Double.parseDouble(parts[0]), Double.parseDouble(parts[1])};
            }
        } catch (Exception e) {
            log.error("[AMap] Geocode failed for '{}': {}", address, e.getMessage());
        }
        return null;
    }

    @Override
    public String reverseGeocode(double lat, double lng) {
        if (apiKey == null || apiKey.isEmpty()) return null;
        try {
            String url = String.format(
                    "https://restapi.amap.com/v3/geocode/regeo?location=%.6f,%.6f&key=%s&output=JSON",
                    lng, lat, apiKey);
            String response = restTemplate.getForObject(url, String.class);
            if (response != null && response.contains("\"formatted_address\"")) {
                int addrStart = response.indexOf("\"formatted_address\":\"") + 21;
                int addrEnd = response.indexOf("\"", addrStart);
                return response.substring(addrStart, addrEnd);
            }
        } catch (Exception e) {
            log.error("[AMap] Reverse geocode failed for ({},{}): {}", lat, lng, e.getMessage());
        }
        return null;
    }

    @Override
    public String getCoordinateSystem() { return "GCJ02"; }

    @Override
    public int getMaxZoom() { return 18; }

    private String mapStyleCode(String style) {
        if (style == null) return "7";
        return switch (style.toLowerCase()) {
            case "satellite", "6" -> "6";
            case "terrain", "8" -> "8";
            default -> "7";
        };
    }
}
