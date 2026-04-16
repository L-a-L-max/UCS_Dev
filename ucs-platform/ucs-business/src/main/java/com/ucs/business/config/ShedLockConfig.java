package com.ucs.business.config;

import net.javacrumbs.shedlock.core.LockProvider;
import net.javacrumbs.shedlock.provider.redis.spring.RedisLockProvider;
import net.javacrumbs.shedlock.spring.annotation.EnableSchedulerLock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * T-45: ShedLock 分布式定时任务锁配置。
 * <p>
 * 多实例部署时，Spring @Scheduled 会在每个实例上各执行一次。
 * ShedLock 使用 Redis 作为分布式锁提供者，确保同一时刻只有一个实例执行该任务。
 * </p>
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
