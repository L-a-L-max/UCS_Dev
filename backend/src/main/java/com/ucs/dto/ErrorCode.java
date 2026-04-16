package com.ucs.dto;

import lombok.Getter;

/**
 * T-55: 统一错误码枚举。
 *
 * 编码规范:
 * - 0       : 成功
 * - 400xx   : 客户端参数错误
 * - 401xx   : 认证/授权错误
 * - 403xx   : 权限不足
 * - 404xx   : 资源不存在
 * - 409xx   : 业务冲突
 * - 429xx   : 限流
 * - 500xx   : 服务端异常
 */
@Getter
public enum ErrorCode {

    // ---- 成功 ----
    SUCCESS(0, "ok"),

    // ---- 400 客户端错误 ----
    BAD_REQUEST(40000, "Bad request"),
    PARAM_INVALID(40001, "Parameter validation failed"),
    PARAM_MISSING(40002, "Required parameter missing"),
    BODY_MALFORMED(40003, "Malformed request body"),

    // ---- 401 认证错误 ----
    UNAUTHORIZED(40100, "Unauthorized"),
    TOKEN_EXPIRED(40101, "Token expired"),
    TOKEN_INVALID(40102, "Invalid token signature"),
    REFRESH_TOKEN_INVALID(40103, "Invalid refresh token"),

    // ---- 403 权限不足 ----
    FORBIDDEN(40300, "Access denied"),
    NO_CONTROL_PERMISSION(40301, "No control permission for this drone"),

    // ---- 404 资源不存在 ----
    NOT_FOUND(40400, "Resource not found"),
    DRONE_NOT_FOUND(40401, "Drone not found"),
    USER_NOT_FOUND(40402, "User not found"),

    // ---- 409 业务冲突 ----
    DRONE_OFFLINE(40901, "Drone is offline"),
    COMMAND_DUPLICATE(40902, "Duplicate command rejected (idempotency)"),
    DRONE_ALREADY_ARMED(40903, "Drone is already armed"),

    // ---- 429 限流 ----
    RATE_LIMITED(42900, "Too many requests, please retry later"),

    // ---- 500 服务端异常 ----
    INTERNAL_ERROR(50000, "Internal server error"),
    GATEWAY_UNREACHABLE(50001, "Gateway unreachable"),
    REDIS_UNAVAILABLE(50002, "Redis service unavailable"),
    KAFKA_UNAVAILABLE(50003, "Kafka service unavailable");

    private final int code;
    private final String message;

    ErrorCode(int code, String message) {
        this.code = code;
        this.message = message;
    }

    /** 快捷方法：基于 ErrorCode 构建 ApiResponse */
    public <T> ApiResponse<T> toResponse() {
        return ApiResponse.error(this.code, this.message);
    }

    public <T> ApiResponse<T> toResponse(String detail) {
        return ApiResponse.error(this.code, this.message + ": " + detail);
    }
}
