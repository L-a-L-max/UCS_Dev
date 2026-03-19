package com.ucs.controller;

import com.ucs.dto.ApiResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * Backend proxy for geocoding to avoid CORS and GFW issues.
 * Tries multiple geocoding services with timeouts:
 *   1. Nominatim (OpenStreetMap) - free, no API key
 *   2. Photon (Komoot, OSM-based) - free, no API key, often faster
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/public")
@Tag(name = "Geocoding", description = "Geocoding Proxy API")
public class GeocodingController {

    private final RestTemplate restTemplate;

    public GeocodingController() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(5000);
        factory.setReadTimeout(5000);
        this.restTemplate = new RestTemplate(factory);
    }

    private HttpEntity<String> buildRequestEntity() {
        HttpHeaders headers = new HttpHeaders();
        headers.set("User-Agent", "UCS-Backend/1.0 (drone-management-system)");
        return new HttpEntity<>(headers);
    }

    @GetMapping("/geocode")
    @Operation(summary = "Geocode an address to lat/lon coordinates")
    @SuppressWarnings("unchecked")
    public ApiResponse<Map<String, Object>> geocode(@RequestParam String address) {
        log.info("[Geocode] Request received: address='{}'", address);

        // Try Nominatim first
        try {
            Map<String, Object> result = geocodeWithNominatim(address);
            if (result != null) {
                log.info("[Geocode] Nominatim success: {}", result);
                return ApiResponse.success(result);
            }
            log.warn("[Geocode] Nominatim returned no results for '{}'", address);
        } catch (Exception e) {
            log.warn("[Geocode] Nominatim failed for '{}': {}", address, e.getMessage());
        }

        // Fallback to Photon
        try {
            Map<String, Object> result = geocodeWithPhoton(address);
            if (result != null) {
                log.info("[Geocode] Photon success: {}", result);
                return ApiResponse.success(result);
            }
            log.warn("[Geocode] Photon returned no results for '{}'", address);
        } catch (Exception e) {
            log.warn("[Geocode] Photon failed for '{}': {}", address, e.getMessage());
        }

        log.error("[Geocode] All geocoding services failed for '{}'", address);
        return ApiResponse.error(-1, "地址解析失败，所有服务均无法响应，请检查网络或尝试更详细的地址");
    }

    @GetMapping("/reverse-geocode")
    @Operation(summary = "Reverse geocode lat/lon to address string")
    @SuppressWarnings("unchecked")
    public ApiResponse<Map<String, Object>> reverseGeocode(
            @RequestParam double lat, @RequestParam double lon) {
        log.info("[ReverseGeocode] Request received: lat={}, lon={}", lat, lon);

        // Try Nominatim reverse
        try {
            URI uri = URI.create(String.format(
                    "https://nominatim.openstreetmap.org/reverse?format=json&lat=%f&lon=%f&accept-language=zh-CN",
                    lat, lon));
            ResponseEntity<Map> response = restTemplate.exchange(
                    uri, HttpMethod.GET, buildRequestEntity(), Map.class);
            Map<String, Object> body = response.getBody();
            if (body != null && body.containsKey("display_name")) {
                String displayName = String.valueOf(body.get("display_name"));
                log.info("[ReverseGeocode] Nominatim success: {}", displayName);
                return ApiResponse.success(Map.of(
                        "lat", lat, "lon", lon, "displayName", displayName));
            }
        } catch (Exception e) {
            log.warn("[ReverseGeocode] Nominatim failed: {}", e.getMessage());
        }

        // Fallback to Photon reverse
        try {
            URI uri2 = URI.create(String.format(
                    "https://photon.komoot.io/reverse?lat=%f&lon=%f&lang=default", lat, lon));
            ResponseEntity<Map> response = restTemplate.exchange(
                    uri2, HttpMethod.GET, buildRequestEntity(), Map.class);
            Map<String, Object> body = response.getBody();
            if (body != null) {
                List<Map<String, Object>> features = (List<Map<String, Object>>) body.get("features");
                if (features != null && !features.isEmpty()) {
                    Map<String, Object> props = (Map<String, Object>) features.get(0).get("properties");
                    String displayName = buildPhotonDisplayName(props);
                    log.info("[ReverseGeocode] Photon success: {}", displayName);
                    return ApiResponse.success(Map.of(
                            "lat", lat, "lon", lon, "displayName", displayName));
                }
            }
        } catch (Exception e) {
            log.warn("[ReverseGeocode] Photon failed: {}", e.getMessage());
        }

        return ApiResponse.error(-1, "反向地址解析失败");
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> geocodeWithNominatim(String address) {
        String encoded = URLEncoder.encode(address, StandardCharsets.UTF_8);
        URI uri = URI.create("https://nominatim.openstreetmap.org/search?format=json&q="
                + encoded + "&limit=5&accept-language=zh-CN");
        log.debug("[Geocode] Nominatim URL: {}", uri);

        ResponseEntity<List> response = restTemplate.exchange(
                uri, HttpMethod.GET, buildRequestEntity(), List.class);

        List<Map<String, Object>> results = response.getBody();
        if (results != null && !results.isEmpty()) {
            Map<String, Object> first = results.get(0);
            double lat = Double.parseDouble(String.valueOf(first.get("lat")));
            double lon = Double.parseDouble(String.valueOf(first.get("lon")));
            String displayName = String.valueOf(first.getOrDefault("display_name", address));
            return Map.of("lat", lat, "lon", lon, "displayName", displayName);
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> geocodeWithPhoton(String address) {
        String encoded = URLEncoder.encode(address, StandardCharsets.UTF_8);
        URI uri = URI.create("https://photon.komoot.io/api/?q=" + encoded + "&limit=5&lang=default");
        log.debug("[Geocode] Photon URL: {}", uri);

        ResponseEntity<Map> response = restTemplate.exchange(
                uri, HttpMethod.GET, buildRequestEntity(), Map.class);

        Map<String, Object> body = response.getBody();
        if (body != null) {
            List<Map<String, Object>> features = (List<Map<String, Object>>) body.get("features");
            if (features != null && !features.isEmpty()) {
                Map<String, Object> geometry = (Map<String, Object>) features.get(0).get("geometry");
                List<Number> coords = (List<Number>) geometry.get("coordinates");
                Map<String, Object> props = (Map<String, Object>) features.get(0).get("properties");
                double lon = coords.get(0).doubleValue();
                double lat = coords.get(1).doubleValue();
                String displayName = buildPhotonDisplayName(props);
                return Map.of("lat", lat, "lon", lon, "displayName", displayName);
            }
        }
        return null;
    }

    private String buildPhotonDisplayName(Map<String, Object> props) {
        StringBuilder sb = new StringBuilder();
        for (String key : new String[]{"name", "street", "district", "city", "state", "country"}) {
            Object val = props.get(key);
            if (val != null && !val.toString().isEmpty()) {
                if (sb.length() > 0) sb.append(", ");
                sb.append(val);
            }
        }
        return sb.length() > 0 ? sb.toString() : "Unknown";
    }
}
