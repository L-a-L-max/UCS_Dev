package com.ucs.business.strategy.gateway;

import com.ucs.business.kafka.CommandKafkaProducer;
import com.ucs.common.strategy.gateway.GatewayStrategy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * T-03: DDS gateway strategy implementation.
 *
 * Routes commands to simulated drones via DDS/ROS2 protocol.
 * Commands delivered through Kafka commands.down topic, with HTTP fallback.
 *
 * uavId format: px4_1, px4_2, ... (anything without mavlink_ prefix belongs to DDS)
 */
@Slf4j
@Component
public class DdsGatewayStrategy implements GatewayStrategy {

    @Autowired(required = false)
    private CommandKafkaProducer commandKafkaProducer;

    @Value("${dds.gateway.command-url:http://localhost:5050}")
    private String ddsGatewayCommandUrl;

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();

    @Override
    public String getGatewayType() {
        return "DDS";
    }

    @Override
    public boolean supports(String uavId) {
        return uavId != null && !uavId.startsWith("mavlink_");
    }

    @Override
    public boolean sendCommand(String uavId, String commandType, String params,
                                Long userId, Long commandLogId) {
        if (commandKafkaProducer != null) {
            try {
                commandKafkaProducer.sendCommand(uavId, commandType, params, userId, commandLogId);
                log.debug("[DdsStrategy] Sent via Kafka: {} -> {} (cmdLogId={})",
                        commandType, uavId, commandLogId);
                return true;
            } catch (Exception e) {
                log.warn("[DdsStrategy] Kafka failed, falling back to HTTP: {}", e.getMessage());
            }
        }
        return sendCommandViaHttp(uavId, commandType, params);
    }

    private boolean sendCommandViaHttp(String uavId, String commandType, String params) {
        try {
            String body = String.format(
                    "{\"uavId\":\"%s\",\"commandType\":\"%s\",\"params\":%s}",
                    uavId, commandType, params != null ? params : "{}");
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(ddsGatewayCommandUrl + "/api/command"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .timeout(Duration.ofSeconds(10))
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            boolean success = response.statusCode() == 200;
            log.debug("[DdsStrategy] HTTP command {} -> {}: status={}", commandType, uavId, response.statusCode());
            return success;
        } catch (Exception e) {
            log.warn("[DdsStrategy] HTTP failed ({}): {}", ddsGatewayCommandUrl, e.getMessage());
            return false;
        }
    }

    @Override
    public String getCommandTopic() {
        return "commands.down";
    }

    @Override
    public void startHeartbeat(String uavId) {
        log.debug("[DdsStrategy] Heartbeat start requested for {} (handled by DDS gateway)", uavId);
    }

    @Override
    public void stopHeartbeat(String uavId) {
        log.debug("[DdsStrategy] Heartbeat stop requested for {} (handled by DDS gateway)", uavId);
    }

    @Override
    public boolean isAvailable() {
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(ddsGatewayCommandUrl + "/api/health"))
                    .GET()
                    .timeout(Duration.ofSeconds(3))
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            return response.statusCode() == 200;
        } catch (Exception e) {
            return false;
        }
    }
}
