package com.ucs.gateway.filter;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import java.util.List;
import java.util.stream.Collectors;

/**
 * API Gateway JWT鉴权全局过滤器。
 * <p>
 * T-46: 支持 RSA-256 非对称密钥验证 + HMAC-SHA 降级。
 * 在网关层统一校验 Access Token，通过后将用户信息写入请求头转发给下游微服务。
 * 白名单路径（登录/注册/刷新/健康检查）跳过校验。
 * </p>
 */
@Slf4j
@Component
public class JwtAuthGatewayFilter implements GlobalFilter, Ordered {

    @Value("${jwt.secret:change-me-in-production}")
    private String jwtSecret;

    /** RSA 公钥（Base64 PEM）— 可选，配置后优先使用 RSA 验证 */
    @Value("${jwt.rsa.public-key:}")
    private String rsaPublicKeyBase64;

    private PublicKey rsaPublicKey;
    private boolean useRsa = false;

    @PostConstruct
    public void init() {
        if (rsaPublicKeyBase64 != null && !rsaPublicKeyBase64.isBlank()) {
            try {
                String cleaned = rsaPublicKeyBase64
                        .replace("-----BEGIN PUBLIC KEY-----", "")
                        .replace("-----END PUBLIC KEY-----", "")
                        .replaceAll("\\s+", "");
                byte[] decoded = Base64.getDecoder().decode(cleaned);
                this.rsaPublicKey = KeyFactory.getInstance("RSA")
                        .generatePublic(new X509EncodedKeySpec(decoded));
                this.useRsa = true;
                log.info("[Gateway] RSA public key loaded — using RS256 verification");
            } catch (Exception e) {
                log.warn("[Gateway] Failed to load RSA public key, falling back to HMAC: {}", e.getMessage());
            }
        } else {
            log.info("[Gateway] RSA key not configured — using HMAC-SHA verification");
        }
    }

    /** 白名单路径 — 不需要JWT校验 */
    private static final List<String> WHITE_LIST = List.of(
            "/api/v1/auth/login",
            "/api/v1/auth/register",
            "/api/v1/auth/refresh",
            "/api/v1/dds-gateway",   // DDS Gateway 使用 X-Gateway-Key 认证，不走JWT
            "/api/v1/public",        // 公共接口（地理编码等），无需认证
            "/api/v1/map",           // 地图瓦片代理，无需认证
            "/api/v1/telemetry",     // 遥测数据查询，内部服务调用
            "/actuator",             // Spring Boot Actuator 健康检查等
            "/ws"
    );

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getURI().getPath();

        // Skip whitelist paths
        for (String white : WHITE_LIST) {
            if (path.startsWith(white)) {
                return chain.filter(exchange);
            }
        }

        // Extract Authorization header
        String authHeader = exchange.getRequest().getHeaders().getFirst(HttpHeaders.AUTHORIZATION);
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            log.warn("[Gateway] Missing or invalid Authorization header for path: {}", path);
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }

        String token = authHeader.substring(7);
        try {
            var parserBuilder = Jwts.parser();
            if (useRsa) {
                parserBuilder.verifyWith(rsaPublicKey);
            } else {
                parserBuilder.verifyWith(getSigningKey());
            }
            Claims claims = parserBuilder
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();

            String username = claims.getSubject();
            String tokenType = claims.get("tokenType", String.class);

            // Only Access Token can be used for API access
            // 兼容旧 token（没有 tokenType 字段的视为 access）
            if (tokenType != null && !"access".equals(tokenType)) {
                log.warn("[Gateway] Non-access token used for API: path={}, type={}", path, tokenType);
                exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
                return exchange.getResponse().setComplete();
            }

            // Extract userId for downstream services
            Object userIdObj = claims.get("userId");
            String userId = userIdObj != null ? userIdObj.toString() : username;

            // Extract roles for downstream services (critical for Spring Security RBAC)
            @SuppressWarnings("unchecked")
            List<String> roles = claims.get("roles", List.class);
            String rolesHeader = (roles != null && !roles.isEmpty())
                    ? roles.stream().map(Object::toString).collect(Collectors.joining(","))
                    : "";

            // Forward user info to downstream services via headers
            ServerHttpRequest mutatedRequest = exchange.getRequest().mutate()
                    .header("X-User-Id", userId)
                    .header("X-User-Name", username)
                    .header("X-User-Roles", rolesHeader)
                    .header("X-Token-Type", tokenType != null ? tokenType : "access")
                    .build();

            return chain.filter(exchange.mutate().request(mutatedRequest).build());

        } catch (Exception e) {
            log.warn("[Gateway] JWT validation failed for path={}: {}", path, e.getMessage());
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }
    }

    /**
     * 构建签名密钥 — 与 ucs-business JwtUtil.getSigningKey() 保持一致。
     * 短密钥自动补齐到 32 字节，确保 HMAC-SHA256 签名一致。
     */
    private SecretKey getSigningKey() {
        byte[] keyBytes = jwtSecret.getBytes(StandardCharsets.UTF_8);
        if (keyBytes.length < 32) {
            byte[] paddedKey = new byte[32];
            System.arraycopy(keyBytes, 0, paddedKey, 0, keyBytes.length);
            keyBytes = paddedKey;
        }
        return Keys.hmacShaKeyFor(keyBytes);
    }

    @Override
    public int getOrder() {
        return -100; // Execute before other filters
    }
}
