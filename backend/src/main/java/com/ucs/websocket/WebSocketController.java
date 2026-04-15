package com.ucs.websocket;

import com.ucs.dto.DroneStatusDTO;
import com.ucs.dto.EventDTO;
import com.ucs.service.DroneService;
import com.ucs.service.EventService;
import com.ucs.service.TeamService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Controller;

import java.security.Principal;
import java.util.List;
import java.util.Map;

@Slf4j
@Controller
public class WebSocketController {
    
    private final SimpMessagingTemplate messagingTemplate;
    private final DroneService droneService;
    private final EventService eventService;
    private final TeamService teamService;
    
    public WebSocketController(SimpMessagingTemplate messagingTemplate,
                               DroneService droneService,
                               EventService eventService,
                               TeamService teamService) {
        this.messagingTemplate = messagingTemplate;
        this.droneService = droneService;
        this.eventService = eventService;
        this.teamService = teamService;
    }
    
    @MessageMapping("/subscribe")
    public void subscribe(@Payload Map<String, Object> payload, Principal principal) {
        if (principal != null) {
            String userId = principal.getName();
            teamService.setUserOnline(Long.parseLong(userId), true);
        }
    }
    
    @MessageMapping("/unsubscribe")
    public void unsubscribe(Principal principal) {
        if (principal != null) {
            String userId = principal.getName();
            teamService.setUserOnline(Long.parseLong(userId), false);
        }
    }
    
    /**
     * T-15: 移除原2秒全表查询广播，改为5秒摘要推送。
     * 单架无人机的实时遥测由 TelemetryKafkaConsumer -> WebSocketGatewayService
     * 通过 Kafka 事件驱动增量推送到 /topic/telemetry/partition/{partitionName}。
     *
     * 此处保留5秒频率的摘要推送（全量状态快照），
     * 供前端仪表盘/列表页做低频刷新（非实时地图渲染用途）。
     */
    @Scheduled(fixedRate = 5000)
    public void broadcastDroneSummary() {
        try {
            List<DroneStatusDTO> allDrones = droneService.getAllDrones();
            messagingTemplate.convertAndSend("/topic/drones", allDrones);
        } catch (Exception e) {
            log.debug("[WS] Failed to broadcast drone summary: {}", e.getMessage());
        }
    }
    
    @Scheduled(fixedRate = 5000)
    public void broadcastEvents() {
        try {
            List<EventDTO> events = eventService.getLatestEvents(5);
            messagingTemplate.convertAndSend("/topic/events", events);
        } catch (Exception e) {
            log.debug("[WS] Failed to broadcast events: {}", e.getMessage());
        }
    }

    /**
     * T-15: Kafka驱动的单架无人机增量推送入口。
     * 由 TelemetryKafkaConsumer 在处理每条遥测消息后调用，
     * 将该架无人机的最新状态推送到 /topic/drone/{uavId}。
     * 前端地图组件订阅此topic获取实时位置更新。
     *
     * @param uavId   无人机唯一标识
     * @param payload 遥测数据Map
     */
    public void pushDroneTelemetry(String uavId, Map<String, Object> payload) {
        messagingTemplate.convertAndSend("/topic/drone/" + uavId, payload);
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
}
