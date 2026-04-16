# UCS-Platform 微服务架构 — 前后端联调启动指南

> 版本：v1.0 — 对应 `ClusterArchitectureUpgrade` 分支
> 适用于：开发环境下的前后端联调测试
> 最后更新：2026-04

---

## 目录

1. [环境要求](#1-环境要求)
2. [快速启动（TL;DR）](#2-快速启动tldr)
3. [第一步：安装基础环境](#3-第一步安装基础环境)
4. [第二步：启动基础设施（Docker）](#4-第二步启动基础设施docker)
5. [第三步：初始化数据库](#5-第三步初始化数据库)
6. [第四步：编译并启动后端微服务](#6-第四步编译并启动后端微服务)
7. [第五步：启动前端](#7-第五步启动前端)
8. [第六步：验证联调](#8-第六步验证联调)
9. [端口分配总表](#9-端口分配总表)
10. [环境变量参考](#10-环境变量参考)
11. [微服务模块说明](#11-微服务模块说明)
12. [常见问题排查](#12-常见问题排查)
13. [测试账号](#13-测试账号)
14. [附录：虚拟线程说明](#14-附录虚拟线程说明)

---

## 1. 环境要求

| 软件 | 最低版本 | 用途 | 安装检查命令 |
|------|---------|------|-------------|
| **JDK** | 21 | 后端编译运行（需要虚拟线程支持） | `java -version` |
| **Maven** | 3.9+ | 后端构建 | `mvn -version` |
| **Node.js** | 18+ | 前端构建运行 | `node -v` |
| **npm** | 9+ | 前端依赖管理 | `npm -v` |
| **Docker** | 24.0+ | 基础设施容器 | `docker -v` |
| **Docker Compose** | 2.20+ | 容器编排 | `docker compose version` |
| **Python** | 3.10+ | DDS/MAVLink 网关（可选） | `python3 --version` |

> **说明：** 本项目使用 JDK 21 虚拟线程（`Thread.ofVirtual()`）来提升并发性能，JDK 21 是硬性要求。详见[附录](#14-附录虚拟线程说明)。

---

## 2. 快速启动（TL;DR）

适合已安装好全部环境的开发者，5 条命令启动全栈：

```bash
# ① 启动基础设施（Kafka + PostgreSQL + Redis）
cd UCS_Dev
docker compose -f docker-compose.yml up -d          # PostgreSQL
docker compose -f docker-compose-kafka.yml up -d     # Kafka 3-Broker
# Redis：开发环境用单节点即可
docker run -d --name ucs-redis -p 6379:6379 redis:7-alpine

# ② 初始化数据库（仅首次）
docker exec -i $(docker ps -qf "name=postgres") psql -U ucs_user -d ucsdb < backend/src/main/resources/schema.sql
docker exec -i $(docker ps -qf "name=postgres") psql -U ucs_user -d ucsdb < backend/src/main/resources/data.sql

# ③ 编译后端
cd ucs-platform && mvn clean compile -q

# ④ 启动后端（需要多个终端窗口）
mvn -pl ucs-business spring-boot:run          # 终端1: 业务服务 :8086
mvn -pl ucs-api-gateway spring-boot:run       # 终端2: API网关 :8080

# ⑤ 启动前端
cd ../frontend/ucs-dashboard && npm install && npm run dev   # :5173
```

浏览器打开 `http://localhost:5173`，使用 `commander / 123456` 登录。

---

## 3. 第一步：安装基础环境

### 3.1 JDK 21

**macOS (Homebrew):**
```bash
brew install openjdk@21
export JAVA_HOME=$(brew --prefix openjdk@21)
```

**Ubuntu/Debian:**
```bash
sudo apt update && sudo apt install -y openjdk-21-jdk
```

**Windows:**
下载 [Eclipse Temurin JDK 21](https://adoptium.net/temurin/releases/?version=21) 并安装。

### 3.2 Maven

**macOS:**
```bash
brew install maven
```

**Ubuntu/Debian:**
```bash
sudo apt install -y maven
```

### 3.3 Node.js 18+

推荐使用 [nvm](https://github.com/nvm-sh/nvm)：
```bash
nvm install 18
nvm use 18
```

或直接下载 [Node.js LTS](https://nodejs.org/)。

### 3.4 Docker & Docker Compose

**macOS / Windows:** 安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)

**Ubuntu:**
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

---

## 4. 第二步：启动基础设施（Docker）

以下所有命令均在项目根目录 `UCS_Dev/` 下执行。

### 4.1 创建 Docker 网络

```bash
docker network create ucs_dev_kafka-net 2>/dev/null || true
```

### 4.2 启动 PostgreSQL

```bash
docker compose -f docker-compose.yml up -d
```

> `docker-compose.yml` 包含 PostgreSQL（端口 5432）。

**验证：**
```bash
docker exec -it $(docker ps -qf "name=postgres") psql -U ucs_user -d ucsdb -c "SELECT 1;"
```

### 4.3 启动 Kafka 3-Broker KRaft 集群

```bash
docker compose -f docker-compose-kafka.yml up -d
```

**验证（等待 30 秒后执行）：**
```bash
docker exec kafka-1 kafka-topics.sh --list --bootstrap-server kafka-1:29092
```

> 返回空列表或已有 topic 列表表示正常。

### 4.4 启动 Redis

**开发环境推荐单节点 Redis：**
```bash
docker run -d --name ucs-redis -p 6379:6379 redis:7-alpine
```

**验证：**
```bash
docker exec ucs-redis redis-cli ping
# 预期: PONG
```

> **注意：** 生产环境使用 Redis Cluster（`docker-compose-redis-cluster.yml`）或 Redis Sentinel（`docker-compose-redis-sentinel.yml`）。开发联调不需要。

### 4.5 基础设施状态确认

```bash
# 确认所有容器正常运行
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

预期看到：
- PostgreSQL 容器运行中（5432）
- kafka-1/2/3 运行中（9092/9093/9094）
- ucs-redis 运行中（6379）

---

## 5. 第三步：初始化数据库

> **仅首次部署需要执行。** 后续启动跳过此步。

### 5.1 创建表结构

```bash
docker exec -i $(docker ps -qf "name=postgres") \
  psql -U ucs_user -d ucsdb < backend/src/main/resources/schema.sql
```

### 5.2 导入初始数据

```bash
docker exec -i $(docker ps -qf "name=postgres") \
  psql -U ucs_user -d ucsdb < backend/src/main/resources/data.sql
```

### 5.3 验证数据

```bash
docker exec -it $(docker ps -qf "name=postgres") \
  psql -U ucs_user -d ucsdb -c "SELECT username, real_name FROM users;"
```

预期输出包含：commander、observer、zhangsan、lisi、wangwu、zhaoliu、qianqi、sunba。

---

## 6. 第四步：编译并启动后端微服务

### 6.1 编译整个 ucs-platform

```bash
cd ucs-platform
mvn clean compile
```

> 预期输出：`BUILD SUCCESS`（约 30-60 秒）

### 6.2 微服务启动顺序

微服务之间存在依赖关系，推荐按以下顺序启动。**每个服务需要一个独立的终端窗口。**

#### 启动顺序与依赖关系

```
基础设施 (PostgreSQL + Kafka + Redis)  ← 必须先启动
    │
    ├── [1] ucs-business (:8086)       ← 核心业务（用户/团队/分区）
    ├── [2] ucs-drone-state (:8085)    ← 无人机状态缓存
    ├── [3] ucs-telemetry-ingest (:8081) ← 遥测接入
    ├── [4] ucs-telemetry-store (:8082)  ← 遥测存储
    ├── [5] ucs-realtime-push (:8083)    ← WebSocket推送
    ├── [6] ucs-command (:8084)          ← 命令调度
    │
    └── [7] ucs-api-gateway (:8080)    ← API网关（路由到上述服务）← 最后启动
```

#### 最小启动集（前端联调最少需要）

如果只做基础前端联调，**最少启动 2 个服务**即可：

| 服务 | 说明 | 必须？ |
|------|------|--------|
| `ucs-business` | 登录、用户、团队、无人机列表 | **必须** |
| `ucs-api-gateway` | 前端所有请求的入口，路由到各微服务 | **必须** |
| `ucs-realtime-push` | WebSocket/STOMP 实时推送（地图实时位置） | 建议 |
| `ucs-drone-state` | 无人机状态缓存（无人机在线/离线状态） | 建议 |
| `ucs-command` | 控制命令下发（起飞/降落等操作） | 需要控制功能时 |
| `ucs-telemetry-ingest` | Kafka遥测数据消费 | 接入真实网关时 |
| `ucs-telemetry-store` | 遥测历史数据存储 | 需要历史轨迹时 |

#### 启动命令

在 `ucs-platform/` 目录下，每个终端窗口运行一个服务：

**终端 1 — ucs-business（核心业务）：**
```bash
cd ucs-platform
mvn -pl ucs-business spring-boot:run
```

**终端 2 — ucs-api-gateway（API网关）：**
```bash
cd ucs-platform
mvn -pl ucs-api-gateway spring-boot:run
```

**终端 3 — ucs-realtime-push（实时推送，建议启动）：**
```bash
cd ucs-platform
mvn -pl ucs-realtime-push spring-boot:run
```

**终端 4 — ucs-drone-state（状态缓存，建议启动）：**
```bash
cd ucs-platform
mvn -pl ucs-drone-state spring-boot:run
```

**终端 5 — ucs-command（命令调度）：**
```bash
cd ucs-platform
mvn -pl ucs-command spring-boot:run
```

**终端 6 — ucs-telemetry-ingest（遥测接入）：**
```bash
cd ucs-platform
mvn -pl ucs-telemetry-ingest spring-boot:run
```

**终端 7 — ucs-telemetry-store（遥测存储）：**
```bash
cd ucs-platform
mvn -pl ucs-telemetry-store spring-boot:run
```

### 6.3 验证后端服务健康

每个服务启动后，通过 Actuator 健康检查端点验证：

```bash
# API Gateway
curl -s http://localhost:8080/actuator/health | python3 -m json.tool

# Business
curl -s http://localhost:8086/actuator/health | python3 -m json.tool

# Drone State
curl -s http://localhost:8085/actuator/health | python3 -m json.tool

# Realtime Push
curl -s http://localhost:8083/actuator/health | python3 -m json.tool

# Command
curl -s http://localhost:8084/actuator/health | python3 -m json.tool

# Telemetry Ingest
curl -s http://localhost:8081/actuator/health | python3 -m json.tool

# Telemetry Store
curl -s http://localhost:8082/actuator/health | python3 -m json.tool
```

预期返回：`{"status": "UP"}`

---

## 7. 第五步：启动前端

### 7.1 安装前端依赖

```bash
cd frontend/ucs-dashboard
npm install
```

### 7.2 启动开发服务器

```bash
npm run dev
```

> 默认启动在 `http://localhost:5173`

### 7.3 前端连接配置

前端通过以下逻辑确定后端地址（`src/services/api.ts`）：

1. 如果设置了环境变量 `VITE_API_URL`，使用该值
2. 如果浏览器不在 localhost 访问，使用 `{当前域名}:8080`
3. 默认使用 `http://localhost:8080`（即 API Gateway 端口）

**自定义后端地址（可选）：**

在 `frontend/ucs-dashboard/.env` 文件中添加：
```
VITE_API_URL=http://localhost:8080
```

### 7.4 WebSocket 连接

前端通过 STOMP over WebSocket 接收实时遥测数据：
- WebSocket 端点：`ws://localhost:8080/ws/websocket`
- 由 `StompConnectionManager` 管理（支持自动重连 + REST 降级）

---

## 8. 第六步：验证联调

### 8.1 登录测试

1. 打开浏览器 `http://localhost:5173`
2. 输入用户名 `commander`，密码 `123456`
3. 登录成功后应看到仪表盘界面

### 8.2 API 接口测试

```bash
# 登录获取 Token
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"commander","password":"123456"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

echo "Token: $TOKEN"

# 获取无人机列表
curl -s http://localhost:8080/api/v1/screen/uav/list \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# 获取团队列表
curl -s http://localhost:8080/api/v1/screen/team/list \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### 8.3 WebSocket 连接测试

登录后，打开浏览器开发者工具 (F12) → Network → WS 标签页，应能看到：
- WebSocket 连接到 `ws://localhost:8080/ws/websocket`
- STOMP CONNECTED 帧
- 定期收到遥测数据推送

### 8.4 地图数据测试

如果已接入真实无人机网关（DDS 或 MAVLink），地图上应显示：
- 无人机图标在对应位置
- 位置实时更新
- 点击无人机显示详细信息面板

---

## 9. 端口分配总表

### 后端微服务

| 服务 | 端口 | 说明 |
|------|------|------|
| ucs-api-gateway | 8080 | API 网关（前端请求入口） |
| ucs-telemetry-ingest | 8081 | 遥测数据接入 |
| ucs-telemetry-store | 8082 | 遥测数据存储 |
| ucs-realtime-push | 8083 | WebSocket/STOMP 实时推送 |
| ucs-command | 8084 | 命令调度 |
| ucs-drone-state | 8085 | 无人机状态缓存 |
| ucs-business | 8086 | 核心业务逻辑 |

### 基础设施

| 服务 | 端口 | 说明 |
|------|------|------|
| PostgreSQL | 5432 | 主数据库 |
| Redis | 6379 | 缓存/会话/分区映射 |
| Kafka Broker 1 | 9092 | 消息队列 |
| Kafka Broker 2 | 9093 | 消息队列 |
| Kafka Broker 3 | 9094 | 消息队列 |

### 前端 & 网关

| 服务 | 端口 | 说明 |
|------|------|------|
| 前端 (Vite) | 5173 | React 开发服务器 |
| DDS 网关 | 5050 | 仿真无人机网关（可选） |
| MAVLink 网关 | 14550 | 真实无人机网关（可选） |

### 监控（可选）

| 服务 | 端口 | 说明 |
|------|------|------|
| Prometheus | 9090 | 指标采集 |
| Grafana | 3000 | 仪表盘 |
| Jaeger | 16686 | 链路追踪 |
| Kafka UI | 8090 | Kafka 管理界面 |

---

## 10. 环境变量参考

所有微服务共用的环境变量（均有默认值，开发环境通常不需要修改）：

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `DB_HOST` | `localhost` | PostgreSQL 地址 |
| `DB_PORT` | `5432` | PostgreSQL 端口 |
| `DB_NAME` | `ucs` | 数据库名 |
| `DB_USER` | `ucs` | 数据库用户 |
| `DB_PASS` | `ucs_password` | 数据库密码 |
| `REDIS_HOST` | `localhost` | Redis 地址 |
| `REDIS_PORT` | `6379` | Redis 端口 |
| `KAFKA_BOOTSTRAP_SERVERS` | `localhost:9092` | Kafka Broker 地址 |
| `JWT_SECRET` | `change-me-in-production` | JWT 签名密钥 |
| `VIRTUAL_THREADS_ENABLED` | `true` | 虚拟线程开关（JDK 21 必须） |

**自定义示例：**
```bash
DB_HOST=192.168.1.100 DB_PORT=5432 mvn -pl ucs-business spring-boot:run
```

---

## 11. 微服务模块说明

```
ucs-platform/
├── pom.xml                    # 父 POM（Spring Boot 3.2.0, Spring Cloud 2023.0.0）
├── ucs-common/                # 共享库（不可独立运行）
│   ├── entity/                # JPA 实体类（Drone, User, Team 等）
│   ├── dto/                   # 数据传输对象（ApiResponse, ErrorCode）
│   ├── cache/                 # 多级缓存服务（Caffeine L1 + Redis L2）
│   ├── config/                # 全局异常处理、安全工具
│   └── service/               # 共享服务（Epoch验证、Redis集群、地理空间）
│
├── ucs-api-gateway/           # API 网关（Spring Cloud Gateway, WebFlux）
│   ├── 路由所有 /api/** 请求到对应微服务
│   ├── JWT 验证过滤器
│   └── 全局限流过滤器
│
├── ucs-business/              # 核心业务服务
│   ├── 用户认证 & JWT 签发
│   ├── 团队管理 & 权限控制
│   ├── 无人机 CRUD & 分区路由
│   ├── WebSocket 推送网关
│   └── 遥测数据持久化
│
├── ucs-drone-state/           # 无人机状态缓存
│   ├── Redis 缓存无人机最新状态
│   └── 设备注册/注销管理
│
├── ucs-telemetry-ingest/      # 遥测接入
│   ├── Kafka Consumer 消费原始遥测
│   └── 边缘存储转发（网络中断时本地缓存）
│
├── ucs-telemetry-store/       # 遥测存储
│   ├── Kafka → TimescaleDB 批量写入
│   └── 数据保留策略（自动清理过期数据）
│
├── ucs-realtime-push/         # 实时推送
│   ├── Kafka Consumer → WebSocket STOMP
│   └── 分区级广播（按用户权限推送数据）
│
└── ucs-command/               # 命令调度
    ├── REST 接收控制命令 → Kafka 发送到网关
    ├── 幂等性保护（Redis SETNX）
    └── 线程池拒绝策略（DiscardOldestPolicy, HA优先）
```

---

## 12. 常见问题排查

### Q1: `mvn clean compile` 报错 "cannot find symbol: variable log"

**原因：** Lombok 注解处理器未正确配置。

**解决：** 确保使用的是 `ucs-platform/` 目录下的 `pom.xml`（父 POM 已配置 Lombok 注解处理器）。如果用 IDE 编译，需要安装 Lombok 插件。

### Q2: 启动时报 "Connection refused" (PostgreSQL/Kafka/Redis)

**原因：** 基础设施容器未启动。

**解决：**
```bash
docker ps  # 检查容器状态
docker compose -f docker-compose.yml up -d        # 启动 PostgreSQL
docker compose -f docker-compose-kafka.yml up -d   # 启动 Kafka
docker start ucs-redis                             # 启动 Redis
```

### Q3: 前端登录返回 401

**原因：** API Gateway 未启动，或 ucs-business 未启动。

**解决：** 确保 `ucs-api-gateway`（:8080）和 `ucs-business`（:8086）都已启动。前端所有请求通过 :8080 的 API Gateway 路由。

### Q4: 地图上没有无人机显示

**可能原因：**
1. 数据库中没有无人机数据 → 执行 `data.sql` 初始化
2. WebSocket 未连接 → 检查 `ucs-realtime-push` 是否启动
3. 未接入无人机网关 → 需要启动 DDS 网关或 MAVLink 网关发送遥测数据

**排查：**
```bash
# 检查数据库中有无无人机
docker exec -it $(docker ps -qf "name=postgres") \
  psql -U ucs_user -d ucsdb -c "SELECT uav_id, drone_sn FROM drones;"
```

### Q5: Kafka 连接超时

**原因：** Kafka 集群尚未完全初始化（KRaft 需要 30-60 秒）。

**解决：** 等待 60 秒后重试，或检查 Kafka 日志：
```bash
docker logs kafka-1 --tail 20
```

### Q6: 端口已被占用

**解决：**
```bash
# 查找占用进程
lsof -i :8080  # 替换为被占用的端口号
kill -9 <PID>
```

### Q7: API Gateway 路由 404

**原因：** 目标微服务未启动。API Gateway 按路径前缀路由，找不到后端时返回 404。

**解决：** 确保对应的微服务已启动。查看 API Gateway 的路由配置：`ucs-api-gateway/src/main/resources/application.yml`。

### Q8: IDE 中无法识别 Lombok 注解

**IntelliJ IDEA：**
1. 安装 Lombok 插件（Settings → Plugins）
2. 启用注解处理器（Settings → Build → Compiler → Annotation Processors → Enable）

**VS Code：**
安装 "Lombok Annotations Support" 扩展。

---

## 13. 测试账号

所有账号密码均为 `123456`。

| 用户名 | 姓名 | 角色 | 所属团队 | 说明 |
|--------|------|------|----------|------|
| `commander` | 指挥官 | 指挥员 | 无 | 最高权限，可查看全局、管理所有资源 |
| `observer` | 观察员 | 观察员 | 无 | 全局只读，用于大屏展示 |
| `zhangsan` | 张三 | 队长 | 巡检队伍 | 可管理队员、分配无人机 |
| `lisi` | 李四 | 队员 | 巡检队伍 | 普通飞手 |
| `wangwu` | 王五 | 队员 | 巡检队伍 | 普通飞手 |
| `zhaoliu` | 赵六 | 队长 | 应急队伍 | 可管理队员、分配无人机 |
| `qianqi` | 钱七 | 队员 | 应急队伍 | 普通飞手 |
| `sunba` | 孙八 | 队员 | 应急队伍 | 普通飞手 |

---

## 14. 附录：虚拟线程说明

本项目**强制要求 JDK 21**，因为核心代码（如 `MultiLevelCacheService`）直接使用了 `Thread.ofVirtual()` API 来提升并发性能。

所有微服务的 `application.yml` 中配置了：

```yaml
spring:
  threads:
    virtual:
      enabled: ${VIRTUAL_THREADS_ENABLED:true}
```

**虚拟线程的使用场景：**

| 场景 | 实现方式 | 说明 |
|------|---------|------|
| HTTP 请求处理 | `spring.threads.virtual.enabled=true` | Tomcat 每个请求使用虚拟线程 |
| 缓存异步刷新（T-24） | `Thread.ofVirtual().name("cache-refresh-" + key).start(...)` | 防止缓存击穿时的后台DB加载 |
| IO 密集型操作 | 虚拟线程自动调度 | 数据库查询、Redis操作、Kafka消费等 |

**结论：** JDK 21 是硬性要求，不可降级到 JDK 17。虚拟线程是本项目的核心并发策略。

---

## 快速参考卡片

```
┌──────────────────────────────────────────────────────────┐
│                    UCS-Platform 快速启动                    │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  基础设施:                                                │
│    docker compose -f docker-compose.yml up -d            │
│    docker compose -f docker-compose-kafka.yml up -d      │
│    docker run -d --name ucs-redis -p 6379:6379 redis:7   │
│                                                          │
│  后端 (在 ucs-platform/ 目录):                            │
│    mvn clean compile                                     │
│    mvn -pl ucs-business spring-boot:run     # :8086     │
│    mvn -pl ucs-api-gateway spring-boot:run  # :8080     │
│                                                          │
│  前端 (在 frontend/ucs-dashboard/ 目录):                  │
│    npm install && npm run dev               # :5173     │
│                                                          │
│  测试:                                                    │
│    浏览器 → http://localhost:5173                         │
│    登录 → commander / 123456                             │
│                                                          │
│  健康检查:                                                │
│    curl http://localhost:8080/actuator/health            │
│    curl http://localhost:8086/actuator/health            │
│                                                          │
└──────────────────────────────────────────────────────────┘
```
