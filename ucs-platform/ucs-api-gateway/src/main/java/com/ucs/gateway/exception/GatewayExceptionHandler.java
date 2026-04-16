package com.ucs.gateway.exception;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.web.reactive.error.ErrorWebExceptionHandler;
import org.springframework.core.annotation.Order;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * T-67: WebFlux-compatible global exception handler for API Gateway.
 *
 * Spring Cloud Gateway uses WebFlux (Netty), NOT Spring MVC.
 * The MVC-based GlobalExceptionHandler from ucs-common does NOT work here.
 * This handler implements ErrorWebExceptionHandler to catch all gateway errors
 * and return a consistent JSON error response.
 *
 * Error response format:
 * {
 *   "success": false,
 *   "code": "GATEWAY_ERROR",
 *   "message": "...",
 *   "path": "/api/v1/...",
 *   "timestamp": "..."
 * }
 */
@Slf4j
@Component
@Order(-1) // Higher priority than default Spring error handler
public class GatewayExceptionHandler implements ErrorWebExceptionHandler {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public Mono<Void> handle(ServerWebExchange exchange, Throwable ex) {
        ServerHttpResponse response = exchange.getResponse();

        // Prevent double-write if response already committed
        if (response.isCommitted()) {
            return Mono.error(ex);
        }

        HttpStatus status;
        String code;
        String message;

        if (ex instanceof ResponseStatusException rse) {
            status = HttpStatus.valueOf(rse.getStatusCode().value());
            code = mapStatusToCode(status);
            message = rse.getReason() != null ? rse.getReason() : status.getReasonPhrase();
        } else if (ex instanceof java.net.ConnectException) {
            status = HttpStatus.SERVICE_UNAVAILABLE;
            code = "SERVICE_UNAVAILABLE";
            message = "Downstream service is unavailable";
        } else if (ex instanceof java.util.concurrent.TimeoutException) {
            status = HttpStatus.GATEWAY_TIMEOUT;
            code = "GATEWAY_TIMEOUT";
            message = "Downstream service timed out";
        } else {
            status = HttpStatus.INTERNAL_SERVER_ERROR;
            code = "GATEWAY_INTERNAL_ERROR";
            message = "An unexpected gateway error occurred";
        }

        String path = exchange.getRequest().getURI().getPath();
        log.debug("[GatewayError] {} {} -> {} {}", exchange.getRequest().getMethod(), path, status.value(), message);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("success", false);
        body.put("code", code);
        body.put("message", message);
        body.put("path", path);
        body.put("timestamp", Instant.now().toString());

        byte[] bytes;
        try {
            bytes = objectMapper.writeValueAsBytes(body);
        } catch (JsonProcessingException e) {
            bytes = "{\"success\":false,\"code\":\"GATEWAY_ERROR\",\"message\":\"Error serialization failed\"}".getBytes(StandardCharsets.UTF_8);
        }

        response.setStatusCode(status);
        response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
        DataBuffer buffer = response.bufferFactory().wrap(bytes);
        return response.writeWith(Mono.just(buffer));
    }

    private String mapStatusToCode(HttpStatus status) {
        return switch (status) {
            case NOT_FOUND -> "ROUTE_NOT_FOUND";
            case UNAUTHORIZED -> "UNAUTHORIZED";
            case FORBIDDEN -> "FORBIDDEN";
            case TOO_MANY_REQUESTS -> "RATE_LIMITED";
            case BAD_GATEWAY -> "BAD_GATEWAY";
            case SERVICE_UNAVAILABLE -> "SERVICE_UNAVAILABLE";
            case GATEWAY_TIMEOUT -> "GATEWAY_TIMEOUT";
            default -> "GATEWAY_ERROR";
        };
    }
}
