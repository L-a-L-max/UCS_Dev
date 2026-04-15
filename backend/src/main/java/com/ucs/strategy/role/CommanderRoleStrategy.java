package com.ucs.strategy.role;

import org.springframework.stereotype.Component;

import java.util.Set;

/**
 * T-29: 指挥官（COMMANDER）角色权限策略。
 *
 * 指挥官拥有系统最高权限：
 *   - 可控制所有无人机（不受分区限制）
 *   - 可管理所有团队（添加/移除成员、解散团队）
 *   - 可转移无人机控制权（个人↔团队）
 *   - 可分配和管理任务
 *   - 可修改系统设置
 *   - 可查看所有遥测数据和日志
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

    /**
     * 指挥官拥有所有权限，直接返回true。
     */
    @Override
    public boolean hasPermission(String action) {
        return true;
    }

    @Override
    public Set<String> getAllowedMenus() {
        return Set.of(
                "dashboard",    // 总览面板
                "map",          // 地图（2D/3D）
                "control",      // 无人机控制
                "team",         // 团队管理
                "task",         // 任务管理
                "permission",   // 权限管理
                "monitor",      // 监控中心
                "settings"      // 系统设置
        );
    }
}
