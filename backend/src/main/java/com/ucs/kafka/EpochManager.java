package com.ucs.kafka;

import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/**
 * Epoch（代际）管理器 —— 解决"僵尸数据"问题。
 *
 * 场景：无人机断电重启后，网络中可能残留关机前的旧消息。
 * 这些"僵尸消息"如果被后端处理，会导致系统状态错乱。
 *
 * 工作原理：
 *   - Gateway 为每架无人机维护一个递增的 epoch 序号
 *   - 每次无人机重连（Discovery 发现新上线），epoch +1
 *   - 消息发送时携带当前 epoch
 *   - 后端收到消息后，比较消息中的 epoch 与本地记录：
 *     - 如果 msgEpoch >= currentEpoch → 接受消息，更新本地 epoch
 *     - 如果 msgEpoch < currentEpoch  → 丢弃消息（僵尸数据）
 *
 * 定期刷新机制：
 *   - 每 6 小时扫描一次 epochMap
 *   - 对超过 EPOCH_SOFT_LIMIT（默认 10000）的无人机，将 epoch 归一化到 1
 *   - 对超过 MAX_IDLE_HOURS（默认 24 小时）没有新消息更新的无人机，清除 epoch 记录
 *   - 防止长期运行后 epoch 数值无限增长
 *
 * 类比：后端就像一个"喜新厌旧"的门卫，只收比手里序号大的信，旧信直接撕掉。
 *       定期刷新就像门卫每天清一次信箱号码簿，防止号码越写越大。
 */
@Slf4j
@Component
public class EpochManager {

    /** 每架无人机的当前 epoch: uavId → epoch */
    private final ConcurrentMap<String, Long> epochMap = new ConcurrentHashMap<>();

    /** 每架无人机的最后更新时间: uavId → System.currentTimeMillis() */
    private final ConcurrentMap<String, Long> lastUpdateMap = new ConcurrentHashMap<>();

    /** epoch 软上限，超过此值时会被归一化 */
    private static final long EPOCH_SOFT_LIMIT = 10_000L;

    /** 无人机空闲超时时间（小时），超过此时间未更新则清除 epoch 记录 */
    private static final long MAX_IDLE_HOURS = 24L;

    /**
     * 校验消息的 epoch 是否有效。
     *
     * @param uavId    无人机 ID
     * @param msgEpoch 消息携带的 epoch
     * @return true 表示消息有效（epoch >= 当前记录），false 表示僵尸数据
     */
    public boolean validateEpoch(String uavId, long msgEpoch) {
        Long currentEpoch = epochMap.get(uavId);

        // 首次见到这架无人机，接受任何 epoch
        if (currentEpoch == null) {
            epochMap.put(uavId, msgEpoch);
            lastUpdateMap.put(uavId, System.currentTimeMillis());
            log.info("[Epoch] First seen drone {}, epoch initialized to {}", uavId, msgEpoch);
            return true;
        }

        // 消息 epoch >= 当前记录 → 有效
        if (msgEpoch >= currentEpoch) {
            if (msgEpoch > currentEpoch) {
                epochMap.put(uavId, msgEpoch);
                log.info("[Epoch] Drone {} epoch updated: {} -> {}", uavId, currentEpoch, msgEpoch);
            }
            lastUpdateMap.put(uavId, System.currentTimeMillis());
            return true;
        }

        // 消息 epoch < 当前记录 → 僵尸数据，丢弃
        log.warn("[Epoch] Stale message for drone {}: msgEpoch={} < currentEpoch={}",
                uavId, msgEpoch, currentEpoch);
        return false;
    }

    /**
     * 获取某架无人机的当前 epoch。
     */
    public long getCurrentEpoch(String uavId) {
        return epochMap.getOrDefault(uavId, 0L);
    }

    /**
     * 手动重置某架无人机的 epoch（用于测试或强制刷新）。
     */
    public void resetEpoch(String uavId) {
        epochMap.remove(uavId);
        lastUpdateMap.remove(uavId);
        log.info("[Epoch] Reset epoch for drone {}", uavId);
    }

    /**
     * 获取当前所有无人机的 epoch 快照（用于调试/监控）。
     */
    public ConcurrentMap<String, Long> getEpochSnapshot() {
        return new ConcurrentHashMap<>(epochMap);
    }

    /**
     * 定期刷新 epoch 记录（每 6 小时执行一次）。
     *
     * 执行两项维护：
     *   1. 归一化：epoch 超过 EPOCH_SOFT_LIMIT 的无人机，重置为 1
     *   2. 清除：超过 MAX_IDLE_HOURS 未活跃的无人机，移除 epoch 记录
     *
     * 归一化后，下次 Gateway 发送新 epoch（无论值是多少）都会被接受，
     * 因为 validateEpoch 使用 >= 比较，新 epoch 一定 >= 1。
     */
    @Scheduled(fixedRate = 6 * 60 * 60 * 1000) // 每 6 小时
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

            // 超时清除
            if (idleMs > idleThresholdMs) {
                it.remove();
                lastUpdateMap.remove(uavId);
                evicted++;
                continue;
            }

            // 归一化
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

    /**
     * 获取 epoch 管理器统计信息（用于监控/API）。
     */
    public Map<String, Object> getStats() {
        return Map.of(
                "trackedDrones", epochMap.size(),
                "epochMap", new ConcurrentHashMap<>(epochMap),
                "softLimit", EPOCH_SOFT_LIMIT,
                "maxIdleHours", MAX_IDLE_HOURS
        );
    }
}
