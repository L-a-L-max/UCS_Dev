package com.ucs.business.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

/**
 * JWT 认证过滤器 — 双模式认证。
 *
 * <h3>模式 1: 网关转发头（优先）</h3>
 * API Gateway 已经完成 JWT 校验，将用户信息通过 X-User-Id / X-User-Name / X-User-Roles 头转发。
 * 业务服务直接信任这些头，无需重复解析 JWT。
 *
 * <h3>模式 2: JWT 直接解析（降级）</h3>
 * 如果没有网关转发头（如直连业务服务调试），则走原来的 JWT 三验证流程：
 * 1. 签名验证（HMAC-SHA）
 * 2. 过期验证（exp 时间戳）
 * 3. 黑名单验证（Redis 查询）
 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtUtil jwtUtil;

    public JwtAuthenticationFilter(JwtUtil jwtUtil) {
        this.jwtUtil = jwtUtil;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {

        // 已认证则跳过
        if (SecurityContextHolder.getContext().getAuthentication() != null) {
            filterChain.doFilter(request, response);
            return;
        }

        // ======== 模式 1: 网关转发头（优先） ========
        // API Gateway 已验证 JWT，通过 X-User-* 头转发用户信息
        String gatewayUserId = request.getHeader("X-User-Id");
        String gatewayUsername = request.getHeader("X-User-Name");
        String gatewayRoles = request.getHeader("X-User-Roles");

        if (gatewayUsername != null && !gatewayUsername.isEmpty()
                && gatewayRoles != null && !gatewayRoles.isEmpty()) {

            Long userId;
            try {
                userId = Long.parseLong(gatewayUserId);
            } catch (NumberFormatException e) {
                userId = 0L;
            }

            List<String> roles = Arrays.stream(gatewayRoles.split(","))
                    .map(String::trim)
                    .filter(r -> !r.isEmpty())
                    .collect(Collectors.toList());

            List<SimpleGrantedAuthority> authorities = roles.stream()
                    .map(role -> new SimpleGrantedAuthority("ROLE_" + role.toUpperCase()))
                    .collect(Collectors.toList());

            UserPrincipal principal = new UserPrincipal(userId, gatewayUsername, roles);
            UsernamePasswordAuthenticationToken authToken =
                    new UsernamePasswordAuthenticationToken(principal, null, authorities);
            SecurityContextHolder.getContext().setAuthentication(authToken);

            logger.debug("Authenticated via gateway headers: user=" + gatewayUsername + ", roles=" + roles);
            filterChain.doFilter(request, response);
            return;
        }

        // ======== 模式 2: JWT 直接解析（降级/直连调试） ========
        final String authHeader = request.getHeader("Authorization");

        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            filterChain.doFilter(request, response);
            return;
        }

        try {
            final String jwt = authHeader.substring(7);
            final String username = jwtUtil.extractUsername(jwt);

            if (username != null && SecurityContextHolder.getContext().getAuthentication() == null) {
                // 三验证：签名 + 过期 + 黑名单
                if (jwtUtil.validateToken(jwt, username)) {
                    // 仅 Access Token 可用于接口鉴权（Refresh Token 只能用于刷新）
                    if (jwtUtil.isTokenType(jwt, "access")) {
                        Long userId = jwtUtil.extractUserId(jwt);
                        List<String> roles = jwtUtil.extractRoles(jwt);

                        List<SimpleGrantedAuthority> authorities = roles.stream()
                                .map(role -> new SimpleGrantedAuthority("ROLE_" + role.toUpperCase()))
                                .collect(Collectors.toList());

                        UserPrincipal principal = new UserPrincipal(userId, username, roles);

                        UsernamePasswordAuthenticationToken authToken =
                                new UsernamePasswordAuthenticationToken(principal, null, authorities);

                        SecurityContextHolder.getContext().setAuthentication(authToken);
                    } else {
                        logger.debug("Refresh token used for API access, rejected");
                    }
                }
            }
        } catch (Exception e) {
            logger.error("JWT Authentication failed: " + e.getMessage());
        }

        filterChain.doFilter(request, response);
    }
}
