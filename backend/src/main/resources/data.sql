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
-- Password for all users: 123456
-- BCrypt hash: $2b$10$z2MeLWNfs5Ca9Dt8AjDw3.L36U7QhxsTp3GIapFu2HldVR409Mzza

-- ============================================================
-- 1. Roles (4 system roles)
-- ============================================================
INSERT INTO roles (role_name, description, created_at, updated_at) VALUES
('operator',  '队员 - 普通飞手，可查看和控制自己的无人机', NOW(), NOW()),
('leader',    '队长 - 可管理队员和分配任务',             NOW(), NOW()),
('observer',  '观察员 - 全局只读权限，用于大屏展示',     NOW(), NOW()),
('commander', '指挥员 - 最高权限，可创建队伍和分配资源',  NOW(), NOW());

-- ============================================================
-- 2. Teams (2 teams)
-- ============================================================
INSERT INTO teams (team_name, description, created_by, created_at, updated_at) VALUES
('巡检队伍', '负责河道、管线等基础设施巡检', 1, NOW(), NOW()),
('应急队伍', '负责紧急救援和应急响应任务',   1, NOW(), NOW());

-- ============================================================
-- 3. Team Roles (lookup table: 2 role definitions only)
-- Describes what roles a team can have, not per-team entries.
-- ============================================================
INSERT INTO team_roles (role_name, description, created_at) VALUES
('Leader', '队长', NOW()),
('Pilot',  '飞手', NOW());

-- ============================================================
-- 4. Users (8 total)
-- Partition names are NULL here; computed on first login by backend.
-- ============================================================
INSERT INTO users (username, password_hash, real_name, pilot_license_id, phone, email, team_id, partition_name, status, created_at, updated_at) VALUES
('commander', '$2b$10$z2MeLWNfs5Ca9Dt8AjDw3.L36U7QhxsTp3GIapFu2HldVR409Mzza', '指挥官', 'AOPA-COMMANDER', '13800000001', 'commander@ucs.com', NULL, NULL, 1, NOW(), NOW()),
('observer',  '$2b$10$z2MeLWNfs5Ca9Dt8AjDw3.L36U7QhxsTp3GIapFu2HldVR409Mzza', '观察员', 'AOPA-OBSERVER',  '13800000008', 'observer@ucs.com',  NULL, NULL, 1, NOW(), NOW()),
('zhangsan',  '$2b$10$z2MeLWNfs5Ca9Dt8AjDw3.L36U7QhxsTp3GIapFu2HldVR409Mzza', '张三',   'AOPA-ZHANGSAN',  '13800000002', 'zhangsan@ucs.com',  (SELECT id FROM teams WHERE team_name = '巡检队伍'), NULL, 1, NOW(), NOW()),
('lisi',      '$2b$10$z2MeLWNfs5Ca9Dt8AjDw3.L36U7QhxsTp3GIapFu2HldVR409Mzza', '李四',   'AOPA-LISI',      '13800000003', 'lisi@ucs.com',      (SELECT id FROM teams WHERE team_name = '巡检队伍'), NULL, 1, NOW(), NOW()),
('wangwu',    '$2b$10$z2MeLWNfs5Ca9Dt8AjDw3.L36U7QhxsTp3GIapFu2HldVR409Mzza', '王五',   'AOPA-WANGWU',    '13800000004', 'wangwu@ucs.com',    (SELECT id FROM teams WHERE team_name = '巡检队伍'), NULL, 1, NOW(), NOW()),
('zhaoliu',   '$2b$10$z2MeLWNfs5Ca9Dt8AjDw3.L36U7QhxsTp3GIapFu2HldVR409Mzza', '赵六',   'AOPA-ZHAOLIU',   '13800000005', 'zhaoliu@ucs.com',   (SELECT id FROM teams WHERE team_name = '应急队伍'), NULL, 1, NOW(), NOW()),
('qianqi',    '$2b$10$z2MeLWNfs5Ca9Dt8AjDw3.L36U7QhxsTp3GIapFu2HldVR409Mzza', '钱七',   'AOPA-QIANQI',    '13800000006', 'qianqi@ucs.com',    (SELECT id FROM teams WHERE team_name = '应急队伍'), NULL, 1, NOW(), NOW()),
('sunba',     '$2b$10$z2MeLWNfs5Ca9Dt8AjDw3.L36U7QhxsTp3GIapFu2HldVR409Mzza', '孙八',   'AOPA-SUNBA',     '13800000007', 'sunba@ucs.com',     (SELECT id FROM teams WHERE team_name = '应急队伍'), NULL, 1, NOW(), NOW());

-- ============================================================
-- 5. User-Role Mappings
-- ============================================================
INSERT INTO user_role_map (user_id, role_id, assigned_at) VALUES
((SELECT id FROM users WHERE username = 'commander'), (SELECT id FROM roles WHERE role_name = 'commander'), NOW()),
((SELECT id FROM users WHERE username = 'observer'),  (SELECT id FROM roles WHERE role_name = 'observer'),  NOW()),
((SELECT id FROM users WHERE username = 'zhangsan'),   (SELECT id FROM roles WHERE role_name = 'leader'),    NOW()),
((SELECT id FROM users WHERE username = 'lisi'),       (SELECT id FROM roles WHERE role_name = 'operator'),  NOW()),
((SELECT id FROM users WHERE username = 'wangwu'),     (SELECT id FROM roles WHERE role_name = 'operator'),  NOW()),
((SELECT id FROM users WHERE username = 'zhaoliu'),    (SELECT id FROM roles WHERE role_name = 'leader'),    NOW()),
((SELECT id FROM users WHERE username = 'qianqi'),     (SELECT id FROM roles WHERE role_name = 'operator'),  NOW()),
((SELECT id FROM users WHERE username = 'sunba'),      (SELECT id FROM roles WHERE role_name = 'operator'),  NOW());

-- ============================================================
-- 6. Team Members
-- ============================================================
INSERT INTO team_members (team_id, user_id, team_role_id, joined_at) VALUES
(
  (SELECT id FROM teams WHERE team_name = '巡检队伍'),
  (SELECT id FROM users WHERE username = 'zhangsan'),
  (SELECT id FROM team_roles WHERE role_name = 'Leader'),
  NOW()
),
(
  (SELECT id FROM teams WHERE team_name = '巡检队伍'),
  (SELECT id FROM users WHERE username = 'lisi'),
  (SELECT id FROM team_roles WHERE role_name = 'Pilot'),
  NOW()
),
(
  (SELECT id FROM teams WHERE team_name = '巡检队伍'),
  (SELECT id FROM users WHERE username = 'wangwu'),
  (SELECT id FROM team_roles WHERE role_name = 'Pilot'),
  NOW()
),
(
  (SELECT id FROM teams WHERE team_name = '应急队伍'),
  (SELECT id FROM users WHERE username = 'zhaoliu'),
  (SELECT id FROM team_roles WHERE role_name = 'Leader'),
  NOW()
),
(
  (SELECT id FROM teams WHERE team_name = '应急队伍'),
  (SELECT id FROM users WHERE username = 'qianqi'),
  (SELECT id FROM team_roles WHERE role_name = 'Pilot'),
  NOW()
),
(
  (SELECT id FROM teams WHERE team_name = '应急队伍'),
  (SELECT id FROM users WHERE username = 'sunba'),
  (SELECT id FROM team_roles WHERE role_name = 'Pilot'),
  NOW()
);
