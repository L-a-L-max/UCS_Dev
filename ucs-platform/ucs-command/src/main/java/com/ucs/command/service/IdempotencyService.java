package com.ucs.command.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;

/**
 * T-50: 命令幂等性服务 — Redis SETNX 实现。
 * <p>
 * 每条控制命令携带唯一 requestId，通过 Redis SETNX 判断是否已处理过。
 * TTL 默认 10 分钟，过期后允许相同 requestId 重新提交。
 * </p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class IdempotencyService {

    private static final String KEY_PREFIX = "cmd:idempotent:";
    private static final Duration DEFAULT_TTL = Duration.ofMinutes(10);

    private final StringRedisTemplate stringRedisTemplate;

    /**
     * 尝试获取幂等锁。
     *
     * @param requestId 请求唯一标识
     * @return true = 首次请求（允许执行）; false = 重复请求（应拒绝）
     */
    public boolean tryAcquire(String requestId) {
        if (requestId == null || requestId.isBlank()) {
            return true; // 未提供 requestId 则不做幂等检查
        }
        String key = KEY_PREFIX + requestId;
        Boolean result = stringRedisTemplate.opsForValue()
                .setIfAbsent(key, "1", DEFAULT_TTL);
        if (Boolean.TRUE.equals(result)) {
            log.debug("[Idempotency] Acquired lock for requestId={}", requestId);
            return true;
        }
        log.warn("[Idempotency] Duplicate request rejected: requestId={}", requestId);
        return false;
    }

    /**
     * 主动释放幂等锁（用于命令执行失败时允许重试）。
     */
    public void release(String requestId) {
        if (requestId != null && !requestId.isBlank()) {
            stringRedisTemplate.delete(KEY_PREFIX + requestId);
            log.debug("[Idempotency] Released lock for requestId={}", requestId);
        }
    }
}
