package com.ucs.business.service;

import com.ucs.business.kafka.TelemetryKafkaConsumer;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.*;

/**
 * 无人机心跳超时检测服务。
 *
 * 使用 Redis ZSet（drone:heartbeat）存储每架无人机的最后心跳时间戳。
 * 每秒扫描一次，将超过 3 秒未更新的无人机判定为离线：
 *   1. 从 Redis 删除 online key + ZSet 条目
 *   2. 从 TelemetryKafkaConsumer 的 allDroneSnapshot 移除
 *   3. 通过 WebSocket 通知前端该无人机离线
 *
 * 行业标准心跳机制：
 *   - 在线：10Hz 持续更新 → ZSet score 不断刷新 → 永远不超时
 *   - 离线：数据停止 → score 停留 → 3 秒后被检测出来 → 标记离线
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DroneHeartbeatService {

    private final RedisService redisService;
    private final TelemetryKafkaConsumer telemetryKafkaConsumer;
    private final WebSocketGatewayService webSocketGatewayService;
    private final SimpMessagingTemplate messagingTemplate;

    /** 超时阈值：3 秒无数据 → 离线 */
    private static final long TIMEOUT_MS = 3000;

    /**
     * 每秒扫描 Redis ZSet，检测超时无人机。
     */
    @Scheduled(fixedRate = 1000)
    @SchedulerLock(name = "checkHeartbeats", lockAtLeastFor = "500ms", lockAtMostFor = "5s")
    public void checkHeartbeats() {
        try {
            Set<String> timedOut = redisService.getTimedOutDrones(TIMEOUT_MS);
            if (timedOut.isEmpty()) {
                return;
            }

            for (String uavId : timedOut) {
                log.debug("[Heartbeat] Drone '{}' timed out (>{}ms no data) → marking OFFLINE", uavId, TIMEOUT_MS);

                // 1. 清理 Redis
                redisService.setDroneOffline(uavId);
                redisService.removeDroneHeartbeat(uavId);

                // 2. 从内存快照移除（不再推送到前端）
                telemetryKafkaConsumer.removeDroneFromSnapshot(uavId);

                // 3. 通知前端该无人机离线
                notifyDroneOffline(uavId);
            }

            log.debug("[Heartbeat] Marked {} drone(s) as OFFLINE: {}", timedOut.size(), timedOut);

        } catch (Exception e) {
            log.warn("[Heartbeat] Check failed: {}", e.getMessage());
        }
    }

    /**
     * 通过 WebSocket 通知前端某架无人机离线。
     * 发送到 /topic/drone-status，前端监听此 topic 更新状态。
     */
    private void notifyDroneOffline(String uavId) {
        try {
            Map<String, Object> message = new LinkedHashMap<>();
            message.put("type", "drone_offline");
            message.put("uavId", uavId);
            message.put("timestamp", Instant.now().toString());
            message.put("reason", "heartbeat_timeout");
            messagingTemplate.convertAndSend("/topic/drone-status", message);
        } catch (Exception e) {
            log.debug("[Heartbeat] Failed to notify offline for {}: {}", uavId, e.getMessage());
        }
    }
}
