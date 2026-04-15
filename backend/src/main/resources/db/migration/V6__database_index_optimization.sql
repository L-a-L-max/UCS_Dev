-- =====================================================
-- T-34: 数据库索引优化
-- 针对高频查询路径创建部分索引和覆盖索引
-- 重点优化: drone_partition_map, drones, uav_latest_state
-- =====================================================

-- 1. drone_partition_map: 活跃分区查询（最高频 — 每条遥测消息都要查）
-- 部分索引: 只索引 is_active=true 的行，索引体积减少 50%+
CREATE INDEX IF NOT EXISTS idx_dpm_uav_active
    ON drone_partition_map (uav_id, is_active)
    WHERE is_active = true;

-- 2. drone_partition_map: 按分区名查询活跃映射
CREATE INDEX IF NOT EXISTS idx_dpm_partition_active
    ON drone_partition_map (partition_name, is_active)
    WHERE is_active = true;

-- 3. drones: 按 uav_id 查询（autoCreateDrone、心跳检测）
CREATE INDEX IF NOT EXISTS idx_drones_uav_id
    ON drones (uav_id);

-- 4. drones: 按 gateway_type 查询（网关类型路由）
-- 注: drones表中 gateway_type 列由 V3 migration 添加
CREATE INDEX IF NOT EXISTS idx_drones_gateway_type
    ON drones (gateway_type)
    WHERE gateway_type IS NOT NULL;

-- 5. uav_latest_state: 按 uav_id 查询（已是 PRIMARY KEY，补充活跃状态索引）
CREATE INDEX IF NOT EXISTS idx_latest_state_active
    ON uav_latest_state (uav_id, is_active)
    WHERE is_active = true;

-- 6. drone_ownership: 按用户查询其拥有的无人机
CREATE INDEX IF NOT EXISTS idx_drone_ownership_user
    ON drone_ownership (user_id, drone_id);

-- 7. task_assignments: 按用户查询其任务
CREATE INDEX IF NOT EXISTS idx_task_assignments_user
    ON task_assignments (user_id, task_id);

-- 8. command_log: 按无人机+时间查询命令历史
CREATE INDEX IF NOT EXISTS idx_command_log_drone_time
    ON command_log (drone_id, created_at DESC);

-- 9. event_log: 按事件类型+时间查询
CREATE INDEX IF NOT EXISTS idx_event_log_type_time
    ON event_log (event_type, created_at DESC);

-- 10. team_members: 按团队查询成员（JOIN优化）
CREATE INDEX IF NOT EXISTS idx_team_members_team
    ON team_members (team_id, user_id);
