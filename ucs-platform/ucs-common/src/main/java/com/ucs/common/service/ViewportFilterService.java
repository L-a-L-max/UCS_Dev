package com.ucs.common.service;

import com.ucs.common.dto.ViewportRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Viewport filter service (Phase 4.4).
 * Manages per-session viewport state and determines push frequency
 * based on zoom level (downsampling).
 *
 * Zoom-based downsampling:
 *   zoom >= 15 (close): full rate 10Hz
 *   zoom 10~14 (mid):   2Hz
 *   zoom < 10 (far):    0.5Hz
 */
@Slf4j
@Service
public class ViewportFilterService {

    /** Session ID -> viewport bounds */
    private final Map<String, ViewportRequest> sessionViewports = new ConcurrentHashMap<>();

    /** Session ID -> last push timestamp (for downsampling) */
    private final Map<String, Long> lastPushTimestamp = new ConcurrentHashMap<>();

    /**
     * Update viewport for a session.
     */
    public void updateViewport(String sessionId, ViewportRequest viewport) {
        sessionViewports.put(sessionId, viewport);
        log.debug("[Viewport] Updated session {}: zoom={}, bounds=[{},{},{},{}]",
                sessionId, viewport.getZoomLevel(),
                viewport.getMinLat(), viewport.getMaxLat(),
                viewport.getMinLon(), viewport.getMaxLon());
    }

    /**
     * Get viewport for a session. Returns null if no viewport set.
     */
    public ViewportRequest getViewport(String sessionId) {
        return sessionViewports.get(sessionId);
    }

    /**
     * Check if a drone position is within a session's viewport.
     */
    public boolean isInViewport(String sessionId, double lat, double lon) {
        ViewportRequest vp = sessionViewports.get(sessionId);
        if (vp == null) return true; // No viewport set = show all
        return lat >= vp.getMinLat() && lat <= vp.getMaxLat()
                && lon >= vp.getMinLon() && lon <= vp.getMaxLon();
    }

    /**
     * Determine if a push should be sent based on zoom-level downsampling.
     * Returns true if enough time has elapsed since last push for this session.
     */
    public boolean shouldPush(String sessionId) {
        ViewportRequest vp = sessionViewports.get(sessionId);
        if (vp == null) return true;

        long intervalMs = getPushIntervalMs(vp.getZoomLevel());
        long now = System.currentTimeMillis();
        Long lastPush = lastPushTimestamp.get(sessionId);

        if (lastPush == null || (now - lastPush) >= intervalMs) {
            lastPushTimestamp.put(sessionId, now);
            return true;
        }
        return false;
    }

    /**
     * Get push interval based on zoom level.
     *   zoom >= 15: 100ms  (10Hz full rate)
     *   zoom 10-14: 500ms  (2Hz)
     *   zoom < 10:  2000ms (0.5Hz)
     */
    public static long getPushIntervalMs(int zoomLevel) {
        if (zoomLevel >= 15) return 100;
        if (zoomLevel >= 10) return 500;
        return 2000;
    }

    /**
     * Remove viewport for a disconnected session.
     */
    public void removeSession(String sessionId) {
        sessionViewports.remove(sessionId);
        lastPushTimestamp.remove(sessionId);
    }
}
