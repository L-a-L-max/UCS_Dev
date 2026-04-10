package com.ucs.dronestate;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 无人机状态微服务入口。
 * 职责：分区路由缓存(Redis Cluster)、状态查询REST API、懒同步DB
 */
@SpringBootApplication(scanBasePackages = {"com.ucs.dronestate", "com.ucs.common"})
@EnableScheduling
public class DroneStateApplication {
    public static void main(String[] args) {
        SpringApplication.run(DroneStateApplication.class, args);
    }
}
