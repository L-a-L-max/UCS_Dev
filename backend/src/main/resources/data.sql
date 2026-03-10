-- =====================================================
-- UCS PostgreSQL Initial Data (DML)
-- Execute AFTER schema.sql to populate initial data.
-- Usage: psql -U ucs_user -d ucsdb -f data.sql
-- =====================================================
-- Password for all users: 123456
-- BCrypt hash: $2b$10$z2MeLWNfs5Ca9Dt8AjDw3.L36U7QhxsTp3GIapFu2HldVR409Mzza

-- ============================================================
-- 1. Roles
-- ============================================================
INSERT INTO roles (id, role_name, description, created_at, updated_at) VALUES
(1, 'operator', '队员 - 普通飞手，可查看和控制自己的无人机', NOW(), NOW()),
(2, 'leader',   '队长 - 可管理队员和分配任务',             NOW(), NOW()),
(3, 'observer',  '观察员 - 全局只读权限，用于大屏展示',     NOW(), NOW()),
(4, 'commander', '指挥员 - 最高权限，可创建队伍和分配资源',  NOW(), NOW());
SELECT setval('roles_id_seq', 4);

-- ============================================================
-- 2. Teams
-- ============================================================
INSERT INTO teams (id, team_name, description, created_by, created_at, updated_at) VALUES
(1, '巡检队伍', '负责河道、管线等基础设施巡检', 1, NOW(), NOW()),
(2, '应急队伍', '负责紧急救援和应急响应任务',   1, NOW(), NOW());
SELECT setval('teams_id_seq', 2);

-- ============================================================
-- 3. Team Roles
-- ============================================================
INSERT INTO team_roles (id, team_id, role_name, description, created_at) VALUES
(1, 1, 'Leader', '队长', NOW()),
(2, 1, 'Pilot',  '飞手', NOW()),
(3, 2, 'Leader', '队长', NOW()),
(4, 2, 'Pilot',  '飞手', NOW());
SELECT setval('team_roles_id_seq', 4);

-- ============================================================
-- 4. Users (8 total)
-- Partition naming: observer/commander fixed, others user_{id}
-- ============================================================
INSERT INTO users (id, username, password_hash, real_name, pilot_license_id, phone, email, team_id, partition_name, status, created_at, updated_at) VALUES
(1, 'commander', '$2b$10$z2MeLWNfs5Ca9Dt8AjDw3.L36U7QhxsTp3GIapFu2HldVR409Mzza', '指挥官', 'AOPA-COMMANDER', '13800000001', 'commander@ucs.com', NULL, 'commander', 1, NOW(), NOW()),
(2, 'zhangsan',  '$2b$10$z2MeLWNfs5Ca9Dt8AjDw3.L36U7QhxsTp3GIapFu2HldVR409Mzza', '张三',   'AOPA-ZHANGSAN',  '13800000002', 'zhangsan@ucs.com',  1,    'user_2',    1, NOW(), NOW()),
(3, 'lisi',      '$2b$10$z2MeLWNfs5Ca9Dt8AjDw3.L36U7QhxsTp3GIapFu2HldVR409Mzza', '李四',   'AOPA-LISI',      '13800000003', 'lisi@ucs.com',      1,    'user_3',    1, NOW(), NOW()),
(4, 'wangwu',    '$2b$10$z2MeLWNfs5Ca9Dt8AjDw3.L36U7QhxsTp3GIapFu2HldVR409Mzza', '王五',   'AOPA-WANGWU',    '13800000004', 'wangwu@ucs.com',    1,    'user_4',    1, NOW(), NOW()),
(5, 'zhaoliu',   '$2b$10$z2MeLWNfs5Ca9Dt8AjDw3.L36U7QhxsTp3GIapFu2HldVR409Mzza', '赵六',   'AOPA-ZHAOLIU',   '13800000005', 'zhaoliu@ucs.com',   2,    'user_5',    1, NOW(), NOW()),
(6, 'qianqi',    '$2b$10$z2MeLWNfs5Ca9Dt8AjDw3.L36U7QhxsTp3GIapFu2HldVR409Mzza', '钱七',   'AOPA-QIANQI',    '13800000006', 'qianqi@ucs.com',    2,    'user_6',    1, NOW(), NOW()),
(7, 'sunba',     '$2b$10$z2MeLWNfs5Ca9Dt8AjDw3.L36U7QhxsTp3GIapFu2HldVR409Mzza', '孙八',   'AOPA-SUNBA',     '13800000007', 'sunba@ucs.com',     2,    'user_7',    1, NOW(), NOW()),
(8, 'observer',  '$2b$10$z2MeLWNfs5Ca9Dt8AjDw3.L36U7QhxsTp3GIapFu2HldVR409Mzza', '观察员', 'AOPA-OBSERVER',  '13800000008', 'observer@ucs.com',  NULL, 'observer',  1, NOW(), NOW());
SELECT setval('users_id_seq', 8);

-- ============================================================
-- 5. User-Role Mappings
-- ============================================================
INSERT INTO user_role_map (id, user_id, role_id, assigned_at) VALUES
(1, 1, 4, NOW()),
(2, 2, 2, NOW()),
(3, 3, 1, NOW()),
(4, 4, 1, NOW()),
(5, 5, 2, NOW()),
(6, 6, 1, NOW()),
(7, 7, 1, NOW()),
(8, 8, 3, NOW());
SELECT setval('user_role_map_id_seq', 8);

-- ============================================================
-- 6. Team Members
-- ============================================================
INSERT INTO team_members (id, team_id, user_id, team_role_id, joined_at) VALUES
(1, 1, 2, 1, NOW()),
(2, 1, 3, 2, NOW()),
(3, 1, 4, 2, NOW()),
(4, 2, 5, 3, NOW()),
(5, 2, 6, 4, NOW()),
(6, 2, 7, 4, NOW());
SELECT setval('team_members_id_seq', 6);

-- ============================================================
-- 7. Drones (4 PX4 simulated drones)
-- ============================================================
INSERT INTO drones (id, drone_sn, uav_id, model, manufacturer, default_team_id, mavlink_system_id, online_status, capabilities, created_at, updated_at) VALUES
(1, 'PX4-SIM-001', 'px4_1', 'PX4-SITL', 'PX4', 1, 1, FALSE, '{"camera":true,"thermal":true,"zoom":true}',  NOW(), NOW()),
(2, 'PX4-SIM-002', 'px4_2', 'PX4-SITL', 'PX4', 1, 2, FALSE, '{"camera":true,"thermal":true,"zoom":true}',  NOW(), NOW()),
(3, 'PX4-SIM-003', 'px4_3', 'PX4-SITL', 'PX4', 1, 3, FALSE, '{"camera":true,"thermal":false,"zoom":true}', NOW(), NOW()),
(4, 'PX4-SIM-004', 'px4_4', 'PX4-SITL', 'PX4', 2, 4, FALSE, '{"camera":true,"thermal":false,"zoom":true}', NOW(), NOW());
SELECT setval('drones_id_seq', 4);

-- ============================================================
-- 8. Team-Drone Mapping
-- ============================================================
INSERT INTO team_drone_map (id, team_id, drone_id, assigned_at) VALUES
(1, 1, 1, NOW()),
(2, 1, 2, NOW()),
(3, 1, 3, NOW()),
(4, 2, 4, NOW());
SELECT setval('team_drone_map_id_seq', 4);

-- ============================================================
-- 9. Drone Ownership
-- ============================================================
INSERT INTO drone_ownership (id, drone_id, user_id, assigned_by, assigned_at) VALUES
(1, 1, 3, 1, NOW()),
(2, 2, 3, 1, NOW()),
(3, 3, 4, 1, NOW()),
(4, 4, 6, 1, NOW());
SELECT setval('drone_ownership_id_seq', 4);

-- ============================================================
-- 10. Drone Partition Mappings
-- ============================================================
INSERT INTO drone_partition_map (id, drone_id, uav_id, partition_name, is_active, created_at, updated_at) VALUES
( 1, 1, 'px4_1', 'observer',  TRUE, NOW(), NOW()),
( 2, 1, 'px4_1', 'commander', TRUE, NOW(), NOW()),
( 3, 1, 'px4_1', 'user_3',    TRUE, NOW(), NOW()),
( 4, 1, 'px4_1', 'user_2',    TRUE, NOW(), NOW()),
( 5, 2, 'px4_2', 'observer',  TRUE, NOW(), NOW()),
( 6, 2, 'px4_2', 'commander', TRUE, NOW(), NOW()),
( 7, 2, 'px4_2', 'user_3',    TRUE, NOW(), NOW()),
( 8, 2, 'px4_2', 'user_2',    TRUE, NOW(), NOW()),
( 9, 3, 'px4_3', 'observer',  TRUE, NOW(), NOW()),
(10, 3, 'px4_3', 'commander', TRUE, NOW(), NOW()),
(11, 3, 'px4_3', 'user_4',    TRUE, NOW(), NOW()),
(12, 3, 'px4_3', 'user_2',    TRUE, NOW(), NOW()),
(13, 4, 'px4_4', 'observer',  TRUE, NOW(), NOW()),
(14, 4, 'px4_4', 'commander', TRUE, NOW(), NOW()),
(15, 4, 'px4_4', 'user_6',    TRUE, NOW(), NOW()),
(16, 4, 'px4_4', 'user_5',    TRUE, NOW(), NOW());
SELECT setval('drone_partition_map_id_seq', 16);

-- ============================================================
-- 11. Initial Drone Status (on ground)
-- ============================================================
INSERT INTO drone_status (id, drone_id, lat, lng, alt, heading, velocity, battery, health_status, risk_level, flight_status, task_status, grid_x, grid_y, timestamp) VALUES
(1, 1, 39.9042, 116.4074, 0.0, 0.0,   0.0, 95.0, 0, 0, 'IDLE', 'IDLE', 407, 904, NOW()),
(2, 2, 39.9052, 116.4084, 0.0, 90.0,  0.0, 88.0, 0, 0, 'IDLE', 'IDLE', 408, 905, NOW()),
(3, 3, 39.9032, 116.4064, 0.0, 180.0, 0.0, 92.0, 0, 0, 'IDLE', 'IDLE', 406, 903, NOW()),
(4, 4, 39.9062, 116.4094, 0.0, 270.0, 0.0, 85.0, 0, 0, 'IDLE', 'IDLE', 409, 906, NOW());
SELECT setval('drone_status_id_seq', 4);

-- ============================================================
-- 12. Weather Snapshot
-- ============================================================
INSERT INTO weather_snapshot (id, temperature, humidity, wind_speed, wind_direction, risk_level, location, created_at) VALUES
(1, -2.0, 35.0, 3.5, 315.0, 'MEDIUM', 'Beijing', NOW());
SELECT setval('weather_snapshot_id_seq', 1);
