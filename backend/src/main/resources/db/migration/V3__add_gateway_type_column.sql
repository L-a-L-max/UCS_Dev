-- ============================================================
-- T-03: 添加 gateway_type 列 — 网关策略模式路由依据
--
-- gateway_type 决定指令路由到哪种网关:
--   'DDS'     = 仿真无人机 (ROS2/DDS协议)
--   'MAVLINK' = 真实无人机 (MAVLink协议)
--   NULL      = 根据 uavId 前缀自动推断 (向后兼容)
-- ============================================================

ALTER TABLE drones
    ADD COLUMN IF NOT EXISTS gateway_type VARCHAR(20) DEFAULT NULL;

-- 为已有的 MAVLink 无人机 (mavlink_ 前缀) 自动设置 gateway_type
UPDATE drones
SET gateway_type = 'MAVLINK'
WHERE uav_id LIKE 'mavlink_%'
  AND (gateway_type IS NULL OR gateway_type = '');

-- 为已有的 DDS 无人机 (非 mavlink_ 前缀) 自动设置 gateway_type
UPDATE drones
SET gateway_type = 'DDS'
WHERE uav_id NOT LIKE 'mavlink_%'
  AND uav_id IS NOT NULL
  AND (gateway_type IS NULL OR gateway_type = '');

-- 添加索引加速查询
CREATE INDEX IF NOT EXISTS idx_drones_gateway_type ON drones(gateway_type);

COMMENT ON COLUMN drones.gateway_type IS 'T-03: 网关类型 (DDS/MAVLINK)，决定指令路由策略';
