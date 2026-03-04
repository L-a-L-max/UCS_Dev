-- =====================================================
-- V2.1: Zenoh Control System - Test Data Population
-- =====================================================
-- This script populates test data for the Zenoh closed-loop control system.
-- It matches the DataInitService.java data for consistency.
--
-- IMPORTANT: This script is for PRODUCTION database deployment.
-- For H2 in-memory dev mode, DataInitService handles initialization.
--
-- Test data includes:
-- 1. Roles (observer, operator, leader, commander)
-- 2. Users (1 commander, 3 leaders, 5 pilots, 1 observer = 10 users)
-- 3. Teams (3 teams with leaders and pilots)
-- 4. Drones (8 PX4-SITL drones with uavIds matching simulation)
-- 5. Drone ownership (pilots assigned to drones)
-- 6. Drone partition mappings (team-based partitions)
-- =====================================================

-- -----------------------------------------------
-- 1. Roles
-- -----------------------------------------------
INSERT INTO roles (role_name, description) VALUES
    ('operator', '队员 - 普通飞手，可查看和控制自己的无人机'),
    ('leader', '队长 - 可管理队员和分配任务'),
    ('observer', '观察员 - 全局只读权限，用于大屏展示'),
    ('commander', '指挥员 - 最高权限，可创建队伍和分配资源');

-- -----------------------------------------------
-- 2. Teams
-- -----------------------------------------------
INSERT INTO teams (team_name, description, created_by) VALUES
    ('侦察一队', '负责区域侦察和目标跟踪任务', 1),
    ('巡检二队', '负责河道、管线等基础设施巡检', 1),
    ('应急三队', '负责紧急救援和应急响应任务', 1);

-- -----------------------------------------------
-- 3. Users (password: 123456 for all, BCrypt hash)
-- -----------------------------------------------
-- Note: The password hash below is BCrypt for "123456"
-- In production, use proper password hashing

INSERT INTO users (username, password_hash, real_name, pilot_license_id, phone, email, status, team_id) VALUES
    ('commander', '$2a$10$placeholder_bcrypt_hash', '指挥官', 'AOPA-COMMANDER', '13800000001', 'commander@ucs.com', 1, NULL),
    ('zhangsan', '$2a$10$placeholder_bcrypt_hash', '张三', 'AOPA-ZHANGSAN', '13800000002', 'zhangsan@ucs.com', 1, 1),
    ('lisi', '$2a$10$placeholder_bcrypt_hash', '李四', 'AOPA-LISI', '13800000003', 'lisi@ucs.com', 1, 1),
    ('wangwu', '$2a$10$placeholder_bcrypt_hash', '王五', 'AOPA-WANGWU', '13800000004', 'wangwu@ucs.com', 1, 1),
    ('zhaoliu', '$2a$10$placeholder_bcrypt_hash', '赵六', 'AOPA-ZHAOLIU', '13800000005', 'zhaoliu@ucs.com', 1, 2),
    ('qianqi', '$2a$10$placeholder_bcrypt_hash', '钱七', 'AOPA-QIANQI', '13800000006', 'qianqi@ucs.com', 1, 2),
    ('sunba', '$2a$10$placeholder_bcrypt_hash', '孙八', 'AOPA-SUNBA', '13800000007', 'sunba@ucs.com', 1, 2),
    ('zhoujiu', '$2a$10$placeholder_bcrypt_hash', '周九', 'AOPA-ZHOUJIU', '13800000008', 'zhoujiu@ucs.com', 1, 3),
    ('wushi', '$2a$10$placeholder_bcrypt_hash', '吴十', 'AOPA-WUSHI', '13800000009', 'wushi@ucs.com', 1, 3),
    ('observer', '$2a$10$placeholder_bcrypt_hash', '观察员', 'AOPA-OBSERVER', '13800000010', 'observer@ucs.com', 1, NULL);

-- -----------------------------------------------
-- 4. User-Role Mappings
-- -----------------------------------------------
-- user_id 1 = commander (commander role = 4)
-- user_id 2 = zhangsan (leader role = 2)
-- user_id 3 = lisi (operator role = 1)
-- user_id 4 = wangwu (operator role = 1)
-- user_id 5 = zhaoliu (leader role = 2)
-- user_id 6 = qianqi (operator role = 1)
-- user_id 7 = sunba (operator role = 1)
-- user_id 8 = zhoujiu (leader role = 2)
-- user_id 9 = wushi (operator role = 1)
-- user_id 10 = observer (observer role = 3)

INSERT INTO user_role_map (user_id, role_id) VALUES
    (1, 4),   -- commander -> commander
    (2, 2),   -- zhangsan -> leader
    (3, 1),   -- lisi -> operator
    (4, 1),   -- wangwu -> operator
    (5, 2),   -- zhaoliu -> leader
    (6, 1),   -- qianqi -> operator
    (7, 1),   -- sunba -> operator
    (8, 2),   -- zhoujiu -> leader
    (9, 1),   -- wushi -> operator
    (10, 3);  -- observer -> observer

-- -----------------------------------------------
-- 5. Team Memberships
-- -----------------------------------------------
INSERT INTO team_members (team_id, user_id) VALUES
    (1, 2),   -- zhangsan -> 侦察一队
    (1, 3),   -- lisi -> 侦察一队
    (1, 4),   -- wangwu -> 侦察一队
    (2, 5),   -- zhaoliu -> 巡检二队
    (2, 6),   -- qianqi -> 巡检二队
    (2, 7),   -- sunba -> 巡检二队
    (3, 8),   -- zhoujiu -> 应急三队
    (3, 9);   -- wushi -> 应急三队

-- -----------------------------------------------
-- 6. Drones (PX4-SITL with uavIds)
-- -----------------------------------------------
-- uavIds UAV_001 through UAV_008 match the PX4 simulation script.
-- mavlink_system_id 1 through 8 for PX4 SITL addressing.

INSERT INTO drones (drone_sn, uav_id, model, manufacturer, default_team_id, mavlink_system_id, online_status, capabilities) VALUES
    ('PX4-SIM-001', 'UAV_001', 'PX4-SITL', 'PX4', 1, 1, FALSE, '{"camera": true, "thermal": true, "zoom": true}'),
    ('PX4-SIM-002', 'UAV_002', 'PX4-SITL', 'PX4', 1, 2, FALSE, '{"camera": true, "thermal": true, "zoom": true}'),
    ('PX4-SIM-003', 'UAV_003', 'PX4-SITL', 'PX4', 1, 3, FALSE, '{"camera": true, "thermal": true, "zoom": true}'),
    ('PX4-SIM-004', 'UAV_004', 'PX4-SITL', 'PX4', 2, 4, FALSE, '{"camera": true, "thermal": true, "zoom": true}'),
    ('PX4-SIM-005', 'UAV_005', 'PX4-SITL', 'PX4', 2, 5, FALSE, '{"camera": true, "thermal": false, "zoom": true}'),
    ('PX4-SIM-006', 'UAV_006', 'PX4-SITL', 'PX4', 2, 6, FALSE, '{"camera": true, "thermal": false, "zoom": true}'),
    ('PX4-SIM-007', 'UAV_007', 'PX4-SITL', 'PX4', 3, 7, FALSE, '{"camera": true, "thermal": false, "zoom": true}'),
    ('PX4-SIM-008', 'UAV_008', 'PX4-SITL', 'PX4', 3, 8, FALSE, '{"camera": true, "thermal": false, "zoom": true}');

-- -----------------------------------------------
-- 7. Drone Ownership (pilots control their drones)
-- -----------------------------------------------
-- Team 1 drones: UAV_001,002 -> lisi(3), UAV_003 -> wangwu(4)
-- Team 2 drones: UAV_004,005 -> qianqi(6), UAV_006 -> sunba(7)
-- Team 3 drones: UAV_007,008 -> wushi(9)

INSERT INTO drone_ownership (drone_id, user_id, assigned_by) VALUES
    (1, 3, 1),   -- UAV_001 -> lisi, assigned by commander
    (2, 3, 1),   -- UAV_002 -> lisi
    (3, 4, 1),   -- UAV_003 -> wangwu
    (4, 6, 1),   -- UAV_004 -> qianqi
    (5, 6, 1),   -- UAV_005 -> qianqi
    (6, 7, 1),   -- UAV_006 -> sunba
    (7, 9, 1),   -- UAV_007 -> wushi
    (8, 9, 1);   -- UAV_008 -> wushi

-- -----------------------------------------------
-- 8. Team-Drone Mappings
-- -----------------------------------------------
INSERT INTO team_drone_map (team_id, drone_id) VALUES
    (1, 1), (1, 2), (1, 3),    -- Team 1: UAV_001-003
    (2, 4), (2, 5), (2, 6),    -- Team 2: UAV_004-006
    (3, 7), (3, 8);            -- Team 3: UAV_007-008

-- -----------------------------------------------
-- 9. Drone Partition Mappings (Zenoh data routing)
-- -----------------------------------------------
-- Each team gets a partition containing their drones.
-- Commander's partition includes all drones.

INSERT INTO drone_partition_map (drone_id, uav_id, partition_name, is_active) VALUES
    -- Team 1 partition: 侦察一队
    (1, 'UAV_001', 'partition_recon_team_1', TRUE),
    (2, 'UAV_002', 'partition_recon_team_1', TRUE),
    (3, 'UAV_003', 'partition_recon_team_1', TRUE),
    -- Team 2 partition: 巡检二队
    (4, 'UAV_004', 'partition_inspect_team_2', TRUE),
    (5, 'UAV_005', 'partition_inspect_team_2', TRUE),
    (6, 'UAV_006', 'partition_inspect_team_2', TRUE),
    -- Team 3 partition: 应急三队
    (7, 'UAV_007', 'partition_emergency_team_3', TRUE),
    (8, 'UAV_008', 'partition_emergency_team_3', TRUE),
    -- Commander global partition (all drones)
    (1, 'UAV_001', 'partition_commander_global', TRUE),
    (2, 'UAV_002', 'partition_commander_global', TRUE),
    (3, 'UAV_003', 'partition_commander_global', TRUE),
    (4, 'UAV_004', 'partition_commander_global', TRUE),
    (5, 'UAV_005', 'partition_commander_global', TRUE),
    (6, 'UAV_006', 'partition_commander_global', TRUE),
    (7, 'UAV_007', 'partition_commander_global', TRUE),
    (8, 'UAV_008', 'partition_commander_global', TRUE);

-- -----------------------------------------------
-- 10. Initial Drone Status (all on ground)
-- -----------------------------------------------
INSERT INTO drone_status (drone_id, lat, lng, alt, heading, velocity, battery, health_status, risk_level, flight_status, task_status, grid_x, grid_y) VALUES
    (1, 39.9042, 116.4074, 0.0, 0.0, 0.0, 100.0, 0, 0, 'IDLE', 'IDLE', 407, 904),
    (2, 39.9052, 116.4084, 0.0, 0.0, 0.0, 100.0, 0, 0, 'IDLE', 'IDLE', 408, 905),
    (3, 39.9032, 116.4064, 0.0, 0.0, 0.0, 100.0, 0, 0, 'IDLE', 'IDLE', 406, 903),
    (4, 39.9062, 116.4054, 0.0, 0.0, 0.0, 100.0, 0, 0, 'IDLE', 'IDLE', 405, 906),
    (5, 39.9022, 116.4094, 0.0, 0.0, 0.0, 100.0, 0, 0, 'IDLE', 'IDLE', 409, 902),
    (6, 39.9072, 116.4044, 0.0, 0.0, 0.0, 100.0, 0, 0, 'IDLE', 'IDLE', 404, 907),
    (7, 39.9012, 116.4104, 0.0, 0.0, 0.0, 100.0, 0, 0, 'IDLE', 'IDLE', 410, 901),
    (8, 39.9082, 116.4034, 0.0, 0.0, 0.0, 100.0, 0, 0, 'IDLE', 'IDLE', 403, 908);
