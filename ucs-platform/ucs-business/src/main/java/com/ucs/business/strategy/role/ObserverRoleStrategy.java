package com.ucs.business.strategy.role;

import com.ucs.common.strategy.role.RolePermissionStrategy;
import org.springframework.stereotype.Component;

import java.util.Set;

/**
 * T-29: Observer (OBSERVER) role permission strategy.
 *
 * Observer has read-only permissions:
 *   - View map and drone positions
 *   - View telemetry data
 *   - View dashboard
 *   - Cannot control any drones
 *   - Cannot manage teams or tasks
 *   - Cannot modify any data
 *
 * Typical scenarios: supervisory personnel, client demos, training observation.
 */
@Component
public class ObserverRoleStrategy implements RolePermissionStrategy {

    @Override
    public String getRoleName() {
        return "OBSERVER";
    }

    @Override
    public String getDisplayName() {
        return "观察者";
    }

    @Override
    public boolean hasPermission(String action) {
        if (action == null) return false;
        return action.startsWith("VIEW_") || action.startsWith("READ_");
    }

    @Override
    public Set<String> getAllowedMenus() {
        return Set.of("dashboard", "map");
    }
}
