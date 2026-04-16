package com.ucs.business.event;

import com.ucs.business.service.WebSocketGatewayService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * T-15: Event-driven drone status broadcast listener.
 *
 * Listens for DroneStatusEvent and broadcasts drone status changes via WebSocket.
 * Replaces direct coupling between TelemetryKafkaConsumer and WebSocket broadcasting.
 *
 * Event types handled:
 *   - ONLINE        → broadcast to /topic/drone-status
 *   - OFFLINE       → broadcast to /topic/drone-status + notify partitions
 *   - STATUS_UPDATE  → broadcast to /topic/drone-status (throttled)
 *   - MODE_CHANGE   → broadcast to /topic/drone-status + /topic/events
 *   - LOW_BATTERY   → broadcast to /topic/drone-status + /topic/events
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DroneStatusEventListener {

    private final SimpMessagingTemplate messagingTemplate;
    private final WebSocketGatewayService webSocketGatewayService;

    /**
     * Handle drone status events asynchronously.
     * Using @Async to avoid blocking the event publisher (Kafka consumer thread).
     */
    @Async
    @EventListener
    public void handleDroneStatusEvent(DroneStatusEvent event) {
        try {
            String uavId = event.getUavId();
            String eventType = event.getEventType();
            Map<String, Object> payload = event.getPayload();

            switch (eventType) {
                case "ONLINE" -> handleDroneOnline(uavId, payload);
                case "OFFLINE" -> handleDroneOffline(uavId, payload);
                case "MODE_CHANGE" -> handleModeChange(uavId, payload);
                case "LOW_BATTERY" -> handleLowBattery(uavId, payload);
                case "STATUS_UPDATE" -> handleStatusUpdate(uavId, payload);
                default -> log.debug("[DroneStatusListener] Unknown event type: {}", eventType);
            }
        } catch (Exception e) {
            log.warn("[DroneStatusListener] Failed to handle event for {}: {}",
                    event.getUavId(), e.getMessage());
        }
    }

    private void handleDroneOnline(String uavId, Map<String, Object> payload) {
        Map<String, Object> message = buildMessage("drone_online", uavId, payload);
        messagingTemplate.convertAndSend("/topic/drone-status", message);
        log.debug("[DroneStatusListener] Drone '{}' ONLINE event broadcast", uavId);
    }

    private void handleDroneOffline(String uavId, Map<String, Object> payload) {
        Map<String, Object> message = buildMessage("drone_offline", uavId, payload);
        message.put("reason", payload.getOrDefault("reason", "heartbeat_timeout"));
        messagingTemplate.convertAndSend("/topic/drone-status", message);

        // Also notify partitions about drone removal
        webSocketGatewayService.notifyDroneRemoved(uavId, Set.of("__all__"));
        log.debug("[DroneStatusListener] Drone '{}' OFFLINE event broadcast", uavId);
    }

    private void handleModeChange(String uavId, Map<String, Object> payload) {
        Map<String, Object> message = buildMessage("mode_change", uavId, payload);
        message.put("oldMode", payload.getOrDefault("oldMode", ""));
        message.put("newMode", payload.getOrDefault("newMode", ""));
        messagingTemplate.convertAndSend("/topic/drone-status", message);
        messagingTemplate.convertAndSend("/topic/events", message);
        log.debug("[DroneStatusListener] Drone '{}' MODE_CHANGE event broadcast", uavId);
    }

    private void handleLowBattery(String uavId, Map<String, Object> payload) {
        Map<String, Object> message = buildMessage("low_battery", uavId, payload);
        message.put("batteryPercent", payload.getOrDefault("batteryPercent", 0));
        messagingTemplate.convertAndSend("/topic/drone-status", message);
        messagingTemplate.convertAndSend("/topic/events", message);
        log.debug("[DroneStatusListener] Drone '{}' LOW_BATTERY event broadcast", uavId);
    }

    private void handleStatusUpdate(String uavId, Map<String, Object> payload) {
        Map<String, Object> message = buildMessage("status_update", uavId, payload);
        messagingTemplate.convertAndSend("/topic/drone-status", message);
    }

    private Map<String, Object> buildMessage(String type, String uavId, Map<String, Object> payload) {
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("type", type);
        message.put("uavId", uavId);
        message.put("timestamp", Instant.now().toString());
        if (payload != null) {
            message.putAll(payload);
        }
        return message;
    }
}
