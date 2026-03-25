package com.ucs.common.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * Command acknowledgment DTO shared across microservices.
 * Represents an ack from Kafka topic: commands.ack
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CommandAckMessage implements Serializable {

    private String commandId;
    private String uavId;
    private boolean success;
    private int command;
    private int result;
    private String resultText;
    private long epoch;
    private long timestamp;
}
