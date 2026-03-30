package com.ucs.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

/**
 * Zenoh client service for publishing control commands and subscribing to responses.
 * 
 * This service abstracts the Zenoh session management. In production, it uses the
 * Zenoh Java SDK (io.zenoh:zenoh-java). For development/testing without the SDK,
 * it operates in stub mode and logs commands.
 * 
 * Zenoh key hierarchy follows PX4 DDS topic naming:
 * - Uplink (drone→ground):  {uavId}/fmu/out/vehicle_global_position
 *                            {uavId}/fmu/out/vehicle_local_position
 *                            {uavId}/fmu/out/battery_status
 *                            {uavId}/fmu/out/vehicle_status
 * - Downlink (ground→drone): {uavId}/fmu/in/vehicle_command
 *                             {uavId}/fmu/in/offboard_control_mode
 *                             {uavId}/fmu/in/trajectory_setpoint
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ZenohService {
    
    private final ObjectMapper objectMapper;
    private final RedisService redisService;
    
    /**
     * Whether Zenoh session is connected.
     * In stub mode, always returns true.
     */
    private volatile boolean connected = false;
    
    /**
     * Initialize Zenoh session connection.
     * In production: connects to Zenoh router at configured endpoint.
     * In stub mode: marks as connected for testing.
     */
    public void connect(String routerEndpoint) {
        log.info("Connecting to Zenoh router at: {}", routerEndpoint);
        // TODO: Replace with actual Zenoh Java SDK session initialization
        // Session session = Zenoh.open(Config.fromJson("{\"connect\":{\"endpoints\":[\"" + routerEndpoint + "\"]}}"));
        this.connected = true;
        log.info("Zenoh session connected (stub mode)");
    }
    
    /**
     * Publish a control command to a drone via Zenoh.
     * Maps command type to PX4 vehicle_command format and publishes to
     * {uavId}/fmu/in/vehicle_command topic.
     * 
     * @param uavId  Target drone's unique identifier
     * @param commandType PX4 command type (TAKEOFF, LAND, RTL, ARM, DISARM, GOTO, HOLD)
     * @param params Command parameters as JSON string
     * @return true if published successfully
     */
    public boolean publishCommand(String uavId, String commandType, String params) {
        String zenohKey = uavId + "/fmu/in/vehicle_command";
        
        // Build PX4 vehicle_command compatible payload
        Map<String, Object> vehicleCommand = buildVehicleCommand(commandType, params);
        
        try {
            String payload = objectMapper.writeValueAsString(vehicleCommand);
            return publishToZenoh(zenohKey, payload);
        } catch (JsonProcessingException e) {
            log.error("Failed to serialize command for drone {}: {}", uavId, e.getMessage());
            return false;
        }
    }
    
    /**
     * Publish a trajectory setpoint to a drone for GOTO commands.
     * Publishes to {uavId}/fmu/in/trajectory_setpoint topic.
     */
    public boolean publishTrajectorySetpoint(String uavId, double lat, double lon, double alt) {
        String zenohKey = uavId + "/fmu/in/trajectory_setpoint";
        
        Map<String, Object> setpoint = Map.of(
            "timestamp", System.currentTimeMillis() * 1000L, // microseconds
            "lat", lat,
            "lon", lon,
            "alt", alt,
            "yaw", Float.NaN // NaN = maintain current yaw
        );
        
        try {
            String payload = objectMapper.writeValueAsString(setpoint);
            return publishToZenoh(zenohKey, payload);
        } catch (JsonProcessingException e) {
            log.error("Failed to serialize trajectory setpoint for drone {}: {}", uavId, e.getMessage());
            return false;
        }
    }
    
    /**
     * Build a PX4-compatible vehicle_command message from our command type.
     * 
     * PX4 vehicle_command mapping:
     * - TAKEOFF  → command=22 (MAV_CMD_NAV_TAKEOFF), param7=altitude
     * - LAND     → command=21 (MAV_CMD_NAV_LAND)
     * - RTL      → command=20 (MAV_CMD_NAV_RETURN_TO_LAUNCH)
     * - ARM      → command=400 (MAV_CMD_COMPONENT_ARM_DISARM), param1=1
     * - DISARM   → command=400 (MAV_CMD_COMPONENT_ARM_DISARM), param1=0
     * - GOTO     → command=192 (MAV_CMD_DO_REPOSITION), param5=lat, param6=lon, param7=alt
     * - HOLD     → command=17 (MAV_CMD_NAV_LOITER_UNLIM)
     */
    private Map<String, Object> buildVehicleCommand(String commandType, String paramsJson) {
        Map<String, Object> params = parseParams(paramsJson);
        
        long timestamp = System.currentTimeMillis() * 1000L; // microseconds
        
        // Use HashMap since vehicle_command messages can have >10 fields (Map.of limit)
        Map<String, Object> cmd = new HashMap<>();
        cmd.put("timestamp", timestamp);
        cmd.put("target_system", 1);
        cmd.put("source_system", 255);
        cmd.put("confirmation", 0);
        cmd.put("from_external", true);
        
        switch (commandType.toUpperCase()) {
            case "TAKEOFF" -> {
                cmd.put("command", 22); // MAV_CMD_NAV_TAKEOFF
                cmd.put("param1", 0.0);
                cmd.put("param2", 0.0);
                cmd.put("param5", params.getOrDefault("lat", 0.0));
                cmd.put("param6", params.getOrDefault("lon", 0.0));
                cmd.put("param7", params.getOrDefault("altitude", 50.0));
            }
            case "LAND" -> {
                cmd.put("command", 21); // MAV_CMD_NAV_LAND
                cmd.put("param5", params.getOrDefault("lat", 0.0));
                cmd.put("param6", params.getOrDefault("lon", 0.0));
                cmd.put("param7", 0.0);
            }
            case "RTL" -> {
                cmd.put("command", 20); // MAV_CMD_NAV_RETURN_TO_LAUNCH
            }
            case "ARM" -> {
                cmd.put("command", 400); // MAV_CMD_COMPONENT_ARM_DISARM
                cmd.put("param1", 1.0); // 1 = ARM
            }
            case "DISARM" -> {
                cmd.put("command", 400); // MAV_CMD_COMPONENT_ARM_DISARM
                cmd.put("param1", 0.0); // 0 = DISARM
            }
            case "GOTO" -> {
                cmd.put("command", 192); // MAV_CMD_DO_REPOSITION
                cmd.put("param5", params.getOrDefault("lat", 0.0));
                cmd.put("param6", params.getOrDefault("lon", 0.0));
                cmd.put("param7", params.getOrDefault("alt", 100.0));
            }
            case "HOLD" -> {
                cmd.put("command", 17); // MAV_CMD_NAV_LOITER_UNLIM
            }
            default -> {
                cmd.put("command", 0);
                cmd.put("raw_command_type", commandType);
                cmd.put("raw_params", paramsJson != null ? paramsJson : "{}");
            }
        }
        
        return cmd;
    }
    
    @SuppressWarnings("unchecked")
    private Map<String, Object> parseParams(String paramsJson) {
        if (paramsJson == null || paramsJson.isBlank()) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(paramsJson, Map.class);
        } catch (JsonProcessingException e) {
            log.warn("Failed to parse command params: {}", paramsJson);
            return Map.of();
        }
    }
    
    /**
     * Low-level publish to Zenoh key.
     * In stub mode: logs the publish and returns true.
     * In production: uses Zenoh session.put(key, payload).
     */
    private boolean publishToZenoh(String key, String payload) {
        log.info("Zenoh PUBLISH [{}] → {}", key, payload);
        // TODO: Replace with actual Zenoh publish
        // session.put(KeyExpr.tryFrom(key), Value.from(payload));
        return true;
    }
    
    /**
     * Check if Zenoh session is connected.
     */
    public boolean isConnected() {
        return connected;
    }
    
    /**
     * Disconnect Zenoh session.
     */
    public void disconnect() {
        log.info("Disconnecting Zenoh session");
        // TODO: session.close();
        this.connected = false;
    }
}
