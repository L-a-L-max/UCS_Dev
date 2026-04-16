package com.ucs.common.strategy.map;

/**
 * T-30: Map provider strategy interface — Strategy Pattern.
 *
 * Decouples map service logic from hardcoded MapTileController.
 * Each map provider is encapsulated as an independent strategy class.
 * Switching or adding providers only requires a new implementation + config change.
 *
 * Supported providers:
 *   - AMAP (AMap/Gaode): Domestic preferred, supports 2D/3D/satellite
 *   - GOOGLE (Google Maps): International scenarios
 *   - MAPBOX (Mapbox): Custom styles, suitable for customization needs
 */
public interface MapProviderStrategy {

    /** Get provider name identifier (corresponds to map.provider config). */
    String getProviderName();

    /** Get provider display name (Chinese). */
    String getDisplayName();

    /**
     * Generate tile map request URL.
     *
     * @param x     tile column number (Web Mercator projection)
     * @param y     tile row number
     * @param z     zoom level (0-18)
     * @param style map style: "normal", "satellite", "terrain"
     * @return complete tile image request URL
     */
    String getTileUrl(int x, int y, int z, String style);

    /**
     * Geocode — convert address text to coordinates.
     *
     * @param address address text
     * @return [longitude, latitude] array, null on failure
     */
    double[] geocode(String address);

    /**
     * Reverse geocode — convert coordinates to address text.
     *
     * @param lat latitude (WGS84)
     * @param lng longitude (WGS84)
     * @return address text, null on failure
     */
    String reverseGeocode(double lat, double lng);

    /** Get the coordinate system type for this provider. */
    String getCoordinateSystem();

    /** Get the maximum zoom level supported by this provider. */
    int getMaxZoom();
}
