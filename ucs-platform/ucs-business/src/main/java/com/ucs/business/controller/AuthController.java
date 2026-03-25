package com.ucs.business.controller;

import com.ucs.business.dto.ApiResponse;
import com.ucs.business.dto.LoginRequest;
import com.ucs.business.dto.LoginResponse;
import com.ucs.business.security.JwtUtil;
import com.ucs.business.service.AuthService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 认证控制器 — 双 Token 三验证。
 *
 * 提供：
 * - POST /login    → 登录，返回 accessToken + refreshToken
 * - POST /refresh  → 用 refreshToken 刷新 accessToken
 * - POST /logout   → 注销，将当前 token 加入黑名单
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
@Tag(name = "Authentication", description = "双 Token 三验证认证接口")
public class AuthController {

    private final AuthService authService;
    private final JwtUtil jwtUtil;

    @PostMapping("/login")
    @Operation(summary = "用户登录", description = "返回 accessToken（短命） + refreshToken（长命）")
    public ApiResponse<LoginResponse> login(@Valid @RequestBody LoginRequest request) {
        try {
            LoginResponse response = authService.login(request);
            return ApiResponse.success(response);
        } catch (Exception e) {
            return ApiResponse.error(-1, e.getMessage());
        }
    }

    /**
     * 刷新 Access Token。
     *
     * 前端在 accessToken 过期后，携带 refreshToken 调用此接口获取新的 accessToken。
     * 旧的 accessToken 不需要主动黑名单（已过期）。
     *
     * 请求体: { "refreshToken": "eyJhbGci..." }
     */
    @PostMapping("/refresh")
    @Operation(summary = "刷新 Access Token", description = "用 Refresh Token 换取新的 Access Token")
    public ApiResponse<Map<String, String>> refresh(@RequestBody Map<String, String> body) {
        try {
            String refreshToken = body.get("refreshToken");
            if (refreshToken == null || refreshToken.isBlank()) {
                return ApiResponse.error(-1, "refreshToken is required");
            }

            // 三验证 refresh token
            String username = jwtUtil.extractUsername(refreshToken);
            if (!jwtUtil.validateToken(refreshToken, username)) {
                return ApiResponse.error(-1, "Invalid or expired refresh token");
            }

            // 确认是 refresh 类型
            if (!jwtUtil.isTokenType(refreshToken, "refresh")) {
                return ApiResponse.error(-1, "Not a refresh token");
            }

            // 提取用户信息，生成新的 access token
            Long userId = jwtUtil.extractUserId(refreshToken);
            List<String> roles = jwtUtil.extractRoles(refreshToken);
            String newAccessToken = jwtUtil.generateAccessToken(userId, username, roles);

            log.info("[Auth] Token refreshed for user: {}", username);

            return ApiResponse.success(Map.of(
                    "token", newAccessToken,
                    "username", username
            ));
        } catch (Exception e) {
            log.warn("[Auth] Token refresh failed: {}", e.getMessage());
            return ApiResponse.error(-1, "Token refresh failed: " + e.getMessage());
        }
    }

    /**
     * 用户注销。
     *
     * 将当前 Access Token 加入 Redis 黑名单，剩余有效期内不可再用。
     * 前端同时应清除本地存储的 accessToken 和 refreshToken。
     */
    @PostMapping("/logout")
    @Operation(summary = "用户注销", description = "将当前 token 加入黑名单")
    public ApiResponse<String> logout(HttpServletRequest request) {
        try {
            String authHeader = request.getHeader("Authorization");
            if (authHeader != null && authHeader.startsWith("Bearer ")) {
                String token = authHeader.substring(7);
                jwtUtil.blacklistToken(token);
                log.info("[Auth] User logged out, token blacklisted");
            }

            // 如果请求体中也带了 refreshToken，同时黑名单
            // (前端可选传递)
            return ApiResponse.success("Logged out successfully");
        } catch (Exception e) {
            log.warn("[Auth] Logout failed: {}", e.getMessage());
            return ApiResponse.error(-1, "Logout failed: " + e.getMessage());
        }
    }
}
