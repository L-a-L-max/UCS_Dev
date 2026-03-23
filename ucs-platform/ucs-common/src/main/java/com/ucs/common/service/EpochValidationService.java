package com.ucs.common.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/**
 * Epoch validation service shared across microservices.
 * Manages drone epoch (generation ID) for filtering stale messages after restart.
 * Includes periodic maintenance to prevent unbounded growth.
 */
@Slf4j
@Service
public class EpochValidationService {

    private final ConcurrentMap<String, Long> epochMap = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, Long> lastUpdateMap = new ConcurrentHashMap<>();

    private static final long EPOCH_SOFT_LIMIT = 10_000L;
    private static final long MAX_IDLE_HOURS = 24L;

    /**
     * Validate and update the epoch for a drone.
     * Returns true if the message epoch is valid (>= current epoch).
     */
    public boolean validate(String uavId, long msgEpoch) {
        lastUpdateMap.put(uavId, System.currentTimeMillis());

        long current = epochMap.getOrDefault(uavId, 0L);
        if (msgEpoch < current) {
            log.warn("[Epoch] Stale message discarded: uavId={}, msgEpoch={}, currentEpoch={}",
                    uavId, msgEpoch, current);
            return false;
        }
        if (msgEpoch > current) {
            epochMap.put(uavId, msgEpoch);
        }
        return true;
    }

    /**
     * Get current epoch for a drone.
     */
    public long getCurrentEpoch(String uavId) {
        return epochMap.getOrDefault(uavId, 0L);
    }

    /**
     * Reset epoch for a drone (e.g., on reconnection).
     */
    public void resetEpoch(String uavId, long newEpoch) {
        epochMap.put(uavId, newEpoch);
        lastUpdateMap.put(uavId, System.currentTimeMillis());
        log.info("[Epoch] Reset drone {} epoch to {}", uavId, newEpoch);
    }

    /**
     * Periodic maintenance: normalize large epochs, evict idle drones.
     * Runs every 6 hours.
     */
    @Scheduled(fixedRate = 6 * 60 * 60 * 1000)
    public void periodicMaintenance() {
        long now = System.currentTimeMillis();
        long idleThresholdMs = MAX_IDLE_HOURS * 60 * 60 * 1000;
        int normalized = 0;
        int evicted = 0;

        Iterator<Map.Entry<String, Long>> it = epochMap.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<String, Long> entry = it.next();
            String uavId = entry.getKey();
            long epoch = entry.getValue();

            Long lastUpdate = lastUpdateMap.get(uavId);
            long idleMs = (lastUpdate != null) ? (now - lastUpdate) : Long.MAX_VALUE;

            if (idleMs > idleThresholdMs) {
                it.remove();
                lastUpdateMap.remove(uavId);
                evicted++;
                continue;
            }

            if (epoch > EPOCH_SOFT_LIMIT) {
                epochMap.put(uavId, 1L);
                normalized++;
                log.info("[Epoch] Normalized drone {} epoch: {} -> 1", uavId, epoch);
            }
        }

        if (normalized > 0 || evicted > 0) {
            log.info("[Epoch] Maintenance: normalized={}, evicted={}, remaining={}",
                    normalized, evicted, epochMap.size());
        }
    }
}
