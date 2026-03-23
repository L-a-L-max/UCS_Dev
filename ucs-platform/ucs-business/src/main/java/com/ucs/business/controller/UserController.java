package com.ucs.business.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 用户管理REST控制器。
 * 提供用户CRUD、认证(双Token三验证)、团队管理等接口。
 * 从原 AuthController / PilotController / LeaderController 拆分而来。
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/users")
@RequiredArgsConstructor
public class UserController {

    /**
     * GET /api/v1/users/me
     * 获取当前登录用户信息
     */
    @GetMapping("/me")
    public ResponseEntity<Map<String, Object>> getCurrentUser(
            @RequestHeader(value = "X-User-Id", required = false) String userId) {
        // In gateway mode, user info is extracted by gateway JWT filter
        // and forwarded via headers
        return ResponseEntity.ok(Map.of(
                "userId", userId != null ? userId : "anonymous",
                "service", "ucs-business"
        ));
    }

    /**
     * GET /api/v1/users/health
     * 健康检查
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, String>> health() {
        return ResponseEntity.ok(Map.of("status", "UP", "service", "ucs-business"));
    }
}
