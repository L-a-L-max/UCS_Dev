package com.ucs.business.service;

import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * T-60: Collision Avoidance Detection Service.
 *
 * Monitors real-time drone positions and detects potential collision risks
 * between multiple drones in the same operational area.
 *
 * Detection algorithm:
 *   1. Maintain latest position snapshot of all active drones
 *   2. On each telemetry update, compute 3D distance to all other drones
 *   3. If distance < WARNING threshold (100m), generate WARNING alert
 *   4. If distance < CRITICAL threshold (30m), generate CRITICAL alert
 *   5. Predict future positions using velocity vectors (lookahead: 5s)
 *
 * Alert levels:
 *   - SAFE:     distance > 100m — no action
 *   - WARNING:  30m < distance <= 100m — notify operator
 *   - CRITICAL: distance <= 30m — emergency alert, suggest evasion
 *
 * Performance:
 *   - O(N^2) pairwise distance check, acceptable for N < 500 drones
 *   - For larger fleets, spatial indexing (R-tree) should be used
 *   - Deduplication: same pair only alerted once per 5 seconds
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CollisionAvoidanceService {

    private final SimpMessagingTemplate messagingTemplate;

    /** Latest position snapshot: uavId -> DronePosition */
    private final ConcurrentHashMap<String, DronePosition> positions = new ConcurrentHashMap<>();

    /** Alert deduplication: "uavId1:uavId2" -> last alert timestamp */
    private final ConcurrentHashMap<String, Long> lastAlertTime = new ConcurrentHashMap<>();

    /** Distance thresholds (meters) */
    private static final double WARNING_DISTANCE = 100.0;
    private static final double CRITICAL_DISTANCE = 30.0;

    /** Alert dedup interval (milliseconds) */
    private static final long ALERT_DEDUP_INTERVAL_MS = 5000;

    /** Prediction lookahead (seconds) */
    private static final double LOOKAHEAD_SECONDS = 5.0;

    /**
     * Update drone position and check for potential collisions.
     * Called on each telemetry update.
     *
     * @param uavId Drone identifier
     * @param lat   Latitude (WGS84)
     * @param lon   Longitude (WGS84)
     * @param alt   Altitude (meters AMSL)
     * @param vx    Velocity north (m/s)
     * @param vy    Velocity east (m/s)
     * @param vz    Velocity down (m/s)
     * @return List of collision alerts (empty if no risks detected)
     */
    public List<CollisionAlert> updateAndCheck(String uavId, double lat, double lon, double alt,
                                                double vx, double vy, double vz) {
        // Update position
        DronePosition pos = new DronePosition();
        pos.setUavId(uavId);
        pos.setLat(lat);
        pos.setLon(lon);
        pos.setAlt(alt);
        pos.setVx(vx);
        pos.setVy(vy);
        pos.setVz(vz);
        pos.setTimestamp(System.currentTimeMillis());
        positions.put(uavId, pos);

        // Check distances to all other drones
        List<CollisionAlert> alerts = new ArrayList<>();
        long now = System.currentTimeMillis();

        for (Map.Entry<String, DronePosition> entry : positions.entrySet()) {
            String otherId = entry.getKey();
            if (otherId.equals(uavId)) continue;

            DronePosition other = entry.getValue();

            // Skip stale positions (older than 10 seconds)
            if (now - other.getTimestamp() > 10000) continue;

            // Current distance
            double distance = calculate3DDistance(pos, other);

            // Predicted distance (lookahead)
            double predictedDistance = calculatePredictedDistance(pos, other, LOOKAHEAD_SECONDS);

            double minDistance = Math.min(distance, predictedDistance);

            if (minDistance <= WARNING_DISTANCE) {
                // Deduplication check
                String pairKey = buildPairKey(uavId, otherId);
                Long lastAlert = lastAlertTime.get(pairKey);
                if (lastAlert != null && (now - lastAlert) < ALERT_DEDUP_INTERVAL_MS) {
                    continue; // Skip duplicate alert
                }

                String severity = minDistance <= CRITICAL_DISTANCE ? "CRITICAL" : "WARNING";
                CollisionAlert alert = new CollisionAlert();
                alert.setUavId1(uavId);
                alert.setUavId2(otherId);
                alert.setCurrentDistance(Math.round(distance * 10.0) / 10.0);
                alert.setPredictedDistance(Math.round(predictedDistance * 10.0) / 10.0);
                alert.setSeverity(severity);
                alert.setTimestamp(Instant.now().toString());
                alert.setLookaheadSeconds(LOOKAHEAD_SECONDS);
                alerts.add(alert);

                lastAlertTime.put(pairKey, now);

                // Broadcast alert via WebSocket
                broadcastAlert(alert);

                if ("CRITICAL".equals(severity)) {
                    log.warn("[CollisionAvoidance] CRITICAL: {} <-> {} distance={:.1f}m predicted={:.1f}m",
                            uavId, otherId, distance, predictedDistance);
                } else {
                    log.debug("[CollisionAvoidance] WARNING: {} <-> {} distance={:.1f}m",
                            uavId, otherId, distance);
                }
            }
        }

        return alerts;
    }

    /**
     * Remove a drone from collision monitoring (e.g., when offline).
     */
    public void removeDrone(String uavId) {
        positions.remove(uavId);
    }

    /**
     * Get current number of monitored drones.
     */
    public int getMonitoredDroneCount() {
        return positions.size();
    }

    // ---- Distance calculations ----

    /**
     * Calculate 3D Euclidean distance between two drones (approximate, valid for short distances).
     * Uses flat-Earth approximation for horizontal distance (valid within ~10km).
     */
    private double calculate3DDistance(DronePosition a, DronePosition b) {
        double dlat = Math.toRadians(b.getLat() - a.getLat());
        double dlon = Math.toRadians(b.getLon() - a.getLon());
        double avgLat = Math.toRadians((a.getLat() + b.getLat()) / 2.0);

        double dx = dlon * Math.cos(avgLat) * 6371000.0; // meters east
        double dy = dlat * 6371000.0;                      // meters north
        double dz = b.getAlt() - a.getAlt();               // meters up

        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /**
     * Predict distance between two drones after lookahead seconds.
     * Assumes constant velocity (linear extrapolation).
     */
    private double calculatePredictedDistance(DronePosition a, DronePosition b, double seconds) {
        // Predict positions
        double aLat = a.getLat() + (a.getVy() * seconds) / 111320.0;
        double aLon = a.getLon() + (a.getVx() * seconds) / (111320.0 * Math.cos(Math.toRadians(a.getLat())));
        double aAlt = a.getAlt() - a.getVz() * seconds; // NED: vz positive = down

        double bLat = b.getLat() + (b.getVy() * seconds) / 111320.0;
        double bLon = b.getLon() + (b.getVx() * seconds) / (111320.0 * Math.cos(Math.toRadians(b.getLat())));
        double bAlt = b.getAlt() - b.getVz() * seconds;

        DronePosition predA = new DronePosition();
        predA.setLat(aLat);
        predA.setLon(aLon);
        predA.setAlt(aAlt);

        DronePosition predB = new DronePosition();
        predB.setLat(bLat);
        predB.setLon(bLon);
        predB.setAlt(bAlt);

        return calculate3DDistance(predA, predB);
    }

    private String buildPairKey(String id1, String id2) {
        return id1.compareTo(id2) < 0 ? id1 + ":" + id2 : id2 + ":" + id1;
    }

    private void broadcastAlert(CollisionAlert alert) {
        try {
            Map<String, Object> message = new LinkedHashMap<>();
            message.put("type", "collision_alert");
            message.put("severity", alert.getSeverity());
            message.put("uavId1", alert.getUavId1());
            message.put("uavId2", alert.getUavId2());
            message.put("currentDistance", alert.getCurrentDistance());
            message.put("predictedDistance", alert.getPredictedDistance());
            message.put("timestamp", alert.getTimestamp());
            messagingTemplate.convertAndSend("/topic/collision-alerts", message);
        } catch (Exception e) {
            log.debug("[CollisionAvoidance] Failed to broadcast alert: {}", e.getMessage());
        }
    }

    // ---- Data classes ----

    @Data
    public static class DronePosition {
        private String uavId;
        private double lat;
        private double lon;
        private double alt;
        private double vx; // velocity north (m/s)
        private double vy; // velocity east (m/s)
        private double vz; // velocity down (m/s)
        private long timestamp; // epoch millis
    }

    @Data
    public static class CollisionAlert {
        private String uavId1;
        private String uavId2;
        private double currentDistance;   // meters
        private double predictedDistance; // meters (after lookahead)
        private String severity;         // WARNING or CRITICAL
        private String timestamp;
        private double lookaheadSeconds;
    }
}
