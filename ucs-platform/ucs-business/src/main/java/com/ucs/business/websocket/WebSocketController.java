package com.ucs.business.websocket;

import com.ucs.business.entity.UavLatestState;
import com.ucs.business.repository.UavLatestStateRepository;
import com.ucs.business.service.EventService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Controller;

import java.security.Principal;
import java.util.*;
import java.util.stream.Collectors;

/**
 * WebSocket Controller — 定时广播无人机状态和事件到前端。
 *
 * 数据来源：
 *   - 无人机状态：直接从 uav_latest_state 表读取（由 TelemetryPersistenceService 写入）
 *   - 事件：通过 EventService 读取最新事件
 *
 * 广播频率：
 *   - /topic/drones：每2秒（无人机实时状态）
 *   - /topic/events：每5秒（最新事件列表）
 */
@Slf4j
@Controller
public class WebSocketController {

    private final SimpMessagingTemplate messagingTemplate;
    private final UavLatestStateRepository uavLatestStateRepository;
    private final EventService eventService;

    public WebSocketController(SimpMessagingTemplate messagingTemplate,
                               UavLatestStateRepository uavLatestStateRepository,
                               EventService eventService) {
        this.messagingTemplate = messagingTemplate;
        this.uavLatestStateRepository = uavLatestStateRepository;
        this.eventService = eventService;
    }

    @MessageMapping("/subscribe")
    public void subscribe(@Payload Map<String, Object> payload, Principal principal) {
        if (principal != null) {
            log.info("[WebSocket] User {} subscribed", principal.getName());
        }
    }

    @MessageMapping("/unsubscribe")
    public void unsubscribe(Principal principal) {
        if (principal != null) {
            log.info("[WebSocket] User {} unsubscribed", principal.getName());
        }
    }

    /**
     * 每2秒广播所有在线无人机状态到 /topic/drones。
     * 直接从 uav_latest_state 表读取，该表由 TelemetryPersistenceService.flushBuffer() 维护。
     */
    @Scheduled(fixedRate = 2000)
    public void broadcastDroneStatus() {
        try {
            List<UavLatestState> latestStates = uavLatestStateRepository.findAllByOrderByUavIdAsc();
            if (latestStates.isEmpty()) {
                return;
            }

            List<Map<String, Object>> drones = latestStates.stream()
                    .map(this::stateToMap)
                    .collect(Collectors.toList());

            // 注意：不再广播到 /topic/telemetry
            // 原因：useTelemetryWebSocket hook 总是订阅 /topic/telemetry，
            // 每次消息触发 setLastBatch() → React state 变更 → CommanderView re-render → 界面闪烁
            // 遥测数据由 TelemetryKafkaConsumer 通过分区 topic 推送

            // Send to /topic/drones for backward compatibility (不触发前端 setLastBatch)
            Map<String, Object> dronesMsg = new LinkedHashMap<>();
            dronesMsg.put("timestamp", java.time.Instant.now().toString());
            dronesMsg.put("numDrones", drones.size());
            dronesMsg.put("drones", drones);
            messagingTemplate.convertAndSend("/topic/drones", dronesMsg);
        } catch (Exception e) {
            log.debug("[WebSocket] broadcastDroneStatus failed: {}", e.getMessage());
        }
    }

    /**
     * 每5秒广播最新事件到 /topic/events。
     */
    @Scheduled(fixedRate = 5000)
    public void broadcastEvents() {
        try {
            var events = eventService.getLatestEvents(5);
            messagingTemplate.convertAndSend("/topic/events", events);
        } catch (Exception e) {
            log.debug("[WebSocket] broadcastEvents failed: {}", e.getMessage());
        }
    }

    public void sendTaskNotification(Long userId, String taskName, String message) {
        Map<String, Object> notification = Map.of(
                "type", "TASK_ASSIGNED",
                "taskName", taskName,
                "message", message
        );
        messagingTemplate.convertAndSendToUser(
                userId.toString(),
                "/queue/notifications",
                notification
        );
    }

    public void sendDroneAssignmentNotification(Long userId, List<String> droneIds) {
        Map<String, Object> notification = Map.of(
                "type", "DRONE_ASSIGNED",
                "droneIds", droneIds,
                "message", "New drones have been assigned to you"
        );
        messagingTemplate.convertAndSendToUser(
                userId.toString(),
                "/queue/notifications",
                notification
        );
    }

    /**
     * 将 UavLatestState 实体转换为前端期望的 Map 格式。
     */
    private Map<String, Object> stateToMap(UavLatestState state) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("uavId", state.getUavId());
        map.put("uavName", state.getUavId()); // Use uavId as name if no separate name field
        map.put("timestamp", state.getLastUpdate() != null ? state.getLastUpdate().toString() : "");
        map.put("lat", state.getLat() != null ? state.getLat() : 0.0);
        map.put("lon", state.getLon() != null ? state.getLon() : 0.0);
        map.put("alt", state.getAlt() != null ? state.getAlt() : 0.0);
        map.put("heading", state.getHeading() != null ? state.getHeading() : 0f);
        map.put("groundSpeed", state.getGroundSpeed() != null ? state.getGroundSpeed() : 0f);
        map.put("verticalSpeed", state.getVerticalSpeed() != null ? state.getVerticalSpeed() : 0f);
        map.put("nedX", state.getNedX() != null ? state.getNedX() : 0.0);
        map.put("nedY", state.getNedY() != null ? state.getNedY() : 0.0);
        map.put("nedZ", state.getNedZ() != null ? state.getNedZ() : 0.0);
        map.put("vx", state.getVx() != null ? state.getVx() : 0.0);
        map.put("vy", state.getVy() != null ? state.getVy() : 0.0);
        map.put("vz", state.getVz() != null ? state.getVz() : 0.0);
        map.put("dataAge", state.getDataAge() != null ? state.getDataAge() : 0.0);
        map.put("msgCount", state.getMsgCount() != null ? state.getMsgCount() : 0L);
        map.put("isActive", Boolean.TRUE.equals(state.getIsActive()));
        map.put("armed", Boolean.TRUE.equals(state.getArmed()));
        map.put("flightMode", state.getFlightMode() != null ? state.getFlightMode() : "");
        map.put("batteryPercent", state.getBatteryPercent() != null ? state.getBatteryPercent() : -1f);
        return map;
    }
}
