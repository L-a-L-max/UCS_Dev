package com.ucs.config;

import com.ucs.dto.ApiResponse;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.security.SignatureException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.stream.Collectors;

/**
 * T-48: 全局异常处理器。
 *
 * 统一捕获所有 Controller 层异常，返回标准 {@link ApiResponse} 格式：
 * - 400: 参数校验失败、请求体解析失败
 * - 401: JWT 过期、签名无效
 * - 403: 权限不足
 * - 404: 资源不存在
 * - 405: HTTP 方法不支持
 * - 429: 限流拒绝（由 RateLimitInterceptor 直接返回，此处兜底）
 * - 500: 未知服务端异常
 *
 * 所有异常响应均包含 traceId（由 MDC 自动注入，T-52）。
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    // ---- 400 Bad Request ----

    /** T-54: @Valid 参数校验失败 */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ApiResponse<Object> handleValidation(MethodArgumentNotValidException ex) {
        String detail = ex.getBindingResult().getFieldErrors().stream()
                .map(FieldError::getDefaultMessage)
                .collect(Collectors.joining("; "));
        log.warn("[400] Validation failed: {}", detail);
        return ApiResponse.error(400, "Parameter validation failed: " + detail);
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ApiResponse<Object> handleMissingParam(MissingServletRequestParameterException ex) {
        log.warn("[400] Missing parameter: {}", ex.getParameterName());
        return ApiResponse.error(400, "Missing required parameter: " + ex.getParameterName());
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ApiResponse<Object> handleBadBody(HttpMessageNotReadableException ex) {
        log.warn("[400] Malformed request body: {}", ex.getMessage());
        return ApiResponse.error(400, "Malformed request body");
    }

    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ApiResponse<Object> handleIllegalArg(IllegalArgumentException ex) {
        log.warn("[400] Illegal argument: {}", ex.getMessage());
        return ApiResponse.error(400, ex.getMessage());
    }

    // ---- 401 Unauthorized ----

    @ExceptionHandler(ExpiredJwtException.class)
    @ResponseStatus(HttpStatus.UNAUTHORIZED)
    public ApiResponse<Object> handleJwtExpired(ExpiredJwtException ex) {
        log.warn("[401] JWT expired");
        return ApiResponse.error(401, "Token expired, please refresh");
    }

    @ExceptionHandler(SignatureException.class)
    @ResponseStatus(HttpStatus.UNAUTHORIZED)
    public ApiResponse<Object> handleJwtSignature(SignatureException ex) {
        log.warn("[401] JWT signature invalid");
        return ApiResponse.error(401, "Invalid token signature");
    }

    // ---- 403 Forbidden ----

    @ExceptionHandler(AccessDeniedException.class)
    @ResponseStatus(HttpStatus.FORBIDDEN)
    public ApiResponse<Object> handleAccessDenied(AccessDeniedException ex) {
        log.warn("[403] Access denied: {}", ex.getMessage());
        return ApiResponse.error(403, "Access denied");
    }

    // ---- 404 Not Found ----

    @ExceptionHandler(NoResourceFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ApiResponse<Object> handleNotFound(NoResourceFoundException ex) {
        return ApiResponse.error(404, "Resource not found: " + ex.getResourcePath());
    }

    // ---- 405 Method Not Allowed ----

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    @ResponseStatus(HttpStatus.METHOD_NOT_ALLOWED)
    public ApiResponse<Object> handleMethodNotAllowed(HttpRequestMethodNotSupportedException ex) {
        return ApiResponse.error(405, "Method not allowed: " + ex.getMethod());
    }

    // ---- 500 Internal Server Error ----

    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ApiResponse<Object> handleGeneric(Exception ex) {
        log.error("[500] Unhandled exception: {}", ex.getMessage(), ex);
        return ApiResponse.error(500, "Internal server error");
    }
}
