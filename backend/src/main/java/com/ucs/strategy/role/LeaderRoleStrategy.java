package com.ucs.strategy.role;

import org.springframework.stereotype.Component;

import java.util.Set;

/**
 * T-29: 队长（LEADER）角色权限策略。
 *
 * 队长负责管理本队无人机和队员：
 *   - 可控制本队内的无人机
 *   - 可将无人机控制权转移给本队队员
 *   - 可查看本队遥测数据
 *   - 可管理本队成员（但不能跨队操作）
 *   - 不可修改系统设置
 */
@Component
public class LeaderRoleStrategy implements RolePermissionStrategy {

    private static final Set<String> ALLOWED_ACTIONS = Set.of(
            "CONTROL_DRONE",
            "VIEW_TELEMETRY",
            "TRANSFER_PERMISSION",
            "MANAGE_TEAM",
            "ASSIGN_TASK",
            "VIEW_MAP",
            "VIEW_DASHBOARD",
            "VIEW_MONITOR"
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
        // 队长拥有除系统设置外的大部分权限
        if (action == null) return false;
        // 允许所有 VIEW_/READ_ 前缀的操作
        if (action.startsWith("VIEW_") || action.startsWith("READ_")) {
            return true;
        }
        return ALLOWED_ACTIONS.contains(action);
    }

    @Override
    public Set<String> getAllowedMenus() {
        return Set.of(
                "dashboard",    // 总览面板
                "map",          // 地图（2D/3D）
                "control",      // 无人机控制
                "team",         // 团队管理（仅本队）
                "task",         // 任务管理
                "monitor"       // 监控中心
        );
    }
}
