package com.ucs.business.strategy.gateway;

import com.ucs.business.entity.Drone;
import com.ucs.business.repository.DroneRepository;
import com.ucs.common.strategy.gateway.GatewayStrategy;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * T-03: Gateway router — resolves and routes to the corresponding gateway strategy based on drone identifier.
 *
 * Routing priority:
 *   1. Database gateway_type field (if set)
 *   2. Each strategy's supports(uavId) method (prefix-based matching)
 *   3. Default to DDS strategy
 *
 * Usage:
 *   GatewayStrategy strategy = gatewayRouter.resolve(uavId);
 *   strategy.sendCommand(uavId, "TAKEOFF", params, userId, cmdLogId);
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class GatewayRouter {

    private final List<GatewayStrategy> strategies;
    private final DroneRepository droneRepository;

    /** Strategy type cache: gatewayType -> Strategy */
    private final Map<String, GatewayStrategy> strategyMap = new ConcurrentHashMap<>();

    /** uavId -> strategy cache (avoid querying DB each time) */
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
     * Resolve the corresponding gateway strategy for a given uavId.
     *
     * @param uavId drone unique identifier
     * @return corresponding GatewayStrategy instance, never returns null
     */
    public GatewayStrategy resolve(String uavId) {
        // 1. Cache lookup
        GatewayStrategy cached = uavCache.get(uavId);
        if (cached != null) {
            return cached;
        }

        // 2. Database lookup for gateway_type
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

        // 3. Match by supports()
        for (GatewayStrategy strategy : strategies) {
            if (strategy.supports(uavId)) {
                uavCache.put(uavId, strategy);
                log.debug("[GatewayRouter] Resolved {} -> {} (by supports())",
                        uavId, strategy.getGatewayType());
                return strategy;
            }
        }

        // 4. Default DDS
        GatewayStrategy defaultStrategy = strategyMap.getOrDefault("DDS", strategies.get(0));
        uavCache.put(uavId, defaultStrategy);
        log.warn("[GatewayRouter] No strategy matched for {}, using default: {}",
                uavId, defaultStrategy.getGatewayType());
        return defaultStrategy;
    }

    /**
     * Clear strategy cache for a specific drone (when gateway_type changes).
     */
    public void invalidateCache(String uavId) {
        uavCache.remove(uavId);
    }

    /**
     * Clear all strategy caches.
     */
    public void invalidateAllCache() {
        uavCache.clear();
    }

    /**
     * Get all registered gateway types.
     */
    public Set<String> getRegisteredGatewayTypes() {
        return strategyMap.keySet();
    }
}
