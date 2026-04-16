package com.ucs.common.strategy.gateway;

/**
 * T-03: Gateway strategy interface — abstracts gateway type differences for extensible drone access.
 *
 * Each gateway type (DDS / MAVLink / future types) implements this interface.
 * GatewayRouter dynamically routes to the corresponding strategy based on the drone's gatewayType field.
 *
 * Design goals:
 *   - Eliminate hardcoded uavId prefix checks in ControlService
 *   - Adding a new gateway type only requires implementing this interface + registering in GatewayRouter
 *   - Each strategy encapsulates its own Kafka Topic, HTTP Fallback address, and heartbeat management
 */
public interface GatewayStrategy {

    /**
     * Return the gateway type identifier for this strategy.
     * e.g., "DDS", "MAVLINK"
     */
    String getGatewayType();

    /**
     * Determine whether this strategy supports the given drone.
     *
     * @param uavId drone unique identifier
     * @return true if this strategy can handle commands for this drone
     */
    boolean supports(String uavId);

    /**
     * Send a control command through this gateway.
     * Kafka first, HTTP fallback if Kafka is unavailable.
     *
     * @param uavId       target drone ID
     * @param commandType command type (ARM, TAKEOFF, LAND, RTL, GOTO, ...)
     * @param params      command parameters JSON
     * @param userId      operator user ID
     * @param commandLogId command log ID (for ACK tracing)
     * @return true = command delivered (does not imply execution success)
     */
    boolean sendCommand(String uavId, String commandType, String params,
                        Long userId, Long commandLogId);

    /**
     * Get the Kafka downstream command Topic for this gateway.
     * DDS: "commands.down"
     * MAVLink: "commands.mavlink.down"
     */
    String getCommandTopic();

    /**
     * Start OFFBOARD heartbeat for the drone.
     */
    void startHeartbeat(String uavId);

    /**
     * Stop OFFBOARD heartbeat for the drone.
     */
    void stopHeartbeat(String uavId);

    /**
     * Check if the gateway is reachable (health check).
     */
    boolean isAvailable();
}
