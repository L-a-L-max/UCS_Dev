package com.ucs.strategy.role;

import org.springframework.stereotype.Component;

import java.util.Set;

/**
 * T-29: 观察者（OBSERVER）角色权限策略。
 *
 * 观察者只有只读权限：
 *   - 可查看地图和无人机位置
 *   - 可查看遥测数据
 *   - 可查看总览面板
 *   - 不可控制任何无人机
 *   - 不可管理团队或任务
 *   - 不可修改任何数据
 *
 * 典型使用场景：上级监督人员、客户演示、培训观摩。
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

    /**
     * 观察者只能执行 VIEW_ 或 READ_ 前缀的操作。
     */
    @Override
    public boolean hasPermission(String action) {
        if (action == null) return false;
        return action.startsWith("VIEW_") || action.startsWith("READ_");
    }

    @Override
    public Set<String> getAllowedMenus() {
        return Set.of(
                "dashboard",    // 总览面板
                "map"           // 地图（只读）
        );
    }
}
