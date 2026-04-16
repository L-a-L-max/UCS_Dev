package com.ucs.business.event;

import org.springframework.context.ApplicationEvent;

import java.util.Map;

/**
 * T-15: Event-driven drone status broadcast.
 *
 * Spring Application Event for drone status changes.
 * Published by TelemetryKafkaConsumer when drone status changes are detected.
 * Listened by DroneStatusEventListener to broadcast via WebSocket.
 *
 * Benefits over direct method calls:
 *   1. Decoupling — publisher doesn't need to know about all consumers
 *   2. Extensibility — new listeners can be added without modifying publisher
 *   3. Async support — listeners can run asynchronously via @Async
 */
public class DroneStatusEvent extends ApplicationEvent {

    private final String uavId;
    private final String eventType;
    private final Map<String, Object> payload;

    /**
     * @param source    Event source (typically the publishing service)
     * @param uavId     Drone identifier
     * @param eventType Event type: ONLINE, OFFLINE, STATUS_UPDATE, MODE_CHANGE, LOW_BATTERY
     * @param payload   Full telemetry/status payload
     */
    public DroneStatusEvent(Object source, String uavId, String eventType, Map<String, Object> payload) {
        super(source);
        this.uavId = uavId;
        this.eventType = eventType;
        this.payload = payload;
    }

    public String getUavId() {
        return uavId;
    }

    public String getEventType() {
        return eventType;
    }

    public Map<String, Object> getPayload() {
        return payload;
    }
}
