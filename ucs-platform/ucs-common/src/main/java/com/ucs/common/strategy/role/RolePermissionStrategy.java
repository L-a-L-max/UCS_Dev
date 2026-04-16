package com.ucs.common.strategy.role;

import java.util.Set;

/**
 * T-29: Role permission strategy interface — Strategy Pattern.
 *
 * Decouples role permission logic from if/else chains in PermissionService.
 * Each role is encapsulated as an independent strategy class.
 * Adding a new role only requires creating an implementation class, following OCP.
 *
 * Current role hierarchy:
 *   - COMMANDER: Full permissions, control all drones, manage teams, assign tasks
 *   - LEADER: Manage team drones and members, transfer control rights
 *   - PILOT: Operate assigned drones, execute tasks
 *   - OBSERVER: Read-only, view map and telemetry data
 */
public interface RolePermissionStrategy {

    /**
     * Get role name identifier (corresponds to team_roles.role_name in database).
     */
    String getRoleName();

    /**
     * Check if this role allows the specified action.
     *
     * @param action action identifier, format: "VERB_RESOURCE", e.g.:
     *               CONTROL_DRONE, VIEW_TELEMETRY, TRANSFER_PERMISSION,
     *               MANAGE_TEAM, ASSIGN_TASK, VIEW_MAP, EDIT_SETTINGS
     * @return true=allowed, false=denied
     */
    boolean hasPermission(String action);

    /**
     * Get the set of menu items accessible by this role.
     * Used by frontend to dynamically render sidebar/navigation.
     *
     * @return menu identifier set, e.g.: {"dashboard", "map", "control", "team"}
     */
    Set<String> getAllowedMenus();

    /**
     * Get the display name for this role (Chinese).
     */
    String getDisplayName();
}
