package com.ucs.strategy.map;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

/**
 * T-30: 高德地图（AMap）提供商策略实现。
 *
 * 高德地图是国内首选地图服务，支持：
 *   - 2D/3D矢量瓦片
 *   - 卫星影像瓦片
 *   - 地理编码/逆地理编码
 *   - 坐标系：GCJ02（国测局坐标，国内法律要求）
 *
 * 瓦片URL格式：
 *   标准地图: https://webrd0{1-4}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&style=7
 *   卫星影像: https://webst0{1-4}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&style=6
 *
 * 通过 @ConditionalOnProperty 控制激活：
 *   application.properties 中设置 map.provider=AMAP（默认值）即激活此策略。
 */
@Slf4j
@Component
@ConditionalOnProperty(name = "map.provider", havingValue = "AMAP", matchIfMissing = true)
public class AmapProviderStrategy implements MapProviderStrategy {

    @Value("${amap.api.key:}")
    private String apiKey;

    private final RestTemplate restTemplate = new RestTemplate();

    @Override
    public String getProviderName() {
        return "AMAP";
    }

    @Override
    public String getDisplayName() {
        return "高德地图";
    }

    /**
     * 高德瓦片URL生成。
     * 使用 (x+y)%4+1 在4台瓦片服务器间负载均衡。
     *
     * style映射：
     *   "normal" / "7" → 标准矢量地图 (webrd)
     *   "satellite" / "6" → 卫星影像 (webst)
     *   "terrain" / "8" → 地形图
     */
    @Override
    public String getTileUrl(int x, int y, int z, String style) {
        int serverIndex = (x + y) % 4 + 1;
        String styleCode = mapStyleCode(style);

        if ("6".equals(styleCode)) {
            // 卫星影像使用 webst 域名
            return String.format(
                    "https://webst0%d.is.autonavi.com/appmaptile?x=%d&y=%d&z=%d&style=%s",
                    serverIndex, x, y, z, styleCode);
        }
        // 标准/地形使用 webrd 域名
        return String.format(
                "https://webrd0%d.is.autonavi.com/appmaptile?x=%d&y=%d&z=%d&style=%s",
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
            // 简化处理：实际项目应使用Jackson解析JSON响应
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
        if (apiKey == null || apiKey.isEmpty()) {
            log.warn("[AMap] Reverse geocode failed: API key not configured");
            return null;
        }
        try {
            // 高德API要求格式: 经度,纬度（注意顺序）
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
    public String getCoordinateSystem() {
        return "GCJ02";
    }

    @Override
    public int getMaxZoom() {
        return 18;
    }

    /**
     * 将语义化style名称映射为高德瓦片style编码。
     */
    private String mapStyleCode(String style) {
        if (style == null) return "7";
        return switch (style.toLowerCase()) {
            case "satellite", "6" -> "6";
            case "terrain", "8" -> "8";
            default -> "7"; // normal
        };
    }
}
