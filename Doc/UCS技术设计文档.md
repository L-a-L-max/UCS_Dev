# UCS 技术设计文档

> 面向：**技术基础薄弱的新接手开发者**
> 目标：读完本文档后，能够独立讲清楚 UCS 无人机地面站从"真机遥测 → Kafka → 微服务 → WebSocket 前端"的完整链路，以及每一处关键设计的 *问题—方案—参数—权衡* 四要素。
> 配套文档：《UCS 技术解析 QA 文档》（面试视角的深度剖析）。

---

## 1. 系统总体架构图（文字版）

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                               数据采集层（Gateway）                              │
│                                                                                  │
│   ┌──────────────────────────────┐      ┌──────────────────────────────┐         │
│   │  Mavlink 网关                │      │  DDS / ROS2 网关             │         │
│   │  - UDP 14550 / TCP 收真机    │      │  - rclpy 订阅 PX4 仿真       │         │
│   │  - pymavlink 解析            │      │  - QoS = BEST_EFFORT         │         │
│   │  - 线程池 10 (cmd) + 4 (ack) │      │  - 线程池 10 (cmd)           │         │
│   │  - Redis epoch: mavlink:*    │      │  - Redis epoch: dds:*        │         │
│   └──────────────────────────────┘      └──────────────────────────────┘         │
│                     │ Kafka key = uav_id                 │                       │
└─────────────────────┼────────────────────────────────────┼───────────────────────┘
                      ▼                                    ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                        Kafka 3-Broker KRaft 集群（中间件）                       │
│                                                                                  │
│   telemetry.raw   ──►  telemetry.processed  ──►  events.drone                    │
│                                                                                  │
│   commands.down   ◄── business / command ──── commands.ack                       │
│                                                                                  │
│   num.partitions=16  RF=3  min.insync.replicas=2  retention=168h                 │
└──────────────────────────────────────────────────────────────────────────────────┘
                      ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                               后端微服务群（Spring Boot 21 + 虚拟线程）          │
│                                                                                  │
│   ucs-telemetry-ingest  (8081) Epoch 校验 + Redis 写 + GeoHash 索引 → processed  │
│   ucs-telemetry-store   (8082) 批量 JDBC 写 TimescaleDB（>50k rows/s）           │
│   ucs-realtime-push     (8083) 批量聚合 → /topic/telemetry/partition/{p}         │
│   ucs-command           (8084) REST + Kafka 生产 commands.down + 幂等 SETNX      │
│   ucs-drone-state       (8085) Device Shadow + 分区查询                          │
│   ucs-business          (8086) 用户/角色/JWT + 分区路由 + WebSocket 全量广播     │
│   ucs-api-gateway       (8080) JWT 统一鉴权 + Resilience4j 限流                  │
└──────────────────────────────────────────────────────────────────────────────────┘
                      ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                           前端（Web + STOMP/SockJS）                             │
│                                                                                  │
│   登录 → JWT → /ws 握手 → STOMP SUBSCRIBE                                        │
│     /topic/telemetry                          全量（大屏）                       │
│     /topic/telemetry/partition/{partitionName} 分区（按角色/用户隔离）          │
│     /topic/drone/{uavId}                      单机视图                           │
│     /topic/viewport/{sessionId}               视口过滤（按 GeoHash 边界）       │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 关键数据流语义

- **遥测主链路**：Gateway →(`telemetry.raw` key=uav_id)→ ingest →(`telemetry.processed` key=uav_id)→ { store 批量入库 / push 批量广播 / business 分区路由 } 三路并行消费。
- **指令回路**：Frontend → API Gateway → ucs-command/ucs-business →(`commands.down` key=uav_id)→ Gateway → 真机/PX4 →(`commands.ack` key=uav_id)→ ucs-command + ucs-business（转 WebSocket）。
- **一致性保证**：uav_id 作为 Kafka 分区 Key，确保"同一架飞机的消息严格有序"；Epoch 作为"重启/重连代数号"过滤过期指令。

---

## 2. 模块一：数据采集层（Mavlink 网关 + DDS 网关）

### 2.1 设计目标

数据采集层是系统唯一与 *真实硬件 / 仿真器* 直接通信的组件，它需要同时解决下列问题：

1. **协议屏蔽**：上层只看到统一的 JSON 遥测/指令消息，看不见 MAVLink 二进制包或 ROS2 IDL 类型。
2. **反压与扇出**：一台网关要抗住几十架飞机 10Hz 的遥测（≈数百 pkt/s），同时把"一条命令 → N 架飞机"并行下发。
3. **故障隔离**：网关挂了不能污染状态——重启后必须能识别"过期命令"并丢弃（Epoch 机制）。
4. **水平扩展**：多实例部署时，每个实例只处理自己"哈希命中"的那批飞机（uav_id 分桶）。
5. **可观测**：每条消息都可追溯到具体飞机、具体时间戳、具体 epoch。

### 2.2 Mavlink 网关详解（`mavlink-gateway/mavlink_gateway.py`）

#### 2.2.1 它解决什么问题

真机通过 MAVLink 协议（通常是 UDP 14550）把状态包（HEARTBEAT、GLOBAL_POSITION_INT、ATTITUDE、BATTERY_STATUS、COMMAND_ACK 等）发给地面端。后端的 Spring Boot 微服务不想（也不应该）直接解析 MAVLink 二进制；网关承担"解包 → 规范化 JSON → 写 Kafka"的职责，同时反向把 Kafka `commands.down` 翻译成 `COMMAND_LONG`/`SET_POSITION_TARGET_LOCAL_NED` 发回飞机。

#### 2.2.2 核心流程

```
[真机 UDP/TCP] ──► _udp_socket.recvfrom(65535)
                  │
                  ▼
              _parse_mavlink_bytes()   (pymavlink，robust_parsing=True)
                  │ 每条 MAVLink msg
                  ▼
          _dispatch_mavlink_message()  → 识别 uav_id（IP/sysid 映射 mavlink:ip_map:*）
                  │
                  ├──► 本地状态更新（self._drone_state[uav_id]，per-drone Lock 保护）
                  ├──► Redis 心跳：mavlink:online:{uav_id}, TTL=30s
                  └──► Kafka send('telemetry.raw', key=uav_id, value=json)

[Kafka commands.down] ──► KafkaConsumer poll
                         │
                         ▼
                 _command_executor.submit(...)  （10 线程并行派发）
                         │
                         ▼
               Epoch 校验（mavlink:epoch:{uav_id}）→ 过期丢弃
                         │
                         ▼
              _send_mavlink_command_long() 或 _send_mavlink_set_position_target()
                         │
                         ▼
                [_udp_socket.sendto(packed, addr)]
                         │
                         ▼
               等待真机 COMMAND_ACK → 通过 _ack_executor（4 线程）回发 commands.ack
```

#### 2.2.3 关键代码与参数

**UDP 监听**（`_start_udp_listener`, L1072-1108）：

```python
self._udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
self._udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
self._udp_socket.bind((self.listen_host, self.listen_port))  # 默认 0.0.0.0:14550
self._udp_socket.settimeout(1.0)                              # 1s 超时避免 recvfrom 永久阻塞
```

- `recvfrom(65535)`：UDP 最大单包 65535 字节，一次性读完避免分片。
- `SO_REUSEADDR`：进程崩溃重启时不等 TIME_WAIT，提高可用性。
- `settimeout(1.0)`：让监听线程周期性检查 `self.running`，以便 graceful shutdown。
- 监听循环运行在 `threading.Thread(name='udp-listener', daemon=True)`，独占一条线程，不占用命令池线程。

**TCP 备用通道**（`_start_tcp_listener`, L1110-1142）：

- `server_socket.listen(50)`：半连接队列 50，单网关实例最多 50 个待握手 TCP 客户端。
- 每条 accept 出来的连接 **独立开一条** reader 线程（`tcp-client-{ip}:{port}`），避免一架飞机的阻塞影响其他飞机。

**线程池模型**（`__init__`, L216-258）：

| 线程池 | 大小 | 命名前缀 | 队列 | 职责 |
|---|---|---|---|---|
| `_command_executor` | `max_workers=10` | `cmd-dispatch` | 默认 `SimpleQueue`（无界） | 并行派发多机指令 |
| `_ack_executor` | `max_workers=4` | `ack-fwd` | 默认 `SimpleQueue`（无界） | 把 COMMAND_ACK 转成 Kafka 消息 |
| UDP 监听线程 | 1 | `udp-listener` | — | 收包 + 分发 |
| TCP accept 线程 | 1 | `tcp-accept` | — | 每连接再 fork reader |

**为什么 10 + 4 这两个值**：
- **10（cmd）**：项目设计目标是"单网关支撑 ≤50 架飞机"。一次群体指令（如"全部起飞"）会同时产生 50 次 `_send_mavlink_command_long` 调用；每次调用包含 UDP sendto + 等待 ACK 确认（含 2s 重试），I/O 密集型。10 条线程足以让 "50 机起飞"在 2-3 秒内完成，同时避免把整台机器的 FD 打满。
- **4（ack）**：回执只是"反序列化 ACK → Kafka send"，纯 CPU + 网络 I/O，轻量，4 条够用；且独立池可防止 ACK 洪峰阻塞下发。

**Kafka 生产者**（`_init_kafka`，DDS 网关 L687-700 结构一致）：

```python
KafkaProducer(
    bootstrap_servers=...,
    key_serializer=lambda k: k.encode('utf-8'),
    value_serializer=lambda v: json.dumps(v).encode('utf-8'),
    acks=1,             # Leader 确认即可——遥测丢一两条可容忍，延迟优先
    retries=3,
    max_block_ms=5000,  # 缓冲区满时最多阻塞 5s，避免无限卡死
    linger_ms=0,        # 立刻发送，不攒批——10Hz 遥测对延迟敏感
    batch_size=16384,   # 16KB，防止极端情况下批量堆积
)
```

**关键一行**：`self._kafka_producer.send('telemetry.raw', key=uav_id, value=msg)`（L985）
- `key=uav_id` 是 **全链路有序性的基石**：Kafka 默认分区器对 key 做哈希 → 同一架飞机总是落到同一分区 → 消费者对同一分区单线程消费 → 有序。
- 无 `flush()`：异步发送，吞吐优先；即便进程崩溃丢掉 in-flight 的几条遥测，也不影响系统正确性（下一帧 100ms 后就来了）。

**Epoch 过期丢弃**：
- 每次网关启动，`self._epoch_map[uav_id]` 通过 `redis.incr('mavlink:epoch:{uav_id}')` +1。
- 指令带上 `epoch`；消费指令时比较：`if msg.epoch < current_epoch: discard`。
- 这解决了**网关重启/切主后残留的旧指令被误执行**的问题——相当于给每一代网关发了一张"任期卡"。

#### 2.2.4 per-drone Lock 的必要性

```python
with self._drone_lock(uav_id):
    self._drone_state[uav_id].update(...)
```

- UDP 监听线程可能同时收到同一架飞机的两种消息（GPS + ATTITUDE），并行走两条代码路径更新 `self._drone_state[uav_id]`。
- 若不加锁 → Python GIL 只能保证单条字节码原子性，复合操作（读-改-写）仍会串扰。
- 做成 **per-drone** 而不是全局锁：避免"A 机慢，拖累 B 机"的伪临界区。

### 2.3 DDS 网关详解（`dds-gateway/dds_gateway.py`）

#### 2.3.1 与 Mavlink 网关的关系

DDS 网关与 Mavlink 网关是**对称结构**（"Mirrors the DDS Gateway architecture" — 见 `mavlink_gateway.py` L180）：

| 维度 | DDS 网关 | Mavlink 网关 |
|---|---|---|
| 数据源 | PX4 SITL / 真机 ROS2 DDS | 真机 UDP/TCP MAVLink |
| 协议栈 | rclpy + px4_msgs | pymavlink |
| 指令语义 | PX4 VehicleCommand / TrajectorySetpoint | MAVLink COMMAND_LONG / SET_POSITION_TARGET_LOCAL_NED |
| Kafka 输出 Topic | **完全相同**：`telemetry.raw` | **完全相同**：`telemetry.raw` |
| Kafka Key | `uav_id`（如 `px4_1`） | `uav_id`（如 `mav_192.168.1.10_1`） |
| Epoch Redis 前缀 | `dds:epoch:` | `mavlink:epoch:` |
| 指令线程池 | 10 | 10 |

**设计要点**：两种网关"殊途同归"——写出的 JSON 消息 schema 完全一致（`TelemetryMessage` DTO），下游 `ucs-telemetry-ingest` 无需区分数据源。

#### 2.3.2 DDS 话题 → Kafka Topic 映射

PX4 通过 ROS2 DDS 发出一组话题，DDS 网关订阅并合并成一条 JSON：

| PX4 DDS 话题 | 字段输出到 | 作用 |
|---|---|---|
| `/px4_{n}/fmu/out/vehicle_global_position` | `lat`, `lon`, `alt` | WGS84 经纬度 |
| `/px4_{n}/fmu/out/vehicle_local_position` | `nedX`, `nedY`, `nedZ`, `vx`, `vy`, `vz` | 本地 NED 坐标 + 速度 |
| `/px4_{n}/fmu/out/vehicle_attitude` | `heading` | 航向角 |
| `/px4_{n}/fmu/out/vehicle_status` | `armed`, `flightMode` | 解锁状态、飞行模式 |
| `/px4_{n}/fmu/out/battery_status` | `batteryPercent` | 电量百分比 |
| `/px4_{n}/fmu/out/vehicle_command_ack` | → Kafka `commands.ack` | 指令回执 |

**所有订阅合并**后，每帧遥测通过 `send_to_kafka()` 发到 **唯一的 Topic `telemetry.raw`**，Key = `px4_{n}`。

#### 2.3.3 多实例分片

```python
def _owns_drone(self, uav_id: str) -> bool:
    """hash(uav_id) % total_instances == instance_id"""
```

- 部署 N 个 DDS 网关副本时，每个副本只订阅"自己那份"uav_id。
- 分片函数纯哈希 + 取模，无中心协调，重启/扩容不需要通知对方。
- 代价：扩/缩容时会有一次"哈希重分布"，短暂重复或丢失订阅——由 Epoch + Kafka key 有序性兜底。

#### 2.3.4 QoS 必须匹配

```python
qos = QoSProfile(
    reliability=ReliabilityPolicy.BEST_EFFORT,  # PX4 发布端就是 BEST_EFFORT
    durability=DurabilityPolicy.VOLATILE,
    depth=5,
)
```
这是 DDS 新手最容易踩的坑：如果订阅端声明 `RELIABLE`，而发布端是 `BEST_EFFORT`，**DDS 规范直接拒绝匹配，一条数据也收不到**。

---

## 3. 模块二：Kafka 消息层

### 3.1 它解决什么问题

- **解耦**：Gateway（Python）和微服务（Java）不再直接 RPC；中间加一层 Kafka，任何一方重启、升级、横向扩容都不影响对方。
- **削峰**：10Hz × 50 架 = 500 msg/s 的瞬时峰值可以让消费者按自己节奏消费（批量拉 500 条一次入库）。
- **多消费者独立进度**：同一条 `telemetry.processed`，被 `store-group`、`push-group`、`ucs-business-telemetry` 三个 Group 各自独立消费，互不干扰。
- **持久化缓冲**：`log.retention.hours=168`（7 天），哪怕下游全挂，7 天内重启可重放。

### 3.2 集群与参数（`docker-compose-kafka.yml`）

| 参数 | 值 | 作用 |
|---|---|---|
| `KAFKA_PROCESS_ROLES` | `controller,broker` | KRaft 模式，每节点同时是 controller 和 broker，不依赖 ZooKeeper |
| `KAFKA_CONTROLLER_QUORUM_VOTERS` | `1@kafka-1:9093,2@kafka-2:9093,3@kafka-3:9093` | 3 节点 Raft 仲裁，容忍 1 节点故障 |
| `KAFKA_DEFAULT_REPLICATION_FACTOR` | `3` | Topic 默认 3 副本 |
| `KAFKA_MIN_INSYNC_REPLICAS` | `2` | 配合 `acks=all`，至少 2 副本同步成功才算写入 |
| `KAFKA_NUM_PARTITIONS` | `16` | 默认 16 分区，支持 16 条并行消费 |
| `KAFKA_LOG_RETENTION_HOURS` | `168` | 7 天 |
| `KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR` | `3` | 消费位点 topic 也 3 副本，确保消费进度不丢 |

### 3.3 Topic 命名与职责（`KafkaTopicConstants.java`）

| Topic | Key | 生产者 | 消费组 | 消费者职责 |
|---|---|---|---|---|
| `telemetry.raw` | uav_id | Gateway | `ingest-group` | Epoch 校验 / Redis 写 / GeoHash / 转发 |
| `telemetry.processed` | uav_id | ingest | `store-group` / `push-group` / `ucs-business-telemetry` | 批量入库 / WebSocket / 分区路由 |
| `events.drone` | uav_id | 各服务 | `business-group` | 上线/下线/告警等状态变更 |
| `commands.down` | uav_id | command / business | Gateway | 下发给真机/PX4 |
| `commands.ack` | uav_id | Gateway | `command-group` | 指令回执，带 epoch 校验 |

### 3.4 分区策略与顺序性

#### 3.4.1 "Key = uav_id" 为什么是全系统的核心约定

```java
// CommandKafkaProducer.java L60
kafkaTemplate.send(commandsDownTopic, uavId, json);  // uavId 作为 key
```
```python
# dds_gateway.py L985
self._kafka_producer.send('telemetry.raw', key=uav_id, value=msg)
```

Kafka 默认分区器：
```
partition = murmur2(key.getBytes()) % num_partitions
```

带来三条不可替代的保证：

1. **严格有序**：同一架飞机的 N 条消息，总是落在同一分区 → 同一 Consumer 线程顺序消费 → 下游看到的状态变迁与真实发生一致。
2. **可并行**：不同飞机哈希到不同分区 → 16 个分区并行消费，吞吐 ≈ 单机 ×16。
3. **可横向扩容 Consumer**：加副本只需把分区重新分配给新副本即可（re-balance），无需改代码。

#### 3.4.2 为什么不用"全局顺序"

- 代价：`num.partitions=1`，吞吐退化为单机单线程。
- 业务上并不需要："A 机起飞"和"B 机返航"之间无因果依赖。
- 我们需要的是**"按飞机粒度"的因果顺序**，正好是 Kafka 分区的原生语义。

### 3.5 生产者可靠性

| 服务 | acks | retries | 语义 |
|---|---|---|---|
| Gateway（遥测）| `1` | `3` | 延迟优先，丢 1-2 条可容忍 |
| ucs-command / ucs-business（指令）| `all` | `3` | 可靠性优先，配合 `min.insync.replicas=2` 实现"写成功即不丢" |

对应 `ucs-command/application.yml` L24-25：
```yaml
producer:
  acks: all
  retries: 3
```

### 3.6 消费者配置对比

| 服务 | `concurrency` | `batch` | `max-poll-records` | `fetch-min-size` / wait | 设计意图 |
|---|---|---|---|---|---|
| `ucs-telemetry-ingest` | 4 | false | 1 | 1 / 100ms | 低延迟，逐条校验后立即转发 |
| `ucs-telemetry-store` | 4 | **true** | **500** | **64KB / 500ms** | 高吞吐，攒批做 JDBC batchInsert |
| `ucs-realtime-push` | 4 | true | 默认 | 默认 | 批量聚合推 WebSocket |
| `ucs-business` | 4 | false | 1 | 1 / 100ms | 实时分区路由 |
| `ucs-command`（ack）| 2 | false | 默认 | 默认 | ack 消费量小 |

---

## 4. 模块三：后端微服务群

### 4.1 整体服务划分

| 服务 | 端口 | 核心职责 | 关键技术点 |
|---|---|---|---|
| `ucs-api-gateway` | 8080 | 路由、JWT 统一校验、限流、CORS 去重 | Spring Cloud Gateway + Resilience4j RateLimiter + JwtAuthGatewayFilter |
| `ucs-telemetry-ingest` | 8081 | 消费 `telemetry.raw`，Epoch 校验，Redis 状态/心跳/GeoHash 更新，转发到 `telemetry.processed` | 4 线程 KafkaListener，虚拟线程，Lettuce pool |
| `ucs-telemetry-store` | 8082 | 消费 `telemetry.processed`，批量入 TimescaleDB | JDBC batchUpdate (500/批)，HikariCP (20/5)，目标 >50k rows/s |
| `ucs-realtime-push` | 8083 | 消费 `telemetry.processed`，批量 WebSocket STOMP 推送 | SimpMessagingTemplate，/topic/* 多级路由 |
| `ucs-command` | 8084 | 接收 REST 指令，写 `commands.down`，消费 `commands.ack`，幂等 | Resilience4j 熔断/重试/Bulkhead，Redis SETNX 幂等，自定义线程池 core=4 / max=16 |
| `ucs-drone-state` | 8085 | Device Shadow (reported/desired/delta) + 分区查询 | Redis 单 Key JSON (`shadow:{uavId}`)，TTL=24h |
| `ucs-business` | 8086 | 用户/角色/团队/JWT 登录，分区路由（**双写一致性核心**），WebSocket 全量广播 | PostgreSQL + Redis 双写，Transactional Outbox + 事务后置钩子 |
| `ucs-common` | — | 公共库：DTO、Epoch 校验、Redis 服务、多级缓存、GeoSpatial | Caffeine L1 + Redis L2 + DB L3；Redis Pub/Sub 失效广播 |

### 4.2 遥测数据消费与校验流程（`TelemetryRawConsumer.java`）

```java
@KafkaListener(topics = TELEMETRY_RAW, groupId = GROUP_INGEST, concurrency = "4")
public void consume(ConsumerRecord<String, String> record) {
    // 1. Epoch 校验 — 过期丢弃
    if (!epochService.validate(uavId, msg.getEpoch())) return;

    // 2. Redis 状态更新（允许失败，不阻塞转发）
    redisService.updateDroneState(uavId, stateMap);
    redisService.setDroneOnline(uavId);

    // 3. GeoHash 空间索引
    geoService.updateDronePosition(uavId, lat, lon);

    // 4. 关键：转发到 telemetry.processed（第 2、3 步失败也要转发）
    kafkaTemplate.send(TELEMETRY_PROCESSED, uavId, rawValue);
}
```

**四步职责分明**：
1. **Epoch 校验**（`EpochValidationService.validate`）— 读 `epoch:{uavId}`，`msgEpoch < current` 则直接 `return`，丢掉残留的老消息。
2. **Redis 双写**（次要副本）— `drone:{uavId}:state`（Hash）TTL 30s + `drone:{uavId}:online` TTL 30s。失败 `log.warn` 但不抛出。
3. **GeoHash 空间索引** — `GEOADD drone:positions lon lat uavId` + 反向索引 `geohash:{hash} -> Set<uavId>`。为前端视口查询服务。
4. **转发到 `telemetry.processed`** — **这一步必须成功**，否则整条链路断掉。所以代码上用独立 `try/catch` + `log.error("CRITICAL: ...")`。

**为什么前三步允许失败、第四步不能失败**：
- Redis/GeoHash 是**读端优化的旁路缓存**，重启后下一帧遥测（100ms 后）就会重新填充。
- Kafka `telemetry.processed` 是**store / push / business 三个下游的唯一数据源**。一条遥测没转发出去 → 数据库缺这条记录 + 前端看不到这一帧。

### 4.3 双写一致性（Redis + PostgreSQL）

项目在不同场景下用了 **三种**一致性方案，分别针对"写多/写少、强/弱一致、能不能接受 stale"：

#### 4.3.1 方案 A：遥测（弱一致 + 最新覆盖）

- 写入路径：`TelemetryRawConsumer` 每帧都覆盖 Redis Hash、每 500 条/5s 批量入库。
- **没有用分布式锁，也不需要**——遥测天然"只增不改"，且 Key = uav_id 的 Kafka 分区保证了"同一架飞机的写入顺序 = 真实时间顺序"，后到的总是比先到的新。

#### 4.3.2 方案 B：分区映射（强一致 + Transactional Outbox + Post-Commit Hook）

见 `PartitionRoutingService.java` L28-65 注释，这是项目中最精心设计的一致性方案：

```
(1) DB-first 写：@Transactional 内 UPDATE drone_partition_map
(2) 事务提交后回调：TransactionSynchronization.afterCommit() 执行 Redis 写
(3) afterCommit 里 Redis 失败 → 入 ConcurrentLinkedQueue pendingRedisSyncQueue
(4) @Scheduled 每 60s 扫描：
     - 重试 pending 队列
     - 全量对账：从 DB 查出活动映射，与 Redis 中的 Set 比对，修正差异
```

**为什么不用"延迟双删"**：
- 延迟双删依赖一个神奇的 sleep 值；Redis/DB 延迟抖动时会失效。
- 延迟双删失败时没有重试托底，最终仍可能留下脏 cache。
- Post-commit 钩子：**事务回滚 → 不会写 Redis**（物理保证不会出现"DB 没改成功但 Redis 改了"）；写 Redis 失败 → 进队列 → 60s 内必纠正。

**收敛窗口**：正常 <100ms（post-commit 延迟）；Redis 宕机时 ≤60s（对账周期）恢复。

#### 4.3.3 方案 C：通用多级缓存（Caffeine L1 + Redis L2 + DB L3）

`MultiLevelCacheService.java` 实现：

| 层级 | 介质 | TTL | 保护措施 |
|---|---|---|---|
| L1 | Caffeine（进程内）| 10s，最多 10,000 条 | `ReentrantLock` 锁 key 防击穿 |
| L2 | Redis | 300s ± 30s（随机抖动）| 逻辑过期时间（base×0.8）+ 异步刷新，防雪崩 |
| L3 | 数据库 | — | 只在 L1+L2 miss 时访问，单 key 串行 |

**穿透**：方案 B 的 `PartitionRoutingService` 额外叠加"布隆过滤器（10 万量级、1% 误判）+ uavId 正则（px4_N / mav_IP_N / mavlink_*）+ 空值缓存（60s）"三重防线。

**跨实例 L1 一致性**：`CacheInvalidationPublisher` 写 DB 后 `PUBLISH cache:invalidate region:key` → `CacheInvalidationListener` 各实例 `invalidateL1`。Redis Pub/Sub "Fire & Forget"，不强保证，但配合 L1 10s TTL 兜底。

### 4.4 并发优化细节

#### 4.4.1 虚拟线程（Spring Boot 21 + Java 21）

所有 Java 服务 `application.yml`：
```yaml
spring:
  threads:
    virtual:
      enabled: ${VIRTUAL_THREADS_ENABLED:true}
```

**效果**：Tomcat 请求处理、`@Async`、`@Scheduled` 都默认跑在虚拟线程上。对 I/O 密集型请求（查 Redis、查 DB）吞吐几乎不受线程数限制；对 CPU 密集任务收益有限——所以 "计算池" 仍然用普通 `ThreadPoolExecutor`。

#### 4.4.2 自定义线程池（`ThreadPoolConfig.java` / ucs-command）

```java
ThreadPoolExecutor(
    4,                                          // corePoolSize
    16,                                         // maximumPoolSize
    60L, TimeUnit.SECONDS,                      // keepAlive
    new LinkedBlockingQueue<>(256),             // 队列上限
    namedThreadFactory("cmd-processor"),
    new ThreadPoolExecutor.DiscardOldestPolicy()// 拒绝策略
);
executor.allowCoreThreadTimeOut(true);
```

**为什么 core=4 / max=16 / queue=256**：
- 指令低频、高价值：core 不需要大。
- 突发批量指令（如"50 机起飞"）：扩到 max=16 吃掉峰值。
- queue=256：有缓冲但不无限堆积；无界队列会让 max 永远不触发。

**为什么 `DiscardOldestPolicy`（丢最旧）**：
- 可选方案 `CallerRunsPolicy`（调用者运行）= 让 Kafka Consumer 自己跑 → 阻塞 poll() → 超过 `max.poll.interval.ms=600000` 就被踢出组 → rebalance → **雪崩式可用性劣化**。
- `DiscardOldestPolicy` 丢的一定是队列里最老的那条指令（已经 stale 了）；结合 ucs-command 的 **SETNX 幂等保护**（`IdempotencyService.tryAcquire`），用户可以安全重试。
- 对比 `AbortPolicy`（抛异常）：会让 Consumer 异常回退，比丢弃更差。
- 哲学：**HA-first，可用性 > 不丢消息**（注释原话："never block Kafka Consumer"）。

#### 4.4.3 异步批量持久化

`ucs-telemetry-store/TelemetryBatchConsumer.java`：
```java
@KafkaListener(topics=TELEMETRY_PROCESSED, groupId=GROUP_STORE, batch="true", concurrency="4")
public void consumeBatch(List<ConsumerRecord<String, String>> records) {
    telemetryRepository.batchInsert(batch);
}
```

`application.yml` 配合：
```yaml
max-poll-records: 500     # 一次拉 500 条
fetch-min-size: 65536     # Broker 至少攒 64KB 才返回
fetch-max-wait: 500       # 最多等 500ms
```

**为什么 500 + 64KB + 500ms 是"三位一体"**：
- 如果只有 `max-poll-records=500`，但流量不足时 Broker 立刻返回少量记录 → 攒不成大批。
- `fetch-min-size=64KB` + `fetch-max-wait=500ms`：等"要么攒够 64KB、要么等满 500ms"，保证每次 poll 都接近满载。
- 代价：**最差 500ms 延迟**。遥测落库本就不是实时路径（实时走 push 服务 WebSocket），可接受。

`TelemetryRepository.batchInsert`：
```java
jdbcTemplate.batchUpdate(INSERT_SQL, records, 500, setter)
```

- 第三个参数 `500`：JDBC 每攒 500 行 flush 一次 `PreparedStatement.executeBatch()`。
- 配合 HikariCP `maximum-pool-size: 20, minimum-idle: 5`：4 个消费者 × 每个事务最多占 1 连接 + 其他 REST 查询用 → 20 足够。

#### 4.4.4 其他关键技术

**幂等性**（`IdempotencyService.java`）：
```java
redisTemplate.opsForValue().setIfAbsent("cmd:idempotent:" + requestId, "1", Duration.ofMinutes(10));
```
- SETNX + TTL 10 分钟：同一 `requestId` 10 分钟内只能成功执行一次。
- 失败时可 `release()` 主动删 key，允许重试。

**熔断 / 重试 / 舱壁**（`ucs-command/application.yml` L62-81）：
```yaml
resilience4j:
  circuitbreaker.instances.commandDispatch:
    slidingWindowSize: 10
    failureRateThreshold: 50       # 失败率 >50% 触发熔断
    waitDurationInOpenState: 30s
  retry.instances.commandDispatch:
    maxAttempts: 3
    waitDuration: 2s
    retryExceptions: [ IOException, TimeoutException ]
  bulkhead.instances.commandDispatch:
    maxConcurrentCalls: 10         # 最多 10 条并发调用网关
```

**事务**：
- `@Transactional` 主要在 ucs-business：分区映射、用户注册、团队管理、拉力点（RallyPoint）等。
- 关键用法：`PartitionRoutingService` 在 `@Transactional` 方法里注册 `TransactionSynchronizationManager.registerSynchronization(new afterCommit...)`，把"写 Redis"放到**事务提交后**执行——事务回滚 Redis 一定不会被污染。

**索引**（`Doc/sql/`）：
- TimescaleDB `telemetry_data` hypertable：按 `time` 自动分片；`(uav_id, time DESC)` 复合索引支持"单机最近轨迹查询"。
- PostgreSQL `drone_partition_map`：`(partition_name, is_active)`、`(uav_id, is_active)` 覆盖索引。

**AOP**：
- 日志切面统一在 controller 层打印请求/响应摘要（INFO 级别，不含 payload，避免日志爆炸）。
- 权限切面：ucs-business 的 `PermissionService` 对标注 `@RequiresRole("commander")` 的方法做 JWT claim 检查。

**定时任务 + 分布式锁**：
- 所有 `@Scheduled` 方法都叠加 `@SchedulerLock(name=..., lockAtLeastFor=..., lockAtMostFor=...)`（ShedLock + Redis）。
- 典型：`EpochValidationService.periodicMaintenance`（6h）、`TelemetryPersistenceService.flushBuffer`（5s）、`PartitionRoutingService` 对账（60s）。
- 作用：多实例部署时，同一时刻只有**一台**跑定时任务，避免重复工作或写冲突。

---

## 5. 模块四：前端与 WebSocket

### 5.1 连接建立

**后端**（`WebSocketConfig.java`）：
```java
@EnableWebSocketMessageBroker
config.enableSimpleBroker("/topic");
config.setApplicationDestinationPrefixes("/app");
registry.addEndpoint("/ws").setAllowedOriginPatterns("*").withSockJS();
registry.addEndpoint("/ws").setAllowedOriginPatterns("*");  // 原生 WebSocket
```

**前端**：
```js
const client = Stomp.over(new SockJS('/ws'));
client.connect({ Authorization: 'Bearer ' + accessToken }, () => {
  client.subscribe('/topic/telemetry', ...);
  client.subscribe(`/topic/telemetry/partition/${partitionName}`, ...);
});
```

### 5.2 分区推送隔离机制

前端登录后从 `LoginResponse.partitions` 拿到自己的分区名（`observer` / `commander` / `zs_2` 等），只订阅自己的分区 topic：

**后端广播**（`TelemetryKafkaConsumer.broadcastToPartitionsNow` + `WebSocketGatewayService.broadcastToPartitions`）：
```java
for (drone in snapshot) {
    Set<String> partitions = partitionRoutingService.getPartitionsForDrone(uavId);
    for (p in partitions) partitionData.get(p).add(drone);
}
webSocketGatewayService.broadcastToPartitions(partitionData, now);
// -> messagingTemplate.convertAndSend("/topic/telemetry/partition/" + p, msg)
```

**分区映射来源**（`DronePartitionMap` 表 + Redis Set `drone:{uavId}:partitions`）：
- 一架飞机可以同时属于多个分区（比如 `observer`、`commander` 全局分区 + 某 pilot 的 `zs_2` 分区）。
- 前端只看到"属于自己分区"的飞机 → **业务层隔离**（不是加密隔离）。

#### 5.2.1 分区名的计算规则（`PartitionNameUtil.computePartitionName`）

| 角色 | 分区名 | 含义 |
|---|---|---|
| observer | 固定 `observer` | 全局观察者，看所有机 |
| commander | 固定 `commander` | 全局指挥，看所有机 |
| 其他（pilot / leader / operator）| `{拼音姓氏首字母}{名字首字母}_{userId}` | 如 `zhangsan`, id=2 → `zs_2` |

- 为什么 observer/commander 用固定名：全局角色多人共用同一分区，一条广播覆盖所有人 → 省网络。
- 为什么普通用户带 userId：**重名防冲突**（`zhangsan1` 和 `zhangsan2` 不能撞分区）。

### 5.3 视口过滤（`ViewportController.java`）

前端在地图缩放/平移时发送：
```js
stompClient.publish({
  destination: '/app/viewport/update',
  body: JSON.stringify({ minLat, maxLat, minLon, maxLon, zoomLevel })
});
```

后端：
```java
@MessageMapping("/viewport/update")
public void updateViewport(@Payload ViewportRequest viewport, SimpMessageHeaderAccessor h) {
    String sessionId = h.getSessionId();
    viewportFilter.updateViewport(sessionId, viewport);
    Set<String> visible = geoService.getDronesInViewport(minLat, maxLat, minLon, maxLon);
    messagingTemplate.convertAndSend("/topic/viewport/" + sessionId, visible);
}
```

- `sessionId` 唯一标识一条 WS 连接 → 每个 Session 有自己的视口 → 推送也只发到 `/topic/viewport/{sessionId}` 这条专属 Topic。
- GeoHash 索引实现 O(k) 查询，k = 视口覆盖的 GeoHash 单元格数，通常 <10。

### 5.4 用户登录验证机制

#### 5.4.1 JWT 双 Token（`AuthService.login`）

```java
String accessToken  = jwtUtil.generateAccessToken(...);  // 短命 30min
String refreshToken = jwtUtil.generateRefreshToken(...); // 长命 7d
```

`application.yml`：
```yaml
jwt:
  access-token-expiration: 1800000    # 30 min
  refresh-token-expiration: 604800000 # 7 day
```

- Access Token：调接口用，过期就拒绝。
- Refresh Token：调 `/api/v1/auth/refresh` 换新 Access。
- **双 Token 的价值**：Access 泄露最多 30 分钟风险；Refresh 只用一次且走单独接口，更易做黑名单。

#### 5.4.2 API Gateway 统一校验（`JwtAuthGatewayFilter.java`）

```java
public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
    if (path 在白名单) return chain.filter(exchange);
    String token = authHeader.substring(7);
    Claims claims = Jwts.parser().verifyWith(useRsa ? rsaPublicKey : hmacKey).parseSignedClaims(token).getPayload();
    if ("access".equals(tokenType) 校验) { ... pass ...}
    // 把 userId / username / roles 塞进请求头转发给下游
}
```

**白名单**：`/api/v1/auth/login`、`/register`、`/refresh`、`/actuator`、`/ws`、`/api/v1/map`、`/api/v1/public`、`/api/v1/dds-gateway`（走 X-Gateway-Key 认证）。

**RSA 可选**：配置了 `jwt.rsa.public-key` 则用 RS256 验签；否则 HMAC-SHA。生产环境推荐 RSA（网关只拿公钥，私钥只在签发方）。

#### 5.4.3 限流（`RateLimitFilter.java`, Order=-200 先于 JWT）

```yaml
ucs.rate-limit:
  default-qps: 100
  command-qps: 10   # 命令 QPS 严格限制
```
- 路径 `/api/v1/command` 走 10 QPS 限流；其他接口 100 QPS。
- 超限返回 `429 Too Many Requests`。
- 实现：Resilience4j `RateLimiter`，`timeoutDuration=ZERO` 表示"不等待直接拒绝"。

---

## 6. 关键设计回顾与权衡总结

| 场景 | 采用方案 | 取舍 |
|---|---|---|
| 多架飞机遥测并发 | Kafka key=uav_id + 16 分区 | 牺牲全局顺序换每机顺序 + 水平吞吐 |
| 遥测 Redis 写失败 | 降级为 warn，不阻塞转发 | 允许短暂状态过时，保证数据主链路通 |
| 分区映射 DB↔Redis | Transactional Outbox + afterCommit + Retry 队列 + 60s 对账 | 牺牲延迟换强一致保证 |
| 指令下发拒绝策略 | DiscardOldestPolicy + SETNX 幂等 | 允许旧指令被丢，换 Consumer 永不阻塞 |
| 遥测入库延迟 | batch=true + 500/64KB/500ms | 牺牲 ≤500ms 延迟换 50k rows/s 吞吐 |
| 防击穿/雪崩/穿透 | Caffeine mutex + TTL 抖动 + 布隆过滤器 + 空值缓存 | 代码复杂度↑ 换大并发下可用性 |
| 多实例定时任务 | ShedLock + Redis | 多一次 Redis 交互换"同一任务全局单跑" |
| WebSocket 隔离 | 按 partitionName 订阅 + 后端筛选 | 业务层隔离，不适用于安全级强隔离 |
| JWT 验签 | API Gateway 统一 + 白名单 | 下游服务专注业务，不做安全 |
| Gateway 重启 | Epoch++（Redis）| 用代数号丢弃所有旧命令，代价一个 Redis INCR |

---

## 7. 新人上手路径建议

1. **先跑起来**：`docker-compose -f docker-compose-kafka.yml up -d` → `docker-compose-microservices.yml up -d` → `python dds-gateway/dds_gateway.py`。
2. **看一条遥测是怎么流过去的**：
   - 在 DDS 网关打点 `logger.info("[SEND] %s %s", uav_id, msg)`。
   - 在 `TelemetryRawConsumer.consume()` 打点。
   - 在 `TelemetryPushConsumer.consumeBatch()` 打点。
   - 前端 Chrome DevTools WS 面板看收到的 `/topic/telemetry`。
3. **下一条命令**：前端点"起飞" → `POST /api/v1/commands/takeoff` → `ucs-command` 写 `commands.down` → Gateway `_send_mavlink_command_long` → PX4 执行 → `commands.ack` 回流。
4. **看 Kafka**：`docker exec -it ucs-kafka-1 kafka-console-consumer.sh --bootstrap-server localhost:29092 --topic telemetry.raw --from-beginning`。
5. **看 Redis**：`redis-cli KEYS 'drone:*'`、`HGETALL drone:px4_1:state`、`GET epoch:px4_1`。
6. **最后再看代码**：带着"这条消息来自哪里、去哪里"的问题反向读代码，比正向啃源码快 10 倍。

---

*本文档随代码演进。如发现与实际代码行为不符，以代码为准，并提交 PR 修正本文档。*
