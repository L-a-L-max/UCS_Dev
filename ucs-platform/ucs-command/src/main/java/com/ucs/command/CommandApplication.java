package com.ucs.command;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 指令下发微服务入口。
 * 职责：REST接收指令 → Kafka commands.down → Gateway → PX4
 *       消费 Kafka commands.ack → 更新指令状态
 */
@SpringBootApplication(scanBasePackages = {"com.ucs.command", "com.ucs.common"})
@EnableScheduling
public class CommandApplication {
    public static void main(String[] args) {
        SpringApplication.run(CommandApplication.class, args);
    }
}
