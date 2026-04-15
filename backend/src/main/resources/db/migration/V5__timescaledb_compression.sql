-- =====================================================
-- T-33: 遥测数据压缩策略（TimescaleDB 原生压缩）
-- 按 uav_id 分段压缩，按 timestamp DESC 排序
-- 7天后自动压缩，90天后自动清理
-- 前置条件: V4 (Hypertable 已创建)
-- =====================================================

-- 启用压缩：按 uav_id 分段（同一架无人机的数据存放在一起），按时间倒序排列
ALTER TABLE uav_telemetry SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'uav_id',
    timescaledb.compress_orderby = '"timestamp" DESC'
);

-- 自动压缩策略：7天前的 chunk 自动压缩（压缩率约 10:1）
-- 7天内的数据保持未压缩状态，支持高频写入和实时查询
SELECT add_compression_policy('uav_telemetry', INTERVAL '7 days', if_not_exists => TRUE);

-- 数据保留策略：90天前的 chunk 自动删除
-- 超过90天的遥测历史数据对实时监控无价值，节省磁盘空间
SELECT add_retention_policy('uav_telemetry', INTERVAL '90 days', if_not_exists => TRUE);
