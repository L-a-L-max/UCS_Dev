package com.ucs.gateway;

import com.ucs.entity.Drone;
import com.ucs.repository.DroneRepository;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * T-03: 网关路由器 — 根据无人机标识解析并路由到对应的网关策略。
 *
 * 路由优先级：
 *   1. 数据库 gateway_type 字段（如果已设置）
 *   2. 各策略的 supports(uavId) 方法（基于 uavId 前缀匹配）
 *   3. 默认使用 DDS 策略
 *
 * 使用方式：
 *   GatewayStrategy strategy = gatewayRouter.resolve(uavId);
 *   strategy.sendCommand(uavId, "TAKEOFF", params, userId, cmdLogId);
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class GatewayRouter {

    private final List<GatewayStrategy> strategies;
    private final DroneRepository droneRepository;

    /** 策略类型缓存: gatewayType -> Strategy */
    private final Map<String, GatewayStrategy> strategyMap = new ConcurrentHashMap<>();

    /** uavId -> 策略缓存 (避免每次查库) */
    private final Map<String, GatewayStrategy> uavCache = new ConcurrentHashMap<>();

    @PostConstruct
    public void init() {
        for (GatewayStrategy strategy : strategies) {
            strategyMap.put(strategy.getGatewayType().toUpperCase(), strategy);
            log.info("[GatewayRouter] Registered strategy: {} -> {}",
                    strategy.getGatewayType(), strategy.getClass().getSimpleName());
        }
    }

    /**
     * 根据 uavId 解析对应的网关策略。
     *
     * @param uavId 无人机唯一标识
     * @return 对应的 GatewayStrategy 实例，不会返回 null
     */
    public GatewayStrategy resolve(String uavId) {
        // 1. 缓存查找
        GatewayStrategy cached = uavCache.get(uavId);
        if (cached != null) {
            return cached;
        }

        // 2. 数据库查找 gateway_type
        Optional<Drone> droneOpt = droneRepository.findByUavId(uavId);
        if (droneOpt.isPresent()) {
            Drone drone = droneOpt.get();
            String gatewayType = drone.getGatewayType();
            if (gatewayType != null && !gatewayType.isEmpty()) {
                GatewayStrategy byType = strategyMap.get(gatewayType.toUpperCase());
                if (byType != null) {
                    uavCache.put(uavId, byType);
                    return byType;
                }
            }
        }

        // 3. 按 supports() 匹配
        for (GatewayStrategy strategy : strategies) {
            if (strategy.supports(uavId)) {
                uavCache.put(uavId, strategy);
                log.debug("[GatewayRouter] Resolved {} -> {} (by supports())",
                        uavId, strategy.getGatewayType());
                return strategy;
            }
        }

        // 4. 默认 DDS
        GatewayStrategy defaultStrategy = strategyMap.getOrDefault("DDS", strategies.get(0));
        uavCache.put(uavId, defaultStrategy);
        log.warn("[GatewayRouter] No strategy matched for {}, using default: {}",
                uavId, defaultStrategy.getGatewayType());
        return defaultStrategy;
    }

    /**
     * 清除指定无人机的策略缓存（当 gateway_type 变更时调用）。
     */
    public void invalidateCache(String uavId) {
        uavCache.remove(uavId);
    }

    /**
     * 清除所有策略缓存。
     */
    public void invalidateAllCache() {
        uavCache.clear();
    }
}
