-- =====================================================
-- UCS PostgreSQL Initial Data (DML) - Personnel Only
-- Execute AFTER schema.sql to populate initial personnel data.
-- Usage: psql -U ucs_user -d ucsdb -f data.sql
--
-- NOTE: Do NOT specify explicit IDs - let PostgreSQL BIGSERIAL auto-generate.
-- Partition names are computed dynamically by the backend on first login:
--   observer role  -> "observer"
--   commander role -> "commander"
--   others         -> "{username_initials}_{db_id}" (e.g., zhangsan id=3 -> "zs_3")
-- =====================================================
-- All user passwords: 123456
-- BCrypt hash (Spring BCryptPasswordEncoder default strength=10):
-- $2a$10$j4.vC1kM31lor89FYP56luNchz4BZAuJBEjn/t6wUpnsOdKfKFxJS

-- ========== 1. Roles (no dependencies) ==========
INSERT INTO roles (role_name, description, created_at, updated_at) VALUES
('operator',  '队员 - 普通飞手，可查看和控制自己的无人机', NOW(), NOW()),
('leader',    '队长 - 可管理队员和分配任务',             NOW(), NOW()),
('observer',  '观察员 - 全局只读权限，用于大屏展示',     NOW(), NOW()),
('commander', '指挥员 - 最高权限，可创建队伍和分配资源',  NOW(), NOW());

-- ========== 2. Teams ==========
INSERT INTO teams (team_name, description, created_at, updated_at) VALUES
('巡检队伍', '负责河道、管线等基础设施巡检', NOW(), NOW()),
('应急队伍', '负责紧急救援和应急响应任务',   NOW(), NOW());

-- ========== 3. Team Roles (lookup table - only 2 role definitions) ==========
INSERT INTO team_roles (role_name, description, created_at) VALUES
('Leader', '队长', NOW()),
('Pilot',  '飞手', NOW());

-- ========== 4. Users (password: 123456) ==========
INSERT INTO users (username, password_hash, real_name, pilot_license_id, phone, email, team_id, partition_name, status, created_at, updated_at) VALUES
('commander', '$2a$10$j4.vC1kM31lor89FYP56luNchz4BZAuJBEjn/t6wUpnsOdKfKFxJS', '指挥官', 'AOPA-COMMANDER', '13800000001', 'commander@ucs.com', NULL, NULL, 1, NOW(), NOW()),
('observer',  '$2a$10$j4.vC1kM31lor89FYP56luNchz4BZAuJBEjn/t6wUpnsOdKfKFxJS', '观察员', 'AOPA-OBSERVER',  '13800000008', 'observer@ucs.com',  NULL, NULL, 1, NOW(), NOW()),
('zhangsan',  '$2a$10$j4.vC1kM31lor89FYP56luNchz4BZAuJBEjn/t6wUpnsOdKfKFxJS', '张三',   'AOPA-ZHANGSAN',  '13800000002', 'zhangsan@ucs.com',  (SELECT id FROM teams WHERE team_name = '巡检队伍' LIMIT 1), NULL, 1, NOW(), NOW()),
('lisi',      '$2a$10$j4.vC1kM31lor89FYP56luNchz4BZAuJBEjn/t6wUpnsOdKfKFxJS', '李四',   'AOPA-LISI',      '13800000003', 'lisi@ucs.com',      (SELECT id FROM teams WHERE team_name = '巡检队伍' LIMIT 1), NULL, 1, NOW(), NOW()),
('wangwu',    '$2a$10$j4.vC1kM31lor89FYP56luNchz4BZAuJBEjn/t6wUpnsOdKfKFxJS', '王五',   'AOPA-WANGWU',    '13800000004', 'wangwu@ucs.com',    (SELECT id FROM teams WHERE team_name = '巡检队伍' LIMIT 1), NULL, 1, NOW(), NOW()),
('zhaoliu',   '$2a$10$j4.vC1kM31lor89FYP56luNchz4BZAuJBEjn/t6wUpnsOdKfKFxJS', '赵六',   'AOPA-ZHAOLIU',   '13800000005', 'zhaoliu@ucs.com',   (SELECT id FROM teams WHERE team_name = '应急队伍' LIMIT 1), NULL, 1, NOW(), NOW()),
('qianqi',    '$2a$10$j4.vC1kM31lor89FYP56luNchz4BZAuJBEjn/t6wUpnsOdKfKFxJS', '钱七',   'AOPA-QIANQI',    '13800000006', 'qianqi@ucs.com',    (SELECT id FROM teams WHERE team_name = '应急队伍' LIMIT 1), NULL, 1, NOW(), NOW()),
('sunba',     '$2a$10$j4.vC1kM31lor89FYP56luNchz4BZAuJBEjn/t6wUpnsOdKfKFxJS', '孙八',   'AOPA-SUNBA',     '13800000007', 'sunba@ucs.com',     (SELECT id FROM teams WHERE team_name = '应急队伍' LIMIT 1), NULL, 1, NOW(), NOW());

-- ========== 5. User-Role Mappings ==========
INSERT INTO user_role_map (user_id, role_id, assigned_at) VALUES
((SELECT id FROM users WHERE username = 'commander' LIMIT 1), (SELECT id FROM roles WHERE role_name = 'commander' LIMIT 1), NOW()),
((SELECT id FROM users WHERE username = 'observer' LIMIT 1),  (SELECT id FROM roles WHERE role_name = 'observer' LIMIT 1),  NOW()),
((SELECT id FROM users WHERE username = 'zhangsan' LIMIT 1),  (SELECT id FROM roles WHERE role_name = 'leader' LIMIT 1),    NOW()),
((SELECT id FROM users WHERE username = 'lisi' LIMIT 1),      (SELECT id FROM roles WHERE role_name = 'operator' LIMIT 1),  NOW()),
((SELECT id FROM users WHERE username = 'wangwu' LIMIT 1),    (SELECT id FROM roles WHERE role_name = 'operator' LIMIT 1),  NOW()),
((SELECT id FROM users WHERE username = 'zhaoliu' LIMIT 1),   (SELECT id FROM roles WHERE role_name = 'leader' LIMIT 1),    NOW()),
((SELECT id FROM users WHERE username = 'qianqi' LIMIT 1),    (SELECT id FROM roles WHERE role_name = 'operator' LIMIT 1),  NOW()),
((SELECT id FROM users WHERE username = 'sunba' LIMIT 1),     (SELECT id FROM roles WHERE role_name = 'operator' LIMIT 1),  NOW());

-- ========== 6. Drones (PX4 SITL 仿真无人机，uav_id 对应 DDS Gateway 发现的 drone prefix) ==========
INSERT INTO drones (drone_sn, uav_id, mavlink_system_id, model, manufacturer, default_team_id, online_status, created_at, updated_at) VALUES
('SN-PX4-001', 'px4_1', 1, 'PX4 Quadrotor', 'PX4 Autopilot', (SELECT id FROM teams WHERE team_name = '巡检队伍' LIMIT 1), FALSE, NOW(), NOW()),
('SN-PX4-002', 'px4_2', 2, 'PX4 Quadrotor', 'PX4 Autopilot', (SELECT id FROM teams WHERE team_name = '巡检队伍' LIMIT 1), FALSE, NOW(), NOW()),
('SN-PX4-003', 'px4_3', 3, 'PX4 Quadrotor', 'PX4 Autopilot', (SELECT id FROM teams WHERE team_name = '应急队伍' LIMIT 1), FALSE, NOW(), NOW());

-- ========== 7. Drone Ownership (初始分配：px4_1/px4_2 → 巡检队长张三，px4_3 → 应急队长赵六) ==========
INSERT INTO drone_ownership (drone_id, user_id, assigned_by, assigned_at) VALUES
((SELECT id FROM drones WHERE uav_id = 'px4_1' LIMIT 1), (SELECT id FROM users WHERE username = 'zhangsan' LIMIT 1), (SELECT id FROM users WHERE username = 'commander' LIMIT 1), NOW()),
((SELECT id FROM drones WHERE uav_id = 'px4_2' LIMIT 1), (SELECT id FROM users WHERE username = 'zhangsan' LIMIT 1), (SELECT id FROM users WHERE username = 'commander' LIMIT 1), NOW()),
((SELECT id FROM drones WHERE uav_id = 'px4_3' LIMIT 1), (SELECT id FROM users WHERE username = 'zhaoliu' LIMIT 1), (SELECT id FROM users WHERE username = 'commander' LIMIT 1), NOW());

-- ========== 8. Team-Drone Mapping (无人机分配到队伍) ==========
INSERT INTO team_drone_map (team_id, drone_id, assigned_at) VALUES
((SELECT id FROM teams WHERE team_name = '巡检队伍' LIMIT 1), (SELECT id FROM drones WHERE uav_id = 'px4_1' LIMIT 1), NOW()),
((SELECT id FROM teams WHERE team_name = '巡检队伍' LIMIT 1), (SELECT id FROM drones WHERE uav_id = 'px4_2' LIMIT 1), NOW()),
((SELECT id FROM teams WHERE team_name = '应急队伍' LIMIT 1), (SELECT id FROM drones WHERE uav_id = 'px4_3' LIMIT 1), NOW());

-- ========== 9. Drone Partition Map (分区路由：Commander 看全部，各队长看自己队伍的无人机) ==========
INSERT INTO drone_partition_map (drone_id, uav_id, partition_name, is_active, created_at, updated_at) VALUES
((SELECT id FROM drones WHERE uav_id = 'px4_1' LIMIT 1), 'px4_1', 'commander', TRUE, NOW(), NOW()),
((SELECT id FROM drones WHERE uav_id = 'px4_2' LIMIT 1), 'px4_2', 'commander', TRUE, NOW(), NOW()),
((SELECT id FROM drones WHERE uav_id = 'px4_3' LIMIT 1), 'px4_3', 'commander', TRUE, NOW(), NOW()),
((SELECT id FROM drones WHERE uav_id = 'px4_1' LIMIT 1), 'px4_1', 'zs_3',      TRUE, NOW(), NOW()),
((SELECT id FROM drones WHERE uav_id = 'px4_2' LIMIT 1), 'px4_2', 'zs_3',      TRUE, NOW(), NOW()),
((SELECT id FROM drones WHERE uav_id = 'px4_3' LIMIT 1), 'px4_3', 'zl_6',      TRUE, NOW(), NOW());

-- ========== 10. Team Members ==========
INSERT INTO team_members (team_id, user_id, team_role_id, joined_at) VALUES
(
  (SELECT id FROM teams WHERE team_name = '巡检队伍' LIMIT 1),
  (SELECT id FROM users WHERE username = 'zhangsan' LIMIT 1),
  (SELECT id FROM team_roles WHERE role_name = 'Leader' LIMIT 1),
  NOW()
),
(
  (SELECT id FROM teams WHERE team_name = '巡检队伍' LIMIT 1),
  (SELECT id FROM users WHERE username = 'lisi' LIMIT 1),
  (SELECT id FROM team_roles WHERE role_name = 'Pilot' LIMIT 1),
  NOW()
),
(
  (SELECT id FROM teams WHERE team_name = '巡检队伍' LIMIT 1),
  (SELECT id FROM users WHERE username = 'wangwu' LIMIT 1),
  (SELECT id FROM team_roles WHERE role_name = 'Pilot' LIMIT 1),
  NOW()
),
(
  (SELECT id FROM teams WHERE team_name = '应急队伍' LIMIT 1),
  (SELECT id FROM users WHERE username = 'zhaoliu' LIMIT 1),
  (SELECT id FROM team_roles WHERE role_name = 'Leader' LIMIT 1),
  NOW()
),
(
  (SELECT id FROM teams WHERE team_name = '应急队伍' LIMIT 1),
  (SELECT id FROM users WHERE username = 'qianqi' LIMIT 1),
  (SELECT id FROM team_roles WHERE role_name = 'Pilot' LIMIT 1),
  NOW()
),
(
  (SELECT id FROM teams WHERE team_name = '应急队伍' LIMIT 1),
  (SELECT id FROM users WHERE username = 'sunba' LIMIT 1),
  (SELECT id FROM team_roles WHERE role_name = 'Pilot' LIMIT 1),
  NOW()
);
