package com.ucs.business.strategy.role;

import com.ucs.common.strategy.role.RolePermissionStrategy;
import org.springframework.stereotype.Component;

import java.util.Set;

/**
 * T-29: Pilot (PILOT) role permission strategy.
 *
 * Pilot operates assigned drones:
 *   - Control drones assigned to them
 *   - View team telemetry data
 *   - View map
 *   - Cannot transfer control rights
 *   - Cannot manage teams
 *   - Cannot modify system settings
 */
@Component
public class PilotRoleStrategy implements RolePermissionStrategy {

    private static final Set<String> ALLOWED_ACTIONS = Set.of(
            "CONTROL_DRONE", "VIEW_TELEMETRY", "VIEW_MAP",
            "VIEW_DASHBOARD", "VIEW_MONITOR", "EXECUTE_TASK"
    );

    @Override
    public String getRoleName() {
        return "PILOT";
    }

    @Override
    public String getDisplayName() {
        return "队员";
    }

    @Override
    public boolean hasPermission(String action) {
        if (action == null) return false;
        if (action.startsWith("VIEW_") || action.startsWith("READ_")) {
            return true;
        }
        return ALLOWED_ACTIONS.contains(action);
    }

    @Override
    public Set<String> getAllowedMenus() {
        return Set.of("dashboard", "map", "control", "task");
    }
}
