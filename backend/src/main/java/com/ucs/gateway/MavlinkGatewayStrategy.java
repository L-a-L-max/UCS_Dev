package com.ucs.gateway;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.ucs.kafka.EpochManager;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * T-03: MAVLink网关策略实现。
 *
 * 负责通过MAVLink协议控制真实无人机。
 * 指令通过 Kafka commands.mavlink.down topic 下发，MAVLink Tx Gateway 消费后转为 MAVLink 帧。
 *
 * uavId 格式: mavlink_{ip}_{port} (由 MAVLink Rx Gateway 根据无人机连接地址生成)
 */
@Slf4j
@Component
public class MavlinkGatewayStrategy implements GatewayStrategy {

    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    @Autowired(required = false)
    private KafkaTemplate<String, String> kafkaTemplate;

    @Autowired(required = false)
    private EpochManager epochManager;

    @Value("${mavlink.gateway.command-url:http://localhost:5061}")
    private String mavlinkGatewayCommandUrl;

    @Value("${kafka.topic.commands-mavlink-down:commands.mavlink.down}")
    private String commandsMavlinkDownTopic;

    public MavlinkGatewayStrategy(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
    }

    @Override
    public String getGatewayType() {
        return "MAVLINK";
    }

    @Override
    public boolean supports(String uavId) {
        return uavId != null && uavId.startsWith("mavlink_");
    }

    @Override
    public boolean sendCommand(String uavId, String commandType, String params,
                                Long userId, Long commandLogId) {
        // Kafka first
        if (kafkaTemplate != null) {
            try {
                Map<String, Object> payload = new LinkedHashMap<>();
                payload.put("uavId", uavId);
                payload.put("commandType", commandType);
                payload.put("params", params != null ? params : "{}");
                payload.put("timestamp", Instant.now().toString());
                payload.put("userId", userId);
                payload.put("commandLogId", commandLogId);
                if (epochManager != null) {
                    payload.put("epoch", epochManager.getCurrentEpoch(uavId));
                }

                String json = objectMapper.writeValueAsString(payload);
                kafkaTemplate.send(commandsMavlinkDownTopic, uavId, json)
                        .whenComplete((result, ex) -> {
                            if (ex != null) {
                                log.error("[MavlinkStrategy] Kafka send failed: {} -> {}: {}",
                                        commandType, uavId, ex.getMessage());
                            } else {
                                log.info("[MavlinkStrategy] Sent via Kafka: {} -> {} partition={}",
                                        commandType, uavId,
                                        result.getRecordMetadata().partition());
                            }
                        });
                return true;
            } catch (Exception e) {
                log.warn("[MavlinkStrategy] Kafka failed, falling back to HTTP: {}", e.getMessage());
            }
        }
        // HTTP fallback
        return sendCommandViaHttp(uavId, commandType, params);
    }

    private boolean sendCommandViaHttp(String uavId, String commandType, String params) {
        try {
            Map<String, Object> payload = Map.of(
                    "uavId", uavId,
                    "commandType", commandType,
                    "params", params != null ? params : "{}");
            String body = objectMapper.writeValueAsString(payload);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(mavlinkGatewayCommandUrl + "/api/command"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .timeout(Duration.ofSeconds(10))
                    .build();

            HttpResponse<String> response = httpClient.send(request,
                    HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() == 200) {
                Map<?, ?> result = objectMapper.readValue(response.body(), Map.class);
                boolean success = Boolean.TRUE.equals(result.get("success"));
                log.info("[MavlinkStrategy] HTTP command {} -> {}: success={}",
                        commandType, uavId, success);
                return success;
            } else {
                log.error("[MavlinkStrategy] HTTP returned {}: {}", response.statusCode(), response.body());
                return false;
            }
        } catch (Exception e) {
            log.warn("[MavlinkStrategy] HTTP failed ({}): {}", mavlinkGatewayCommandUrl, e.getMessage());
            return false;
        }
    }

    @Override
    public String getCommandTopic() {
        return commandsMavlinkDownTopic;
    }

    @Override
    public void startHeartbeat(String uavId) {
        try {
            String body = objectMapper.writeValueAsString(Map.of("uavId", uavId));
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(mavlinkGatewayCommandUrl + "/api/heartbeat/start"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .timeout(Duration.ofSeconds(5))
                    .build();
            httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString());
            log.info("[MavlinkStrategy] Started heartbeat for {}", uavId);
        } catch (Exception e) {
            log.error("[MavlinkStrategy] Failed to start heartbeat: {}", e.getMessage());
        }
    }

    @Override
    public void stopHeartbeat(String uavId) {
        try {
            String body = objectMapper.writeValueAsString(Map.of("uavId", uavId));
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(mavlinkGatewayCommandUrl + "/api/heartbeat/stop"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .timeout(Duration.ofSeconds(5))
                    .build();
            httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString());
            log.info("[MavlinkStrategy] Stopped heartbeat for {}", uavId);
        } catch (Exception e) {
            log.error("[MavlinkStrategy] Failed to stop heartbeat: {}", e.getMessage());
        }
    }

    @Override
    public boolean isAvailable() {
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(mavlinkGatewayCommandUrl + "/api/health"))
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
