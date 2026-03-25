-- ============================================================
-- TimescaleDB 初始化脚本
-- 创建遥测数据 hypertable + 压缩策略 + 保留策略 + 连续聚合
-- ============================================================

-- 1. 启用 TimescaleDB 扩展
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- 2. 创建遥测数据表
CREATE TABLE IF NOT EXISTS telemetry_data (
    time        TIMESTAMPTZ     NOT NULL,
    uav_id      VARCHAR(64)     NOT NULL,
    latitude    DOUBLE PRECISION,
    longitude   DOUBLE PRECISION,
    altitude    DOUBLE PRECISION,
    speed       DOUBLE PRECISION,
    heading     DOUBLE PRECISION,
    battery     DOUBLE PRECISION,
    status      VARCHAR(32),
    epoch       BIGINT
);

-- 3. 转换为 hypertable（chunk_interval = 1小时）
SELECT create_hypertable('telemetry_data', 'time',
       chunk_time_interval => INTERVAL '1 hour',
       if_not_exists => TRUE);

-- 4. 创建索引：按 uav_id + time 查询
CREATE INDEX IF NOT EXISTS idx_telemetry_uav_time
    ON telemetry_data (uav_id, time DESC);

-- 5. 压缩策略：2小时以上的数据自动压缩
ALTER TABLE telemetry_data SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'uav_id',
    timescaledb.compress_orderby = 'time DESC'
);
SELECT add_compression_policy('telemetry_data', INTERVAL '2 hours',
       if_not_exists => TRUE);

-- 6. 保留策略：7天以上的原始数据自动删除
SELECT add_retention_policy('telemetry_data', INTERVAL '7 days',
       if_not_exists => TRUE);

-- 7. 连续聚合视图：1分钟粒度的汇总（用于历史查询/报表）
CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_1min
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 minute', time)  AS bucket,
    uav_id,
    AVG(latitude)                  AS avg_lat,
    AVG(longitude)                 AS avg_lon,
    AVG(altitude)                  AS avg_alt,
    AVG(speed)                     AS avg_speed,
    MIN(battery)                   AS min_battery,
    MAX(battery)                   AS max_battery,
    COUNT(*)                       AS sample_count
FROM telemetry_data
GROUP BY bucket, uav_id
WITH NO DATA;

-- 8. 连续聚合刷新策略
SELECT add_continuous_aggregate_policy('telemetry_1min',
    start_offset    => INTERVAL '2 hours',
    end_offset      => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute',
    if_not_exists   => TRUE);
