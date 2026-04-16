package com.ucs.business.strategy.map;

import com.ucs.common.strategy.map.MapProviderStrategy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

/**
 * T-30: Google Maps provider strategy implementation.
 *
 * International scenarios. Coordinate system: WGS84.
 * Activated when map.provider=GOOGLE.
 */
@Slf4j
@Component
@ConditionalOnProperty(name = "map.provider", havingValue = "GOOGLE")
public class GoogleMapsProviderStrategy implements MapProviderStrategy {

    @Value("${google.maps.api.key:}")
    private String apiKey;

    private final RestTemplate restTemplate = new RestTemplate();

    @Override
    public String getProviderName() { return "GOOGLE"; }

    @Override
    public String getDisplayName() { return "Google Maps"; }

    @Override
    public String getTileUrl(int x, int y, int z, String style) {
        int serverIndex = (x + y) % 4;
        String lyrs = mapLayerType(style);
        return String.format("https://mt%d.google.com/vt/lyrs=%s&x=%d&y=%d&z=%d",
                serverIndex, lyrs, x, y, z);
    }

    @Override
    public double[] geocode(String address) {
        if (apiKey == null || apiKey.isEmpty()) return null;
        try {
            String url = String.format(
                    "https://maps.googleapis.com/maps/api/geocode/json?address=%s&key=%s",
                    address, apiKey);
            String response = restTemplate.getForObject(url, String.class);
            if (response != null && response.contains("\"lat\"")) {
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
        if (apiKey == null || apiKey.isEmpty()) return null;
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
    public String getCoordinateSystem() { return "WGS84"; }

    @Override
    public int getMaxZoom() { return 21; }

    private String mapLayerType(String style) {
        if (style == null) return "m";
        return switch (style.toLowerCase()) {
            case "satellite" -> "s";
            case "hybrid" -> "y";
            case "terrain" -> "t";
            default -> "m";
        };
    }
}
