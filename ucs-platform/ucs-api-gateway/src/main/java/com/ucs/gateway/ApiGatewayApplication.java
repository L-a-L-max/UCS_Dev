package com.ucs.gateway;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * 统一API网关入口。
 * 职责：路由分发 + JWT鉴权 + 请求限流
 * 基于 Spring Cloud Gateway (WebFlux)
 */
@SpringBootApplication(scanBasePackages = {"com.ucs.gateway"})
public class ApiGatewayApplication {
    public static void main(String[] args) {
        SpringApplication.run(ApiGatewayApplication.class, args);
    }
}
