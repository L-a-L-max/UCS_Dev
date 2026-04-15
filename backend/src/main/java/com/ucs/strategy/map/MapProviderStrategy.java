package com.ucs.strategy.map;

/**
 * T-30: 地图提供商策略接口 — 策略模式（Strategy Pattern）。
 *
 * 将地图服务逻辑从 MapTileController 的硬编码中解耦，
 * 每种地图提供商封装为独立的策略类，切换或新增提供商时
 * 只需新建实现类 + 修改配置，无需修改业务代码。
 *
 * 当前支持的地图提供商：
 *   - AMAP（高德地图）：国内首选，支持2D/3D/卫星影像
 *   - GOOGLE（Google Maps）：国际场景，海外无人机管控
 *   - MAPBOX（Mapbox）：自定义样式，适合定制化需求
 *
 * 扩展示例：新增"百度地图 BAIDU"提供商时，只需：
 *   1. 新建 BaiduMapProviderStrategy implements MapProviderStrategy
 *   2. 修改 application.properties: map.provider=BAIDU
 *   3. 无需修改 MapTileController 或 MapProviderRouter
 */
public interface MapProviderStrategy {

    /**
     * 获取提供商名称标识（与配置 map.provider 对应）。
     * 例如: "AMAP", "GOOGLE", "MAPBOX", "BAIDU"
     */
    String getProviderName();

    /**
     * 获取提供商中文显示名称。
     */
    String getDisplayName();

    /**
     * 生成瓦片地图请求URL。
     *
     * @param x     瓦片列号（Web Mercator投影）
     * @param y     瓦片行号
     * @param z     缩放级别（0-18）
     * @param style 地图样式，例如: "normal"(标准), "satellite"(卫星), "terrain"(地形)
     * @return 完整的瓦片图片请求URL
     */
    String getTileUrl(int x, int y, int z, String style);

    /**
     * 地理编码 — 地址文本转换为经纬度坐标。
     *
     * @param address 地址文本，如 "北京市海淀区中关村"
     * @return 经纬度坐标数组 [longitude, latitude]，失败返回null
     */
    double[] geocode(String address);

    /**
     * 逆地理编码 — 经纬度坐标转换为地址文本。
     *
     * @param lat 纬度（WGS84）
     * @param lng 经度（WGS84）
     * @return 地址文本，如 "北京市海淀区中关村大街1号"，失败返回null
     */
    String reverseGeocode(double lat, double lng);

    /**
     * 获取该提供商支持的坐标系类型。
     *
     * @return 坐标系标识: "GCJ02"(国测局/火星坐标), "WGS84"(GPS原始), "BD09"(百度)
     */
    String getCoordinateSystem();

    /**
     * 获取该提供商支持的最大缩放级别。
     */
    int getMaxZoom();
}
