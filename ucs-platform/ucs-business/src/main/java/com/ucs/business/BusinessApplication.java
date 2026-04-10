package com.ucs.business;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 业务管理微服务入口。
 * 职责：用户/团队/集结点/事件/任务管理、认证鉴权(双Token三验证)
 */
@EnableScheduling
@SpringBootApplication(scanBasePackages = {"com.ucs.business", "com.ucs.common"})
public class BusinessApplication {
    public static void main(String[] args) {
        SpringApplication.run(BusinessApplication.class, args);
    }
}
