package com.ucs.strategy.role;

import org.springframework.stereotype.Component;

import java.util.Set;

/**
 * T-29: 队员/飞手（PILOT）角色权限策略。
 *
 * 队员负责操控分配给自己的无人机：
 *   - 可控制分配给自己的无人机（需要通过控制权分配）
 *   - 可查看本队遥测数据
 *   - 可查看地图
 *   - 不可转移控制权（只有Leader和Commander可以）
 *   - 不可管理团队
 *   - 不可修改系统设置
 */
@Component
public class PilotRoleStrategy implements RolePermissionStrategy {

    private static final Set<String> ALLOWED_ACTIONS = Set.of(
            "CONTROL_DRONE",
            "VIEW_TELEMETRY",
            "VIEW_MAP",
            "VIEW_DASHBOARD",
            "VIEW_MONITOR",
            "EXECUTE_TASK"
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
                "control",      // 无人机控制（仅分配给自己的）
                "task"          // 任务（仅执行）
        );
    }
}
