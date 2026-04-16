package com.ucs.business.strategy.role;

import com.ucs.common.strategy.role.RolePermissionStrategy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * T-29: Role permission strategy router — auto-injects all RolePermissionStrategy implementations.
 *
 * Spring container automatically collects all @Component RolePermissionStrategy implementations
 * and builds a roleName -> strategy mapping table.
 *
 * Usage:
 *   permissionRouter.checkPermission("COMMANDER", "CONTROL_DRONE")  -> true
 *   permissionRouter.checkPermission("OBSERVER", "CONTROL_DRONE")   -> false
 *   permissionRouter.getAllowedMenus("PILOT")                        -> {"dashboard","map","control","task"}
 */
@Slf4j
@Component
public class PermissionStrategyRouter {

    private final Map<String, RolePermissionStrategy> strategyMap;

    public PermissionStrategyRouter(List<RolePermissionStrategy> strategies) {
        this.strategyMap = strategies.stream()
                .collect(Collectors.toMap(
                        s -> s.getRoleName().toUpperCase(),
                        s -> s
                ));
        log.info("[T-29] PermissionStrategyRouter initialized with {} role strategies: {}",
                strategyMap.size(), strategyMap.keySet());
    }

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

    public Set<String> getAllowedMenus(String roleName) {
        if (roleName == null) return Set.of();
        RolePermissionStrategy strategy = strategyMap.get(roleName.toUpperCase());
        if (strategy == null) {
            log.warn("[T-29] Unknown role '{}', returning empty menus", roleName);
            return Set.of();
        }
        return strategy.getAllowedMenus();
    }

    public String getDisplayName(String roleName) {
        if (roleName == null) return "未知";
        RolePermissionStrategy strategy = strategyMap.get(roleName.toUpperCase());
        return strategy != null ? strategy.getDisplayName() : roleName;
    }

    public Set<String> getRegisteredRoles() {
        return strategyMap.keySet();
    }
}
