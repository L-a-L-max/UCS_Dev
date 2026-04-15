package com.ucs.strategy.role;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * T-29: 角色权限策略路由器 — 自动注入所有 RolePermissionStrategy 实现。
 *
 * Spring容器启动时自动收集所有标注 @Component 的 RolePermissionStrategy 实现类，
 * 构建 roleName → strategy 的映射表。调用方无需关心具体有多少种角色。
 *
 * 使用方式：
 *   permissionRouter.checkPermission("COMMANDER", "CONTROL_DRONE")  → true
 *   permissionRouter.checkPermission("OBSERVER", "CONTROL_DRONE")   → false
 *   permissionRouter.getAllowedMenus("PILOT")                        → {"dashboard","map","control","task"}
 */
@Slf4j
@Component
public class PermissionStrategyRouter {

    private final Map<String, RolePermissionStrategy> strategyMap;

    /**
     * Spring自动注入所有 RolePermissionStrategy 实现类（Commander, Leader, Pilot, Observer等）。
     * 构建 roleName(大写) → strategy 的映射表。
     */
    public PermissionStrategyRouter(List<RolePermissionStrategy> strategies) {
        this.strategyMap = strategies.stream()
                .collect(Collectors.toMap(
                        s -> s.getRoleName().toUpperCase(),
                        s -> s
                ));
        log.info("[T-29] PermissionStrategyRouter initialized with {} role strategies: {}",
                strategyMap.size(), strategyMap.keySet());
    }

    /**
     * 检查指定角色是否有权执行指定操作。
     *
     * @param roleName 角色名称（不区分大小写），如 "COMMANDER", "Leader", "pilot"
     * @param action   操作标识，如 "CONTROL_DRONE", "VIEW_TELEMETRY"
     * @return true=允许, false=拒绝（未知角色默认拒绝）
     */
    public boolean checkPermission(String roleName, String action) {
        if (roleName == null || action == null) {
            return false;
        }
        RolePermissionStrategy strategy = strategyMap.get(roleName.toUpperCase());
        if (strategy == null) {
            log.warn("[T-29] Unknown role '{}', permission denied for action '{}'", roleName, action);
            return false;
        }
        boolean allowed = strategy.hasPermission(action);
        log.debug("[T-29] Permission check: role={}, action={}, result={}",
                roleName, action, allowed ? "ALLOW" : "DENY");
        return allowed;
    }

    /**
     * 获取指定角色可访问的功能菜单列表。
     *
     * @param roleName 角色名称（不区分大小写）
     * @return 菜单标识集合，未知角色返回空集合
     */
    public Set<String> getAllowedMenus(String roleName) {
        if (roleName == null) {
            return Set.of();
        }
        RolePermissionStrategy strategy = strategyMap.get(roleName.toUpperCase());
        if (strategy == null) {
            log.warn("[T-29] Unknown role '{}', returning empty menus", roleName);
            return Set.of();
        }
        return strategy.getAllowedMenus();
    }

    /**
     * 获取指定角色的显示名称。
     *
     * @param roleName 角色名称（不区分大小写）
     * @return 中文显示名称，未知角色返回原始名称
     */
    public String getDisplayName(String roleName) {
        if (roleName == null) return "未知";
        RolePermissionStrategy strategy = strategyMap.get(roleName.toUpperCase());
        return strategy != null ? strategy.getDisplayName() : roleName;
    }

    /**
     * 获取系统中已注册的所有角色名称。
     */
    public Set<String> getRegisteredRoles() {
        return strategyMap.keySet();
    }
}
