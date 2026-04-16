package com.ucs.business.strategy.map;

import com.ucs.common.strategy.map.MapProviderStrategy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * T-30: Map provider strategy router — auto-injects all MapProviderStrategy implementations.
 *
 * Supports multi-provider coexistence (e.g., domestic AMap, overseas Google).
 *
 * Usage:
 *   mapRouter.getActiveProvider()                           -> AmapProviderStrategy
 *   mapRouter.getTileUrl("AMAP", 215, 99, 8, "normal")     -> "https://webrd01..."
 */
@Slf4j
@Component
public class MapProviderRouter {

    private final Map<String, MapProviderStrategy> strategyMap;
    private final MapProviderStrategy defaultProvider;

    public MapProviderRouter(List<MapProviderStrategy> strategies) {
        this.strategyMap = strategies.stream()
                .collect(Collectors.toMap(
                        s -> s.getProviderName().toUpperCase(),
                        s -> s
                ));
        this.defaultProvider = strategies.isEmpty() ? null : strategies.get(0);
        log.info("[T-30] MapProviderRouter initialized with {} providers: {}, default={}",
                strategyMap.size(), strategyMap.keySet(),
                defaultProvider != null ? defaultProvider.getProviderName() : "NONE");
    }

    public MapProviderStrategy getActiveProvider() {
        return defaultProvider;
    }

    public MapProviderStrategy getProvider(String providerName) {
        if (providerName == null) return defaultProvider;
        MapProviderStrategy strategy = strategyMap.get(providerName.toUpperCase());
        if (strategy == null) {
            log.warn("[T-30] Map provider '{}' not found, falling back to default", providerName);
            return defaultProvider;
        }
        return strategy;
    }

    public String getTileUrl(int x, int y, int z, String style) {
        if (defaultProvider == null) {
            throw new IllegalStateException("No map provider configured");
        }
        return defaultProvider.getTileUrl(x, y, z, style);
    }

    public String getTileUrl(String providerName, int x, int y, int z, String style) {
        MapProviderStrategy provider = getProvider(providerName);
        if (provider == null) {
            throw new IllegalStateException("No map provider found for: " + providerName);
        }
        return provider.getTileUrl(x, y, z, style);
    }

    public Set<String> getRegisteredProviders() {
        return strategyMap.keySet();
    }
}
