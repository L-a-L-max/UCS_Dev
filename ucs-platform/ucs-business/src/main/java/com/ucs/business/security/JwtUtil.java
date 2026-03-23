package com.ucs.business.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;

/**
 * JWT 工具类 — 双 Token 三验证。
 *
 * <h3>双 Token</h3>
 * <ul>
 *   <li><b>Access Token</b> — 短命（默认 15 分钟），用于接口鉴权</li>
 *   <li><b>Refresh Token</b> — 长命（默认 7 天），仅用于刷新 Access Token</li>
 * </ul>
 *
 * <h3>三验证</h3>
 * <ol>
 *   <li><b>签名验证</b> — HMAC-SHA512，确保 token 未被篡改</li>
 *   <li><b>过期验证</b> — 检查 exp 时间戳</li>
 *   <li><b>黑名单验证</b> — Redis 中查询 token 是否已被注销</li>
 * </ol>
 */
@Slf4j
@Component
public class JwtUtil {

    @Value("${jwt.secret:change-me-in-production}")
    private String secret;

    /** Access Token 有效期，默认 30 分钟 */
    @Value("${jwt.access-token.expiration:1800000}")
    private Long accessTokenExpiration;

    /** Refresh Token 有效期，默认 7 天 */
    @Value("${jwt.refresh-token.expiration:604800000}")
    private Long refreshTokenExpiration;

    /** 向后兼容：旧配置项映射到 accessTokenExpiration */
    @Value("${jwt.expiration:0}")
    private Long legacyExpiration;

    private static final String TOKEN_BLACKLIST_PREFIX = "token:blacklist:";

    private final StringRedisTemplate stringRedisTemplate;

    public JwtUtil(StringRedisTemplate stringRedisTemplate) {
        this.stringRedisTemplate = stringRedisTemplate;
    }

    // ======================== Key ========================

    private SecretKey getSigningKey() {
        byte[] keyBytes = secret.getBytes(StandardCharsets.UTF_8);
        if (keyBytes.length < 32) {
            byte[] paddedKey = new byte[32];
            System.arraycopy(keyBytes, 0, paddedKey, 0, keyBytes.length);
            keyBytes = paddedKey;
        }
        return Keys.hmacShaKeyFor(keyBytes);
    }

    // ======================== 生成 Token ========================

    /**
     * 生成 Access Token（短命）。
     */
    public String generateAccessToken(Long userId, String username, List<String> roles) {
        long exp = (legacyExpiration != null && legacyExpiration > 0)
                ? legacyExpiration : accessTokenExpiration;
        return buildToken(userId, username, roles, "access", exp);
    }

    /**
     * 生成 Refresh Token（长命）。
     */
    public String generateRefreshToken(Long userId, String username, List<String> roles) {
        return buildToken(userId, username, roles, "refresh", refreshTokenExpiration);
    }

    /**
     * 向后兼容的旧方法 — 内部委托到 generateAccessToken。
     */
    public String generateToken(Long userId, String username, List<String> roles) {
        return generateAccessToken(userId, username, roles);
    }

    private String buildToken(Long userId, String username, List<String> roles,
                              String tokenType, long expirationMs) {
        return Jwts.builder()
                .subject(username)
                .claim("userId", userId)
                .claim("roles", roles)
                .claim("tokenType", tokenType)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + expirationMs))
                .signWith(getSigningKey())
                .compact();
    }

    // ======================== 提取 Claims ========================

    public String extractUsername(String token) {
        return extractClaim(token, Claims::getSubject);
    }

    public Long extractUserId(String token) {
        return extractClaim(token, claims -> claims.get("userId", Long.class));
    }

    @SuppressWarnings("unchecked")
    public List<String> extractRoles(String token) {
        return extractClaim(token, claims -> claims.get("roles", List.class));
    }

    public String extractTokenType(String token) {
        return extractClaim(token, claims -> claims.get("tokenType", String.class));
    }

    public <T> T extractClaim(String token, Function<Claims, T> claimsResolver) {
        final Claims claims = extractAllClaims(token);
        return claimsResolver.apply(claims);
    }

    private Claims extractAllClaims(String token) {
        return Jwts.parser()
                .verifyWith(getSigningKey())     // 验证 1: 签名验证 (HMAC-SHA)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    // ======================== 验证 Token ========================

    public Boolean isTokenExpired(String token) {
        return extractExpiration(token).before(new Date());
    }

    public Date extractExpiration(String token) {
        return extractClaim(token, Claims::getExpiration);
    }

    /**
     * 三验证：签名 + 过期 + 黑名单。
     *
     * @param token    JWT token 字符串
     * @param username 期望的用户名
     * @return true = 通过所有验证
     */
    public Boolean validateToken(String token, String username) {
        // 验证 1: 签名验证 — extractAllClaims 内部已校验
        final String extractedUsername = extractUsername(token);
        if (!extractedUsername.equals(username)) {
            return false;
        }
        // 验证 2: 过期验证
        if (isTokenExpired(token)) {
            return false;
        }
        // 验证 3: 黑名单验证
        if (isTokenBlacklisted(token)) {
            log.debug("Token rejected: blacklisted for user {}", username);
            return false;
        }
        return true;
    }

    /**
     * 验证 token 是否为指定类型（access / refresh）。
     */
    public boolean isTokenType(String token, String expectedType) {
        String tokenType = extractTokenType(token);
        // 兼容旧 token（没有 tokenType 字段的视为 access）
        if (tokenType == null) {
            return "access".equals(expectedType);
        }
        return expectedType.equals(tokenType);
    }

    // ======================== 黑名单 (Redis) ========================

    /**
     * 将 token 加入黑名单（用于注销/刷新场景）。
     * TTL = token 剩余有效时间，到期后自动清除。
     */
    public void blacklistToken(String token) {
        try {
            Date expiration = extractExpiration(token);
            long ttlMs = expiration.getTime() - System.currentTimeMillis();
            if (ttlMs > 0) {
                String key = TOKEN_BLACKLIST_PREFIX + token;
                stringRedisTemplate.opsForValue().set(key, "1", ttlMs, TimeUnit.MILLISECONDS);
                log.info("Token blacklisted, TTL={}ms", ttlMs);
            }
        } catch (Exception e) {
            log.warn("Failed to blacklist token: {}", e.getMessage());
        }
    }

    /**
     * 检查 token 是否在黑名单中。
     */
    public boolean isTokenBlacklisted(String token) {
        try {
            String key = TOKEN_BLACKLIST_PREFIX + token;
            return Boolean.TRUE.equals(stringRedisTemplate.hasKey(key));
        } catch (Exception e) {
            // Redis 不可用时放行，避免影响正常使用
            log.debug("Redis unavailable for blacklist check, allowing token");
            return false;
        }
    }
}
