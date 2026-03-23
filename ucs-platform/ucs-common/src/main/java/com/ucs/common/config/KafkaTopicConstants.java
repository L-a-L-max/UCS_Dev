package com.ucs.common.config;

/**
 * Kafka topic name constants shared across all microservices.
 */
public final class KafkaTopicConstants {

    public static final String TELEMETRY_RAW = "telemetry.raw";
    public static final String TELEMETRY_PROCESSED = "telemetry.processed";
    public static final String EVENTS_DRONE = "events.drone";
    public static final String COMMANDS_DOWN = "commands.down";
    public static final String COMMANDS_ACK = "commands.ack";

    /** Consumer group IDs */
    public static final String GROUP_INGEST = "ingest-group";
    public static final String GROUP_STORE = "store-group";
    public static final String GROUP_PUSH = "push-group";
    public static final String GROUP_COMMAND = "command-group";
    public static final String GROUP_BUSINESS = "business-group";

    private KafkaTopicConstants() {}
}
