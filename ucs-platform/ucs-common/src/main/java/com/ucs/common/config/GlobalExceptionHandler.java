package com.ucs.common.config;

import com.ucs.common.dto.ApiResponse;
import com.ucs.common.dto.ErrorCode;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.security.SignatureException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.nio.file.AccessDeniedException;
import java.util.stream.Collectors;

/**
 * T-48: 全局异常处理器 — 所有微服务共享（放在 ucs-common 中）。
 * <p>
 * 统一捕获并转换为 {@link ApiResponse} 格式返回，避免泄露堆栈信息。
 * 各微服务通过依赖 ucs-common 自动引入。
 * </p>
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    /** 参数校验失败（@Valid + DTO 约束） */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidation(MethodArgumentNotValidException ex) {
        String detail = ex.getBindingResult().getFieldErrors().stream()
                .map(FieldError::getDefaultMessage)
                .collect(Collectors.joining("; "));
        log.warn("[Validation] {}", detail);
        return ResponseEntity.badRequest()
                .body(ApiResponse.fail(ErrorCode.PARAM_INVALID, detail));
    }

    /** 缺少必要参数 */
    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ApiResponse<Void>> handleMissingParam(MissingServletRequestParameterException ex) {
        log.warn("[MissingParam] {}", ex.getMessage());
        return ResponseEntity.badRequest()
                .body(ApiResponse.fail(ErrorCode.PARAM_MISSING, ex.getParameterName()));
    }

    /** 参数类型不匹配 */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiResponse<Void>> handleTypeMismatch(MethodArgumentTypeMismatchException ex) {
        log.warn("[TypeMismatch] param={}, value={}", ex.getName(), ex.getValue());
        return ResponseEntity.badRequest()
                .body(ApiResponse.fail(ErrorCode.PARAM_TYPE_MISMATCH, ex.getName()));
    }

    /** JWT 过期 */
    @ExceptionHandler(ExpiredJwtException.class)
    public ResponseEntity<ApiResponse<Void>> handleJwtExpired(ExpiredJwtException ex) {
        log.warn("[JWT] Token expired: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(ApiResponse.fail(ErrorCode.TOKEN_EXPIRED));
    }

    /** JWT 签名无效 */
    @ExceptionHandler(SignatureException.class)
    public ResponseEntity<ApiResponse<Void>> handleJwtSignature(SignatureException ex) {
        log.warn("[JWT] Invalid signature: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(ApiResponse.fail(ErrorCode.TOKEN_INVALID));
    }

    /** 权限不足 */
    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiResponse<Void>> handleAccessDenied(AccessDeniedException ex) {
        log.warn("[Auth] Access denied: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ApiResponse.fail(ErrorCode.ACCESS_DENIED));
    }

    /** 资源不存在 */
    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ApiResponse<Void>> handleNotFound(NoResourceFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiResponse.fail(ErrorCode.RESOURCE_NOT_FOUND));
    }

    /** 兜底 — 未知异常 */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleGeneric(Exception ex) {
        log.error("[Internal] Unhandled exception", ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.fail(ErrorCode.INTERNAL_ERROR));
    }
}
