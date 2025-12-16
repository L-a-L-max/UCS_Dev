package com.ucs.websocket;

import com.ucs.dto.DroneStatusDTO;
import com.ucs.dto.EventDTO;
import com.ucs.service.DroneService;
import com.ucs.service.EventService;
import com.ucs.service.TeamService;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Controller;

import java.security.Principal;
import java.util.List;
import java.util.Map;

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
    
    @Scheduled(fixedRate = 2000)
    public void broadcastDroneStatus() {
        List<DroneStatusDTO> allDrones = droneService.getAllDrones();
        messagingTemplate.convertAndSend("/topic/drones", allDrones);
    }
    
    @Scheduled(fixedRate = 5000)
    public void broadcastEvents() {
        List<EventDTO> events = eventService.getLatestEvents(5);
        messagingTemplate.convertAndSend("/topic/events", events);
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
