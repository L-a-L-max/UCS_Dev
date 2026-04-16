package com.ucs.business.service;

import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * T-59: Geofence Service.
 *
 * Manages geofence zones and detects boundary violations for drones.
 * Supports three geofence types:
 *   1. INCLUSION — drone must stay inside (operational area)
 *   2. EXCLUSION — drone must not enter (no-fly zone)
 *   3. ALERT     — drone triggers alert when entering (monitoring zone)
 *
 * Geofence shapes supported:
 *   - CIRCLE:  center point + radius (meters)
 *   - POLYGON: list of vertices (lat/lon pairs)
 *
 * Detection algorithm:
 *   - Circle: Haversine distance < radius
 *   - Polygon: Ray-casting point-in-polygon test
 *
 * Integration points:
 *   - Called by TelemetryKafkaConsumer on each telemetry update
 *   - Publishes DroneStatusEvent with type=GEOFENCE_BREACH
 *   - Breach events written to events.drone Kafka topic
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GeofenceService {

    private final ApplicationEventPublisher eventPublisher;

    /** Active geofences: fenceId -> GeofenceZone */
    private final ConcurrentHashMap<String, GeofenceZone> geofences = new ConcurrentHashMap<>();

    /** Track last breach state per drone per fence to avoid duplicate alerts */
    private final ConcurrentHashMap<String, Set<String>> droneBreachState = new ConcurrentHashMap<>();

    /**
     * Register a new geofence zone.
     */
    public void addGeofence(GeofenceZone zone) {
        geofences.put(zone.getFenceId(), zone);
        log.info("[Geofence] Added {} zone '{}' (type={}, shape={})",
                zone.getType(), zone.getFenceId(), zone.getType(), zone.getShape());
    }

    /**
     * Remove a geofence zone.
     */
    public void removeGeofence(String fenceId) {
        geofences.remove(fenceId);
        log.info("[Geofence] Removed zone '{}'", fenceId);
    }

    /**
     * Get all active geofences.
     */
    public Collection<GeofenceZone> getAllGeofences() {
        return Collections.unmodifiableCollection(geofences.values());
    }

    /**
     * Check a drone's position against all active geofences.
     * Called on each telemetry update.
     *
     * @param uavId Drone identifier
     * @param lat   Current latitude (WGS84)
     * @param lon   Current longitude (WGS84)
     * @param alt   Current altitude (meters AMSL)
     * @return List of breach events (empty if no violations)
     */
    public List<GeofenceBreachEvent> checkPosition(String uavId, double lat, double lon, double alt) {
        List<GeofenceBreachEvent> breaches = new ArrayList<>();

        for (GeofenceZone zone : geofences.values()) {
            // Check altitude constraints
            if (zone.getMinAlt() != null && alt < zone.getMinAlt()) continue;
            if (zone.getMaxAlt() != null && alt > zone.getMaxAlt()) continue;

            boolean inside = isInsideZone(lat, lon, zone);
            boolean breached = false;
            String breachType = null;

            switch (zone.getType()) {
                case "INCLUSION" -> {
                    if (!inside) {
                        breached = true;
                        breachType = "LEFT_INCLUSION_ZONE";
                    }
                }
                case "EXCLUSION" -> {
                    if (inside) {
                        breached = true;
                        breachType = "ENTERED_EXCLUSION_ZONE";
                    }
                }
                case "ALERT" -> {
                    if (inside) {
                        breached = true;
                        breachType = "ENTERED_ALERT_ZONE";
                    }
                }
            }

            if (breached) {
                // Check if this is a new breach (not already in breach state)
                Set<String> currentBreaches = droneBreachState.computeIfAbsent(uavId,
                        k -> ConcurrentHashMap.newKeySet());
                if (currentBreaches.add(zone.getFenceId())) {
                    // New breach — create event
                    GeofenceBreachEvent event = new GeofenceBreachEvent();
                    event.setUavId(uavId);
                    event.setFenceId(zone.getFenceId());
                    event.setFenceName(zone.getName());
                    event.setBreachType(breachType);
                    event.setLat(lat);
                    event.setLon(lon);
                    event.setAlt(alt);
                    event.setTimestamp(Instant.now().toString());
                    event.setSeverity(zone.getType().equals("EXCLUSION") ? "CRITICAL" : "WARNING");
                    breaches.add(event);

                    log.warn("[Geofence] BREACH: drone='{}' {} fence='{}' at ({},{},{})",
                            uavId, breachType, zone.getFenceId(), lat, lon, alt);
                }
            } else {
                // Drone is no longer breaching this fence — clear state
                Set<String> currentBreaches = droneBreachState.get(uavId);
                if (currentBreaches != null) {
                    currentBreaches.remove(zone.getFenceId());
                }
            }
        }

        return breaches;
    }

    /**
     * Check if a point is inside a geofence zone.
     */
    private boolean isInsideZone(double lat, double lon, GeofenceZone zone) {
        if ("CIRCLE".equalsIgnoreCase(zone.getShape())) {
            return isInsideCircle(lat, lon, zone.getCenterLat(), zone.getCenterLon(), zone.getRadius());
        } else if ("POLYGON".equalsIgnoreCase(zone.getShape())) {
            return isInsidePolygon(lat, lon, zone.getVertices());
        }
        return false;
    }

    /**
     * Haversine distance check for circle geofence.
     */
    private boolean isInsideCircle(double lat, double lon, double centerLat, double centerLon, double radiusMeters) {
        double R = 6371000; // Earth radius in meters
        double dLat = Math.toRadians(lat - centerLat);
        double dLon = Math.toRadians(lon - centerLon);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(Math.toRadians(centerLat)) * Math.cos(Math.toRadians(lat)) *
                        Math.sin(dLon / 2) * Math.sin(dLon / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        double distance = R * c;
        return distance <= radiusMeters;
    }

    /**
     * Ray-casting point-in-polygon test.
     */
    private boolean isInsidePolygon(double lat, double lon, List<double[]> vertices) {
        if (vertices == null || vertices.size() < 3) return false;

        boolean inside = false;
        int n = vertices.size();
        for (int i = 0, j = n - 1; i < n; j = i++) {
            double yi = vertices.get(i)[0], xi = vertices.get(i)[1];
            double yj = vertices.get(j)[0], xj = vertices.get(j)[1];

            if (((yi > lat) != (yj > lat)) &&
                    (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }

    // ---- Data classes ----

    @Data
    public static class GeofenceZone {
        private String fenceId;
        private String name;
        /** INCLUSION, EXCLUSION, ALERT */
        private String type;
        /** CIRCLE or POLYGON */
        private String shape;
        // Circle params
        private double centerLat;
        private double centerLon;
        private double radius; // meters
        // Polygon params
        private List<double[]> vertices; // list of [lat, lon]
        // Altitude constraints (optional)
        private Double minAlt;
        private Double maxAlt;
    }

    @Data
    public static class GeofenceBreachEvent {
        private String uavId;
        private String fenceId;
        private String fenceName;
        private String breachType;
        private double lat;
        private double lon;
        private double alt;
        private String timestamp;
        private String severity;
    }
}
