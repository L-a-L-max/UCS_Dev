package com.ucs.business.kafka;

import com.ucs.business.service.RedisService;
import com.ucs.business.service.WebSocketGatewayService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Gateway 健康监控器 —— 解决"网关断电后前端无感知"的问题。
 *
 * 场景：网关所在机房断电，即使后端多实例部署，前后端也收不到无人机数据。
 * 此时前端显示的无人机仍处于最后已知状态（如"在飞"），用户无法察觉异常。
 *
 * 工作原理：
 *   - 每 10 秒检查 Redis 中是否存在 drone:*:online 心跳键
 *   - 正常情况：Gateway 每次发送遥测时会刷新 drone:{uavId}:online（TTL=30s）
 *   - 网关断电后：心跳键 TTL 到期，Redis 中不再有 online 键
 *   - 如果连续 60 秒（6 次检查）没有任何在线无人机，判定网关离线
 *   - 通过 WebSocket 向前端广播 GATEWAY_OFFLINE 事件
 *   - 前端收到后应将所有无人机标记为"离线"状态，并弹出警告提示
 *
 * 恢复机制：
 *   - 当网关恢复后，遥测数据重新流入，心跳键会被重建
 *   - 下次检查时发现有在线无人机，自动清除告警状态
 *   - 通过 WebSocket 广播 GATEWAY_RECOVERED 事件
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class GatewayHealthMonitor {

    private final RedisService redisService;
    private final WebSocketGatewayService webSocketGatewayService;
    private final SimpMessagingTemplate messagingTemplate;

    /** 连续无在线无人机的检查次数 */
    private int consecutiveEmptyChecks = 0;

    /** 触发离线告警的阈值（连续空检查次数）：6 次 × 10 秒 = 60 秒 */
    private static final int OFFLINE_THRESHOLD = 6;

    /** 是否已经发送过离线告警（避免重复发送） */
    private volatile boolean gatewayOfflineAlerted = false;

    /** 上一次检测到的在线无人机集合（用于恢复时通知） */
    private final Set<String> lastKnownOnlineDrones = ConcurrentHashMap.newKeySet();

    /**
     * 定时检查 Gateway 心跳状态（每 10 秒执行一次）。
     */
    @Scheduled(fixedRate = 10_000)
    public void checkGatewayHealth() {
        try {
            Set<String> onlineDrones = redisService.getAllOnlineDroneIds();

            if (!onlineDrones.isEmpty()) {
                // 有在线无人机：Gateway 正常
                if (gatewayOfflineAlerted) {
                    // 从离线恢复
                    log.info("[GatewayHealth] Gateway RECOVERED, {} drone(s) online: {}",
                            onlineDrones.size(), onlineDrones);
                    broadcastRecovery(onlineDrones);
                    gatewayOfflineAlerted = false;
                }
                consecutiveEmptyChecks = 0;
                lastKnownOnlineDrones.clear();
                lastKnownOnlineDrones.addAll(onlineDrones);
            } else {
                // 没有在线无人机
                consecutiveEmptyChecks++;

                if (consecutiveEmptyChecks >= OFFLINE_THRESHOLD && !gatewayOfflineAlerted) {
                    // 达到阈值，判定网关离线
                    log.warn("[GatewayHealth] Gateway OFFLINE detected! " +
                                    "No online drones for {}s (threshold={}s). " +
                                    "Last known drones: {}",
                            consecutiveEmptyChecks * 10, OFFLINE_THRESHOLD * 10,
                            lastKnownOnlineDrones);

                    Set<String> affectedDrones = lastKnownOnlineDrones.isEmpty()
                            ? Set.of("unknown")
                            : Set.copyOf(lastKnownOnlineDrones);

                    webSocketGatewayService.broadcastOfflineStatus(
                            affectedDrones,
                            "Gateway heartbeat lost for " + (consecutiveEmptyChecks * 10) + "s. "
                                    + "Possible gateway power failure or network partition."
                    );
                    gatewayOfflineAlerted = true;
                } else if (consecutiveEmptyChecks < OFFLINE_THRESHOLD) {
                    log.debug("[GatewayHealth] No online drones (check {}/{})",
                            consecutiveEmptyChecks, OFFLINE_THRESHOLD);
                }
            }
        } catch (Exception e) {
            log.debug("[GatewayHealth] Health check failed (Redis may be unavailable): {}",
                    e.getMessage());
        }
    }

    /**
     * 广播网关恢复事件。
     */
    private void broadcastRecovery(Set<String> onlineDrones) {
        try {
            Map<String, Object> message = new LinkedHashMap<>();
            message.put("type", "gateway_recovered");
            message.put("timestamp", Instant.now().toString());
            message.put("onlineDrones", onlineDrones);
            message.put("droneCount", onlineDrones.size());

            messagingTemplate.convertAndSend("/topic/drone-status", message);

            log.info("[GatewayHealth] Broadcast GATEWAY_RECOVERED: {} drone(s) back online",
                    onlineDrones.size());
        } catch (Exception e) {
            log.error("[GatewayHealth] Failed to broadcast recovery: {}", e.getMessage());
        }
    }

    /**
     * 获取当前监控状态（用于调试/API）。
     */
    public Map<String, Object> getStatus() {
        return Map.of(
                "consecutiveEmptyChecks", consecutiveEmptyChecks,
                "offlineThreshold", OFFLINE_THRESHOLD,
                "gatewayOfflineAlerted", gatewayOfflineAlerted,
                "lastKnownOnlineDrones", Set.copyOf(lastKnownOnlineDrones)
        );
    }
}
