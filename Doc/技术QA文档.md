# UCS 无人机集群控制系统 — 技术 Q&A 文档

> **版本**: 1.0  
> **更新日期**: 2026-04-14  
> **适用分支**: FUIAttemptation  
> **目的**: (1) 技术底层实现原理参考 (2) 系统升级分析依据

---

## 目录

1. [数据流与路由](#1-数据流与路由)
2. [后端数据处理](#2-后端数据处理)
3. [Redis 与数据库双写一致性](#3-redis-与数据库双写一致性)
4. [数据库选型与设计](#4-数据库选型与设计)
5. [线程池与并发](#5-线程池与并发)
6. [事务管理](#6-事务管理)
7. [AOP 应用](#7-aop-应用)
8. [DDS 与 MAVLink 协议](#8-dds-与-mavlink-协议)
9. [坐标系与高度](#9-坐标系与高度)
10. [降落功能实现](#10-降落功能实现)
11. [心跳线程架构](#11-心跳线程架构)
12. [集结点与搜索](#12-集结点与搜索)
13. [精度与导航](#13-精度与导航)
14. [避障机制](#14-避障机制)
15. [方向计算](#15-方向计算)
16. [RBAC 权限模型](#16-rbac-权限模型)
17. [地址解析](#17-地址解析)
18. [Kafka 配置与消息有序性](#18-kafka-配置与消息有序性)
19. [SSO 与 JWT](#19-sso-与-jwt)
20. [多级缓存策略](#20-多级缓存策略)
21. [无人机状态流转](#21-无人机状态流转)
22. [Redis 数据结构](#22-redis-数据结构)
23. [Kafka 消息持久化与偏移量](#23-kafka-消息持久化与偏移量)
24. [TimescaleDB 选型](#24-timescaledb-选型)
25. [AOP 日志](#25-aop-日志)
26. [Epoch 机制](#26-epoch-机制)
27. [消息丢失防护](#27-消息丢失防护)
28. [Docker 模块架构](#28-docker-模块架构)
29. [Spring Task 调度](#29-spring-task-调度)
30. [Java 21 虚拟线程](#30-java-21-虚拟线程)
31. [网关数据路由原理](#31-网关数据路由原理)
32. [错误处理与韧性](#32-错误处理与韧性)
33. [监控与可观测性](#33-监控与可观测性)
34. [可扩展性分析](#34-可扩展性分析)
35. [性能瓶颈与优化路径](#35-性能瓶颈与优化路径)
36. [未来升级路线图](#36-未来升级路线图)

---

## 1. 数据流与路由

### Q1: 网关路由节点处理了订阅到的数据是直接将数据标记了一个分区发送给了后端，还是将数据发送到了对应的 DDS 网络分区？

**答：网关将数据以 `uav_id` 为 Key 发送到 Kafka Topic `telemetry.raw`，由 Kafka 的 murmur2 哈希分区策略决定进入哪个 Kafka 物理分区，而非 DDS 网络分区。**

#### 数据流全链路

```
PX4飞控 --DDS/MAVLink--> 网关(Python) --Kafka(key=uav_id)--> telemetry.raw --消费者--> 后端(Java)
```

#### 具体实现

**网关侧（`dds-gateway/dds_gateway.py` 第960-993行）：**

```python
def send_to_kafka(self, payload: dict) -> bool:
    drones = payload.get('drones', [])
    for drone_data in drones:
        uav_id = drone_data.get('uavId', '')
        msg = dict(drone_data)
        msg['timestamp'] = timestamp_ms
        msg['epoch'] = self._epoch_map.get(uav_id, 0)
        # Key = uav_id -> same partition -> ordered
        self._kafka_producer.send('telemetry.raw', key=uav_id, value=msg)
```

关键点：
1. **网关不做逻辑分区** — 网关只负责将每架无人机的遥测数据以 `uav_id` 为 Key 发送到 `telemetry.raw` Topic
2. **Kafka 物理分区** — Kafka 使用 `murmur2(uav_id) % 16` 决定消息进入哪个分区（共16个分区，见 `KafkaConfig.java` 第17行注释）
3. **逻辑分区（用户可见分区）在后端完成** — 后端 `TelemetryKafkaConsumer` 消费后调用 `PartitionRoutingService.getPartitionsForDrone()` 做逻辑路由

**后端消费侧（`TelemetryKafkaConsumer.java` 第90-98行）：**

```java
// --- 分区路由 + WebSocket 推送 ---
Set<String> partitions = partitionRoutingService.getPartitionsForDrone(uavId);
Map<String, List<Map<String, Object>>> partitionData = new LinkedHashMap<>();
for (String partition : partitions) {
    partitionData.computeIfAbsent(partition, k -> new ArrayList<>()).add(payload);
}
webSocketGatewayService.broadcastToPartitions(partitionData, timestamp);
```

#### 两层分区的区别

| 分区类型 | 层级 | 机制 | 目的 |
|---------|------|------|------|
| **Kafka 物理分区** | 传输层 | `murmur2(uav_id) % 16` | 保证同一架无人机消息有序、支持并行消费 |
| **用户逻辑分区** | 业务层 | `drone_partition_map` 表 | 决定哪些用户/角色能看到哪些无人机数据 |

#### 升级建议

当前网关的 Kafka 物理分区是 16 个（全局默认值），这意味着最多 16 个消费者实例可以并行消费。如果无人机数量超过数百架，建议：
- 将 `telemetry.raw` 分区数提升至 32 或 64
- 相应调整消费者 `concurrency` 参数

---

### Q2: 网关多实例部署时的数据路由分片逻辑是什么？

**答：当前使用静态 MD5 哈希分片，每个网关实例只处理属于自己的无人机子集。**

**DDS 网关（`dds_gateway.py` 第240-253行）：**

```python
def _owns_drone(self, uav_id: str) -> bool:
    if self.total_instances <= 1:
        return True
    h = int(hashlib.md5(uav_id.encode('utf-8')).hexdigest(), 16)
    owner = h % self.total_instances
    return owner == self.instance_id
```

**MAVLink 网关（`mavlink_gateway.py` 第290-296行）：**

```python
def _owns_drone(self, uav_id: str) -> bool:
    if self.total_instances <= 1:
        return True
    h = int(hashlib.md5(uav_id.encode('utf-8')).hexdigest(), 16)
    owner = h % self.total_instances
    return owner == self.instance_id
```

两个网关使用完全一致的分片算法。当 `total_instances=3` 时：
- 实例0处理 `md5(uav_id) % 3 == 0` 的无人机
- 实例1处理 `md5(uav_id) % 3 == 1` 的无人机
- 实例2处理 `md5(uav_id) % 3 == 2` 的无人机

**局限性**：
- 静态分片，新增/移除实例需要重启所有网关
- 分片不均匀时无法动态调整
- 未接入 Nacos 实现动态服务发现

**升级方向**：接入 Nacos 实现一致性哈希动态分片（详见 `Doc/Nacos_DDS_Gateway_Deployment_Guide.md`）

---

## 2. 后端数据处理

### Q3: 后端订阅或接收到数据之后是如何区分电量信息和位姿数据的？

**答：后端不通过 Kafka Topic 区分电量和位姿，而是从单条遥测消息的 JSON 字段中直接提取。**

#### 原因

网关侧已将所有数据聚合到一条消息中。DDS 网关（`dds_gateway.py`）为每架无人机维护一个 `DroneState` 对象（第76-108行），各 DDS 话题回调更新对应字段：

```python
@dataclass
class DroneState:
    uav_id: str
    lat: float = 0.0          # 来自 VehicleGlobalPosition（_on_global_position）
    lon: float = 0.0          # 来自 VehicleGlobalPosition
    alt: float = 0.0          # 来自 VehicleGlobalPosition（AMSL）
    heading: float = 0.0      # 来自 VehicleAttitude（_on_attitude，四元数转偏航）
    ground_speed: float = 0.0 # 来自 VehicleLocalPosition（_on_local_position，sqrt(vx²+vy²)）
    vertical_speed: float = 0.0 # 来自 VehicleLocalPosition（-vz）
    vx: float = 0.0           # 来自 VehicleLocalPosition
    vy: float = 0.0           # 来自 VehicleLocalPosition
    vz: float = 0.0           # 来自 VehicleLocalPosition
    ned_x: float = 0.0        # 来自 VehicleLocalPosition
    ned_y: float = 0.0        # 来自 VehicleLocalPosition
    ned_z: float = 0.0        # 来自 VehicleLocalPosition
    armed: bool = False        # 来自 VehicleStatus（_on_vehicle_status）
    flight_mode: str = "UNKNOWN" # 来自 VehicleStatus
    battery_percent: float = -1.0 # 来自 BatteryStatus（_on_battery_status）
```

当主循环发送 Kafka 消息时（`build_telemetry_payload`，第1013-1058行），所有字段被序列化为一个扁平 JSON：

```json
{
  "uavId": "px4_1",
  "lat": 47.397742,
  "lon": 8.545594,
  "alt": 5.2,
  "heading": 90.0,
  "groundSpeed": 2.5,
  "batteryPercent": 85.0,
  "armed": true,
  "flightMode": "OFFBOARD",
  "epoch": 3
}
```

**后端消费侧**直接通过 JSON 字段名提取各类数据：
- **位姿**：`lat`、`lon`、`alt`、`heading`、`nedX/Y/Z`
- **速度**：`groundSpeed`、`verticalSpeed`、`vx/vy/vz`
- **电量**：`batteryPercent`
- **状态**：`armed`、`flightMode`

**持久化层**（`TelemetryPersistenceService.java` 第57-68行）：

```java
public void persistFromMap(Map<String, Object> telemetryMsg) {
    record.lat = ((Number) telemetryMsg.getOrDefault("lat", 0.0)).doubleValue();
    record.lon = ((Number) telemetryMsg.getOrDefault("lon", 0.0)).doubleValue();
    record.alt = ((Number) telemetryMsg.getOrDefault("alt", 0.0)).doubleValue();
    record.heading = ((Number) telemetryMsg.getOrDefault("heading", 0.0)).doubleValue();
    record.groundSpeed = ((Number) telemetryMsg.getOrDefault("groundSpeed", 0.0)).doubleValue();
}
```

**架构设计考量**：将所有数据合并为单条消息（而非分多个 Topic）的原因：
1. 减少 Kafka Topic 数量和管理复杂度
2. 前端只需订阅一个 WebSocket Topic 即可获得完整无人机状态
3. 遥测数据具有时间相关性，合并后保证同一时间戳的数据一致性

---

## 3. Redis 与数据库双写一致性

### Q4: 如何保证 Redis 和数据库的双写一致性？为什么这么做？是不是使用了延迟双删策略？

**答：未使用延迟双删，而是采用了「Transactional Outbox + Post-Commit Hook」模式。**

#### 为什么不用延迟双删？

延迟双删策略（先删缓存 → 写DB → sleep → 再删缓存）存在以下问题：
1. **sleep 时间难以确定** — 需要估算 DB 复制延迟和 Redis 响应时间，过短会留下脏数据，过长影响性能
2. **第二次删除可能失败** — 如果第二次 DELETE 失败，缓存中将永久保留脏数据
3. **不适合高频更新场景** — 遥测数据 10Hz 更新，频繁的 sleep 会严重拖慢吞吐

#### 当前实现：Transactional Outbox + Post-Commit Hook

**`PartitionRoutingService.java` 第19-58行的 Javadoc 完整描述了这个模式：**

```
Dual-Write Consistency Strategy: Transactional Outbox + Post-Commit Hook

1. DB-first write: 所有分区变更在 @Transactional 边界内持久化到 PostgreSQL。DB 是单一事实来源。
2. Post-commit Redis sync: DB 事务提交后，TransactionSynchronization.afterCommit() 
   回调将变更传播到 Redis。保证 DB 回滚时 Redis 绝不被更新。
3. Retry queue: Post-commit Redis 写入失败时，操作入队 ConcurrentLinkedQueue，
   定时任务以指数退避方式重试。
4. Periodic reconciliation: 每 60 秒定时任务检测并修复 DB 与 Redis 之间的偏差。
```

**核心代码（`PartitionRoutingService.java` 第204-230行）：**

```java
private void registerPostCommitRedisSync(String uavId, Set<String> newPartitions, 
                                          Set<String> removedPartitions) {
    Runnable redisSync = () -> syncToRedis(uavId, newPartitions, removedPartitions);

    if (TransactionSynchronizationManager.isSynchronizationActive()) {
        TransactionSynchronizationManager.registerSynchronization(
            new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    try {
                        redisSync.run();
                    } catch (Exception e) {
                        pendingRedisSyncQueue.offer(redisSync);  // 失败入队重试
                    }
                }
            });
    } else {
        // 无事务上下文时立即执行
        try { redisSync.run(); } 
        catch (Exception e) { pendingRedisSyncQueue.offer(redisSync); }
    }
}
```

**重试机制（`PartitionRoutingService.java` 第253-273行）：**

```java
@Scheduled(fixedDelay = 5000)
public void retryPendingRedisSync() {
    int size = pendingRedisSyncQueue.size();
    if (size == 0) return;
    for (int i = 0; i < size; i++) {
        Runnable op = pendingRedisSyncQueue.poll();
        try { op.run(); } 
        catch (Exception e) { pendingRedisSyncQueue.offer(op); }  // 失败重新入队
    }
}
```

**定期对账（`PartitionRoutingService.java` 第280-316行）：**

```java
@Scheduled(fixedDelay = 60000, initialDelay = 30000)
public void reconcileDbRedis() {
    // 从 DB 加载所有活跃分区映射
    // 逐一与 Redis 比较
    // DB 不一致 → 以 DB 为准覆盖 Redis
}
```

#### 一致性保证

| 场景 | 处理策略 | 收敛时间 |
|------|---------|---------|
| 正常写入 | afterCommit 回调同步 Redis | <100ms |
| Redis 暂时不可用 | ConcurrentLinkedQueue 重试 | 5s per cycle |
| Redis 重启/宕机恢复 | 60s 对账任务兜底 | ≤60s |
| DB 事务回滚 | afterCommit 不会触发，Redis 不变 | 0ms（无脏数据） |

#### 升级建议

- 当前重试队列是内存级（`ConcurrentLinkedQueue`），进程重启会丢失。可引入 Kafka 持久化重试
- 对账任务扫描全表，可优化为增量扫描（通过 `updated_at > last_reconcile_time`）
- 多实例部署时，对账任务需要分布式锁防止并发执行

---

## 4. 数据库选型与设计

### Q5: 数据库选型理由是什么？为什么有 PostgreSQL 又有 TimescaleDB？

**答：PostgreSQL 负责业务数据（OLTP），TimescaleDB 负责时序遥测数据（TSDB），职责分离。**

#### Docker 配置（`docker-compose-microservices.yml`）

```yaml
# PostgreSQL 16-alpine — 业务数据库（端口5432）
postgres:
  image: postgres:16-alpine
  ports: ["5432:5432"]
  environment:
    POSTGRES_DB: ucsdb
    
# TimescaleDB latest-pg16 — 遥测时序数据库（端口5433）
timescaledb:
  image: timescale/timescaledb:latest-pg16
  ports: ["5433:5432"]
  environment:
    POSTGRES_DB: ucs_telemetry
```

#### 选型理由

| 维度 | PostgreSQL (业务) | TimescaleDB (遥测) |
|------|------------------|-------------------|
| **数据特征** | 用户、角色、任务、权限 — 关系型，低频写 | 遥测轨迹 — 时序型，10Hz × N架无人机高频写 |
| **查询模式** | CRUD、JOIN、事务 | 按时间范围聚合、最新值查询、降采样 |
| **写入频率** | <100 TPS | 每架无人机 10 条/秒 × 无人机数 |
| **保留策略** | 永久保存 | 可配置自动压缩 + 保留策略（如保留30天） |
| **扩展能力** | 标准 PostgreSQL 即可 | 自动分区（hypertable）、透明压缩 |

#### 数据库 Schema 设计

**业务库（`schema.sql`，共23张表）：**

| 核心表 | 用途 | 关键字段 |
|--------|------|---------|
| `users` (第34-49行) | 用户账号 | `username`, `password_hash`, `team_id`, `partition_name` |
| `roles` (第8-14行) | 角色定义 | `role_name`: PILOT, OPERATOR, LEADER, COMMANDER |
| `drones` (第74-95行) | 无人机注册 | `uav_id`, `mavlink_ip`, `mavlink_port`, `connection_protocol` |
| `drone_ownership` (第141-150行) | 控制权归属 | `drone_id`, `user_id`, `expired_at` |
| `drone_partition_map` (第153-161行) | 分区路由映射 | `uav_id`, `partition_name`, `is_active` |
| `command_log` (第214-222行) | 指令日志 | `command_type`, `payload`, `status` |
| `operation_log` (第236-249行) | 操作审计 | `operation_type`, `detail`, `result` |
| `rally_points` (第276-296行) | 集结点 | `latitude`, `longitude`, `capacity`, `scope` |

**遥测库：**

| 表 | 用途 | 关键字段 |
|---|------|---------|
| `uav_telemetry` (第346-365行) | 全量时序历史 | `uav_id`, `timestamp`, `lat/lon/alt`, `heading`, 14个字段 |
| `uav_latest_state` (第370-388行) | 每架无人机最新状态（upsert） | `uav_id` (PK), `last_update`, 同上14个字段 |

#### 升级建议

- TimescaleDB 的 `uav_telemetry` 表应转换为 hypertable：`SELECT create_hypertable('uav_telemetry', 'timestamp');`
- 启用压缩策略：`ALTER TABLE uav_telemetry SET (timescaledb.compress); SELECT add_compression_policy('uav_telemetry', INTERVAL '7 days');`
- 添加保留策略：`SELECT add_retention_policy('uav_telemetry', INTERVAL '90 days');`

---

## 5. 线程池与并发

### Q6: 线程池配置的依据是什么？

**答：当前系统在网关和后端分别使用不同线程池，配置基于任务类型和延迟要求。**

#### DDS 网关线程模型（`dds_gateway.py`）

| 线程/线程池 | 配置 | 用途 | 代码位置 |
|------------|------|------|---------|
| `cmd-dispatch` | `ThreadPoolExecutor(max_workers=10)` | 并行派发控制命令 | 第157行 |
| `ack-fwd` | `ThreadPoolExecutor(max_workers=4)` | 异步转发命令回执 | 第195行 |
| `ros2-spin` | 单线程 | 专用 ROS2 消息处理 | 第1193-1216行 |
| `kafka-cmd-consumer` | 单线程 | 消费 commands.down | 第830行 |
| `epoch-maintenance` | 单线程 | 周期性 epoch 维护 | 第956行 |
| `heartbeat-{uav_id}` | 每架无人机一个线程 | OFFBOARD 模式 4Hz 心跳 | 第1999行 |
| `orbit-{uav_id}` | 每架无人机一个线程 | 盘旋轨迹 10Hz 更新 | 第2109行 |
| `command-server` | 单线程 | HTTP 命令接收服务器 | 第2192行 |

**配置依据：**

- **cmd-dispatch(10)**: 多机批量指令场景下需要并行派发。10个 worker 支持同时向10架无人机发送命令。过多 worker 无意义因为 DDS 发布本身是非阻塞的
- **ack-fwd(4)**: ACK 转发涉及网络 I/O（Kafka 或 HTTP），4个 worker 足以覆盖峰值 ACK 频率
- **heartbeat（每架一个）**: PX4 要求 OFFBOARD 模式下 >2Hz 持续心跳，独立线程避免其他操作延迟影响心跳频率

#### MAVLink 网关线程模型（`mavlink_gateway.py`）

与 DDS 网关基本相同，额外增加：

| 线程 | 用途 | 代码位置 |
|------|------|---------|
| `udp-listener` | UDP 数据包接收 | 第963-999行 |
| `tcp-listener` | TCP 连接接受 | 第1001-1033行 |
| `tcp-client-{addr}` | 每个 TCP 连接一个线程 | 第1035-1075行 |

#### 后端线程模型

| 组件 | 配置 | 用途 |
|------|------|------|
| `TelemetryKafkaConsumer` | `concurrency = "4"` | 4个并发消费者线程 |
| `TelemetryPersistenceService` | `@Scheduled(fixedDelay = 5000)` | 5s 批量落盘 |
| `PartitionRoutingService` | `@Scheduled(fixedDelay = 5000)` + `@Scheduled(fixedDelay = 60000)` | 重试 + 对账 |

**Kafka 消费者 concurrency=4 的依据**：`telemetry.raw` 有 16 个分区，4个消费者线程各分配4个分区。增加到16个线程可以 1:1 对应分区，但要权衡 CPU 资源。

#### 升级建议

- **心跳线程合并**：当前每架无人机一个心跳线程，100架无人机就有100个线程。应改为单线程调度器（如 `ScheduledThreadPoolExecutor`）统一管理所有无人机的心跳定时任务
- **asyncio 重构**：网关的 I/O 密集型操作（Kafka 发送、HTTP 转发、Redis 读写）适合 asyncio 协程模型，可大幅减少线程数
- **命令派发优化**：`ThreadPoolExecutor(10)` 可改为 `max_workers = min(len(drone_states), 20)`，动态调整

---

## 6. 事务管理

### Q7: 编程式事务与声明式事务的使用场景？当前项目中的实际应用？

**答：当前项目以声明式事务（`@Transactional`）为主，编程式事务（`TransactionSynchronizationManager`）用于 Post-Commit Hook。**

#### 声明式事务（`@Transactional`）

适用于整个方法需要包裹在一个事务中的场景。项目中大量使用：

**ControlService.java 第56行**：

```java
@Transactional
public ControlCommandResponse sendControlCommand(ControlCommandRequest request,
                                                   Long userId, String username) {
    // 1. 查询无人机 → 2. 校验权限 → 3. 检查在线 → 4. 记录日志 → 5. 发送命令
    // 整个流程要么全部成功，要么全部回滚
}
```

**PermissionService.java 第58行**：

```java
@Transactional
public boolean transferPermission(String uavId, Long toUserId,
                                   Long operatorId, String operatorName) {
    // 1. 过期旧归属 → 2. 创建新归属 → 3. 更新 Redis → 4. 重算分区
    // 权限转移必须原子性完成
}
```

**RallyPointService.java 第30、41、68行**：所有 CUD 操作均声明式事务。

#### 编程式事务（TransactionSynchronizationManager）

用于需要在事务提交后执行副作用操作（如 Redis 同步）的场景：

**PartitionRoutingService.java 第207-220行**：

```java
TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
    @Override
    public void afterCommit() {
        // 只有在 DB 事务成功提交后才执行 Redis 同步
        // 如果事务回滚，此回调不会被触发
        syncToRedis(uavId, newPartitions, removedPartitions);
    }
});
```

这里不能用声明式事务，因为需要精确控制「事务提交后」的时机，避免 Redis 写入先于 DB 提交导致数据不一致。

#### 比较

| 特性 | 声明式（`@Transactional`） | 编程式（TransactionSynchronizationManager） |
|------|--------------------------|-------------------------------------------|
| 适用场景 | 方法级事务边界 | 事务生命周期钩子（before/after commit） |
| 代码侵入性 | 低（注解即可） | 高（需要手动注册回调） |
| 灵活性 | 低（只能控制整个方法） | 高（可控制事务内/后的精确行为） |
| 项目使用 | ControlService, PermissionService, RallyPointService | PartitionRoutingService |

#### 升级建议

- 考虑引入 `TransactionTemplate` 编程式事务，用于需要细粒度控制的批量操作
- 大规模权限批量转移可考虑 `REQUIRES_NEW` 传播级别，避免单个失败回滚整个批次

---

## 7. AOP 应用

### Q8: 项目中有哪些 AOP 的应用场景？

**答：当前项目的 AOP 应用主要体现在 Spring Security 的过滤器链和声明式事务，尚未显式使用自定义 AOP 切面。**

#### 隐式 AOP（框架级）

1. **`@Transactional` 事务代理**：Spring 通过 AOP 代理拦截 `@Transactional` 注解方法，在方法前开启事务、方法后提交/回滚。底层使用 `TransactionInterceptor`
2. **Spring Security 过滤器链**：`JwtAuthenticationFilter`（第47-72行）作为 `OncePerRequestFilter` 注册在 Spring Security 过滤器链中，本质是 Servlet Filter 而非 AOP，但实现了类似的横切关注点处理
3. **`@Scheduled` 调度代理**：`TelemetryPersistenceService.flushBuffer()`、`PartitionRoutingService.retryPendingRedisSync()` 和 `reconcileDbRedis()` 通过 Spring Task Scheduler AOP 代理实现定时执行

#### 可扩展的 AOP 场景（当前未实现）

| 场景 | 切面类型 | 实现建议 |
|------|---------|---------|
| **操作日志自动化** | `@Around` | 当前操作日志通过 `operationLogService.recordOperation()` 手动调用，可改为注解式 `@OperationLog(type="CONTROL_COMMAND")` |
| **方法耗时监控** | `@Around` | 对 Kafka 消费者、Redis 操作、DB 查询添加耗时统计 |
| **参数校验** | `@Before` | 对 `uavId`、`userId` 等通用参数做非空/格式校验 |
| **权限校验** | `@Before` | 替代 `ControlService` 中手动查询 `droneOwnershipRepository` 的逻辑 |
| **异常统一处理** | `@AfterThrowing` | 统一处理 Redis 不可用、Kafka 发送失败等异常 |

#### 升级建议

推荐实现一个统一的操作审计切面：

```java
@Aspect
@Component
public class OperationLogAspect {
    @Around("@annotation(opLog)")
    public Object logOperation(ProceedingJoinPoint pjp, OperationLog opLog) {
        // Before: 记录操作开始
        // Execute: result = pjp.proceed()
        // After: 记录操作结果（成功/失败/耗时）
    }
}
```

---

## 8. DDS 与 MAVLink 协议

### Q9: DDS 网关与 MAVLink 网关的区别是什么？

**答：两者是数据源不同的对等网关，产生完全相同格式的 Kafka 消息，后端和前端零改动。**

#### 架构对比

```
仿真无人机 --DDS话题订阅--> DDS网关(rclpy) ---+
                                              |--- Kafka(telemetry.raw) --> 后端
真实无人机 --MAVLink UDP/TCP--> MAVLink网关 ---+
```

#### 核心差异

| 维度 | DDS 网关 (`dds_gateway.py`) | MAVLink 网关 (`mavlink_gateway.py`) |
|------|---------------------------|-------------------------------------|
| **数据源** | ROS2 DDS 话题（发布/订阅） | MAVLink UDP/TCP 数据包 |
| **依赖** | `rclpy`, `px4_msgs` | `pymavlink` |
| **uav_id 生成** | 从 DDS 话题名提取（`px4_1`, `px4_2`） | 从源IP+端口生成（`mavlink_192.168.1.101_14550`） |
| **数据接收方式** | ROS2 回调（`_on_global_position` 等） | 二进制解析（`_dispatch_mavlink_message`） |
| **命令发送方式** | DDS 话题发布（`publish_vehicle_command`） | MAVLink COMMAND_LONG 封装（`_send_mavlink_command_long`） |
| **IP映射** | 不需要（DDS 自动发现） | 三级缓存（本地→Redis→PG） |
| **代码行数** | ~2275行 | ~2044行 |
| **Epoch Redis 键前缀** | `dds:epoch:{uavId}` | `mavlink:epoch:{uavId}` |

#### 完全相同的部分

- Kafka 生产者配置和发送逻辑
- Epoch 校验机制
- 多实例分片（MD5 哈希）
- GPS 跳变检测
- OFFBOARD 心跳线程
- 盘旋轨迹计算
- 命令处理 `handle_command()` 逻辑
- 统计日志
- HTTP 命令服务器

#### MAVLink 网关独有功能

**IP 映射三级缓存（`mavlink_gateway.py` 第302-394行）：**

```
写入：Redis → 本地缓存 → Kafka(events.drone) → 后端 PG 持久化
读取：本地缓存 → Redis → 后端 API(PG查询)
```

MAVLink 无法像 DDS 那样通过话题名自动识别无人机，必须维护 IP↔uav_id 映射关系。

---

### Q10: DDS 与 MAVLink 的消息格式差异

| 维度 | DDS (PX4) | MAVLink v2 |
|------|-----------|-----------|
| **序列化** | CDR (Common Data Representation) | 自定义二进制编码 |
| **传输** | UDP multicast (RTPS) | UDP unicast / TCP |
| **消息发现** | 自动（RTPS 发现协议） | 手动配置（IP:Port） |
| **位置精度** | `float64`（lat/lon）、`float32`（alt） | `int32`（lat/lon × 1e7）、`int32`（alt × 1e3） |
| **心跳** | 话题刷新即为心跳 | 专用 HEARTBEAT(#0) 消息 1Hz |
| **命令确认** | VehicleCommandAck DDS 话题 | COMMAND_ACK(#77) MAVLink 消息 |
| **QoS** | DDS QoS Profile（可靠/尽力） | 无 QoS 保证 |
| **适用场景** | 仿真（PX4 SITL/ROS2环境） | 真实无人机（飞控原生支持） |

---

## 9. 坐标系与高度

### Q11: 系统中涉及哪些坐标系和高度类型？

**答：系统涉及 WGS84（全球坐标）、NED（本地坐标）和两种高度类型（AMSL 和相对高度）。**

#### 坐标系

**1. WGS84（World Geodetic System 1984）**
- 字段：`lat`（纬度）、`lon`（经度）、`alt`（海拔）
- 来源：PX4 的 `VehicleGlobalPosition` / MAVLink `GLOBAL_POSITION_INT`
- 用途：地图显示、前端渲染、GOTO/RTL 命令参数
- 精度：DDS `float64` ≈ 15位有效数字 ≈ 毫米级；MAVLink `int32/1e7` ≈ ~1cm

**2. NED（North-East-Down）本地坐标**
- 字段：`nedX`（北）、`nedY`（东）、`nedZ`（下）
- 来源：PX4 的 `VehicleLocalPosition` / MAVLink `LOCAL_POSITION_NED`
- 用途：OFFBOARD 模式位置控制、心跳 setpoint、到达检测
- 特点：`z` 轴朝下为正，即 z=-5 表示距 Home 点上方5米

**WGS84→NED 转换（`dds_gateway.py` 第111-124行）：**

```python
def _latlon_to_ned(lat, lon, alt, home_lat, home_lon, home_alt):
    """简化平面地球近似，10km 范围内精度足够。"""
    EARTH_RADIUS = 6371000.0
    dlat = math.radians(lat - home_lat)
    dlon = math.radians(lon - home_lon)
    north = dlat * EARTH_RADIUS
    east = dlon * EARTH_RADIUS * math.cos(math.radians(home_lat))
    down = -(alt - home_alt)
    return north, east, down
```

#### 高度类型

| 高度类型 | 字段名 | 含义 | 来源 | 用途 |
|---------|--------|------|------|------|
| **AMSL** | `alt` (DroneState) / `altAmsl` (JSON) | 海平面绝对高度 | VehicleGlobalPosition.alt | 数据库持久化、PX4 TAKEOFF 命令参数 |
| **相对高度** | `alt` (JSON输出) | 距 Home 点高度 | `alt - ref_alt` 或 `-ned_z` | 前端显示、用户感知高度 |
| **ref_alt** | `ref_alt` (DroneState) | Home 点的 AMSL 高度 | VehicleLocalPosition.ref_alt | 计算相对高度的基准 |

**相对高度计算逻辑（`dds_gateway.py` 第1030-1033行）：**

```python
# 优先使用 ref_alt（精确）
if state.ref_alt_valid and state.alt > 0:
    relative_alt = state.alt - state.ref_alt
# 备选使用 -ned_z（NED 框架直接给出相对高度）
else:
    relative_alt = -state.ned_z
```

**为什么这两种方式等价**：
- `ref_alt` = Home 点的 AMSL 高度
- `alt` = 当前 AMSL 高度
- `alt - ref_alt` = 当前高度 - Home 高度 = 相对高度
- `ned_z` = -(当前高度 - Home 高度)，所以 `-ned_z` = 相对高度

#### 升级建议

- 当前使用平面地球近似（`_latlon_to_ned`），在 10km 范围内误差 <0.1%。如果需要支持长距离飞行，应改用 Vincenty 公式或 pyproj 库
- 前端 3D 渲染高度需要考虑地形海拔，当前已通过高德地图地形 API 查询地面海拔

---

## 10. 降落功能实现

### Q12: 降落命令是如何实现的？

**答：通过 MAV_CMD_NAV_LAND (cmd=21) 实现，支持原地降落和指定坐标降落。**

**DDS 网关实现（`dds_gateway.py` 第1640-1651行）：**

```python
elif command_type == 'LAND':
    # 停止心跳（退出 OFFBOARD 模式）
    self.stop_offboard_heartbeat(uav_id)
    lat = float(params.get('lat', 0))
    lon = float(params.get('lon', 0))
    alt = float(params.get('alt', 0))
    if lat != 0 and lon != 0:
        # 指定坐标降落
        ok = self.publish_vehicle_command(
            uav_id, command=21, param5=lat, param6=lon, param7=alt)
    else:
        # 原地降落
        ok = self.publish_vehicle_command(uav_id, command=21)
```

**关键步骤**：
1. **停止 OFFBOARD 心跳**（`stop_offboard_heartbeat`）— 如果不停止，PX4 会因为持续收到 OFFBOARD setpoint 而拒绝切换到 LAND 模式
2. **同时停止盘旋**（`stop_orbit_heartbeat`）— `stop_offboard_heartbeat` 内部调用 `stop_orbit_heartbeat`（第2009行）
3. **发送 NAV_LAND 命令**（cmd=21）

**PX4 内部处理**：
- PX4 收到 NAV_LAND 后切换到 `AUTO_LAND` 模式（nav_state=18）
- 飞控自动控制降落速度和着陆检测
- 着陆后自动 disarm（如果配置了 `COM_DISARM_LAND`）

---

## 11. 心跳线程架构

### Q13: 为什么每架无人机需要独立的心跳线程？

**答：PX4 OFFBOARD 模式要求 >2Hz 持续接收 OffboardControlMode + TrajectorySetpoint 消息，一旦中断超过 500ms 就会自动退出 OFFBOARD 模式。**

#### 心跳线程实现（`dds_gateway.py` 第1893-2001行）

```python
def start_offboard_heartbeat(self, uav_id, interval=0.25,
                              target_z=None, target_x=None, target_y=None, target_yaw=None):
    """4Hz 发布 OffboardControlMode + TrajectorySetpoint"""
    
    def _heartbeat_loop():
        while self._heartbeat_active.get(uav_id, False) and self.running:
            # 1. 发布 OffboardControlMode（告诉 PX4 使用位置控制）
            self.publish_offboard_control_mode(uav_id, position=True)
            
            # 2. 发布 TrajectorySetpoint（目标位置 + 偏航）
            self.publish_trajectory_setpoint(uav_id, x, y, z, yaw=yaw, log=False)
            
            # 3. 到达检测：距目标 <1.5m 时切换为悬停
            if dist_3d < 1.5:
                x, y, z = state.ned_x, state.ned_y, state.ned_z
            
            time.sleep(0.25)  # 4Hz
```

#### 为什么独立线程而非统一调度？

| 方案 | 优点 | 缺点 |
|------|------|------|
| **每架无人机独立线程（当前）** | 简单、隔离性好、单架故障不影响其他 | 线程数线性增长（100架=100线程） |
| **统一调度器** | 线程数可控、资源效率高 | 实现复杂、需要精确时间管理 |
| **asyncio 协程** | 极高并发、资源最优 | 改动大、需要重构整个网关 |

**当前选择独立线程的原因**：
1. 开发简单，每个心跳循环独立且无依赖
2. 心跳间隔 250ms，Python 线程上下文切换开销可接受
3. 当前仿真规模（<50架）线程数可控

#### 盘旋线程（`dds_gateway.py` 第2012-2111行）

盘旋使用独立于心跳的 `orbit-{uav_id}` 线程，10Hz 更新位置：

```python
def start_orbit_heartbeat(self, uav_id, center_n, center_e, alt_ned, radius, velocity):
    omega = velocity / radius  # 角速度 rad/s
    
    def _orbit_loop():
        # 阶段1: 飞向圆周切入点
        if not arrived:
            target_n = center_n + (dx/dist) * radius
            target_e = center_e + (dy/dist) * radius
        
        # 阶段2: 绕圈飞行
        if arrived:
            angle = initial_angle + (omega * elapsed)
            target_n = center_n + radius * cos(angle)
            target_e = center_e + radius * sin(angle)
            yaw = atan2(center_e - target_e, center_n - target_n)  # 机头指向圆心
```

**盘旋算法**：参数方程 `(x,y) = center + R * (cos(θ), sin(θ))`，其中 `θ = θ₀ + ω*t`，偏航角始终指向圆心。

---

## 12. 集结点与搜索

### Q14: 集结点计算和搜索/自动补全是如何实现的？

**答：集结点是 CRUD 管理的预定义坐标点，搜索使用数据库 LIKE 模糊查询。**

#### 集结点数据模型（`schema.sql` 第276-296行）

```sql
CREATE TABLE rally_points (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,       -- 如 "北区1号停机坪"
    latitude DOUBLE PRECISION NOT NULL,  -- WGS84 纬度
    longitude DOUBLE PRECISION NOT NULL, -- WGS84 经度
    altitude REAL,                     -- 海拔高度（米）
    capacity INTEGER NOT NULL,         -- 最大同时停靠数
    current_occupancy INTEGER DEFAULT 0, -- 当前已占用数
    status SMALLINT DEFAULT 1,         -- 0-禁用 1-启用 2-维护中
    scope SMALLINT DEFAULT 0,          -- 0-全局 1-队伍
    team_id VARCHAR(50),               -- scope=1时指定队伍
    radius REAL DEFAULT 5.0,           -- 到达判定半径（米）
    service_type SMALLINT,             -- 0-停靠 1-充电 2-维护 3-物资
);
```

索引设计（第297-300行）：
- `idx_rally_points_lng_lat` — 经纬度联合索引（空间查询）
- `idx_rally_points_city` — 城市索引
- `idx_rally_points_scope_team` — 权限范围索引

#### 搜索实现（`RallyPointService.java` 第120-125行）

```java
public List<RallyPoint> search(String keyword) {
    if (keyword == null || keyword.trim().isEmpty()) {
        return getAll();
    }
    return rallyPointRepository.searchByKeyword(keyword.trim());
}
```

Repository 层的 `searchByKeyword` 使用 JPA `@Query` 实现 LIKE 模糊匹配：
- 匹配字段：`name`、`address`、`city`
- 支持前缀/包含匹配

#### 权限过滤（`RallyPointService.java` 第106-108行）

```java
public List<RallyPoint> getAccessibleByTeam(String teamId) {
    return rallyPointRepository.findAccessibleByTeamId(teamId);
    // 查询条件：scope=0(全局) OR (scope=1 AND team_id=teamId)
}
```

#### 升级建议

- **Elasticsearch/MeiliSearch 全文搜索**：当集结点数量达到数千时，DB LIKE 查询效率低，应引入搜索引擎
- **空间索引**：PostgreSQL PostGIS 扩展可支持 `ST_DWithin()` 距离查询（如"查找5km内的集结点"）
- **自动补全**：当前无前端自动补全，可通过 Trie 数据结构或 Elasticsearch suggest API 实现

---

## 13. 精度与导航

### Q15: 系统涉及哪些精度考量和导航实现？

**答：精度体现在坐标精度、高度计算精度和到达判定精度三个层面。**

#### 坐标精度

| 来源 | 精度 | 说明 |
|------|------|------|
| DDS VehicleGlobalPosition | `float64` (lat/lon) | ~15位有效数字，毫米级 |
| MAVLink GLOBAL_POSITION_INT | `int32 / 1e7` (lat/lon) | ~1.1cm (赤道处) |
| JavaScript `Number` (前端) | `float64` | 15位有效数字，满足所有精度需求 |
| PostgreSQL `DOUBLE PRECISION` | 8字节 float64 | 与飞控一致 |

#### 高度精度与地形考虑

前端 3D 渲染需要考虑地形海拔（`AMap3DPanel.tsx`）：
- 通过高德地图 Elevation API 查询地面海拔
- 无人机渲染高度 = `relative_alt * altitudeScale`（动态比例因子）
- 地图点击时，通过 raycasting 检测建筑物/地形高度

#### 到达判定

**心跳线程中的到达检测（`dds_gateway.py` 第1976行）：**

```python
dist_3d = math.sqrt(dx**2 + dy**2 + dz**2)
if dist_3d < 1.5:  # 3D距离 < 1.5m 视为到达
    # 切换为悬停（锁定当前位置作为 setpoint）
```

**盘旋切入判定（`dds_gateway.py` 第2082行）：**

```python
if abs(dist - radius) < 2.0:  # 距圆周 < 2m 视为到达
    arrived = True
    # 从直线飞行切换为圆周运动
```

---

## 14. 避障机制

### Q16: 当前系统有避障功能吗？

**答：当前系统无主动避障实现。仅有 GPS 跳变检测作为数据保护机制。**

#### 已实现的数据保护（非避障）

**GPS 跳变检测（`dds_gateway.py` 第477-492行）：**

```python
# 基于速度的位置跳变拒绝
if s.position_valid and s.ground_speed is not None:
    dt = now - s.last_update
    if 0 < dt < 5:
        dlat_m = (lat - s.lat) * 111320
        dlon_m = (lon - s.lon) * 111320 * math.cos(math.radians(s.lat))
        distance = math.sqrt(dlat_m**2 + dlon_m**2)
        max_possible = (s.ground_speed + 10) * dt  # 允许加速余量
        if distance > max(max_possible, 100):  # 至少100m容差
            logger.warning("[GPS] %s rejected jump: %.0fm", uav_id, distance)
            return  # 丢弃此帧
```

**高度跳变检测（第494-500行）：**

```python
if s.position_valid and abs(alt - s.alt) > 500:  # >500m 视为异常
    logger.warning("[GPS] %s rejected altitude jump", uav_id)
    return
```

**(0,0) 坐标拒绝（第467-475行）：**

```python
if s.position_valid and abs(lat) < 1.0 and abs(lon) < 1.0:
    # GPS 未锁定时可能返回 (0,0)，拒绝此帧
    return
```

#### 升级建议

1. **PX4 内置避障**：PX4 支持通过 `obstacle_distance` 话题接入避障传感器（如激光雷达），DDS 网关可新增订阅此话题
2. **地理围栏**：通过 PX4 的 GeoFence 参数设定飞行边界
3. **多机防撞**：后端可基于实时遥测数据计算无人机间距离，当 <安全距离时发送 HOLD 命令

---

## 15. 方向计算

### Q17: 航向（Heading）和偏航（Yaw）是如何计算的？

**答：航向从四元数提取，偏航从目标位置计算。**

#### 航向计算

**DDS 网关从姿态四元数提取偏航角（`dds_gateway.py` 第544-558行）：**

```python
def _on_attitude(self, uav_id, msg):
    q = msg.q  # 四元数 [w, x, y, z]
    siny_cosp = 2 * (q[0] * q[3] + q[1] * q[2])
    cosy_cosp = 1 - 2 * (q[2]**2 + q[3]**2)
    s.heading = math.degrees(math.atan2(siny_cosp, cosy_cosp)) % 360
```

这是标准的四元数→欧拉角转换（仅提取偏航分量），结果范围 [0, 360)，0=北，90=东。

**MAVLink 网关从 ATTITUDE 消息提取（`mavlink_gateway.py` 第842-857行）：**

```python
def _on_attitude(self, uav_id, msg):
    yaw_rad = struct.unpack('<f', data[16:20])[0]  # MAVLink ATTITUDE.yaw (rad)
    heading = math.degrees(yaw_rad) % 360
```

#### 偏航控制

**GOTO 命令中的偏航计算（`dds_gateway.py` 第1722-1735行）：**

```python
# 从当前 NED 位置指向目标 NED 位置的方位角
delta_n = target_n - cur_n  # 北方向差
delta_e = target_e - cur_e  # 东方向差
dist = math.sqrt(delta_n**2 + delta_e**2)
if dist > 0.5:
    target_yaw = math.atan2(delta_e, delta_n)  # NED: atan2(east, north)
```

**NED 偏航约定**：`atan2(east, north)` 给出 0=北、π/2=东、π=南、-π/2=西。这与 PX4 的偏航定义一致。

**盘旋中的偏航计算（`dds_gateway.py` 第2097行）：**

```python
# 机头始终指向圆心
yaw = math.atan2(center_e - target_e, center_n - target_n)
```

---

## 16. RBAC 权限模型

### Q18: 系统的权限模型是 RBAC 还是 ABAC？具体如何实现？

**答：基于 RBAC（Role-Based Access Control），通过角色→分区→数据可见性的链路实现数据隔离。**

#### 角色体系

| 角色 | 权限 | 数据可见性 |
|------|------|-----------|
| **COMMANDER** | 全局管理、权限分配、集结点管理 | 所有无人机 |
| **LEADER** | 队伍管理、权限转移 | 队伍内所有无人机 |
| **PILOT** | 单机控制 | 被分配的无人机 |
| **OPERATOR** | 只读观察 | 观察分区内的无人机 |

#### 实现机制

**1. 角色→分区映射（`AuthService.java` 第91-99行）：**

```java
String primaryRole = roles.isEmpty() ? "operator" : roles.get(0);
partitionName = PartitionNameUtil.computePartitionName(
    primaryRole, user.getUsername(), user.getId());
// 示例：pilot_zhang_5, leader_wang_3, commander, observer
```

**2. 登录时返回分区（`AuthService.java` 第100行）：**

```java
response.setPartitions(List.of(partitionName));
```

**3. 数据路由到分区（`PartitionRoutingService.java` 第81-103行）：**

每架无人机映射到多个分区（`drone_partition_map` 表），确保相关角色能看到：

```java
// 默认分区：observer + commander
// 权限转移后：+ pilot_{username}_{id} + leader_{username}_{id}
```

**4. WebSocket 推送到分区（`WebSocketGatewayService.java` 第44-55行）：**

```java
for (Map.Entry<String, List<Map<String, Object>>> entry : partitionData.entrySet()) {
    String topic = "/topic/telemetry/partition/" + partitionName;
    messagingTemplate.convertAndSend(topic, message);
}
```

前端订阅自己分区的 WebSocket Topic，只能看到该分区内的无人机数据。

#### 分布式锁保护权限转移

**`PermissionService.java` 第71-78行：**

```java
String lockValue = UUID.randomUUID().toString();
boolean lockAcquired = redisService.tryAcquireLock(uavId, lockValue);
// Redis SETNX + 5秒 TTL
// 同一时刻只有一个操作者可以转移某架无人机的控制权
```

**`RedisService.java` 第256-272行（Lua 原子释放）：**

```java
String script = "if redis.call('get', KEYS[1]) == ARGV[1] " +
                "then return redis.call('del', KEYS[1]) else return 0 end";
```

#### 与 ABAC 的对比

| 维度 | 当前 RBAC | ABAC（如需升级） |
|------|----------|-----------------|
| 判断依据 | 角色 | 角色 + 属性（时间、位置、任务状态等） |
| 灵活性 | 角色固定，需要代码修改 | 策略可动态配置 |
| 实现复杂度 | 低 | 高（需要策略引擎如 OPA） |
| 适用场景 | 组织架构稳定 | 多维度动态权限控制 |

#### 升级建议

- 引入 Spring Security 的 `@PreAuthorize("hasRole('COMMANDER')")` 注解替代手动权限检查
- 考虑引入 ABAC 以支持更细粒度控制（如：仅在某时间段内允许飞行、某区域内限制特定操作）

---

## 17. 地址解析

### Q19: 地址解析（反向地理编码）如何实现？

**答：通过高德地图 API 实现前端反向地理编码，后端集结点的 `city` 和 `address` 字段在创建时由前端调用地图 API 获取后传入。**

#### 集结点城市字段

```sql
-- schema.sql 第309行
COMMENT ON COLUMN rally_points.city IS '所在城市（通过地图服务反向地理编码得到）';
```

即：前端在创建集结点时，调用高德 `AMap.Geocoder.getAddress(lnglat)` 获取城市名和详细地址，作为请求参数提交给后端。

#### 升级建议

- 后端可引入服务端地理编码（如 `amap-geocode-api`），不依赖前端
- 批量无人机降落位置的地址解析可异步执行

---

## 18. Kafka 配置与消息有序性

### Q20: Kafka 的配置和消息有序性是如何保证的？

**答：通过 `uav_id` 作为消息 Key，利用 Kafka 的分区有序性保证同一架无人机的消息有序。**

#### Kafka 配置

**`docker-compose-kafka.yml`**（KRaft 模式，无 ZooKeeper）：

```yaml
kafka:
  image: apache/kafka:3.7.0
  environment:
    KAFKA_NUM_PARTITIONS: 16                    # 默认分区数
    KAFKA_DEFAULT_REPLICATION_FACTOR: 1          # 单节点副本
    KAFKA_LOG_RETENTION_HOURS: 168               # 保留7天
    KAFKA_LISTENERS: EXTERNAL://0.0.0.0:9092,INTERNAL://0.0.0.0:29092
    KAFKA_PROCESS_ROLES: broker,controller       # KRaft 模式
```

#### Topic 设计（`KafkaConfig.java` 第10-18行）

| Topic | 分区数 | Key | 用途 |
|-------|--------|-----|------|
| `telemetry.raw` | 16 | `uav_id` | 遥测原始数据 |
| `events.drone` | 8 | `uav_id` | 无人机事件（上线/离线/告警/模式切换） |
| `commands.down` | 16 | `uav_id` | 下行指令（后端→网关→PX4） |
| `commands.ack` | 8 | `uav_id` | 指令回执（PX4→网关→后端） |

#### 有序性保证

**Kafka 分区内有序**：相同 Key 的消息进入同一分区，分区内严格 FIFO。

**网关生产者（`dds_gateway.py` 第983-985行）：**

```python
# Key = uav_id → 同一架无人机的所有消息进入同一个 Kafka 分区 → 有序
self._kafka_producer.send('telemetry.raw', key=uav_id, value=msg)
```

**后端生产者（`CommandKafkaProducer.java` 第68-69行）：**

```java
// 以 uavId 作为 Key，确保同一架无人机的指令进入同一分区（有序）
kafkaTemplate.send(commandsDownTopic, uavId, json)
```

#### 分区策略

Kafka 默认使用 murmur2 哈希：`murmur2(key_bytes) % num_partitions`

对于 `telemetry.raw`（16个分区）：
- `px4_1` 的所有消息 → 分区 `murmur2("px4_1") % 16 = N`
- `px4_2` 的所有消息 → 分区 `murmur2("px4_2") % 16 = M`
- 保证：N 和 M 可能相同也可能不同，但同一架无人机始终在同一分区

#### 生产者配置

```python
# dds_gateway.py 第691-700行
KafkaProducer(
    acks=1,            # Leader 确认即可（平衡延迟和可靠性）
    retries=3,         # 失败重试3次
    max_block_ms=5000, # 缓冲区满时最大等待5秒
    linger_ms=0,       # 不等待批量，立即发送（实时性优先）
    batch_size=16384,  # 小批量
)
```

`acks=1` 的含义：Leader 分区副本确认写入后即返回，不等待所有 ISR 副本同步。对于单节点部署等价于 `acks=all`。

#### 升级建议

- 生产环境应设置 `replication.factor=3` + `acks=all` + `min.insync.replicas=2`
- 分区数应根据无人机数量和消费者实例数调整：经验值为 `max(消费者数, 预期无人机数/10)`
- 考虑启用 Kafka Schema Registry（Avro/Protobuf）替代 JSON 序列化，减小消息体积

---

## 19. SSO 与 JWT

### Q21: JWT 认证是如何实现的？是否有 SSO？

**答：使用双 Token 机制（Access Token + Refresh Token），当前无 SSO 集成。**

#### 双 Token 机制

**`JwtUtil.java` 第78-101行：**

```java
// Access Token（短命，默认30分钟）
public String generateAccessToken(Long userId, String username, List<String> roles) {
    return buildToken(userId, username, roles, "access", accessTokenExpiration);
}

// Refresh Token（长命，默认7天）
public String generateRefreshToken(Long userId, String username, List<String> roles) {
    return buildToken(userId, username, roles, "refresh", refreshTokenExpiration);
}

private String buildToken(...) {
    return Jwts.builder()
        .subject(username)
        .claim("userId", userId)
        .claim("roles", roles)
        .claim("tokenType", tokenType)  // "access" 或 "refresh"
        .issuedAt(new Date())
        .expiration(new Date(System.currentTimeMillis() + expirationMs))
        .signWith(getSigningKey())      // HMAC-SHA256
        .compact();
}
```

#### 三级验证

**`JwtAuthenticationFilter.java` 第47-72行：**

```java
// 三验证：签名 + 过期 + 黑名单
if (jwtUtil.validateToken(jwt, username)) {
    // 仅 Access Token 可用于接口鉴权
    if (jwtUtil.isTokenType(jwt, "access")) {
        Long userId = jwtUtil.extractUserId(jwt);
        List<String> roles = jwtUtil.extractRoles(jwt);
        // 构造 Spring Security Authentication
        UsernamePasswordAuthenticationToken authToken =
            new UsernamePasswordAuthenticationToken(principal, null, authorities);
        SecurityContextHolder.getContext().setAuthentication(authToken);
    }
}
```

验证流程：
1. **签名验证**：HMAC-SHA256 验证 Token 完整性
2. **过期验证**：检查 `exp` claim
3. **黑名单验证**：检查 Token 是否已被注销（`validateToken` 内部）
4. **类型检查**：只有 `access` Token 可用于 API 调用，`refresh` Token 只能用于刷新

#### 登录流程（`AuthService.java` 第54-113行）

```
用户提交 username + password
  → 验证密码（BCrypt）
  → 查询角色列表
  → 生成 Access Token + Refresh Token
  → 计算用户分区名
  → 更新在线状态
  → 发布 Kafka 上线事件
  → 返回 LoginResponse
```

#### 升级建议

- **SSO 集成**：可引入 Spring Security OAuth2 Client 对接企业 LDAP/AD 或第三方 OAuth2 Provider
- **Token 刷新端点**：当前有 Refresh Token 生成但未见刷新端点实现，应补充
- **Token 黑名单存 Redis**：确保注销后的 Token 立即失效，且支持多实例共享黑名单

---

## 20. 多级缓存策略

### Q22: 系统中有哪些缓存层次？读写策略是什么？

**答：系统采用两级缓存（Redis + 内存），读写策略因场景不同。**

#### 缓存层次概览

| 层级 | 技术 | 用途 | TTL |
|------|------|------|-----|
| L1: 网关本地内存 | Python `dict` | Epoch 映射、无人机状态、IP映射 | 无 TTL（内存生命周期） |
| L2: Redis | `StringRedisTemplate` | 在线状态、分区映射、控制权、分布式锁 | 30s (heartbeat) / 5s (lock) / 无 |
| L3: PostgreSQL | JPA / JDBC | 持久化数据（用户、无人机、分区映射） | 永久 |

#### 各场景缓存策略

**场景1: 无人机在线状态**
- **写**：网关每次发送 telemetry → 后端消费者调用 `redisService.setDroneOnline(uavId)` → Redis SET with 30s TTL
- **读**：`redisService.isDroneOnline(uavId)` → Redis hasKey
- **策略**：TTL 过期即离线，无需主动删除
- **实现**：`RedisService.java` 第44-68行

**场景2: 分区路由映射**
- **写**：DB-first + Post-Commit Redis Sync（见Q4）
- **读**：Redis → DB fallback → Auto-create（`PartitionRoutingService.java` 第81-103行）
- **策略**：Cache-Aside + 定期对账

**场景3: Epoch 代际 ID（网关侧）**
- **写**：网关本地 `_epoch_map` + Redis SET（`dds_gateway.py` 第861-896行）
- **读**：本地 → Redis → 默认值1
- **策略**：Write-Through（每次更新同步写 Redis）

**场景4: IP→uav_id 映射（MAVLink 网关）**
- **写**：Redis → 本地缓存 → Kafka → PG（`mavlink_gateway.py` 第302-342行）
- **读**：本地 → Redis → PG API（第344-394行）
- **策略**：三级缓存 Read-Through + Write-Through

#### 缓存失效处理

| 场景 | 处理 |
|------|------|
| Redis 不可用 | 降级到 DB 查询（`PartitionRoutingService` 的 DB fallback） |
| Redis 数据陈旧 | 60s 对账修正（`reconcileDbRedis`） |
| 网关重启 | Epoch 从 Redis 恢复（`_get_or_increment_epoch` 第871-879行） |
| 数据不一致 | Post-Commit Hook 重试队列 + 对账 |

---

## 21. 无人机状态流转

### Q23: 无人机的状态机是怎样的？

**答：无人机状态由 PX4 飞控管理，网关通过 `VehicleStatus.nav_state` 映射为可读字符串。**

#### PX4 飞行模式映射（`dds_gateway.py` 第674-681行）

```python
modes = {
    0: "MANUAL",       # 手动遥控
    1: "ALTCTL",       # 高度控制
    2: "POSCTL",       # 位置控制
    3: "AUTO_MISSION", # 自动航线
    4: "AUTO_LOITER",  # 自动悬停
    5: "AUTO_RTL",     # 自动返航
    14: "OFFBOARD",    # 外部控制（本系统主要使用）
    17: "AUTO_TAKEOFF", # 自动起飞
    18: "AUTO_LAND",   # 自动降落
}
```

#### 系统控制下的状态流转

```
[DISARMED] --TAKEOFF--> [ARMED+OFFBOARD(起飞)] --到达高度--> [OFFBOARD(悬停)]
                                                    |
    [OFFBOARD(悬停)] <--HOLD-- [OFFBOARD(飞行)] <--GOTO-- [OFFBOARD(悬停)]
                                    |
                              --ORBIT--> [OFFBOARD(盘旋)]
                                    |
    [AUTO_LAND(降落)] <--LAND-- [任意OFFBOARD状态]
                                    |
    [AUTO_RTL(返航)] <--RTL-- [任意OFFBOARD状态]
```

#### 在线/离线状态

- **在线**：Redis key `drone:{uavId}:online` 存在且未过期（30s TTL）
- **离线**：TTL 过期自动变为离线
- **检测**：`RedisService.isDroneOnline()` → `hasKey()`
- **批量检测**：`GatewayHealthMonitor` 定期扫描 `drone:*:online` keys

---

## 22. Redis 数据结构

### Q24: Redis 中使用了哪些数据结构？为什么选择这些结构？

**答：使用了 String、Set 和 Lua Script，各有其适用场景。**

#### 完整的 Redis Key 设计（`RedisService.java` 第17-36行）

```
Key Pattern                          | Type    | 用途                    | TTL
-------------------------------------|---------|------------------------|--------
drone:{uavId}:online                 | String  | 在线状态心跳             | 30s
drone:{uavId}:partitions             | Set     | 无人机所属分区集合        | 无
drone:{uavId}:controller             | String  | 当前控制者 userId        | 无
drone:{uavId}:home                   | String  | Home 位置 "lat,lon,alt" | 无
partition:{name}:drones              | Set     | 分区内的无人机集合（反向索引）| 无
lock:drone:{uavId}                   | String  | 分布式锁                 | 5s
dds:epoch:{uavId}                    | String  | DDS 网关 Epoch          | 无
mavlink:epoch:{uavId}                | String  | MAVLink 网关 Epoch      | 无
mavlink:ip_map:{uavId}               | String  | uav_id → ip:port 映射   | 3600s
mavlink:ip_map:rev:{ip:port}         | String  | ip:port → uav_id 反向映射| 3600s
```

#### 为什么选择这些结构？

**String**（在线状态、控制者、Epoch）：
- 单值存储，O(1) 读写
- 在线状态利用 TTL 自动过期，无需主动清理

**Set**（分区映射）：
- 一架无人机可以属于多个分区（observer, commander, pilot_xxx），Set 天然去重
- `SADD/SREM` 原子操作，O(1) 添加/删除
- `SMEMBERS` 一次性获取所有分区，O(N) N为分区数（通常 <5）

**Lua Script**（分布式锁释放）：

```lua
-- RedisService.java 第259行
if redis.call('get', KEYS[1]) == ARGV[1] then 
    return redis.call('del', KEYS[1]) 
else 
    return 0 
end
```

**为什么用 Lua 而非两步操作（GET+DEL）**：如果在 GET 和 DEL 之间另一个进程获取了锁，DEL 会错误地释放别人的锁。Lua 脚本在 Redis 中原子执行，避免竞态条件。

#### 未使用但可考虑的结构

| 结构 | 潜在用途 |
|------|---------|
| **Hash** | 无人机状态缓存（多字段：lat, lon, alt, heading...），替代多个 String key |
| **ZSet** | 按最后更新时间排序的无人机列表，支持离线检测（`ZRANGEBYSCORE ... +inf`） |
| **Stream** | 替代 Kafka 做轻量级消息队列（小规模场景） |
| **Pub/Sub** | 多实例间缓存失效通知 |

---

## 23. Kafka 消息持久化与偏移量

### Q25: Kafka 如何保证消息不丢失？偏移量管理策略是什么？

#### 消息持久化

**Kafka 配置（`docker-compose-kafka.yml`）：**

```yaml
KAFKA_LOG_RETENTION_HOURS: 168  # 消息保留7天
KAFKA_DEFAULT_REPLICATION_FACTOR: 1  # 单节点，无副本
```

当前单节点无副本，Broker 宕机会丢失未消费的消息。生产环境必须 `replication.factor >= 3`。

**生产者持久化**：
- `acks=1`：Leader 副本确认写入后返回
- `retries=3`：写入失败自动重试

#### 偏移量管理

**网关 Kafka 消费者（`dds_gateway.py` 第741-742行）：**

```python
consumer = KafkaConsumer(
    'commands.down',
    auto_offset_reset='latest',      # 新消费者从最新消息开始
    enable_auto_commit=True,          # 自动提交偏移量
)
```

**后端 Kafka 消费者（`TelemetryKafkaConsumer.java`）：**

Spring Kafka 默认使用 `enable.auto.commit=false` + `AckMode.BATCH`（每次 poll 后自动提交）。

#### 消息丢失风险分析

| 场景 | 风险 | 当前处理 | 改进 |
|------|------|---------|------|
| Broker 宕机 | 高（无副本） | 无 | 多节点 + 副本 |
| 生产者发送失败 | 中 | retries=3 | + 死信队列 |
| 消费者处理失败 | 低 | 自动提交可能丢失 | 改为手动提交 |
| 消息积压 | 低 | 保留7天 | 监控消费延迟 |

---

## 24. TimescaleDB 选型

### Q26: 为什么选择 TimescaleDB 而不是 InfluxDB 或其他时序数据库？

**答：TimescaleDB 基于 PostgreSQL，可复用现有技术栈和 SQL 能力，无需引入新的查询语言。**

#### 选型理由

| 维度 | TimescaleDB | InfluxDB | 说明 |
|------|------------|----------|------|
| **SQL 支持** | 完整 SQL（PostgreSQL） | InfluxQL / Flux | 团队已熟悉 SQL |
| **JOIN 能力** | 可与业务表 JOIN | 不支持跨库 JOIN | 遥测+业务关联查询 |
| **驱动** | JDBC (postgresql) | 专用 HTTP client | 复用 Spring Data JPA |
| **自动分区** | hypertable 按时间自动分区 | 自动 shard | 两者都有 |
| **压缩** | 原生压缩（10:1~20:1） | 自动压缩 | 两者都有 |
| **部署** | Docker `timescale/timescaledb:latest-pg16` | 独立部署 | TimescaleDB 更轻量 |
| **学习曲线** | 零（就是 PostgreSQL） | 需要学习 Flux 语言 | 降低维护成本 |

#### 当前使用方式

当前 TimescaleDB 被当作普通 PostgreSQL 使用（未启用 hypertable），通过 `TelemetryPersistenceService` 每 5 秒批量写入 `uav_telemetry` 表。

#### 优化路径

```sql
-- 1. 转换为 hypertable（按 timestamp 自动分区）
SELECT create_hypertable('uav_telemetry', 'timestamp', 
    chunk_time_interval => INTERVAL '1 day');

-- 2. 启用压缩（7天后压缩）
ALTER TABLE uav_telemetry SET (timescaledb.compress,
    timescaledb.compress_segmentby = 'uav_id',
    timescaledb.compress_orderby = 'timestamp DESC');
SELECT add_compression_policy('uav_telemetry', INTERVAL '7 days');

-- 3. 保留策略（90天后自动删除）
SELECT add_retention_policy('uav_telemetry', INTERVAL '90 days');

-- 4. 连续聚合（每分钟平均值物化视图）
CREATE MATERIALIZED VIEW uav_telemetry_1min
WITH (timescaledb.continuous) AS
SELECT uav_id,
       time_bucket('1 minute', timestamp) AS bucket,
       avg(lat) AS avg_lat, avg(lon) AS avg_lon, avg(alt) AS avg_alt,
       avg(ground_speed) AS avg_speed
FROM uav_telemetry
GROUP BY uav_id, bucket;
```

---

## 25. AOP 日志

### Q27: 操作日志是如何实现的？是否使用了 AOP？

**答：当前使用手动调用 `OperationLogService` 记录日志，未使用 AOP。**

#### 当前实现

每个需要记录操作日志的方法内手动调用：

**`ControlService.java` 第65-67行：**

```java
operationLogService.logFailure(userId, username, "CONTROL_COMMAND",
    null, uavId, commandType, "Drone not found: " + uavId);
```

**`PermissionService.java` 第138-141行：**

```java
operationLogService.recordOperation(operatorId, operatorName, "PERMISSION_TRANSFER",
    drone.getId(), uavId, toUserId,
    buildTransferDetail(fromUserId, toUserId),
    "SUCCESS", null, null);
```

#### 日志表结构（`schema.sql` 第236-249行）

```sql
CREATE TABLE operation_log (
    user_id BIGINT NOT NULL,
    username VARCHAR(50),
    operation_type VARCHAR(50) NOT NULL,  -- CONTROL_COMMAND, PERMISSION_TRANSFER 等
    target_drone_id BIGINT,
    target_uav_id VARCHAR(50),
    target_user_id BIGINT,
    detail VARCHAR(2000),                 -- 人可读描述
    result VARCHAR(20),                   -- SUCCESS / FAILURE
    error_message VARCHAR(2000),
    ip_address VARCHAR(50),
    created_at TIMESTAMP
);
```

索引：`user_id`, `operation_type`, `created_at` 三个独立索引。

#### 问题与升级

**当前问题**：
1. 日志调用分散在业务代码中，增加代码复杂度
2. 容易遗漏（新增方法可能忘记加日志）
3. 成功和失败分别调用不同方法（`recordOperation` vs `logFailure`）

**推荐 AOP 改造**：

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface OperationLog {
    String type();  // "CONTROL_COMMAND", "PERMISSION_TRANSFER"
}

@Aspect
@Component
public class OperationLogAspect {
    @Around("@annotation(opLog)")
    public Object around(ProceedingJoinPoint pjp, OperationLog opLog) throws Throwable {
        long start = System.currentTimeMillis();
        try {
            Object result = pjp.proceed();
            // 自动记录成功日志
            return result;
        } catch (Exception e) {
            // 自动记录失败日志
            throw e;
        }
    }
}
```

---

## 26. Epoch 机制

### Q28: Epoch（代际 ID）机制的设计原理和优化方向？

**答：Epoch 是防止僵尸数据和过期命令被处理的代际标记，贯穿整个数据链路。**

#### 设计原理

当无人机断连后重连（或网关重启），可能存在旧的 Kafka 消息尚未消费完。这些"僵尸消息"如果被处理，会导致：
1. 旧遥测数据覆盖新数据（位置回退）
2. 旧命令被执行（已取消的 GOTO 再次执行）

**解决方案**：每次重连时 Epoch +1，所有消息携带当前 Epoch，消费者丢弃 `msgEpoch < currentEpoch` 的消息。

#### 网关侧 Epoch 管理

**初始化/递增（`dds_gateway.py` 第861-896行）：**

```python
def _get_or_increment_epoch(self, uav_id, is_new=False):
    # 1. 优先从 Redis 加载（跨重启持久化）
    if uav_id not in self._epoch_map and self._redis:
        stored = self._redis.get(f"dds:epoch:{uav_id}")
        if stored: self._epoch_map[uav_id] = int(stored)
    
    # 2. 首次出现 → epoch=1
    if uav_id not in self._epoch_map:
        self._epoch_map[uav_id] = 1
    # 3. 重连 → epoch++
    elif is_new:
        self._epoch_map[uav_id] += 1
    
    # 4. 持久化到 Redis
    self._redis.set(f"dds:epoch:{uav_id}", self._epoch_map[uav_id])
    return self._epoch_map[uav_id]
```

#### 后端侧 Epoch 校验

**`EpochManager.java` 第58-83行：**

```java
public boolean validateEpoch(String uavId, long msgEpoch) {
    Long currentEpoch = epochMap.get(uavId);
    
    if (currentEpoch == null) {
        epochMap.put(uavId, msgEpoch);  // 首次：接受任何 epoch
        return true;
    }
    if (msgEpoch >= currentEpoch) {
        if (msgEpoch > currentEpoch)
            epochMap.put(uavId, msgEpoch);  // 新代际：更新
        return true;
    }
    // msgEpoch < currentEpoch → 僵尸数据，丢弃
    return false;
}
```

**命令发送时携带 Epoch（`CommandKafkaProducer.java` 第64行）：**

```java
payload.put("epoch", epochManager.getCurrentEpoch(uavId));
```

**命令消费时校验 Epoch（`dds_gateway.py` 第770-781行）：**

```python
msg_epoch = data.get('epoch', 0)
current_epoch = self._epoch_map.get(uav_id, 0)
if current_epoch > 0 and msg_epoch < current_epoch:
    # 丢弃过期命令
    continue
```

#### Epoch 维护（`dds_gateway.py` 第898-958行）

每 6 小时执行一次维护：
- **归一化**：epoch > 10000 → 重置为 1（防止无限增长）
- **驱逐**：>24小时未更新的无人机 → 从 epoch 映射中移除
- 变更同步到 Redis

#### 全链路 Epoch 流向

```
                        网关启动/无人机重连
                              ↓
                    _get_or_increment_epoch → Redis SET
                              ↓
遥测消息 {epoch: N} → Kafka(telemetry.raw) → 后端 EpochManager.validateEpoch
                              ↓
命令消息 {epoch: N} → Kafka(commands.down) → 网关 epoch 校验
                              ↓
                   过期消息(epoch < current) → 丢弃
```

#### 升级建议

- **集群 Epoch 同步**：多网关实例各自维护 Epoch，应通过 Redis 集中管理，避免不同实例对同一架无人机使用不同 Epoch
- **Epoch 重置协调**：归一化时需要通知后端 EpochManager 同步重置，当前缺少此机制

---

## 27. 消息丢失防护

### Q29: 系统如何防止消息丢失？

#### 遥测数据链路

| 环节 | 防丢失机制 | 风险 |
|------|-----------|------|
| 网关→Kafka | `retries=3` + `acks=1` | 单节点无副本，Broker 宕机丢失 |
| Kafka→后端 | 消费者组偏移量管理 | 自动提交可能在处理前提交 |
| 后端→WebSocket | 内存推送 | 前端断连期间丢失 |
| 后端→DB | 批量缓冲（5s） + `@Transactional` | 进程崩溃时缓冲区丢失 |

#### 命令链路

| 环节 | 防丢失机制 | 风险 |
|------|-----------|------|
| 后端→Kafka | `whenComplete` 回调检测失败 | 无重试机制 |
| Kafka→网关 | Epoch + 时间戳双重校验 | 60s 过期窗口外的命令被丢弃 |
| 网关→PX4 | DDS QoS / MAVLink 无保证 | DDS best-effort 可能丢失 |

#### 已实现的容错

**HTTP 降级（`dds_gateway.py` 第1369-1371行）：**

```python
kafka_ok = self.send_to_kafka(batch_payload)
if not kafka_ok:
    self.send_to_backend(batch_payload)  # Kafka 失败时降级到 HTTP
```

**ACK 双通道（`_forward_command_ack` 第646-671行）：**

```python
# Primary: Kafka commands.ack
kafka_ok = self._kafka_producer.send('commands.ack', ...)
# Fallback: HTTP
if not kafka_ok:
    self._ack_session.post(f"{self.backend_url}/api/v1/dds-gateway/command-ack", ...)
```

#### 升级建议

- 遥测缓冲区应持久化到磁盘（WAL 模式），防止进程崩溃丢失
- 命令发送应添加超时+重试+死信队列
- WebSocket 断线重连后应支持增量同步（从最后收到的时间戳开始）

---

## 28. Docker 模块架构

### Q30: Docker 部署架构是怎样的？

#### 基础设施层（`docker-compose-kafka.yml`，61行）

```
┌─────────────────────────────────────┐
│  Kafka 3.7.0 (KRaft, 无 ZooKeeper)  │
│  EXTERNAL: localhost:9092            │
│  INTERNAL: kafka:29092               │
│  分区: 16 | 副本: 1 | 保留: 7天     │
└─────────────────────────────────────┘
```

#### 微服务层（`docker-compose-microservices.yml`，330行）

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  API Gateway  │  │ Telemetry    │  │ Telemetry    │
│  :8080       │  │ Ingest :8081 │  │ Store :8082  │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
┌──────┴───────┐  ┌──────┴───────┐  ┌──────┴───────┐
│ Realtime Push│  │  Command     │  │ Drone State  │
│  :8083      │  │  :8084      │  │  :8085      │
└──────┬───────┘  └──────┬───────┘  └──────┴───────┘
       │                 │                 │
┌──────┴───────┐  ┌──────┴───────┐  ┌──────┴───────┐
│  Business    │  │ PostgreSQL   │  │ TimescaleDB  │
│  :8086      │  │  :5432      │  │  :5433      │
└──────────────┘  └──────────────┘  └──────────────┘
                         │
                  ┌──────┴───────┐
                  │  Redis 7.2   │
                  │  :6379      │
                  └──────────────┘
```

#### 7 个微服务的职责

| 服务 | 端口 | 职责 |
|------|------|------|
| API Gateway | 8080 | 统一入口、路由、鉴权 |
| Telemetry Ingest | 8081 | 接收网关遥测数据（HTTP/Kafka） |
| Telemetry Store | 8082 | 遥测数据持久化到 TimescaleDB |
| Realtime Push | 8083 | WebSocket 实时推送到前端 |
| Command | 8084 | 指令下发、ACK 处理 |
| Drone State | 8085 | 无人机状态管理、上下线检测 |
| Business | 8086 | 业务逻辑（用户、团队、权限、集结点） |

**注**：当前单体后端（`backend/`）集成了以上所有功能，微服务架构在 `docker-compose-microservices.yml` 中定义但尚未完全拆分。

---

## 29. Spring Task 调度

### Q31: 系统中使用了哪些定时任务？

| 定时任务 | 间隔 | 文件 | 用途 |
|---------|------|------|------|
| `flushBuffer` | 5s | `TelemetryPersistenceService.java:73` | 批量落盘遥测数据 |
| `retryPendingRedisSync` | 5s | `PartitionRoutingService.java:253` | 重试失败的 Redis 同步 |
| `reconcileDbRedis` | 60s (30s 初始延迟) | `PartitionRoutingService.java:280` | DB-Redis 对账 |

#### Spring `@Scheduled` 原理

```java
@Scheduled(fixedDelay = 5000)  // 上次执行完成后等5秒再执行
@Scheduled(fixedRate = 5000)   // 每5秒执行一次（不等上次完成）
@Scheduled(cron = "0 */5 * * * *")  // Cron 表达式
```

当前都使用 `fixedDelay`（上次完成后延迟），适合不确定执行时长的任务。

#### DDS 网关定时任务（Python）

| 任务 | 间隔 | 实现 |
|------|------|------|
| 话题发现 | 5s | `run()` 主循环（第1278-1279行） |
| 遥测批量发送 | 100ms (10Hz) | `run()` 主循环 per-drone 节流 |
| 统计日志 | 10s | `log_statistics()`（第1142行） |
| Epoch 维护 | 6h | `_start_epoch_maintenance()`（第898行） |

---

## 30. Java 21 虚拟线程

### Q32: Java 21 虚拟线程在这个项目中可以起到什么作用？

**答：当前项目使用 Java 17（`pom.xml` 第21行 `<java.version>17</java.version>`），升级到 Java 21 后可利用虚拟线程优化 I/O 密集型操作。**

#### 适用场景分析

| 组件 | 当前实现 | 虚拟线程改造 | 收益 |
|------|---------|-------------|------|
| **Kafka 消费者** | 4个平台线程（`concurrency="4"`） | 可增加到数十个虚拟线程消费者 | 更高消费并行度 |
| **WebSocket 推送** | STOMP 同步推送 | 虚拟线程异步推送 | 推送不阻塞消费者 |
| **Redis 操作** | Lettuce 异步（Spring 默认） | 虚拟线程 + 同步 API 更简洁 | 代码可读性 |
| **DB 查询** | JDBC 同步阻塞 | 虚拟线程包裹，不占用平台线程 | 高并发查询 |
| **HTTP 调用** | RestTemplate 同步 | 虚拟线程避免线程池耗尽 | 外部 API 调用 |
| **定时任务** | Spring TaskScheduler | 虚拟线程执行器 | 更多并发任务 |

#### 具体改造方案

**1. Kafka 消费者虚拟线程化**

```java
// 当前
@KafkaListener(topics = "telemetry.raw", concurrency = "4")

// Java 21 改造
spring.kafka.listener.concurrency=16  // 可以大幅增加
spring.threads.virtual.enabled=true    // Spring Boot 3.2+ 全局虚拟线程
```

**2. Tomcat 虚拟线程**

```properties
# application.properties
spring.threads.virtual.enabled=true
```

Spring Boot 3.2 (当前版本) 已支持此配置，但需要 Java 21 运行时。启用后所有 HTTP 请求处理器在虚拟线程上运行。

**3. 自定义虚拟线程执行器**

```java
@Bean
public ExecutorService virtualThreadExecutor() {
    return Executors.newVirtualThreadPerTaskExecutor();
}
```

#### 需要注意的问题

| 问题 | 说明 |
|------|------|
| **synchronized 固定** | 虚拟线程在 `synchronized` 块中会固定到平台线程，应改为 `ReentrantLock` |
| **JDBC 连接池** | 虚拟线程可能创建大量并发 DB 连接，需限制连接池大小 |
| **ThreadLocal** | 虚拟线程共享载体线程，`ThreadLocal` 行为可能不符预期 |
| **连接池竞争** | 大量虚拟线程争夺有限的 DB/Redis 连接，需要合理的连接池配置 |

#### 升级路径

```
1. pom.xml: <java.version>21</java.version>
2. application.properties: spring.threads.virtual.enabled=true
3. 替换 synchronized → ReentrantLock
4. 监控连接池使用率，调整 HikariCP.maximum-pool-size
5. 逐步将 ThreadPoolExecutor → Executors.newVirtualThreadPerTaskExecutor()
```

---

## 31. 网关数据路由原理

### Q33: 从无人机数据到前端显示的完整链路是什么？

```
                          ┌─────────────────────────────────────────────────────────────────┐
                          │                        完整数据链路                               │
                          └─────────────────────────────────────────────────────────────────┘

[PX4 飞控]                     [网关 Python]                    [后端 Java]                [前端 React]
     │                              │                               │                         │
     ├─DDS话题/MAVLink UDP──────────►│                               │                         │
     │  VehicleGlobalPosition       │                               │                         │
     │  VehicleLocalPosition        │ DroneState聚合                │                         │
     │  VehicleAttitude             │  └─ GPS跳变检测               │                         │
     │  VehicleStatus               │  └─ 高度异常检测              │                         │
     │  BatteryStatus               │  └─ per-drone锁              │                         │
     │                              │                               │                         │
     │                              ├─Kafka(telemetry.raw)──────────►│                         │
     │                              │  key=uavId                    │ TelemetryKafkaConsumer  │
     │                              │  value={lat,lon,alt,...}      │  └─ Epoch校验            │
     │                              │  epoch=N                      │  └─ 时间戳校验           │
     │                              │                               │  └─ Redis心跳刷新        │
     │                              │                               │  └─ 持久化到TimescaleDB  │
     │                              │                               │  └─ 分区路由             │
     │                              │                               │                         │
     │                              │                               ├─WebSocket STOMP──────────►│
     │                              │                               │  /topic/telemetry/       │
     │                              │                               │  partition/{name}         │
     │                              │                               │                         │
     │                              │                               │                    MapPanel
     │                              │                               │                    AMap3DPanel
     │                              │                               │                     └─ 渲染
     │                              │                               │                         │
     │◄─DDS话题发布/MAVLink─────────┤◄──Kafka(commands.down)────────┤◄────HTTP POST───────────┤
     │  VehicleCommand              │  Epoch校验                    │  ControlService         │ 用户点击
     │  TrajectorySetpoint          │  时间戳校验                   │  权限校验               │ "前往"等
     │  OffboardControlMode         │  handle_command()             │  CommandKafkaProducer   │
     │                              │                               │                         │
     │──VehicleCommandAck──────────►│──Kafka(commands.ack)──────────►│                         │
     │                              │                               │  状态更新               │
     │                              │                               │  WebSocket通知          │
```

---

## 32. 错误处理与韧性

### Q34: 系统的容错和降级策略有哪些？

| 故障场景 | 影响 | 当前处理 |
|---------|------|---------|
| **Kafka 不可用** | 遥测数据无法传输 | 降级到 HTTP 直连后端 |
| **Redis 不可用** | 分区缓存失效、锁不可用 | DB fallback 查询 + 内存 Epoch |
| **后端不可用** | 命令无法下发 | 网关缓存 3 次健康检查后继续运行 |
| **PX4/飞控断连** | 遥测停止 | 30s TTL 自动标记离线 |
| **网关崩溃** | 所有无人机失联 | Epoch 从 Redis 恢复，不重复执行旧命令 |
| **DB 事务回滚** | 分区更新失败 | Post-Commit 不触发 Redis 写入，数据一致 |

#### 具体降级代码

**Kafka→HTTP 降级（`dds_gateway.py` 第1369-1371行）：**

```python
kafka_ok = self.send_to_kafka(batch_payload)
if not kafka_ok:
    self.send_to_backend(batch_payload)
```

**Redis 降级（`RedisService.java` 第60-67行）：**

```java
public boolean isDroneOnline(String uavId) {
    try {
        return Boolean.TRUE.equals(stringRedisTemplate.hasKey(key));
    } catch (Exception e) {
        log.debug("Redis unavailable, returning false");
        return false;  // 降级：假设离线
    }
}
```

---

## 33. 监控与可观测性

### Q35: 系统的监控能力如何？

#### 网关侧统计（`dds_gateway.py` 第1142-1187行）

每 10 秒输出一次统计：
- 总消息数、无人机数、订阅数
- 每架无人机：消息数、位置、航向、模式、数据年龄
- 每个话题的消息计数
- GPS 跳变拒绝数、Kafka 成功/失败数、后端成功/失败数

#### 后端侧日志

- Kafka 消费者：每条消息的 Epoch 校验结果
- 分区路由：缓存命中/未命中
- 双写同步：成功/失败/重试
- 对账：偏差检测和修复
- WebSocket：推送分区数和无人机数

#### 升级建议

| 维度 | 当前 | 建议 |
|------|------|------|
| **指标** | 日志文本 | Prometheus + Micrometer（Spring Boot Actuator） |
| **链路追踪** | 无 | OpenTelemetry + Jaeger |
| **仪表盘** | 无 | Grafana（Kafka/Redis/JVM/自定义指标） |
| **告警** | 无 | Alertmanager（消费延迟、无人机离线、Redis 故障） |

---

## 34. 可扩展性分析

### 水平扩展能力

| 组件 | 可扩展性 | 瓶颈 |
|------|---------|------|
| **DDS/MAVLink 网关** | MD5 静态分片 → 需重启扩缩 | 动态发现和负载均衡 |
| **Kafka** | 分区数限制并行度 | 16分区 → 最多16个消费者 |
| **后端消费者** | `concurrency` 参数调整 | 受 Kafka 分区数限制 |
| **Redis** | 单节点 → 集群 | 当前单节点无分片 |
| **PostgreSQL** | 单节点 → 读写分离 | 当前无读副本 |
| **TimescaleDB** | hypertable 自动分区 | 未启用 hypertable |
| **WebSocket** | 单实例 → 需要 Redis Pub/Sub 扇出 | 当前单实例推送 |

---

## 35. 性能瓶颈与优化路径

### 识别到的瓶颈

| 瓶颈 | 影响 | 优化方案 |
|------|------|---------|
| **每架无人机独立心跳线程** | 100架=100线程，Python GIL 限制 | 统一调度器 or asyncio |
| **遥测 5s 批量落盘** | 进程崩溃丢失5秒数据 | 减小批量间隔 or WAL |
| **对账扫描全表** | 无人机数增加时性能下降 | 增量对账（`updated_at`） |
| **WebSocket 单实例** | 无法水平扩展 | Redis Pub/Sub 扇出 |
| **Kafka JSON 序列化** | 消息体积大、CPU 开销 | Avro/Protobuf + Schema Registry |
| **分区路由每次查询 Redis** | 10Hz × N 架无人机 | 本地缓存 + TTL |

---

## 36. 未来升级路线图

### 短期（1-3个月）

1. **Java 17 → 21**：启用虚拟线程
2. **TimescaleDB hypertable**：启用自动分区和压缩
3. **心跳线程合并**：统一调度器管理所有心跳
4. **Prometheus + Grafana**：基础监控体系

### 中期（3-6个月）

5. **Nacos 动态分片**：替代静态 MD5 分片
6. **Debezium CDC**：替代 Post-Commit Hook，多实例缓存同步
7. **Kafka Schema Registry**：Avro 序列化
8. **多实例 WebSocket**：Redis Pub/Sub 扇出

### 长期（6-12个月）

9. **asyncio 网关重构**：协程模型替代线程模型
10. **Kubernetes 部署**：自动扩缩容
11. **ABAC 权限引擎**：OPA 策略引擎
12. **AI 异常检测**：遥测数据异常自动告警

---

> **文档维护提示**：本文档基于 FUIAttemptation 分支代码分析生成。当代码发生重大变更时，需要更新对应的行号引用和实现细节描述。
