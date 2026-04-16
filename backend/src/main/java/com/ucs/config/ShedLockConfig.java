package com.ucs.config;

import net.javacrumbs.shedlock.core.LockProvider;
import net.javacrumbs.shedlock.provider.redis.spring.RedisLockProvider;
import net.javacrumbs.shedlock.spring.annotation.EnableSchedulerLock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * T-45: ShedLock 分布式定时任务锁配置。
 *
 * 问题：多实例部署时，@Scheduled 任务会在每个实例上各执行一次，
 *       导致重复广播、重复对账、重复天气刷新等问题。
 *
 * 方案：使用 ShedLock + Redis 实现分布式锁，
 *       同一时刻只有一个实例能获得锁并执行任务，其余实例跳过。
 *
 * 锁存储：Redis（复用现有 Redis 集群连接）
 * 锁键前缀：shedlock:{taskName}
 * 默认锁时长：lockAtMostFor — 任务最长持有锁时间（防止死锁）
 *              lockAtLeastFor — 任务最短持有锁时间（防止跨实例快速重复执行）
 */
@Configuration
@EnableScheduling
@EnableSchedulerLock(defaultLockAtMostFor = "10m")
public class ShedLockConfig {

    @Bean
    public LockProvider lockProvider(RedisConnectionFactory connectionFactory) {
        return new RedisLockProvider(connectionFactory, "ucs", "shedlock");
    }
}
