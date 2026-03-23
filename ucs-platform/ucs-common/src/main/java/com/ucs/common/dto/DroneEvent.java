package com.ucs.common.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * Drone event DTO shared across microservices.
 * Represents a state-change event from Kafka topic: events.drone
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DroneEvent implements Serializable {

    private String uavId;
    private String eventType;  // CONNECTED, ARMED_CHANGED, DISCONNECTED
    private boolean armed;
    private long epoch;
    private long timestamp;
}
