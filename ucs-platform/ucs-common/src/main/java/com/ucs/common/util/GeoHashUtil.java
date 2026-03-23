package com.ucs.common.util;

import ch.hsr.geohash.GeoHash;
import ch.hsr.geohash.WGS84Point;
import ch.hsr.geohash.BoundingBox;

import java.util.HashSet;
import java.util.Set;

/**
 * GeoHash utility for spatial indexing (Phase 4.5).
 * Provides efficient bounding-box coverage and encoding for Redis GEO operations.
 */
public final class GeoHashUtil {

    /** Default precision: 6 characters (~1.2km x 0.6km) */
    public static final int DEFAULT_PRECISION = 6;

    private GeoHashUtil() {}

    /**
     * Encode a lat/lon pair into a GeoHash string.
     */
    public static String encode(double lat, double lon, int precision) {
        return GeoHash.geoHashStringWithCharacterPrecision(lat, lon, precision);
    }

    /**
     * Encode with default precision.
     */
    public static String encode(double lat, double lon) {
        return encode(lat, lon, DEFAULT_PRECISION);
    }

    /**
     * Compute the set of GeoHash cells that cover a bounding box.
     * Used for viewport queries: given map bounds, find all GeoHash cells
     * that overlap, then query each cell for drones.
     */
    public static Set<String> coverBoundingBox(double minLat, double maxLat,
                                                double minLon, double maxLon,
                                                int precision) {
        Set<String> hashes = new HashSet<>();

        // Calculate step sizes based on precision
        // At precision 6: lat step ~0.006, lon step ~0.012
        double latStep = 180.0 / Math.pow(8, (precision + 1) / 2);
        double lonStep = 360.0 / Math.pow(4, precision / 2);

        // Scan the bounding box with overlapping steps
        for (double lat = minLat; lat <= maxLat + latStep; lat += latStep * 0.5) {
            for (double lon = minLon; lon <= maxLon + lonStep; lon += lonStep * 0.5) {
                double clampedLat = Math.max(-90, Math.min(90, lat));
                double clampedLon = Math.max(-180, Math.min(180, lon));
                hashes.add(encode(clampedLat, clampedLon, precision));
            }
        }

        return hashes;
    }

    /**
     * Cover bounding box with default precision.
     */
    public static Set<String> coverBoundingBox(double minLat, double maxLat,
                                                double minLon, double maxLon) {
        return coverBoundingBox(minLat, maxLat, minLon, maxLon, DEFAULT_PRECISION);
    }
}
