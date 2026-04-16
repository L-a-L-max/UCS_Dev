package com.ucs.common.dto;

import lombok.Getter;

/**
 * T-55: 统一错误码枚举 — 所有微服务共享。
 * <p>
 * 编码规则：
 * <ul>
 *   <li>1xxx — 认证/授权错误</li>
 *   <li>2xxx — 参数校验错误</li>
 *   <li>3xxx — 业务逻辑错误</li>
 *   <li>4xxx — 外部服务错误</li>
 *   <li>5xxx — 系统内部错误</li>
 * </ul>
 */
@Getter
public enum ErrorCode {

    // ── 1xxx 认证/授权 ──
    UNAUTHORIZED(1001, "未认证，请先登录"),
    TOKEN_EXPIRED(1002, "Token 已过期"),
    TOKEN_INVALID(1003, "Token 无效"),
    ACCESS_DENIED(1004, "权限不足"),
    ACCOUNT_LOCKED(1005, "账号已锁定"),

    // ── 2xxx 参数校验 ──
    PARAM_INVALID(2001, "参数校验失败"),
    PARAM_MISSING(2002, "缺少必要参数"),
    PARAM_TYPE_MISMATCH(2003, "参数类型不匹配"),

    // ── 3xxx 业务逻辑 ──
    RESOURCE_NOT_FOUND(3001, "资源不存在"),
    RESOURCE_ALREADY_EXISTS(3002, "资源已存在"),
    COMMAND_DUPLICATE(3003, "重复命令，已被幂等拦截"),
    DRONE_OFFLINE(3004, "无人机离线"),
    DRONE_NOT_FOUND(3005, "无人机不存在"),
    TEAM_NOT_FOUND(3006, "团队不存在"),
    TASK_NOT_FOUND(3007, "任务不存在"),

    // ── 4xxx 外部服务 ──
    KAFKA_SEND_FAILED(4001, "Kafka 消息发送失败"),
    REDIS_UNAVAILABLE(4002, "Redis 服务不可用"),
    EXTERNAL_API_FAILED(4003, "外部 API 调用失败"),
    CIRCUIT_BREAKER_OPEN(4004, "熔断器已开启，服务暂不可用"),

    // ── 5xxx 系统内部 ──
    INTERNAL_ERROR(5001, "系统内部错误"),
    SERVICE_UNAVAILABLE(5002, "服务暂不可用"),
    RATE_LIMIT_EXCEEDED(5003, "请求频率超限");

    private final int code;
    private final String message;

    ErrorCode(int code, String message) {
        this.code = code;
        this.message = message;
    }
}
