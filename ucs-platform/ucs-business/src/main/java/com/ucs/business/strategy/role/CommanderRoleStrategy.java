package com.ucs.business.strategy.role;

import com.ucs.common.strategy.role.RolePermissionStrategy;
import org.springframework.stereotype.Component;

import java.util.Set;

/**
 * T-29: Commander (COMMANDER) role permission strategy.
 *
 * Commander has the highest system privileges:
 *   - Control all drones (no partition restrictions)
 *   - Manage all teams
 *   - Transfer drone control rights
 *   - Assign and manage tasks
 *   - Modify system settings
 *   - View all telemetry data and logs
 */
@Component
public class CommanderRoleStrategy implements RolePermissionStrategy {

    @Override
    public String getRoleName() {
        return "COMMANDER";
    }

    @Override
    public String getDisplayName() {
        return "指挥官";
    }

    @Override
    public boolean hasPermission(String action) {
        return true; // Commander has all permissions
    }

    @Override
    public Set<String> getAllowedMenus() {
        return Set.of(
                "dashboard", "map", "control", "team",
                "task", "permission", "monitor", "settings"
        );
    }
}
