package com.ucs.business.kafka;

import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/**
 * Epoch（代际）管理器 — 解决"僵尸数据"问题。
 */
@Slf4j
@Component
public class EpochManager {

    private final ConcurrentMap<String, Long> epochMap = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, Long> lastUpdateMap = new ConcurrentHashMap<>();

    private static final long EPOCH_SOFT_LIMIT = 10_000L;
    private static final long MAX_IDLE_HOURS = 24L;

    public boolean validateEpoch(String uavId, long msgEpoch) {
        Long currentEpoch = epochMap.get(uavId);
        if (currentEpoch == null) {
            epochMap.put(uavId, msgEpoch);
            lastUpdateMap.put(uavId, System.currentTimeMillis());
            return true;
        }
        if (msgEpoch >= currentEpoch) {
            if (msgEpoch > currentEpoch) {
                epochMap.put(uavId, msgEpoch);
            }
            lastUpdateMap.put(uavId, System.currentTimeMillis());
            return true;
        }
        log.warn("[Epoch] Stale message for drone {}: msgEpoch={} < currentEpoch={}",
                uavId, msgEpoch, currentEpoch);
        return false;
    }

    public long getCurrentEpoch(String uavId) {
        return epochMap.getOrDefault(uavId, 0L);
    }

    public void resetEpoch(String uavId) {
        epochMap.remove(uavId);
        lastUpdateMap.remove(uavId);
    }

    public ConcurrentMap<String, Long> getEpochSnapshot() {
        return new ConcurrentHashMap<>(epochMap);
    }

    @Scheduled(fixedRate = 6 * 60 * 60 * 1000)
    public void periodicEpochMaintenance() {
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
            }
        }

        if (normalized > 0 || evicted > 0) {
            log.info("[Epoch] Maintenance: normalized={}, evicted={}, remaining={}",
                    normalized, evicted, epochMap.size());
        }
    }

    public Map<String, Object> getStats() {
        return Map.of(
                "trackedDrones", epochMap.size(),
                "epochMap", new ConcurrentHashMap<>(epochMap),
                "softLimit", EPOCH_SOFT_LIMIT,
                "maxIdleHours", MAX_IDLE_HOURS
        );
    }
}
