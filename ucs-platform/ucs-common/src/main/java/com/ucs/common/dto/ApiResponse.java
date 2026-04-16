package com.ucs.common.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * T-55: 统一 API 响应包装器 — 所有微服务共享。
 * <p>
 * 所有 REST 接口返回统一格式：
 * <pre>
 * {
 *   "success": true/false,
 *   "code": 0,           // 0=成功, 非0=ErrorCode枚举值
 *   "message": "...",
 *   "data": { ... }      // 业务数据，失败时为null
 *   "traceId": "..."     // 分布式追踪ID（可选）
 * }
 * </pre>
 *
 * @param <T> 业务数据类型
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ApiResponse<T> {

    private boolean success;
    private int code;
    private String message;
    private T data;
    private String traceId;

    public static <T> ApiResponse<T> ok(T data) {
        return ApiResponse.<T>builder()
                .success(true)
                .code(0)
                .message("success")
                .data(data)
                .build();
    }

    public static <T> ApiResponse<T> ok() {
        return ok(null);
    }

    public static <T> ApiResponse<T> fail(ErrorCode errorCode) {
        return ApiResponse.<T>builder()
                .success(false)
                .code(errorCode.getCode())
                .message(errorCode.getMessage())
                .build();
    }

    public static <T> ApiResponse<T> fail(ErrorCode errorCode, String detail) {
        return ApiResponse.<T>builder()
                .success(false)
                .code(errorCode.getCode())
                .message(errorCode.getMessage() + ": " + detail)
                .build();
    }

    public static <T> ApiResponse<T> fail(int code, String message) {
        return ApiResponse.<T>builder()
                .success(false)
                .code(code)
                .message(message)
                .build();
    }
}
