-- =====================================================
-- T-32: TimescaleDB Hypertable 自动分区配置
-- 将 uav_telemetry 表转换为 Hypertable，按天自动分区
-- 前置条件: TimescaleDB 扩展已安装 (CREATE EXTENSION IF NOT EXISTS timescaledb)
-- =====================================================

-- 确保 TimescaleDB 扩展已启用
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- 将 uav_telemetry 转换为 Hypertable（按 timestamp 列，每天一个 chunk）
-- if_not_exists: 如果已经是 Hypertable 则跳过，避免重复执行报错
SELECT create_hypertable(
    'uav_telemetry',
    'timestamp',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE,
    migrate_data => TRUE
);

-- 创建复合索引：按 uav_id + timestamp DESC 查询（最常用的查询模式）
-- TimescaleDB 会自动在每个 chunk 上创建此索引
CREATE INDEX IF NOT EXISTS idx_telemetry_uav_time
    ON uav_telemetry (uav_id, "timestamp" DESC);

-- BRIN 索引：适合时间序列数据的范围扫描（块级索引，占用空间极小）
CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp_brin
    ON uav_telemetry USING BRIN ("timestamp");
