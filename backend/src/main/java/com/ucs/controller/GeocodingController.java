package com.ucs.controller;

import com.ucs.dto.ApiResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * Backend proxy for geocoding to avoid CORS issues with third-party APIs.
 * Uses Nominatim (OpenStreetMap) - free, no API key required.
 */
@RestController
@RequestMapping("/api/v1/public")
@Tag(name = "Geocoding", description = "Geocoding Proxy API")
public class GeocodingController {

    private final RestTemplate restTemplate = new RestTemplate();

    @GetMapping("/geocode")
    @Operation(summary = "Geocode an address to lat/lon coordinates")
    @SuppressWarnings("unchecked")
    public ApiResponse<Map<String, Object>> geocode(@RequestParam String address) {
        try {
            String encoded = URLEncoder.encode(address, StandardCharsets.UTF_8);
            String url = "https://nominatim.openstreetmap.org/search?format=json&q="
                    + encoded + "&limit=5&accept-language=zh-CN";

            // Nominatim requires a User-Agent header
            org.springframework.http.HttpHeaders headers = new org.springframework.http.HttpHeaders();
            headers.set("User-Agent", "UCS-Backend/1.0 (drone-management-system)");
            org.springframework.http.HttpEntity<String> entity = new org.springframework.http.HttpEntity<>(headers);

            org.springframework.http.ResponseEntity<List> response = restTemplate.exchange(
                    url, org.springframework.http.HttpMethod.GET, entity, List.class);

            List<Map<String, Object>> results = response.getBody();
            if (results != null && !results.isEmpty()) {
                Map<String, Object> first = results.get(0);
                double lat = Double.parseDouble(String.valueOf(first.get("lat")));
                double lon = Double.parseDouble(String.valueOf(first.get("lon")));
                String displayName = String.valueOf(first.getOrDefault("display_name", address));
                return ApiResponse.success(Map.of(
                        "lat", lat,
                        "lon", lon,
                        "displayName", displayName
                ));
            }
            return ApiResponse.error(-1, "地址解析无结果，请尝试更详细的地址");
        } catch (Exception e) {
            return ApiResponse.error(-1, "地址解析失败: " + e.getMessage());
        }
    }
}
