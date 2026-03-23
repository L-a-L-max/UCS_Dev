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
import java.util.List;
import java.util.stream.Collectors;

/**
 * JWT 认证过滤器 — 三验证流程。
 *
 * 对每个请求执行：
 * 1. 签名验证（HMAC-SHA，在 extractAllClaims 内部完成）
 * 2. 过期验证（exp 时间戳）
 * 3. 黑名单验证（Redis 查询）
 *
 * 仅接受 Access Token（tokenType=access），Refresh Token 不允许用于接口鉴权。
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
