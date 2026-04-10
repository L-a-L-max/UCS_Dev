package com.ucs.push;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 实时推送微服务入口。
 * 职责：消费 Kafka telemetry.raw + events.drone → 视口裁剪 + 降采样 → WebSocket STOMP 推送
 */
@SpringBootApplication(scanBasePackages = {"com.ucs.push", "com.ucs.common"})
@EnableScheduling
public class RealtimePushApplication {
    public static void main(String[] args) {
        SpringApplication.run(RealtimePushApplication.class, args);
    }
}
