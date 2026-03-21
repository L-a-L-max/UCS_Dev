package com.ucs.kafka;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

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
 * 类比：后端就像一个"喜新厌旧"的门卫，只收比手里序号大的信，旧信直接撕掉。
 */
@Slf4j
@Component
public class EpochManager {

    /** 每架无人机的当前 epoch: uavId → epoch */
    private final ConcurrentMap<String, Long> epochMap = new ConcurrentHashMap<>();

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
            log.info("[Epoch] First seen drone {}, epoch initialized to {}", uavId, msgEpoch);
            return true;
        }

        // 消息 epoch >= 当前记录 → 有效
        if (msgEpoch >= currentEpoch) {
            if (msgEpoch > currentEpoch) {
                epochMap.put(uavId, msgEpoch);
                log.info("[Epoch] Drone {} epoch updated: {} -> {}", uavId, currentEpoch, msgEpoch);
            }
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
        log.info("[Epoch] Reset epoch for drone {}", uavId);
    }

    /**
     * 获取当前所有无人机的 epoch 快照（用于调试/监控）。
     */
    public ConcurrentMap<String, Long> getEpochSnapshot() {
        return new ConcurrentHashMap<>(epochMap);
    }
}
