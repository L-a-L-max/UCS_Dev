package com.ucs.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;

import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;

/**
 * T-21: 线程池隔离配置
 *
 * 将原先共享的5线程调度池拆分为独立的业务线程池：
 * - telemetryProcessorPool: 遥测数据处理（CPU密集型，核心8线程，最大32线程）
 * - websocketPushPool: WebSocket推送（IO密集型，核心4线程，最大16线程）
 *
 * 隔离的目的是防止某一类任务（如遥测处理突增）占满所有线程，
 * 导致其他关键任务（如WebSocket推送）被饿死。
 */
@Configuration
@EnableAsync
public class ThreadPoolConfig {

    /**
     * 遥测数据处理线程池
     * - 核心线程: 8（保证基本处理能力）
     * - 最大线程: 32（应对突发流量）
     * - 队列容量: 1024（缓冲峰值，超出后丢弃最旧的遥测数据）
     * - 拒绝策略: DiscardOldestPolicy（丢弃队列中最旧的遥测数据，保证最新数据优先处理）
     */
    @Bean("telemetryProcessorPool")
    public Executor telemetryProcessorPool() {
        org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor executor =
                new org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor();
        executor.setCorePoolSize(8);
        executor.setMaxPoolSize(32);
        executor.setQueueCapacity(1024);
        executor.setThreadNamePrefix("telemetry-proc-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.DiscardOldestPolicy());
        executor.setKeepAliveSeconds(60);
        executor.setAllowCoreThreadTimeOut(true);
        executor.initialize();
        return executor;
    }

    /**
     * WebSocket推送线程池
     * - 核心线程: 4（WebSocket推送为IO密集型，不需要太多CPU）
     * - 最大线程: 16（应对大量客户端连接时的推送压力）
     * - 队列容量: 512（缓冲推送任务）
     * - 拒绝策略: CallerRunsPolicy（推送队列满时由调用线程执行，保证消息不丢失）
     */
    @Bean("websocketPushPool")
    public Executor websocketPushPool() {
        org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor executor =
                new org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(16);
        executor.setQueueCapacity(512);
        executor.setThreadNamePrefix("ws-push-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.setKeepAliveSeconds(60);
        executor.setAllowCoreThreadTimeOut(true);
        executor.initialize();
        return executor;
    }
}
