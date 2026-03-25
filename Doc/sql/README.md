# UCS 数据库初始化脚本

所有数据库初始化脚本统一存放在此目录，按编号顺序执行。

## 脚本清单

| 文件名 | 目标数据库 | 说明 |
|--------|-----------|------|
| `01_postgres_schema.sql` | PostgreSQL (ucs) | 业务数据库建表脚本（DDL），包含用户、团队、无人机、任务、日志等全部表结构 |
| `02_postgres_init_data.sql` | PostgreSQL (ucs) | 业务数据库初始数据（DML），包含默认角色、测试用户（密码均为 `123456`）、测试团队 |
| `03_timescaledb_init.sql` | TimescaleDB (ucs_telemetry) | 遥测时序数据库初始化，创建 hypertable + 压缩策略 + 保留策略 + 连续聚合视图 |

## 使用方式

### 方式一：Docker Compose 自动执行（推荐）

使用 `docker-compose-microservices.yml` 启动时，脚本会通过卷挂载自动执行：

```bash
# 在项目根目录
docker compose -f docker-compose-microservices.yml up -d
```

- PostgreSQL 容器启动时自动执行 `01_postgres_schema.sql` 和 `02_postgres_init_data.sql`
- TimescaleDB 容器启动时自动执行 `03_timescaledb_init.sql`

> 注意：`docker-entrypoint-initdb.d` 目录下的脚本仅在数据库首次初始化（数据卷为空）时执行。
> 如需重新初始化，请先删除对应的 Docker Volume：
> ```bash
> docker compose -f docker-compose-microservices.yml down -v
> ```

### 方式二：手动执行

```bash
# PostgreSQL 业务库
psql -U ucs -d ucs -f Doc/sql/01_postgres_schema.sql
psql -U ucs -d ucs -f Doc/sql/02_postgres_init_data.sql

# TimescaleDB 遥测库
psql -U ucs -d ucs_telemetry -p 5433 -f Doc/sql/03_timescaledb_init.sql
```

## 命名规范

- 编号前缀：`01_`、`02_`、`03_`... 表示执行顺序
- 数据库标识：`postgres_` = 业务库，`timescaledb_` = 遥测时序库
- 用途后缀：`schema` = 建表，`init_data` = 初始数据，`init` = 综合初始化
