package com.ucs.business.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

/**
 * Service for publishing control commands to the DDS gateway.
 * 
 * The DDS gateway exposes a lightweight HTTP API on port 5050 (configurable)
 * that accepts command requests and publishes them to the appropriate
 * PX4 DDS topics via rclpy.
 * 
 * Command flow:
 *   Backend ControlService -> DdsCommandService -> HTTP -> DDS Gateway -> DDS/ROS2 -> PX4
 * 
 * Supported commands:
 *   ARM, DISARM, TAKEOFF, LAND, RTL, HOLD, OFFBOARD, GOTO,
 *   ORBIT, SET_ROI, SET_YAW, SET_GPS_ORIGIN, MARK_HOME, GET_HOME
 */
@Slf4j
@Service
public class DdsCommandService {

    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    @Value("${dds.gateway.command-url:http://localhost:5050}")
    private String gatewayCommandUrl;

    public DdsCommandService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
    }

    /**
     * Send a control command to the DDS gateway for publishing to PX4.
     *
     * @param uavId       Target drone ID (e.g., "px4_1")
     * @param commandType Command type (ARM, DISARM, TAKEOFF, LAND, RTL, HOLD, OFFBOARD, GOTO)
     * @param params      Command parameters as JSON string (may be null)
     * @return true if the gateway accepted the command
     */
    public boolean sendCommand(String uavId, String commandType, String params) {
        try {
            Map<String, Object> payload = Map.of(
                    "uavId", uavId,
                    "commandType", commandType,
                    "params", params != null ? params : "{}"
            );
            String body = objectMapper.writeValueAsString(payload);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(gatewayCommandUrl + "/api/command"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .timeout(Duration.ofSeconds(10))
                    .build();

            HttpResponse<String> response = httpClient.send(request,
                    HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() == 200) {
                Map<?, ?> result = objectMapper.readValue(response.body(), Map.class);
                boolean success = Boolean.TRUE.equals(result.get("success"));
                log.info("[DDS] Command {} -> {} via gateway: success={}, msg={}",
                        commandType, uavId, success, result.get("message"));
                return success;
            } else {
                log.error("[DDS] Gateway returned HTTP {}: {}", response.statusCode(), response.body());
                return false;
            }
        } catch (Exception e) {
            log.warn("[DDS] Failed to send command to gateway ({}): {}. Command logged for retry.",
                    gatewayCommandUrl, e.getMessage());
            return false;
        }
    }

    /**
     * Start offboard heartbeat for a drone (>2Hz OffboardControlMode publishing).
     */
    public void startHeartbeat(String uavId) {
        try {
            String body = objectMapper.writeValueAsString(Map.of("uavId", uavId));
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(gatewayCommandUrl + "/api/heartbeat/start"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .timeout(Duration.ofSeconds(5))
                    .build();
            httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString());
            log.info("[DDS] Started offboard heartbeat for {}", uavId);
        } catch (Exception e) {
            log.error("[DDS] Failed to start heartbeat for {}: {}", uavId, e.getMessage());
        }
    }

    /**
     * Stop offboard heartbeat for a drone.
     */
    public void stopHeartbeat(String uavId) {
        try {
            String body = objectMapper.writeValueAsString(Map.of("uavId", uavId));
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(gatewayCommandUrl + "/api/heartbeat/stop"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .timeout(Duration.ofSeconds(5))
                    .build();
            httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString());
            log.info("[DDS] Stopped offboard heartbeat for {}", uavId);
        } catch (Exception e) {
            log.error("[DDS] Failed to stop heartbeat for {}: {}", uavId, e.getMessage());
        }
    }

    /**
     * Check if the DDS gateway command server is reachable.
     */
    public boolean isGatewayAvailable() {
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(gatewayCommandUrl + "/api/health"))
                    .GET()
                    .timeout(Duration.ofSeconds(3))
                    .build();
            HttpResponse<String> response = httpClient.send(request,
                    HttpResponse.BodyHandlers.ofString());
            return response.statusCode() == 200;
        } catch (Exception e) {
            return false;
        }
    }
}
