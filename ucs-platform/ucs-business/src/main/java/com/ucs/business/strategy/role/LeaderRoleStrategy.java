package com.ucs.business.strategy.role;

import com.ucs.common.strategy.role.RolePermissionStrategy;
import org.springframework.stereotype.Component;

import java.util.Set;

/**
 * T-29: Leader (LEADER) role permission strategy.
 *
 * Leader manages team drones and members:
 *   - Control drones within the team
 *   - Transfer drone control rights to team members
 *   - View team telemetry data
 *   - Manage team members (no cross-team operations)
 *   - Cannot modify system settings
 */
@Component
public class LeaderRoleStrategy implements RolePermissionStrategy {

    private static final Set<String> ALLOWED_ACTIONS = Set.of(
            "CONTROL_DRONE", "VIEW_TELEMETRY", "TRANSFER_PERMISSION",
            "MANAGE_TEAM", "ASSIGN_TASK", "VIEW_MAP",
            "VIEW_DASHBOARD", "VIEW_MONITOR"
    );

    @Override
    public String getRoleName() {
        return "LEADER";
    }

    @Override
    public String getDisplayName() {
        return "队长";
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
        return Set.of(
                "dashboard", "map", "control", "team", "task", "monitor"
        );
    }
}
