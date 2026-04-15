-- =====================================================
-- T-35: PostgreSQL WAL 配置（CDC 准备工作）
-- 配置 WAL 级别为 logical，创建 Debezium 专用用户和 Publication
-- 注意: ALTER SYSTEM SET wal_level 需要重启 PostgreSQL 才能生效
-- 前置条件: 无
-- =====================================================

-- 1. 设置 WAL 级别为 logical（支持 CDC 逻辑复制）
-- 注意: 此设置写入 postgresql.auto.conf，需重启 PostgreSQL 生效
-- 如果在 Docker 环境中，可通过 POSTGRES_INITDB_ARGS 或 postgresql.conf 挂载实现
ALTER SYSTEM SET wal_level = 'logical';

-- 2. 设置 max_replication_slots（Debezium 需要至少1个复制槽）
ALTER SYSTEM SET max_replication_slots = 4;

-- 3. 设置 max_wal_senders（允许的 WAL 发送进程数）
ALTER SYSTEM SET max_wal_senders = 4;

-- 4. 创建 Debezium 专用数据库用户（带 REPLICATION 权限）
-- 注意: 密码应在部署时通过环境变量 DEBEZIUM_PASSWORD 传入
-- 此处使用占位符，实际部署前需替换为安全密码
-- 使用 DO 块避免用户已存在时报错
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'debezium') THEN
        -- TODO: 部署时通过 psql -v 或 sed 替换为环境变量 ${DEBEZIUM_PASSWORD}
        CREATE USER debezium WITH PASSWORD :'debezium_pass' REPLICATION LOGIN;
    END IF;
END
$$;

-- 5. 授予 Debezium 用户必要权限
GRANT CONNECT ON DATABASE ucsdb TO debezium;
GRANT USAGE ON SCHEMA public TO debezium;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO debezium;
-- 确保未来新建的表也自动授权给 debezium
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO debezium;

-- 6. 创建 Publication（Debezium 通过 Publication 订阅表变更）
-- 发布所有表的变更事件（INSERT/UPDATE/DELETE）
-- Debezium Connector 配置中指定 publication.name = 'ucs_publication'
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_publication WHERE pubname = 'ucs_publication') THEN
        CREATE PUBLICATION ucs_publication FOR ALL TABLES;
    END IF;
END
$$;
