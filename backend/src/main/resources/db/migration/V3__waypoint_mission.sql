-- ============================================================
-- V3: 航点路径预规划（Waypoint Mission）
--
-- 新增 task_waypoints 表保存任务的航点序列，并为 tasks /
-- task_drone_map 增加任务执行所需的字段。
--
-- 关键设计：
--   seq            连续执行序号，从 0 开始，是网关真正按序飞行的依据
--   display_label  前端展示用编号，NUMERIC(5,1)。删除中间点时后续编号不回退，
--                  插入点用 4.1 ~ 4.9 表示，因此「按 display_label 升序」
--                  与「按 seq 升序」始终一致，无需链表指针
-- ============================================================

-- 1. 航点表
CREATE TABLE IF NOT EXISTS task_waypoints (
    id BIGSERIAL PRIMARY KEY,
    task_id BIGINT NOT NULL,
    seq INTEGER NOT NULL,
    display_label NUMERIC(5,1) NOT NULL,
    item_type VARCHAR(20) NOT NULL DEFAULT 'NAV',
    -- NAV 航点字段（altitude 为相对 Home 的高度，单位米）
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    altitude DOUBLE PRECISION,
    hold_time INTEGER DEFAULT 0,
    -- ACTION 动作字段（载荷动作，如云台/相机）
    action_command VARCHAR(50),
    action_params VARCHAR(2000),
    created_at TIMESTAMP,
    CONSTRAINT fk_twp_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    CONSTRAINT uk_twp_task_seq UNIQUE (task_id, seq),
    CONSTRAINT ck_twp_item_type CHECK (item_type IN ('NAV', 'ACTION')),
    CONSTRAINT ck_twp_nav_fields CHECK (
        item_type <> 'NAV'
        OR (latitude IS NOT NULL AND longitude IS NOT NULL AND altitude IS NOT NULL)
    ),
    CONSTRAINT ck_twp_action_fields CHECK (
        item_type <> 'ACTION' OR action_command IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_twp_task_seq ON task_waypoints(task_id, seq);

-- 2. tasks 扩展
-- exec_count            任务被执行的次数（任务卡片展示）
-- waypoint_timeout_sec  单点超时保护，操作人员可配置（秒）
-- arrival_radius        水平到点判定半径（米）
-- arrival_alt_tol       垂直到点判定容差（米）
-- on_finish             任务完成后的动作：HOLD / RTL / LAND
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS exec_count INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS waypoint_timeout_sec INTEGER DEFAULT 300;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS arrival_radius REAL DEFAULT 3.0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS arrival_alt_tol REAL DEFAULT 2.0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS on_finish VARCHAR(20) DEFAULT 'HOLD';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_exec_time TIMESTAMP;

-- 重名校验在服务层按「创建人 + 任务名」做，这里只建查询索引，
-- 不加唯一约束，避免历史数据中已有重名导致迁移失败
CREATE INDEX IF NOT EXISTS idx_tasks_creator_name ON tasks(created_by, task_name);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);

-- 3. task_drone_map 扩展
-- current_seq    该无人机当前正在飞往的航点 seq，-1 表示尚未开始
-- mission_id     本次执行的唯一标识，用于丢弃上一轮执行的迟到进度消息
ALTER TABLE task_drone_map ADD COLUMN IF NOT EXISTS current_seq INTEGER DEFAULT -1;
ALTER TABLE task_drone_map ADD COLUMN IF NOT EXISTS mission_id VARCHAR(64);
ALTER TABLE task_drone_map ADD COLUMN IF NOT EXISTS error_message VARCHAR(500);

CREATE INDEX IF NOT EXISTS idx_tdmap_task_status ON task_drone_map(task_id, status);
CREATE INDEX IF NOT EXISTS idx_tdmap_drone_status ON task_drone_map(drone_id, status);
