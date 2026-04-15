package com.ucs.strategy.map;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * T-30: 地图提供商策略路由器 — 自动注入所有 MapProviderStrategy 实现。
 *
 * Spring容器启动时自动收集所有激活的 MapProviderStrategy 实现类
 * （通过 @ConditionalOnProperty 控制哪些提供商被激活）。
 *
 * 注意：由于使用了 @ConditionalOnProperty，通常只会有一个提供商被激活。
 * 但路由器设计为支持多提供商共存的场景（例如国内使用高德、海外使用Google）。
 *
 * 使用方式：
 *   mapRouter.getActiveProvider()                           → AmapProviderStrategy
 *   mapRouter.getTileUrl("AMAP", 215, 99, 8, "normal")     → "https://webrd01..."
 *   mapRouter.getProvider("GOOGLE")                         → GoogleMapsProviderStrategy (if active)
 */
@Slf4j
@Component
public class MapProviderRouter {

    private final Map<String, MapProviderStrategy> strategyMap;
    private final MapProviderStrategy defaultProvider;

    /**
     * Spring自动注入所有激活的 MapProviderStrategy 实现类。
     * 第一个注入的策略作为默认提供商。
     */
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

    /**
     * 获取当前激活的默认地图提供商。
     */
    public MapProviderStrategy getActiveProvider() {
        return defaultProvider;
    }

    /**
     * 根据提供商名称获取策略实例。
     *
     * @param providerName 提供商名称（不区分大小写）
     * @return 策略实例，未找到返回默认提供商
     */
    public MapProviderStrategy getProvider(String providerName) {
        if (providerName == null) return defaultProvider;
        MapProviderStrategy strategy = strategyMap.get(providerName.toUpperCase());
        if (strategy == null) {
            log.warn("[T-30] Map provider '{}' not found, falling back to default '{}'",
                    providerName, defaultProvider != null ? defaultProvider.getProviderName() : "NONE");
            return defaultProvider;
        }
        return strategy;
    }

    /**
     * 生成瓦片URL（使用默认提供商）。
     */
    public String getTileUrl(int x, int y, int z, String style) {
        if (defaultProvider == null) {
            throw new IllegalStateException("No map provider configured");
        }
        return defaultProvider.getTileUrl(x, y, z, style);
    }

    /**
     * 生成指定提供商的瓦片URL。
     */
    public String getTileUrl(String providerName, int x, int y, int z, String style) {
        MapProviderStrategy provider = getProvider(providerName);
        if (provider == null) {
            throw new IllegalStateException("No map provider found for: " + providerName);
        }
        return provider.getTileUrl(x, y, z, style);
    }

    /**
     * 获取所有已注册的提供商名称。
     */
    public Set<String> getRegisteredProviders() {
        return strategyMap.keySet();
    }
}
