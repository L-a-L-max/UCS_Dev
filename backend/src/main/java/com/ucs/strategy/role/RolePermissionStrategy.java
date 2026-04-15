package com.ucs.strategy.role;

import java.util.Set;

/**
 * T-29: 用户角色权限策略接口 — 策略模式（Strategy Pattern）。
 *
 * 将角色权限判断从 PermissionService 的 if/else 链中解耦，
 * 每种角色封装为独立的策略类，新增角色时只需新建实现类，
 * 无需修改已有代码，遵循开闭原则（OCP）。
 *
 * 当前角色体系：
 *   - COMMANDER（指挥官）：全部权限，可控制所有无人机、管理团队、分配任务
 *   - LEADER（队长）：管理本队无人机和队员，可转移控制权
 *   - PILOT（队员）：操控分配给自己的无人机，执行任务
 *   - OBSERVER（观察者）：只读权限，查看地图和遥测数据
 *
 * 扩展示例：新增"维护人员 MAINTAINER"角色时，只需：
 *   1. 新建 MaintainerRoleStrategy implements RolePermissionStrategy
 *   2. 数据库 team_roles 表添加 MAINTAINER 记录
 *   3. 无需修改 PermissionService 或 PermissionStrategyRouter
 */
public interface RolePermissionStrategy {

    /**
     * 获取角色名称标识（与数据库 team_roles.role_name 对应）。
     * 例如: "COMMANDER", "LEADER", "PILOT", "OBSERVER"
     */
    String getRoleName();

    /**
     * 判断该角色是否允许执行指定操作。
     *
     * @param action 操作标识，约定格式为 "动词_资源"，例如:
     *               CONTROL_DRONE — 控制无人机（解锁/起飞/降落/航点）
     *               VIEW_TELEMETRY — 查看遥测数据
     *               TRANSFER_PERMISSION — 转移无人机控制权
     *               MANAGE_TEAM — 管理团队（添加/移除成员）
     *               ASSIGN_TASK — 分配任务
     *               VIEW_MAP — 查看地图
     *               EDIT_SETTINGS — 修改系统设置
     * @return true=允许, false=拒绝
     */
    boolean hasPermission(String action);

    /**
     * 获取该角色可访问的功能菜单列表。
     * 用于前端根据角色动态渲染侧边栏/导航菜单。
     *
     * @return 菜单标识集合，例如: {"dashboard", "map", "control", "team"}
     */
    Set<String> getAllowedMenus();

    /**
     * 获取该角色的显示名称（中文）。
     * 用于日志和前端展示。
     */
    String getDisplayName();
}
