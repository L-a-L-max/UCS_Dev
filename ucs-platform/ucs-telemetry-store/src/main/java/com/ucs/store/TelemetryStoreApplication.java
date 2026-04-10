package com.ucs.store;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 遥测存储微服务入口。
 * 职责：Kafka批量消费 telemetry.raw → TimescaleDB batchUpdate 持久化
 */
@SpringBootApplication(scanBasePackages = {"com.ucs.store", "com.ucs.common"})
@EnableScheduling
public class TelemetryStoreApplication {
    public static void main(String[] args) {
        SpringApplication.run(TelemetryStoreApplication.class, args);
    }
}
