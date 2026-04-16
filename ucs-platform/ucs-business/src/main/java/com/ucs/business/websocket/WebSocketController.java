package com.ucs.business.websocket;

import com.ucs.business.service.EventService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.security.Principal;
import java.util.*;

/**
 * T-63: WebSocket Controller — 仅负责业务通知（任务分配、无人机分配等）。
 *
 * 职责划分（T-63 清理后）：
 *   - 遥测广播：由 ucs-realtime-push (TelemetryPushConsumer) 负责
 *   - 分区路由广播：由 ucs-business (TelemetryKafkaConsumer) 通过 WebSocketGatewayService 负责
 *   - 事件广播：由 ucs-realtime-push (EventPushConsumer) 负责
 *   - 本 Controller 仅保留：subscribe/unsubscribe 处理 + 业务通知（任务/无人机分配）
 */
@Slf4j
@Controller
public class WebSocketController {

    private final SimpMessagingTemplate messagingTemplate;
    private final EventService eventService;

    public WebSocketController(SimpMessagingTemplate messagingTemplate,
                               EventService eventService) {
        this.messagingTemplate = messagingTemplate;
        this.eventService = eventService;
    }

    @MessageMapping("/subscribe")
    public void subscribe(@Payload Map<String, Object> payload, Principal principal) {
        if (principal != null) {
            // T-73: Downgrade per-connection log from INFO to DEBUG
            log.debug("[WebSocket] User {} subscribed", principal.getName());
        }
    }

    @MessageMapping("/unsubscribe")
    public void unsubscribe(Principal principal) {
        if (principal != null) {
            // T-73: Downgrade per-connection log from INFO to DEBUG
            log.debug("[WebSocket] User {} unsubscribed", principal.getName());
        }
    }

    // T-63: broadcastDroneStatus() 和 broadcastEvents() 已移除
    // 遥测广播由 ucs-realtime-push (TelemetryPushConsumer) 负责
    // 事件广播由 ucs-realtime-push (EventPushConsumer) 负责

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

}
