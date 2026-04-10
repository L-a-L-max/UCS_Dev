package com.ucs.common.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * Command message DTO shared across microservices.
 * Represents a downlink command from Kafka topic: commands.down
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CommandMessage implements Serializable {

    private String commandId;
    private String uavId;
    private String commandType;
    private int command;          // MAVLink command ID (e.g. 22=TAKEOFF, 21=LAND)
    private String params;
    private double param1;
    private double param2;
    private double param3;
    private double param4;
    private double param5;
    private double param6;
    private double param7;        // e.g. altitude for takeoff
    private long epoch;
    private long timestamp;
    private long expireAt;
}
