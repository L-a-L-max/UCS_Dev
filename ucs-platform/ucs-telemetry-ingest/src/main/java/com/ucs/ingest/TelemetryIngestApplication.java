package com.ucs.ingest;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 遥测接入微服务入口。
 * 职责：消费 Kafka telemetry.raw → Epoch校验 → 更新Redis状态 + GeoHash索引
 */
@SpringBootApplication(scanBasePackages = {"com.ucs.ingest", "com.ucs.common"})
@EnableScheduling
public class TelemetryIngestApplication {
    public static void main(String[] args) {
        SpringApplication.run(TelemetryIngestApplication.class, args);
    }
}
