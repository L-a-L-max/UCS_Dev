package com.ucs.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HexFormat;

/**
 * T-50: 控制命令幂等性保障（Redis SETNX）。
 *
 * 问题场景：
 *   - 前端网络抖动导致同一控制命令重复发送（ARM、TAKEOFF、GOTO 等）
 *   - 多实例部署时，同一命令可能被不同实例消费
 *   - 用户快速双击按钮触发重复请求
 *
 * 方案：
 *   1. 对命令关键字段（uavId + commandType + params）计算 SHA-256 哈希
 *   2. 使用 Redis SETNX 尝试写入去重键（TTL = 5s）
 *   3. 如果 SETNX 返回 false，说明命令重复，返回缓存结果
 *
 * 去重窗口：5 秒（同一命令 5 秒内只执行一次）
 */
@Slf4j
@Component
public class IdempotencyConfig {

    private static final String IDEMPOTENCY_PREFIX = "cmd:idempotent:";
    private static final Duration DEDUP_WINDOW = Duration.ofSeconds(5);

    private final StringRedisTemplate stringRedisTemplate;

    public IdempotencyConfig(StringRedisTemplate stringRedisTemplate) {
        this.stringRedisTemplate = stringRedisTemplate;
    }

    /**
     * 尝试获取幂等锁。如果命令在去重窗口内已执行过，返回 false。
     *
     * @param uavId       无人机 ID
     * @param commandType 命令类型（ARM/TAKEOFF/GOTO 等）
     * @param params      命令参数 JSON
     * @return true = 首次执行（获取锁成功），false = 重复命令
     */
    public boolean tryAcquire(String uavId, String commandType, String params) {
        try {
            String hash = computeHash(uavId, commandType, params);
            String key = IDEMPOTENCY_PREFIX + hash;
            Boolean acquired = stringRedisTemplate.opsForValue()
                    .setIfAbsent(key, "1", DEDUP_WINDOW);
            if (Boolean.FALSE.equals(acquired)) {
                log.warn("[Idempotency] Duplicate command rejected: {} {} {}", commandType, uavId, hash);
                return false;
            }
            return true;
        } catch (Exception e) {
            // Redis 故障时放行，不影响正常命令执行
            log.debug("[Idempotency] Redis unavailable, allowing command: {}", e.getMessage());
            return true;
        }
    }

    private String computeHash(String uavId, String commandType, String params) {
        try {
            String raw = uavId + ":" + commandType + ":" + (params != null ? params : "");
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(raw.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest).substring(0, 16); // 前 16 位足够
        } catch (Exception e) {
            return uavId + ":" + commandType; // fallback
        }
    }
}
