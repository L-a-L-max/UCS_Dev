# UCS 无人机地面站系统 — 新手入门技术讲解

> **定位**：面向技术基础薄弱的新接手开发者或客户，以"问题驱动 + 场景实战"的方式，将 UCS 系统的技术选型、架构设计、关键代码实现完整串讲。  
> **阅读建议**：每一节对应 PDF 问题清单中的一个问题，先给出**使用场景总览**，再选取**最经典的场景**深入讲解（含关键配置、代码文件、参数含义），最后附 1–2 个**深挖追问**及其详细回答。

---

## 目录

- [Q1 — Kafka 分区与消费者隔离](#q1--kafka-分区与消费者隔离)
- [Q2 — Epoch 机制与防重放](#q2--epoch-机制与防重放)
- [Q3 — 线程池配置与场景选型](#q3--线程池配置与场景选型)
- [Q4 — 虚拟线程的适用场景](#q4--虚拟线程的适用场景)
- [Q5 — 遥测数据异步批量持久化](#q5--遥测数据异步批量持久化)
- [Q6 — WebSocket 分区推送与订阅机制](#q6--websocket-分区推送与订阅机制)
- [Q7 — Redis 数据类型与使用场景](#q7--redis-数据类型与使用场景)
- [Q8 — 三级缓存与缓存同步机制](#q8--三级缓存与缓存同步机制)
- [Q9 — 大规模无人机前端压力与 GeoHash 视口裁剪](#q9--大规模无人机前端压力与-geohash-视口裁剪)
- [Q10 — 分布式定时任务与 ShedLock](#q10--分布式定时任务与-shedlock)
- [Q11 — TimescaleDB 选型与关键配置](#q11--timescaledb-选型与关键配置)
- [Q12 — Kafka 消息积压预防](#q12--kafka-消息积压预防)
- [Q13 — Debezium 监听 WAL 实现双写一致性](#q13--debezium-监听-wal-实现双写一致性)
- [Q14 — 事务使用与传播机制](#q14--事务使用与传播机制)
- [Q15 — AOP 与操作日志](#q15--aop-与操作日志)
- [Q16 — 多无人机碰撞避免](#q16--多无人机碰撞避免)
- [Q17 — 无人机心跳维护与离线判定](#q17--无人机心跳维护与离线判定)
- [Q18 — 航线规划与集结点](#q18--航线规划与集结点)
- [Q19 — 大量无人机并发分配](#q19--大量无人机并发分配)
- [Q20 — ElasticSearch 的使用](#q20--elasticsearch-的使用)
- [Q21 — 缓存击穿、穿透、雪崩防护](#q21--缓存击穿穿透雪崩防护)
- [Q22 — 电子围栏（地理围栏）](#q22--电子围栏地理围栏)
- [Q23 — 批量控制命令的同时下发](#q23--批量控制命令的同时下发)
- [Q24 — RBAC 权限模型](#q24--rbac-权限模型)
- [Q25 — 登录鉴权与 JWT + Spring Security](#q25--登录鉴权与-jwt--spring-security)
- [Q26 — Redis 数据结构选型详解](#q26--redis-数据结构选型详解)
- [Q27 — Redis 高可用与集群架构](#q27--redis-高可用与集群架构)
- [Q28 — Kafka 可靠性、高可用与 Rebalance](#q28--kafka-可靠性高可用与-rebalance)
- [Q29 — WebSocket 连接稳定性](#q29--websocket-连接稳定性)
- [Q30 — 日志记录与分布式链路追踪](#q30--日志记录与分布式链路追踪)
- [Q31 — 分布式 ID 生成](#q31--分布式-id-生成)
- [Q32 — 数据加载慢的排查流程](#q32--数据加载慢的排查流程)
- [Q33 — JVM 内存与垃圾回收器](#q33--jvm-内存与垃圾回收器)
- [Q34 — 设计模式的应用](#q34--设计模式的应用)
- [Q35 — Kafka 数据清理策略](#q35--kafka-数据清理策略)
- [Q36 — 分布式事务](#q36--分布式事务)
- [Q37 — 限流措施](#q37--限流措施)
- [Q38 — 微服务间远程调用与负载均衡](#q38--微服务间远程调用与负载均衡)
- [Q39 — 自定义异常与异常处理](#q39--自定义异常与异常处理)
- [Q40 — Redis 缓存淘汰与过期策略](#q40--redis-缓存淘汰与过期策略)
- [Q41 — 布隆过滤器](#q41--布隆过滤器)

---

## Q1 — Kafka 分区与消费者隔离

### 场景总览

在 UCS 系统中，Kafka 承担了遥测数据（`telemetry.raw`、`telemetry.processed`）、控制指令（`commands.down`、`commands.ack`）、事件通知（`events.drone`）等多条数据链路。同一架无人机的所有遥测数据需要写入同一个 Kafka 分区，以保证该无人机的消息顺序性。那么问题来了：如何保证不会出现多个消费者同时消费同一个分区的数据？

涉及的使用场景有：
1. **遥测数据消费**：`telemetry.raw` → `ucs-telemetry-ingest` 服务消费并校验清洗 → 转发到 `telemetry.processed`
2. **业务消费**：`telemetry.processed` → `ucs-business` 服务消费做分区路由 + WebSocket 推送
3. **存储消费**：`telemetry.processed` → `ucs-telemetry-store` 服务批量写入 TimescaleDB
4. **指令消费**：`commands.down` → DDS 网关消费并下发到 PX4

### 经典场景：遥测数据消费隔离

**分区键选择**：DDS 网关在向 Kafka 生产消息时，使用 `uavId`（无人机唯一标识）作为消息的 Key。Kafka 的默认分区器对 Key 做 `murmur2(key) % numPartitions`，确保同一个 `uavId` 的消息始终落入同一个分区。

```python
# dds_gateway.py — 生产消息时以 uavId 为 Key
producer.produce(
    topic='telemetry.raw',
    key=uav_id,            # 分区键 = 无人机ID
    value=json.dumps(payload),
    callback=delivery_callback
)
```

**消费者组隔离**：Kafka 的核心规则是——**同一个消费者组内，一个分区只会被分配给一个消费者实例**。UCS 为每个微服务配置了独立的 `groupId`：

| 微服务 | groupId | 消费的 Topic | 配置文件 |
|--------|---------|-------------|---------|
| ucs-telemetry-ingest | `ucs-ingest` | `telemetry.raw` | `KafkaTopicConstants.GROUP_INGEST` |
| ucs-business | `ucs-business-telemetry` | `telemetry.processed` | `TelemetryKafkaConsumer.java:57` |
| ucs-telemetry-store | `ucs-store` | `telemetry.processed` | `KafkaTopicConstants.GROUP_STORE` |
| ucs-realtime-push | `ucs-push` | `telemetry.processed` | `KafkaTopicConstants.GROUP_PUSH` |

由于 `groupId` 不同，不同微服务可以各自消费同一个 Topic 的全量数据（广播语义）；而同一微服务的多个实例共享同一个 `groupId`，Kafka 会自动把分区均匀分配给这些实例（负载均衡语义），**保证一个分区在同一时刻只被一个实例消费**。

**关键配置**（`ucs-business/src/main/resources/application.yml`）：

```yaml
spring:
  kafka:
    consumer:
      group-id: ucs-business           # 消费者组ID
      auto-offset-reset: earliest      # 新消费者组从最早消息开始
      max-poll-records: 1              # 每次poll拉取1条，适配实时推送场景
      fetch-min-size: 1                # 最小拉取字节数=1，不等待积攒
      fetch-max-wait: 100              # 最大等待100ms就返回
      properties:
        session.timeout.ms: 45000      # 消费者会话超时45s
        heartbeat.interval.ms: 15000   # 心跳间隔15s（< session.timeout/3）
        max.poll.interval.ms: 600000   # 最大处理间隔600s
```

**为什么 `max-poll-records=1` 而不是批量？** 因为 `ucs-business` 的职责是**实时 WebSocket 推送**，每收到一条遥测就立即广播到前端分区 Topic。追求最低延迟，不做批量聚合。而 `ucs-telemetry-store` 使用 `batch=true`（`TelemetryBatchConsumer.java:34`），批量拉取后用 JDBC batchUpdate 一次写入数据库，追求吞吐量。

### 深挖追问

#### 追问 1：如果消费者实例数超过分区数会怎样？

当消费者实例数 > 分区数时，多出的消费者实例将处于**空闲状态**（idle），不会被分配到任何分区。UCS 的 Kafka 配置了 **16 个分区**（`docker-compose-cdc.yml` 和部署文档中 `kafka` 配置），这意味着同一消费者组最多 16 个实例可以并行消费。

如果部署了 20 个 `ucs-business` 实例，则有 4 个实例完全空闲。这不是错误，只是资源浪费。解决方式：
- **方案 A**：增加分区数（但分区数不宜过大，会增加 Kafka Controller 的元数据压力）
- **方案 B**：保持消费者实例数 ≤ 分区数
- **方案 C**：使用 `concurrency` 参数。例如 `TelemetryBatchConsumer` 配置了 `concurrency = "4"`，表示一个 JVM 内部启动 4 个消费者线程，共享同一个 `groupId`，Kafka 会把不同分区分配给不同线程

#### 追问 2：Consumer Rebalance 期间，同一架无人机的消息会不会丢失或重复消费？

Rebalance 是 Kafka 在消费者组成员变化（加入/退出/崩溃）时重新分配分区的过程。在 Rebalance 期间：
- **消息不会丢失**：因为 Kafka 的消息存储在 Broker 磁盘上，offset 也持久化在 `__consumer_offsets` Topic 中。Rebalance 完成后，新的消费者从上次提交的 offset 继续消费。
- **可能重复消费**：如果消费者处理了一条消息但还没来得及提交 offset 就被 Rebalance 了，新的消费者会从上次提交的 offset 重新消费这条消息。UCS 中遥测数据天然幂等（后到的数据覆盖前面的），所以重复消费不影响正确性。对于控制指令，通过 Epoch 机制（Q2）防止过期命令被执行。

UCS 的配置已经做了优化以减少 Rebalance 的频率：
- `session.timeout.ms=45000`：消费者有 45 秒的宽容时间，不会因为短暂的 GC 暂停就被踢出
- `heartbeat.interval.ms=15000`：每 15 秒发一次心跳，远小于 session timeout 的 1/3
- `max.poll.interval.ms=600000`：允许 10 分钟的处理时间，避免慢处理触发 Rebalance

---

## Q2 — Epoch 机制与防重放

### 场景总览

Epoch（时代戳）是 UCS 系统中用于**消息防重放和防乱序**的时间戳机制。它的核心思想是：每条遥测消息和控制指令都携带一个递增的 epoch 值，接收方通过比较 epoch 来判断消息是否过期。使用场景包括：

1. **遥测数据校验**：`ucs-telemetry-ingest` 消费 `telemetry.raw` 时，校验 epoch 是否大于等于当前值，丢弃过期数据
2. **控制指令下发**：`CommandKafkaProducer` 在发送指令时附带当前 epoch，网关端校验防止旧命令被执行
3. **Epoch 定期归一化**：当 epoch 超过 10,000 时触发 soft normalization，避免数值无限增长

### 经典场景：遥测数据 Epoch 校验

**数据链路**：DDS/Mavlink 网关 → Kafka `telemetry.raw` → `TelemetryRawConsumer`（**Epoch 校验在这里**） → Kafka `telemetry.processed` → 下游消费

核心代码在 `EpochValidationService.java`（`ucs-common` 模块）：

```java
// EpochValidationService.java:41-66
public boolean validate(String uavId, long msgEpoch) {
    try {
        String epochKey = RedisKeyConstants.epochKey(uavId);      // "epoch:{uavId}"
        String lastUpdateKey = RedisKeyConstants.epochLastUpdateKey(uavId); // "epoch:{uavId}:lastUpdate"

        String currentStr = redisTemplate.opsForValue().get(epochKey);
        long current = (currentStr != null) ? Long.parseLong(currentStr) : 0L;

        if (msgEpoch < current) {
            // 消息的epoch比当前记录的小 → 过期消息，直接丢弃
            log.warn("[Epoch] Stale message discarded: uavId={}, msgEpoch={}, currentEpoch={}",
                    uavId, msgEpoch, current);
            return false;
        }
        if (msgEpoch > current) {
            // 消息epoch更大 → 更新Redis中的epoch，TTL=24小时
            redisTemplate.opsForValue().set(epochKey, String.valueOf(msgEpoch),
                    TTL_HOURS, TimeUnit.HOURS);   // TTL_HOURS = 24
        } else {
            // epoch相等 → 只刷新TTL，不更新值
            redisTemplate.expire(epochKey, TTL_HOURS, TimeUnit.HOURS);
        }
        // 记录最后更新时间
        redisTemplate.opsForValue().set(lastUpdateKey,
                String.valueOf(System.currentTimeMillis()), TTL_HOURS, TimeUnit.HOURS);
        return true;
    } catch (Exception e) {
        // Redis不可用时，放行消息（可用性优先）
        log.debug("[Epoch] Redis unavailable for validate({}, {}), allowing message", uavId, msgEpoch);
        return true;
    }
}
```

**关键配置与参数**：
- **Redis Key 格式**：`epoch:{uavId}`，值为当前最大 epoch（Long 型）
- **TTL**：24 小时。无人机离线超过 24 小时后 epoch 自动清零，下次上线重新计数
- **容错策略**：Redis 不可用时 `return true`（放行），遵循"可用性优先于一致性"原则，因为短暂的重复数据比丢失数据危害更小
- **lastUpdate Key**：`epoch:{uavId}:lastUpdate`，记录最后一次 epoch 更新的时间戳，用于归一化判断

**在 `TelemetryRawConsumer` 中的调用**（`TelemetryRawConsumer.java:58-66`）：

```java
// 1. Epoch validation — discard stale messages
try {
    if (!epochService.validate(uavId, msg.getEpoch())) {
        return;  // 直接丢弃过期消息，不转发到 telemetry.processed
    }
} catch (Exception e) {
    log.warn("[Ingest] Epoch validation error for {}: {}", uavId, e.getMessage());
    // Continue — don't block forward on epoch errors
}
```

**控制指令中的 Epoch**（`CommandKafkaProducer.java:54`）：

```java
payload.put("epoch", epochValidationService.getCurrentEpoch(uavId));
```

每次下发命令时，将当前 epoch 打入指令消息。网关端收到后对比自己缓存的 epoch，如果命令的 epoch < 当前 epoch，说明这是一条过期命令（可能是网络延迟导致的重复），直接忽略。

### 深挖追问

#### 追问 1：Epoch 数值会不会无限增长？如果无人机频繁断线重连，epoch 会快速上升吗？

不会无限增长。`EpochValidationService` 内置了 **Soft Normalization（软归一化）** 机制（`EpochValidationService.java:88-108`）：

```java
// 定时任务：每60秒执行一次
@Scheduled(fixedRate = 60000)
@SchedulerLock(name = "epochNormalization", lockAtLeastFor = "30s", lockAtMostFor = "60s")
public void normalizeEpochs() {
    // 扫描所有 epoch key，如果 epoch > SOFT_LIMIT(10000)
    // 且 lastUpdate > 1小时前，则将 epoch 重置为 1
}
```

- **Soft Limit**：10,000。当某架无人机的 epoch 超过 10,000 且超过 1 小时没有新数据时，epoch 被重置为 1
- **断线重连不会快速上升**：epoch 是消息自身携带的时间戳，通常由网关基于系统时间生成。断线重连时，新消息的 epoch 仍然基于当前时间，只要时间正常就不会跳变。如果 NTP 同步出了问题导致时间大幅前移，epoch 才会跳变——但这属于基础设施故障，不是应用层应该解决的问题
- **24 小时 TTL 自动清理**：无人机完全离线 24 小时后，Redis 中的 epoch key 过期删除，下次上线从 0 开始

#### 追问 2：为什么 Epoch 校验放在 `ucs-telemetry-ingest` 而不是每个下游服务自己校验？

这是一个**关注点分离（Separation of Concerns）** 的设计选择。`ucs-telemetry-ingest` 是遥测数据链路的唯一入口：

```
telemetry.raw → [ucs-telemetry-ingest: Epoch校验 + Redis状态更新 + GeoHash更新]
                       ↓
              telemetry.processed → ucs-business (WebSocket推送)
                                 → ucs-telemetry-store (持久化)
                                 → ucs-realtime-push (全量推送)
```

如果每个下游服务都做 Epoch 校验，会有以下问题：
1. **重复查询 Redis**：3 个下游服务各查一次 epoch key，Redis QPS × 3
2. **一致性风险**：如果 `ucs-business` 校验通过但 `ucs-telemetry-store` 校验不通过（由于 Redis 竞态），同一条消息的处理结果不一致
3. **职责不清**：谁来更新 epoch？如果都更新，存在并发写入问题

在 Ingest 层统一校验后，`telemetry.processed` 中的每条消息都是"已校验、可信赖"的，下游服务可以安全地直接处理，无需重复校验。

---

## Q3 — 线程池配置与场景选型

### 场景总览

UCS 系统中使用自定义线程池的场景包括：

1. **遥测数据处理**（CPU 密集型）：`telemetryProcessorPool` — 用于遥测数据的解析、校验、聚合等计算密集操作
2. **WebSocket 推送**（IO 密集型）：`websocketPushPool` — 用于将数据推送到 WebSocket 连接，涉及网络 IO
3. **指令处理**（高可用型）：`commandProcessorPool` — 用于控制指令的处理和下发，追求可靠性

### 经典场景：遥测处理池 vs WebSocket 推送池

代码位于 `ucs-business/src/main/java/com/ucs/business/config/ThreadPoolConfig.java`：

```java
// ThreadPoolConfig.java:33-61

@Bean(name = "telemetryProcessorPool")
public ThreadPoolExecutor telemetryProcessorPool() {
    ThreadPoolExecutor executor = new ThreadPoolExecutor(
            8,                  // corePoolSize: 核心线程数，匹配典型CPU核数
            32,                 // maximumPoolSize: 最大线程数，突发容量
            60L, TimeUnit.SECONDS,  // keepAliveTime: 空闲线程存活60秒
            new LinkedBlockingQueue<>(1024),  // 任务队列容量1024
            namedThreadFactory("telemetry-processor"),  // 命名线程工厂（方便日志排查）
            new ThreadPoolExecutor.DiscardOldestPolicy()  // 拒绝策略：丢弃队列中最旧的任务
    );
    executor.allowCoreThreadTimeOut(true);  // 允许核心线程超时回收
    return executor;
}

@Bean(name = "websocketPushPool")
public ThreadPoolExecutor websocketPushPool() {
    ThreadPoolExecutor executor = new ThreadPoolExecutor(
            4,                  // corePoolSize: IO密集型，不需要太多线程
            16,                 // maximumPoolSize
            53L, TimeUnit.SECONDS,
            new LinkedBlockingQueue<>(512),
            namedThreadFactory("ws-push"),
            new ThreadPoolExecutor.CallerRunsPolicy()  // 拒绝策略：调用者线程自己执行
    );
    executor.allowCoreThreadTimeOut(true);
    return executor;
}
```

**参数选择依据**：

| 参数 | telemetryProcessorPool | websocketPushPool | 选择依据 |
|------|----------------------|-------------------|---------|
| core | 8 | 4 | 遥测处理是CPU密集型，需要更多计算线程；WS推送是IO等待型，4线程足够 |
| max | 32 | 16 | 突发时最多扩展到32/16线程，受限于单机CPU核心数和上下文切换开销 |
| queue | 1024 | 512 | 遥测数据量大（10Hz × N架无人机），需要更大缓冲；WS推送队列小一些，推送失败应尽快反压 |
| 拒绝策略 | DiscardOldestPolicy | CallerRunsPolicy | 遥测数据"丢旧留新"（旧数据已过时）；WS推送不能丢，反压到调用者线程 |
| keepAlive | 60s | 53s | 不使用相同值以错开回收时间，避免同时回收造成线程抖动 |

**为什么使用 `DiscardOldestPolicy` 而不是 `AbortPolicy`？** 遥测数据有实时性要求——队列满时，队首的数据已经是最旧的，新数据比旧数据更有价值。丢弃旧数据优于拒绝新数据。如果使用 `AbortPolicy` 抛异常，会导致上游 Kafka 消费线程异常中断。

**为什么使用 `CallerRunsPolicy`？** WebSocket 推送不能丢失——如果推送队列满了，让调用者线程（Kafka 消费线程）自己执行推送任务，起到**背压（backpressure）** 的效果：Kafka 消费变慢 → 拉取速度下降 → 给系统减压。

**命令服务的线程池**（`ucs-command/src/main/java/com/ucs/command/config/ThreadPoolConfig.java`）：

```java
@Bean(name = "commandProcessorPool")
public ThreadPoolExecutor commandProcessorPool() {
    return new ThreadPoolExecutor(
            4, 16, 60L, TimeUnit.SECONDS,
            new LinkedBlockingQueue<>(256),
            namedThreadFactory("cmd-processor"),
            new ThreadPoolExecutor.DiscardOldestPolicy()  // 指令也是丢旧留新
    );
}
```

命令处理池的核心线程数为 4（指令频率远低于遥测），队列仅 256（指令不应堆积，应快速处理或丢弃过期指令）。

### 深挖追问

#### 追问 1：发送命令是短时任务，是不是可以用虚拟线程？

可以，而且 UCS 已经在全局层面启用了虚拟线程。在 `application.yml` 中：

```yaml
spring:
  threads:
    virtual:
      enabled: true   # 启用虚拟线程（Java 21+ / Preview in Java 19-20）
```

这意味着 Spring Boot 的 Tomcat 请求处理线程已经是虚拟线程。当用户通过 REST API 发送控制指令时（`POST /api/v1/control/command`），请求处理本身就跑在虚拟线程上。

但 `commandProcessorPool` 仍然保留的原因是：
1. **异步解耦**：控制指令经过权限校验后，具体的 Kafka 发送和日志记录可以异步执行，不阻塞 HTTP 响应
2. **流量控制**：线程池的队列容量（256）起到了**限流**作用，防止短时间内大量指令打爆 Kafka
3. **拒绝策略**：虚拟线程没有拒绝策略的概念，而线程池的 `DiscardOldestPolicy` 可以在过载时丢弃过期指令

简言之：虚拟线程适合"请求处理"这种短时 IO 等待场景；自定义线程池适合需要**流量控制、拒绝策略、隔离性**的场景。两者互补，不冲突。

#### 追问 2：`allowCoreThreadTimeOut(true)` 有什么具体效果？

默认情况下，线程池的核心线程**永远不会被回收**——即使系统空闲，核心线程也会一直存活，占用操作系统资源。`allowCoreThreadTimeOut(true)` 改变了这个行为：

- **设置后**：核心线程在空闲超过 `keepAliveTime`（60 秒）后也会被回收
- **效果**：系统空闲时（如夜间无人机全部降落），线程池会自动缩减到 0 线程，释放约 1MB/线程 的栈内存
- **代价**：下次有任务到来时，需要重新创建线程，有约 1-2ms 的延迟

这在 UCS 场景中是合理的：无人机不飞行时不会产生遥测数据，线程池可以完全回收；飞行开始时 1-2ms 的线程创建延迟相对于遥测的 100ms 推送间隔可以忽略。

---

## Q4 — 虚拟线程的适用场景

### 场景总览

Java 21 引入的虚拟线程（Virtual Threads，Project Loom）在 UCS 中主要用于以下场景：

1. **HTTP 请求处理**：Spring Boot Tomcat 的请求线程改为虚拟线程，提升 IO 密集型接口的并发能力
2. **数据库查询**：JPA/JDBC 操作天然是 IO 阻塞的，虚拟线程在等待数据库响应时不占用平台线程
3. **Redis 操作**：缓存读写同理，虚拟线程在等待 Redis 响应时挂起，平台线程可以去执行其他虚拟线程

### 经典场景：Tomcat 请求处理

`application.yml` 中的关键配置：

```yaml
# ucs-business/src/main/resources/application.yml
spring:
  threads:
    virtual:
      enabled: ${VIRTUAL_THREADS_ENABLED:true}  # 默认true
```

**启用前**：Tomcat 默认使用 200 个平台线程处理请求。每个平台线程占用约 1MB 栈内存，200 个线程 = 200MB。如果有 201 个并发请求，第 201 个必须等待。

**启用后**：每个 HTTP 请求运行在一个虚拟线程上。虚拟线程的栈内存极小（~几 KB），操作系统不感知其存在。一个 JVM 可以轻松创建几十万个虚拟线程。当虚拟线程执行到 IO 操作（如数据库查询、Redis 调用、HTTP 外部调用）时，它会被**挂起（park）**，底层的**载体线程（carrier thread）** 被释放去执行其他虚拟线程。

**什么场景不适合虚拟线程？**
- **CPU 密集型计算**：虚拟线程优势在于 IO 等待期间释放载体线程。如果任务全是 CPU 计算没有 IO 操作，虚拟线程和平台线程性能相同
- **使用了 `synchronized` 的代码**：`synchronized` 块会 **pin（钉住）** 载体线程，使其无法被其他虚拟线程复用。UCS 中使用 `ReentrantLock` 替代 `synchronized` 来避免这个问题
- **需要线程池功能（流量控制/拒绝策略）的场景**：如 Q3 中解释的，遥测处理和 WebSocket 推送仍使用自定义线程池

### 深挖追问

#### 追问 1：虚拟线程和自定义线程池如何共存？会不会冲突？

不会冲突，它们工作在不同层面：

```
HTTP 请求到达
    ↓
[虚拟线程] 处理 Spring MVC Controller 逻辑（鉴权、参数校验、权限检查）
    ↓
提交异步任务到 telemetryProcessorPool / websocketPushPool
    ↓
[平台线程（线程池管理的）] 执行CPU密集型遥测处理 / IO密集型WebSocket推送
```

虚拟线程负责"接活"——快速接收 HTTP 请求、做简单逻辑后把重活扔给专用线程池。线程池负责"干活"——有流量控制和拒绝策略保护。两者各司其职。

---

## Q5 — 遥测数据异步批量持久化

### 场景总览

无人机遥测数据的持久化有两种消费模式：
1. **实时消费 + 批量写入**：`ucs-telemetry-store` 服务从 `telemetry.processed` 批量拉取消息，使用 JDBC `batchUpdate` 一次性写入 TimescaleDB
2. **实时消费 + 即时推送**：`ucs-business` 服务从 `telemetry.processed` 逐条消费，立即推送到 WebSocket

### 经典场景：TelemetryBatchConsumer 批量持久化

代码在 `ucs-telemetry-store/src/main/java/com/ucs/store/consumer/TelemetryBatchConsumer.java`：

```java
@KafkaListener(
        topics = KafkaTopicConstants.TELEMETRY_PROCESSED,  // "telemetry.processed"
        groupId = KafkaTopicConstants.GROUP_STORE,          // "ucs-store"
        batch = "true",          // 关键：启用批量消费模式
        concurrency = "4"        // 4个消费线程
)
public void consumeBatch(List<ConsumerRecord<String, String>> records) {
    if (records.isEmpty()) return;
    List<TelemetryMessage> batch = new ArrayList<>(records.size());
    for (ConsumerRecord<String, String> record : records) {
        TelemetryMessage msg = JsonUtil.parse(record.value(), TelemetryMessage.class);
        batch.add(msg);
    }
    if (!batch.isEmpty()) {
        int saved = telemetryRepository.batchInsert(batch);
    }
}
```

**JDBC batchUpdate 实现**（`TelemetryRepository.java:33-60`）：

```java
private static final String INSERT_SQL =
    "INSERT INTO telemetry_data (time, uav_id, latitude, longitude, altitude, " +
    "speed, heading, battery, status, epoch) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

public int batchInsert(List<TelemetryMessage> records) {
    int[][] results = jdbcTemplate.batchUpdate(INSERT_SQL, records, 500,
            (PreparedStatement ps, TelemetryMessage msg) -> {
                ps.setTimestamp(1, new Timestamp(msg.getTimestamp()));
                ps.setString(2, msg.getUavId());
                ps.setDouble(3, msg.getLat());
                // ... 其余字段
            });
    // 统计成功插入的行数
}
```

**关键配置说明**：
- `batch = "true"`：让 Kafka Listener 批量拉取消息，方法签名接收 `List<ConsumerRecord>` 而不是单条
- `concurrency = "4"`：4 个消费线程并行消费不同分区
- `batchUpdate(..., 500)`：JDBC 每 500 条 SQL 为一批发送到 PostgreSQL，减少网络往返次数
- 目标吞吐量：**>50,000 rows/s**（注释中标注）

**异步还是同步？** 整个链路是"相对异步"的：
1. 数据采集（DDS 网关） → Kafka 生产 ← **异步**（fire-and-forget + 回调）
2. Kafka 消费 → 批量聚合 ← **Kafka 的 poll 机制本身就是拉取模型**
3. 批量写入 TimescaleDB ← **同步阻塞**（等待数据库返回），但在虚拟线程上，阻塞不影响整体并发

### 深挖追问

#### 追问 1：批量写入失败了怎么办？数据会丢失吗？

不会丢失。Kafka 的 offset 提交策略保证了这一点：

1. Spring Kafka 默认使用 **`AckMode.BATCH`**：一批消息全部处理完后才提交 offset
2. 如果 `batchInsert` 抛异常，`consumeBatch` 方法也会抛异常，Spring Kafka 不会提交这批消息的 offset
3. 下次 poll 时，这批消息会被重新拉取并重新处理

TimescaleDB 的 hypertable 对于重复写入（相同 `time + uav_id`）不会产生唯一约束冲突（`telemetry_data` 表没有唯一约束），因此重复写入只会多占一点存储，不影响查询正确性（查询时通常按 `time DESC` 取最新的）。

#### 追问 2：为什么选择 JDBC batchUpdate 而不是 JPA saveAll？

性能差异巨大：

| 方式 | 写入 10,000 条 | 原因 |
|------|--------------|------|
| JPA saveAll | ~8-12 秒 | 每条数据都经过实体管理器的脏检查、一级缓存、生成动态SQL |
| JDBC batchUpdate | ~0.2-0.5 秒 | 预编译SQL + 批量参数绑定 + 直接发送到数据库 |

`ucs-telemetry-store` 的写入场景特点是：
1. 数据量大（10Hz × 500 架无人机 = 5000 条/秒）
2. 纯写入，不需要读取和修改
3. 不需要 JPA 的对象关系映射（ORM）能力

因此直接使用 `JdbcTemplate.batchUpdate` 绕过 JPA 的所有开销，获得接近原生 JDBC 的性能。

---

## Q6 — WebSocket 分区推送与订阅机制

### 场景总览

UCS 的 WebSocket 推送有三个层级：
1. **全量推送**：`/topic/telemetry` — 所有无人机的遥测数据（由 `ucs-realtime-push` 服务负责）
2. **分区推送**：`/topic/telemetry/partition/{partitionName}` — 按角色/团队隔离（由 `ucs-business` 和 `ucs-realtime-push` 服务负责）
3. **单机推送**：`/topic/drone/{uavId}` — 单架无人机详情（由 `ucs-realtime-push` 服务负责）

### 经典场景：分区推送隔离

**前端连接流程**：
1. 用户登录获取 JWT Token
2. 前端通过 STOMP over WebSocket 连接 `/ws` 端点
3. 前端订阅 `/topic/telemetry/partition/{partitionName}`，其中 `partitionName` 由用户的角色决定（如 `commander`、`observer`、`user_3`）

**后端推送流程**（`WebSocketGatewayService.java:44-61`）：

```java
public void broadcastToPartitions(Map<String, List<Map<String, Object>>> partitionData, 
                                   Instant timestamp) {
    for (Map.Entry<String, List<Map<String, Object>>> entry : partitionData.entrySet()) {
        String partitionName = entry.getKey();
        List<Map<String, Object>> rawDrones = entry.getValue();
        
        String topic = "/topic/telemetry/partition/" + partitionName;
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("partition", partitionName);
        message.put("timestamp", timestamp.toString());
        message.put("drones", drones);
        messagingTemplate.convertAndSend(topic, message);  // STOMP推送
    }
}
```

**分区路由过程**：每条遥测消息到达后，`TelemetryKafkaConsumer` 调用 `PartitionRoutingService.getPartitionsForDrone(uavId)` 查询该无人机属于哪些分区，然后把数据推送到对应的分区 Topic。

**是否每次都查 Redis？** 是的，但有三级缓存优化（详见 Q8）：
1. **L1 Caffeine 本地缓存**：命中率 >90%，延迟 <1μs
2. **L2 Redis**：未命中 L1 时查询，延迟 ~1ms
3. **L3 数据库**：仅在 Redis 也未命中时查询

**如何确定 WebSocket 连接订阅的分区？** 是前端主动订阅的：

```javascript
// 前端代码示例
stompClient.subscribe('/topic/telemetry/partition/commander', function(message) {
    // 只收到 commander 分区的数据
});
```

安全性由 Spring Security 保障——JWT Token 中包含用户角色（`roles` claim），后端可以通过 `@PreAuthorize` 或自定义 Channel Interceptor 验证用户是否有权订阅某个分区 Topic。

### 深挖追问

#### 追问 1：如果同一架无人机属于多个分区，数据会被推送多次吗？

是的，设计上就是这样的。一架无人机默认属于 `observer` 和 `commander` 两个分区（`PartitionRoutingService.java:196-198`）：

```java
Set<String> defaultPartitions = new LinkedHashSet<>();
defaultPartitions.add("observer");
defaultPartitions.add("commander");
```

这意味着 `commander` 和 `observer` 分区的订阅者都能看到这架无人机。这是**安全隔离 + 数据可见性**的设计：指挥官能看到所有无人机，观察员也能看到所有无人机，但飞行员只能看到自己控制的无人机（通过权限转移后的分区映射）。

推送的"多次"仅是网络层面的——同一份遥测数据被序列化两次发送到不同 Topic。这不影响性能，因为序列化开销极小（JSON + 几百字节），且 STOMP 层只给实际订阅了该 Topic 的连接发送。

---

## Q7 — Redis 数据类型与使用场景

### 场景总览

UCS 项目中 Redis 承担了多种角色，使用了以下数据类型：

| 数据类型 | 使用场景 | Redis Key 格式 | 示例值 |
|---------|---------|---------------|-------|
| **String** | Epoch 存储、在线状态、分布式锁、JWT 黑名单 | `epoch:{uavId}`, `drone:{uavId}:online`, `lock:drone:{uavId}`, `token:blacklist:{jti}` | `"1234"`, `"true"`, `"uuid"`, `"1"` |
| **Set** | 分区映射（无人机↔分区）、GeoHash 反向索引 | `drone:{uavId}:partitions`, `partition:{name}:drones`, `geohash:{hash}` | `{"observer","commander"}`, `{"px4_1","px4_2"}` |
| **Hash** | 无人机实时状态 | `drone:{uavId}:state` | `{lat:"39.9", lon:"116.4", alt:"100", ...}` |
| **ZSet** | 心跳时间戳排序 | `drone:heartbeat` | member=`px4_1`, score=`1713578400000` |
| **GEO** | 空间位置索引（底层是 ZSet） | `drone:positions` | `GEOADD drone:positions 116.4 39.9 px4_1` |
| **PubSub** | 跨实例缓存失效通知 | channel: `cache:invalidate` | `"partition-map:drone:px4_1:partitions"` |

### 经典场景：ZSet 实现心跳超时检测

`RedisService.java:55-75`：

```java
// 更新心跳：ZSet ZADD，score=当前时间戳
public void updateDroneHeartbeat(String uavId) {
    double nowMs = System.currentTimeMillis();
    stringRedisTemplate.opsForZSet().add("drone:heartbeat", uavId, nowMs);
}

// 获取超时的无人机：score < (now - 3000ms) 的成员
public Set<String> getTimedOutDrones(long timeoutMs) {
    double cutoff = System.currentTimeMillis() - timeoutMs;
    return stringRedisTemplate.opsForZSet().rangeByScore("drone:heartbeat", 0, cutoff);
}

// 移除离线无人机
public void removeDroneHeartbeat(String uavId) {
    stringRedisTemplate.opsForZSet().remove("drone:heartbeat", uavId);
}
```

**为什么用 ZSet 而不是单独给每架无人机设一个 TTL Key？**
- ZSet 可以一次 `ZRANGEBYSCORE` 查出所有超时无人机，O(log(N) + M) 复杂度
- 如果用 TTL Key，需要 SCAN 所有 `drone:*:heartbeat` Key，O(N) 且 SCAN 不保证实时性
- ZSet 天然支持按时间排序，方便做"最久未心跳的无人机"这类查询

### 深挖追问

#### 追问 1：GEO 类型底层就是 ZSet，为什么不直接用 ZSet？

Redis GEO 命令（`GEOADD`、`GEODIST`、`GEORADIUS`、`GEOSEARCH`）内部确实基于 ZSet 实现——经纬度被编码为 52 位整数作为 score。但 GEO 命令提供了更高层的抽象：

1. **`GEORADIUS`**：给定圆心和半径，返回范围内所有成员——这用 ZSet 的 `ZRANGEBYSCORE` 无法直接实现，需要自己编码/解码 GeoHash
2. **`GEODIST`**：计算两个成员之间的距离——ZSet 没有这个能力
3. **`GEOSEARCH`**：更灵活的范围查询（圆形/矩形）

UCS 在 `GeoSpatialService.java` 中同时使用了 GEO 命令（精确半径查询）和手动 GeoHash Set（视口矩形查询），因为 Redis GEO 对矩形查询的支持不如圆形查询高效。

---

## Q8 — 三级缓存与缓存同步机制

### 场景总览

UCS 实现了 L1（Caffeine 本地缓存） + L2（Redis） + L3（数据库） 的三级缓存架构。使用场景：

1. **无人机分区映射查询**：每条遥测消息都要查"这架无人机属于哪个分区"，频率极高
2. **无人机状态查询**：前端定时请求无人机详情
3. **配置数据查询**：系统参数、角色权限等较少变动的数据

### 经典场景：分区映射查询的三级缓存

核心代码在 `MultiLevelCacheService.java`：

```java
// MultiLevelCacheService.java:95-116
public String get(String region, String key, Supplier<String> dbLoader) {
    // L1: Caffeine 本地缓存
    Cache<String, String> l1 = getOrCreateL1(region);
    String value = l1.getIfPresent(key);
    if (value != null) {
        log.debug("[Cache] L1 HIT region={} key={}", region, key);
        return value;
    }

    // L2: Redis（带逻辑过期检查）
    value = redisTemplate.opsForValue().get(key);
    if (value != null) {
        l1.put(key, value);  // 回填L1
        
        // T-24: 逻辑过期检查 — 在物理过期前异步刷新
        if (isLogicallyExpired(key)) {
            asyncRefresh(region, key, dbLoader);  // 异步刷新，不阻塞当前请求
        }
        return value;
    }

    // L3: 数据库
    value = dbLoader.get();
    if (value != null) {
        // 回填L1和L2
        l1.put(key, value);
        redisTemplate.opsForValue().set(key, value, computeTTL(region));
    }
    return value;
}
```

**各级缓存配置**：

| 层级 | 技术 | TTL | 特点 |
|------|-----|-----|------|
| L1 | Caffeine | 10 秒（最大 1000 条） | 进程内缓存，零网络开销，命中率 >90% |
| L2 | Redis | 5 分钟 ± 30 秒随机抖动 | 跨实例共享，逻辑过期 = 物理过期的 80% |
| L3 | PostgreSQL | 无限 | 持久化存储，单一数据源（Source of Truth） |

**TTL 随机抖动（jitter）**：`5分钟 ± 30秒` 的设计目的是**防止缓存雪崩**。如果所有 key 的 TTL 都是精确的 5 分钟，它们可能在同一时刻全部过期，导致大量请求同时穿透到数据库。加了 30 秒随机抖动后，过期时间分散在 4.5-5.5 分钟之间。

**逻辑过期与异步刷新（T-24）**：
- **物理过期**：Redis key 的实际 TTL，到期后 key 被删除
- **逻辑过期**：物理过期的 80%，到期后 key 仍然存在但标记为"需要刷新"
- **效果**：当 L2 命中但逻辑过期时，先返回旧值（不让用户等），然后异步从数据库加载最新值并更新 L2

**用户修改分区后的同步流程**（`PartitionRoutingService.java:230-268`）：

```
1. @Transactional — 写入数据库（deactivate旧分区 + create新分区）
         ↓
2. registerPostCommitRedisSync() — 注册事务提交后的回调
         ↓
3. 事务提交成功
         ↓
4. afterCommit() — 更新Redis分区映射（Set数据结构）
         ↓
5. CacheInvalidationListener — 通过Redis PubSub广播 "cache:invalidate"
         ↓
6. 所有实例的L1 Caffeine缓存清除该无人机的分区缓存
```

**跨实例 L1 失效**（`CacheInvalidationListener.java:33-48`）：

```java
@Override
public void onMessage(Message message, byte[] pattern) {
    String payload = new String(message.getBody());  // 格式: "region:key"
    int sep = payload.indexOf(':');
    String region = payload.substring(0, sep);
    String key = payload.substring(sep + 1);
    cacheService.invalidateL1(region, key);  // 仅清除L1，L2已被写入方更新
}
```

### 深挖追问

#### 追问 1：如果 Redis PubSub 消息丢失，L1 缓存会不会一直返回旧数据？

PubSub 消息确实可能丢失（Redis PubSub 是 fire-and-forget，没有持久化）。UCS 有两层兜底：

1. **L1 TTL = 10 秒**：即使 PubSub 丢失，L1 最多在 10 秒后自然过期，届时会查 L2（已经是新数据）
2. **定期对账任务**：`PartitionRoutingService` 每 60 秒执行一次 Redis ↔ DB 对账（`reconcileRedisWithDb`），修复任何漂移

所以最差情况下，数据不一致的窗口是 **10 秒**（L1 TTL），不是无限的。对于遥测数据显示场景，10 秒的延迟是完全可以接受的。

#### 追问 2：Mutex Lock 防止缓存击穿具体是怎么实现的？

当 L1 和 L2 都未命中时，需要查询数据库（L3）。如果 1000 个请求同时对同一个 key 的缓存 Miss，它们都会同时查数据库——这就是**缓存击穿**。

`MultiLevelCacheService` 使用了 **Mutex Lock（互斥锁）** 防止这个问题：只有第一个获得锁的线程去查数据库，其他线程等待或返回旧值。具体实现是 Redis `SETNX`（`SET key value NX EX timeout`）：

```
线程A: SETNX lock:cache:drone:px4_1 → 成功 → 查数据库 → 写缓存 → 释放锁
线程B: SETNX lock:cache:drone:px4_1 → 失败 → 等待50ms → 重试读缓存（此时A已写入）→ 命中
```

这样 1000 个并发请求中，只有 1 个会打到数据库，其余都会从缓存获取。

---

## Q9 — 大规模无人机前端压力与 GeoHash 视口裁剪

### 场景总览

当无人机数量达到几百甚至上千架时，前端面临两个压力：
1. **网络带宽**：每 100ms 推送全量无人机数据 → 几百 KB/次 → 几 MB/秒
2. **渲染压力**：地图上渲染上千个移动标记，浏览器 GPU 负担大

解决方案有三个层次：
1. **GeoHash 空间索引**：后端按地理位置分块索引无人机
2. **视口裁剪（Viewport Culling）**：只推送当前地图可视范围内的无人机
3. **分层聚合（LOD）**：缩小地图时，多架无人机聚合为一个标记

### 经典场景：视口裁剪

**前端发送视口边界**：前端在用户拖拽/缩放地图时，通过 STOMP 发送当前视口的经纬度范围：

```javascript
stompClient.publish({
    destination: '/app/viewport/update',
    body: JSON.stringify({
        minLat: 39.85, maxLat: 40.05,
        minLon: 116.25, maxLon: 116.55,
        zoomLevel: 14
    })
});
```

**后端处理**（`ViewportController.java:33-55`）：

```java
@MessageMapping("/viewport/update")
public void updateViewport(@Payload ViewportRequest viewport,
                            SimpMessageHeaderAccessor headerAccessor) {
    String sessionId = headerAccessor.getSessionId();
    viewportFilter.updateViewport(sessionId, viewport);  // 记录该连接的视口

    // 用GeoHash索引查询视口内的无人机
    Set<String> visibleDrones = geoService.getDronesInViewport(
            viewport.getMinLat(), viewport.getMaxLat(),
            viewport.getMinLon(), viewport.getMaxLon()
    );

    // 只推送可见无人机列表给这个客户端
    messagingTemplate.convertAndSend("/topic/viewport/" + sessionId, visibleDrones);
}
```

**GeoHash 原理**：把二维经纬度编码为一维字符串。例如 `GeoHashUtil.encode(39.9, 116.4, 6)` → `"wx4g0e"`。精度 6 对应约 1.2km × 0.6km 的网格。

**视口覆盖计算**（`GeoHashUtil.java:40-60`）：

```java
public static Set<String> coverBoundingBox(double minLat, double maxLat,
                                            double minLon, double maxLon, int precision) {
    Set<String> hashes = new HashSet<>();
    double latStep = 180.0 / Math.pow(8, (precision + 1) / 2);
    double lonStep = 360.0 / Math.pow(4, precision / 2);
    for (double lat = minLat; lat <= maxLat + latStep; lat += latStep * 0.5) {
        for (double lon = minLon; lon <= maxLon + lonStep; lon += lonStep * 0.5) {
            hashes.add(encode(clamp(lat), clamp(lon), precision));
        }
    }
    return hashes;
}
```

这个方法返回覆盖视口的所有 GeoHash 网格编码，然后通过 Redis Set 查询每个网格内的无人机 ID：

```java
// GeoSpatialService.java:63-78
public Set<String> getDronesInViewport(...) {
    Set<String> geoHashes = GeoHashUtil.coverBoundingBox(minLat, maxLat, minLon, maxLon);
    for (String hash : geoHashes) {
        Set<String> members = redisTemplate.opsForSet().members("geohash:" + hash);
        result.addAll(members);
    }
    return result;
}
```

### 深挖追问

#### 追问 1：GeoHash 精度为什么选择 6？如果无人机在网格边界怎么办？

精度 6 对应 ~1.2km × 0.6km 的网格。选择理由：
- 典型无人机作业区域半径 5-20km → 视口约覆盖 50-200 个网格 → 50-200 次 Redis Set 查询
- 精度太高（如 8，~38m × 19m）→ 网格太多，查询次数爆炸
- 精度太低（如 4，~40km × 20km）→ 过滤不精确，返回大量视口外的无人机

**边界问题**：`coverBoundingBox` 使用了半步长扫描（`lat += latStep * 0.5`），确保视口边界处的网格不会遗漏。即使无人机恰好在两个网格的边界上，至少会被一个覆盖网格捕获。

---

## Q10 — 分布式定时任务与 ShedLock

### 场景总览

UCS 中使用定时任务的场景包括：
1. **心跳超时检测**：每 1 秒检查是否有无人机心跳过期（`DroneHeartbeatService`）
2. **缓存对账**：每 60 秒对账 Redis 和数据库的分区映射（`PartitionRoutingService`）
3. **Epoch 归一化**：每 60 秒清理超限 epoch（`EpochValidationService`）
4. **网关健康监控**：定时检查 DDS 网关状态（`GatewayHealthMonitor`）
5. **数据保留策略**：定期清理过期遥测数据（`DataRetentionService`）

### 经典场景：心跳超时检测

`DroneHeartbeatService.java:43-66`：

```java
@Scheduled(fixedRate = 1000)  // 每1秒执行一次
@SchedulerLock(
    name = "checkHeartbeats",
    lockAtLeastFor = "500ms",   // 至少持有锁500ms
    lockAtMostFor = "5s"         // 最多持有锁5s（防止死锁）
)
public void checkHeartbeats() {
    Set<String> timedOut = redisService.getTimedOutDrones(TIMEOUT_MS); // TIMEOUT_MS=3000
    if (timedOut.isEmpty()) return;
    
    for (String uavId : timedOut) {
        redisService.setDroneOffline(uavId);
        redisService.removeDroneHeartbeat(uavId);
        telemetryKafkaConsumer.removeDroneFromSnapshot(uavId);
        notifyDroneOffline(uavId);
    }
}
```

**为什么用 ShedLock 而不是 Redisson 的分布式锁？**

| 特性 | ShedLock | Redisson 分布式锁 |
|------|----------|------------------|
| 使用方式 | `@SchedulerLock` 注解，零代码侵入 | 需要手动 `lock.tryLock()` / `unlock()` |
| 锁后端 | 支持 Redis/JDBC/MongoDB/DynamoDB 等 | 仅 Redis |
| 目的 | **防止定时任务被多实例重复执行** | 通用分布式互斥锁 |
| 锁粒度 | 任务级别 | 任意粒度 |
| 自动释放 | `lockAtMostFor` 自动过期 | 需要 watchdog 续期或手动释放 |

ShedLock 的设计目标就是**定时任务去重**——当你有 3 个 `ucs-business` 实例，每个都有 `@Scheduled(fixedRate=1000)` 的心跳检测任务时，ShedLock 确保每秒只有一个实例真正执行。

**`lockAtLeastFor` 和 `lockAtMostFor` 的作用**：
- `lockAtLeastFor = "500ms"`：即使任务在 100ms 内就执行完了，锁也要持有 500ms。这防止了"任务执行太快 → 锁释放 → 同一秒内另一个实例又执行了一次"
- `lockAtMostFor = "5s"`：如果持有锁的实例崩溃了（没来得及释放锁），5 秒后锁自动释放，其他实例可以接管。没有这个设置，锁可能永远不释放（死锁）

**ShedLock 配置**（`ShedLockConfig.java`）：

```java
@Configuration
@EnableSchedulerLock(defaultLockAtMostFor = "30s")
public class ShedLockConfig {
    @Bean
    public LockProvider lockProvider(StringRedisTemplate redisTemplate) {
        return new RedisLockProvider(redisTemplate.getConnectionFactory());
    }
}
```

### 深挖追问

#### 追问 1：定时对账任务如果数据量非常大（比如 10 万架无人机），怎么处理？

`PartitionRoutingService` 的对账任务（`reconcileRedisWithDb`，`@Scheduled(fixedRate=60000)`）会分批处理：

1. 从数据库分页查询活跃的分区映射记录（每页 1000 条）
2. 与 Redis 中的对应 key 对比
3. 对于不一致的记录，更新 Redis

关键点：
- ShedLock 的 `lockAtMostFor = "60s"` 确保对账不会跨到下一个周期
- 分页查询避免一次加载 10 万条数据 OOM
- 对账只做增量修复（检测不一致的才更新），不做全量覆写

---

## Q11 — TimescaleDB 选型与关键配置

### 场景总览

遥测数据是典型的**时序数据**（Time-Series Data）：每条记录都有一个时间戳，数据只追加不修改，查询模式以时间范围 + 无人机 ID 为主。

可选方案对比：

| 数据库 | 优势 | 劣势 |
|--------|------|------|
| PostgreSQL 原生 | 熟悉、生态好 | 大量时序数据查询慢、没有自动分区 |
| TimescaleDB | PostgreSQL 扩展、自动时间分区、内置压缩 | 需要额外安装扩展 |
| InfluxDB | 原生时序数据库 | 查询语言不同（InfluxQL/Flux）、运维体系独立 |
| ClickHouse | 极高分析性能 | 不擅长频繁小批量写入 |

### 经典场景：遥测数据存储

**TimescaleDB 初始化脚本**（`V1__timescaledb_init.sql`）：

```sql
-- 1. 启用扩展
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- 2. 创建遥测数据表
CREATE TABLE IF NOT EXISTS telemetry_data (
    time        TIMESTAMPTZ     NOT NULL,  -- 时间戳（分区键）
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

-- 3. 转换为 hypertable，chunk_interval = 1小时
SELECT create_hypertable('telemetry_data', 'time',
       chunk_time_interval => INTERVAL '1 hour',
       if_not_exists => TRUE);

-- 4. 复合索引：按 uav_id + time 查询
CREATE INDEX IF NOT EXISTS idx_telemetry_uav_time
    ON telemetry_data (uav_id, time DESC);

-- 5. 压缩策略：2小时以上的数据自动压缩
ALTER TABLE telemetry_data SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'uav_id',    -- 按无人机ID分段压缩
    timescaledb.compress_orderby = 'time DESC'      -- 按时间倒序压缩
);
SELECT add_compression_policy('telemetry_data', INTERVAL '2 hours');

-- 6. 保留策略：7天以上的原始数据自动删除
SELECT add_retention_policy('telemetry_data', INTERVAL '7 days');

-- 7. 连续聚合视图：1分钟粒度汇总
CREATE MATERIALIZED VIEW telemetry_1min WITH (timescaledb.continuous) AS
SELECT time_bucket('1 minute', time) AS bucket,
       uav_id,
       AVG(latitude) AS avg_lat, AVG(longitude) AS avg_lon,
       AVG(altitude) AS avg_alt, AVG(speed) AS avg_speed,
       MIN(battery) AS min_battery, MAX(battery) AS max_battery,
       COUNT(*) AS sample_count
FROM telemetry_data
GROUP BY bucket, uav_id WITH NO DATA;

-- 8. 聚合刷新策略：每分钟刷新
SELECT add_continuous_aggregate_policy('telemetry_1min',
    start_offset => INTERVAL '2 hours',
    end_offset   => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute');
```

**关键配置详解**：

1. **`chunk_time_interval = 1 hour`**：数据按小时自动分片。查询"最近 10 分钟的数据"只需扫描当前 chunk 而不是整张表。选 1 小时而不是 1 天，是因为遥测数据写入频率高（5000+ rows/s），1 小时约 1800 万行，适合单 chunk 的内存和索引大小。

2. **`compress_segmentby = 'uav_id'`**：压缩时按 `uav_id` 分段。这意味着同一架无人机的连续数据被压缩在一起，查询单机历史轨迹时只需解压相关段。压缩率通常 >10:1。

3. **`retention_policy = 7 days`**：原始数据只保留 7 天。超过 7 天的数据被自动 DROP chunk（直接删除文件，比 DELETE 快几个数量级）。1 分钟粒度的聚合视图（`telemetry_1min`）不受保留策略影响，可以长期保存。

### 深挖追问

#### 追问 1：为什么 chunk_interval 选 1 小时？选 1 天或 10 分钟有什么问题？

| chunk_interval | 优势 | 劣势 |
|---------------|------|------|
| 10 分钟 | 查询范围更精确 | chunk 数量太多，增加元数据管理开销 |
| 1 小时 | 查询和写入的平衡点 | — |
| 1 天 | chunk 数量少 | 单 chunk 太大（24h × 5000 rows/s = 4.3 亿行），索引膨胀 |

**经验法则**：单个 chunk 的大小应该适合内存。1 小时 × 5000 rows/s = 1800 万行 × ~100 bytes/row ≈ 1.7 GB 未压缩，压缩后 ~170 MB。这对于一台 16GB 内存的服务器是合适的。

#### 追问 2：连续聚合视图是实时更新的吗？对写入性能有影响吗？

不是实时的。连续聚合有一个 **刷新间隔**（`schedule_interval = 1 minute`）——后台 worker 每分钟运行一次，只增量处理上次刷新以来的新数据。

对写入性能的影响可以忽略：
1. 聚合是**后台异步执行的**，不在写入路径上
2. 增量刷新只处理新增 chunk，不重新计算历史数据
3. `end_offset = 1 minute` 意味着最近 1 分钟的数据不会被聚合（因为可能还有迟到数据），保证聚合结果的准确性

---

## Q12 — Kafka 消息积压预防

### 场景总览

消息积压（Consumer Lag）发生在消费者处理速度跟不上生产者发送速度时。UCS 中可能积压的场景：
1. 遥测数据量突增（更多无人机同时飞行）
2. 数据库写入变慢（如 TimescaleDB 正在执行压缩）
3. 下游服务重启期间消息堆积

### 经典场景：多层预防措施

**1. 批量消费提升吞吐**：`TelemetryBatchConsumer` 使用 `batch=true` + `concurrency=4`，一次 poll 拉取多条消息，批量写入数据库。

**2. 消费者并行度**：每个服务的 `@KafkaListener` 都配置了 `concurrency` 参数：

| 服务 | concurrency | 说明 |
|------|------------|------|
| ucs-telemetry-ingest | 4 | 4 个线程并行消费 `telemetry.raw` 的不同分区 |
| ucs-business | 4 | 4 个线程并行消费 `telemetry.processed` |
| ucs-telemetry-store | 4 | 4 个线程批量写入 TimescaleDB |
| ucs-realtime-push | 4 | 4 个线程并行推送 WebSocket |

**3. 消费者配置优化**（`application.yml`）：

```yaml
spring:
  kafka:
    consumer:
      fetch-min-size: 1          # 不等待积攒，有数据就返回
      fetch-max-wait: 100        # 最多等100ms
      max-poll-records: 1        # (business) 逐条消费，最低延迟
      # (store) 使用 batch=true，一次拉取一批
```

**4. 线程池的 DiscardOldestPolicy**：当处理线程池满了时，丢弃最旧的遥测数据，保证新数据能够进入。这是"宁丢旧数据，不丢新数据"的策略。

**5. 多实例水平扩展**：Kafka 有 16 个分区，支持最多 16 个消费者实例并行消费。如果积压持续，可以增加实例数（直到等于分区数）。

### 深挖追问

#### 追问 1：如何监控 Consumer Lag？积压到什么程度需要报警？

UCS 通过 Actuator + Prometheus + Grafana 监控 Kafka Consumer Lag：

```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
```

Spring Kafka 自动暴露 `kafka.consumer.fetch.manager.records.lag` 指标。在 K8s 部署中，HPA 可以根据 Kafka lag 自动扩缩消费者实例数：

```yaml
# K8s HPA 示例
metrics:
  - type: External
    external:
      metric: {name: kafka_consumergroup_lag}
      target: {type: AverageValue, averageValue: "5000"}
```

当 lag > 5000 条时触发扩容。报警阈值建议设为 10000 条（约 2 秒的遥测数据）。

---

## Q13 — Debezium 监听 WAL 实现双写一致性

### 场景总览

**双写一致性问题**：当同一份数据既要写入数据库又要写入 Redis 缓存时，如何保证两者的一致性？常见方案包括：

1. **先写数据库再删缓存**（Cache-Aside）：简单但有短暂不一致窗口
2. **延迟双删**（Delayed Double Delete）：写 DB → 删缓存 → 延迟 X ms → 再删缓存。依赖延迟窗口的调优
3. **Transactional Outbox + Post-Commit Hook**：数据库事务提交后再更新缓存（UCS 的实际实现方式）
4. **Debezium 监听 WAL**：通过 CDC 监听数据库变更日志，自动触发缓存失效（UCS 的 CDC 增强方案）

UCS 系统同时使用了**方案 3 和方案 4**，形成双保险：
- **主路径**：Transactional Outbox + Post-Commit Hook（代码级同步，延迟 <100ms）
- **兜底路径**：Debezium CDC 监听 PostgreSQL WAL（基础设施级同步，延迟 ~1-10s）

### 经典场景：Debezium 监听 WAL

**Debezium 部署配置**（`docker-compose-cdc.yml`）：

```yaml
# T-26: CDC (Change Data Capture) — Debezium
debezium-connect:
  image: debezium/connect:2.5         # Debezium Connect 版本2.5
  environment:
    GROUP_ID: ucs-cdc-connect          # Connect集群组ID
    BOOTSTRAP_SERVERS: kafka-1:29092,kafka-2:29092,kafka-3:29092  # Kafka集群
    CONFIG_STORAGE_TOPIC: _cdc_configs            # 连接器配置存储
    OFFSET_STORAGE_TOPIC: _cdc_offsets            # 消费位点存储
    STATUS_STORAGE_TOPIC: _cdc_status             # 状态存储
    CONFIG_STORAGE_REPLICATION_FACTOR: 3          # 三副本
    OFFSET_STORAGE_REPLICATION_FACTOR: 3
    STATUS_STORAGE_REPLICATION_FACTOR: 3
    CONNECT_KEY_CONVERTER: org.apache.kafka.connect.json.JsonConverter
    CONNECT_VALUE_CONVERTER: org.apache.kafka.connect.json.JsonConverter
    CONNECT_KEY_CONVERTER_SCHEMAS_ENABLE: "false"  # 不包含Schema（轻量）
    CONNECT_VALUE_CONVERTER_SCHEMAS_ENABLE: "false"
```

**PostgreSQL Source Connector 注册**：

```json
{
  "name": "ucs-postgres-connector",
  "config": {
    "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
    "database.hostname": "postgres",
    "database.port": "5432",
    "database.user": "ucs",
    "database.password": "ucs_password",
    "database.dbname": "ucs",
    "database.server.name": "ucs",
    "plugin.name": "pgoutput",                           // PostgreSQL逻辑复制插件
    "topic.prefix": "cdc",                                // Kafka Topic前缀
    "table.include.list": "public.drone_partition_map,public.drones",  // 监听的表
    "slot.name": "ucs_cdc_slot",                          // 复制槽名称
    "publication.name": "ucs_cdc_pub",                    // PostgreSQL Publication
    "heartbeat.interval.ms": "10000",                     // 心跳间隔10秒
    "snapshot.mode": "initial",                           // 首次启动做全量快照
    "tombstones.on.delete": "false"                       // 删除事件不发送墓碑消息
  }
}
```

**关键参数详解**：

| 参数 | 值 | 含义 |
|------|----|----- |
| `plugin.name` | `pgoutput` | PostgreSQL 14+ 内置的逻辑解码插件，无需额外安装 |
| `table.include.list` | `public.drone_partition_map,public.drones` | 只监听这两张表的变更，减少不必要的 CDC 流量 |
| `slot.name` | `ucs_cdc_slot` | PostgreSQL 复制槽，保存 CDC 消费位点。即使 Debezium 临时下线，WAL 不会被清理 |
| `snapshot.mode` | `initial` | 首次启动时做一次全表快照（INSERT 事件发到 Kafka），之后只增量捕获 |
| `heartbeat.interval.ms` | `10000` | 每 10 秒发送一次心跳消息，确保复制槽的 LSN 前进，防止 WAL 堆积 |
| `tombstones.on.delete` | `false` | DELETE 操作发送正常的删除事件，不额外发送 null 值墓碑消息 |
| `topic.prefix` | `cdc` | 变更事件发到 `cdc.public.drone_partition_map` 和 `cdc.public.drones` Topic |

**CDC 数据流**：

```
PostgreSQL (drone_partition_map表发生UPDATE)
    ↓ WAL 日志
PostgreSQL pgoutput 逻辑解码
    ↓ 
Debezium Connect 捕获变更事件
    ↓
Kafka Topic: cdc.public.drone_partition_map
    ↓
CacheInvalidationListener (消费CDC事件)
    ↓
清除对应的 Redis 缓存 + L1 Caffeine 缓存
```

**消费端**（`CacheInvalidationListener.java`）：监听 Redis PubSub channel `cache:invalidate`，收到消息后清除对应的 L1 缓存。Debezium 的变更事件被转换为缓存失效通知，通过 Redis PubSub 广播到所有实例。

### 两层保险的协作

```
用户修改分区 → @Transactional(DB写入)
    ├── 主路径: afterCommit() → 直接更新Redis → PubSub广播L1失效  [延迟<100ms]
    │
    └── 兜底路径: WAL变更 → Debezium → Kafka CDC Topic → 消费端失效缓存  [延迟1-10s]
```

- **正常情况**：主路径（Post-Commit Hook）在事务提交后立即更新 Redis，延迟 <100ms
- **主路径失败**（如 Redis 临时不可用）：操作进入 `pendingRedisSyncQueue` 重试
- **重试也失败**：Debezium CDC 作为兜底，1-10 秒后通过 WAL 日志捕获变更并触发缓存失效
- **最终兜底**：每 60 秒的对账任务（`reconcileRedisWithDb`）修复所有漂移

### 深挖追问

#### 追问 1：如果 Debezium 挂了怎么办？历史数据怎么处理？

**Debezium 挂了**：

1. **短期影响有限**：主路径（Post-Commit Hook）仍然正常工作，CDC 只是兜底。只要主路径和定期对账正常，系统不受影响
2. **WAL 不会丢失**：PostgreSQL 的复制槽（`ucs_cdc_slot`）会保留 Debezium 未消费的 WAL 段。Debezium 恢复后从断点继续消费，不会遗漏任何变更
3. **WAL 堆积风险**：如果 Debezium 长时间不恢复（>数小时），WAL 文件会持续增长，可能撑满磁盘。需要监控 `pg_replication_slots` 视图中的 `restart_lsn`，如果 lag 过大则告警

**历史数据处理**：

`snapshot.mode = initial` 意味着 Debezium 首次启动时会做全表快照——扫描 `drone_partition_map` 和 `drones` 表的所有现有数据，以 INSERT 事件的形式发送到 Kafka。这确保了 CDC Topic 中包含完整的数据，不仅仅是增量变更。

如果需要重新同步所有历史数据，可以删除 Debezium 的 offset（`_cdc_offsets` Topic 中的相关 key）并重启 Connect，它会重新执行全量快照。

#### 追问 2：为什么选 Debezium 而不是数据库触发器（Trigger）或应用层双写？

| 方案 | 优势 | 劣势 |
|------|------|------|
| **数据库 Trigger** | 同步执行，延迟最低 | 耦合到数据库层，难以维护；触发器里调用外部系统（Redis）不可靠 |
| **应用层双写** | 代码可控 | 如果写 DB 成功但写 Redis 失败，数据不一致；需要手写重试逻辑 |
| **Debezium CDC** | 基于 WAL，不侵入应用代码；不影响写入性能；天然可靠（WAL 不丢） | 有 1-10 秒延迟；额外的基础设施（Connect 集群） |

UCS 的选择是"应用层 Post-Commit Hook（主路径，低延迟）+ Debezium CDC（兜底，高可靠）"，取两者之长。这种混合策略在业界被称为 **"Outbox + CDC"** 模式。

---

## Q14 — 事务使用与传播机制

### 场景总览

UCS 中使用事务的场景：
1. **权限转移**：`PermissionService.transferPermission()` — 过期旧权限 + 创建新权限 + 更新队伍映射，必须原子执行
2. **分区更新**：`PartitionRoutingService.updateDronePartitions()` — 停用旧映射 + 创建新映射
3. **自动注册无人机**：`PartitionRoutingService.autoCreateDroneWithDefaultPartitions()` — 创建无人机 + 创建分区映射
4. **用户注册**：创建用户 + 分配默认角色

### 经典场景：权限转移

`PermissionService.java:58-160`：

```java
@Transactional  // 声明式事务，默认传播级别REQUIRED，隔离级别READ_COMMITTED
public boolean transferPermission(String uavId, Long toUserId,
                                   Long operatorId, String operatorName) {
    // 1. 获取分布式锁（Redis SETNX，5秒TTL）
    String lockValue = UUID.randomUUID().toString();
    boolean lockAcquired = redisService.tryAcquireLock(uavId, lockValue);
    if (!lockAcquired) {
        return false;  // 其他转移正在进行
    }
    
    try {
        // 2. 在锁内原子执行（以下都在同一个DB事务中）
        
        // 2.1 过期当前权限
        currentOwnership.get().setExpiredAt(LocalDateTime.now());
        droneOwnershipRepository.save(currentOwnership.get());
        
        // 2.2 创建新权限
        DroneOwnership newOwnership = new DroneOwnership();
        newOwnership.setDroneId(drone.getId());
        newOwnership.setUserId(toUserId);
        droneOwnershipRepository.save(newOwnership);
        
        // 2.3 更新队伍-无人机映射
        // ...
        
        // 2.4 更新分区路由
        partitionRoutingService.updateDronePartitions(uavId, newPartitions);
        
        return true;
    } finally {
        // 3. 释放分布式锁
        redisService.releaseLock(uavId, lockValue);
    }
}
```

**UCS 使用的是声明式事务**（`@Transactional` 注解），不是编程式事务（`TransactionTemplate`）。原因：
- 代码更简洁，不需要 `try-catch-commit-rollback` 样板代码
- Spring 通过 AOP 代理自动管理事务边界
- 异常时自动回滚（RuntimeException），不需要手动处理

**事务传播机制**：默认 `Propagation.REQUIRED`——如果当前已有事务则加入，没有则创建新事务。这意味着 `transferPermission()` 内部调用 `updateDronePartitions()` 时，后者不会创建新事务，而是加入外层的事务。如果 `updateDronePartitions` 抛异常，整个 `transferPermission` 的事务都会回滚。

**事务隔离级别**：默认 `Isolation.READ_COMMITTED`（PostgreSQL 默认值）。这意味着：
- 不会读到未提交的数据（防脏读）
- 同一事务内两次读取可能看到不同结果（允许不可重复读）——在 UCS 场景中可以接受，因为每个事务都是短暂的写操作

### 深挖追问

#### 追问 1：为什么权限转移需要同时用分布式锁和数据库事务？只用一个不行吗？

它们解决的是不同层面的问题：

- **数据库事务**：保证**数据库内部**的原子性。"过期旧权限 + 创建新权限"要么全成功要么全失败
- **分布式锁**：保证**跨多个操作**的互斥性。防止两个用户同时对同一架无人机发起权限转移

如果只用数据库事务不用分布式锁：两个并发的 `transferPermission(uavId="px4_1")` 可能同时读到同一个 `currentOwnership`，然后各自创建新权限——结果是一架无人机同时有两个控制者。

如果只用分布式锁不用数据库事务：如果创建新权限成功但更新队伍映射失败，数据库中的状态不一致。

两者结合才能保证**并发安全 + 数据一致性**。

---

## Q15 — AOP 与操作日志

### 场景总览

UCS 项目中虽然没有自定义 `@Aspect` 注解类（搜索 `@Aspect` 无结果），但使用了 Spring 框架内置的 AOP 机制：

1. **`@Transactional`**：基于 AOP 代理实现声明式事务管理
2. **Spring Security Filter Chain**：基于 Servlet Filter 实现鉴权和授权
3. **操作日志**：通过**Service 层手动记录**而非 AOP 拦截

### 经典场景：操作日志记录

`OperationLogService.java` 提供了日志记录方法：

```java
public class OperationLogService {
    // 记录成功操作
    public void logSuccess(Long operatorId, String operatorName, String operationType,
                           Long droneId, String uavId, String detail) { ... }
    
    // 记录失败操作
    public void logFailure(Long operatorId, String operatorName, String operationType,
                           Long droneId, String uavId, String detail, String errorMessage) { ... }
}
```

在 `PermissionService` 中的使用（`PermissionService.java:64-67`）：

```java
if (droneOpt.isEmpty()) {
    operationLogService.logFailure(operatorId, operatorName, "PERMISSION_TRANSFER",
            null, uavId, buildTransferDetail(null, toUserId),
            "Drone not found: " + uavId);
    return false;
}
```

**为什么没有使用 AOP 自动记录日志？**

1. **操作日志需要业务上下文**：如"权限从用户 A 转移到用户 B"——这些参数只有在业务代码内部才知道，AOP 切面只能拿到方法签名和参数
2. **需要区分成功和失败**：AOP 的 `@AfterReturning` 和 `@AfterThrowing` 可以区分，但无法获取中间状态（如"锁获取失败"不是异常，是正常的 `return false`）
3. **日志粒度不同**：并非每个方法都需要操作日志，只有关键业务操作（权限转移、指令下发、配置修改）才需要

**为什么没有使用拦截器（Interceptor）？**

Spring MVC 的 `HandlerInterceptor` 工作在 Controller 层（HTTP 请求层面），而操作日志需要记录的是 **Service 层的业务操作**。一个 Controller 方法可能调用多个 Service 方法，每个都需要独立的操作日志。拦截器粒度太粗，无法满足需求。

### 深挖追问

#### 追问 1：如果后续要加 AOP 操作日志，应该怎么设计？

推荐使用自定义注解 + AOP 切面：

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface LogOperation {
    String type();           // 操作类型
    String description();    // 描述
}

@Aspect
@Component
public class OperationLogAspect {
    @Around("@annotation(logOp)")
    public Object around(ProceedingJoinPoint pjp, LogOperation logOp) throws Throwable {
        try {
            Object result = pjp.proceed();
            // 记录成功日志
            return result;
        } catch (Exception e) {
            // 记录失败日志
            throw e;
        }
    }
}
```

但当前 UCS 选择手动记录是合理的——业务逻辑复杂，AOP 很难自动提取足够的上下文信息。

---

## Q16 — 多无人机碰撞避免

### 场景总览

当多架无人机同时飞向同一目标点时，存在碰撞风险。UCS 的 `CollisionAvoidanceService` 提供实时碰撞检测和预警。

### 经典场景：O(N²) 距离检测 + 预测碰撞

`CollisionAvoidanceService.java:72-127`：

```java
public List<CollisionAlert> updateAndCheck(String uavId, double lat, double lon, double alt,
                                            double vx, double vy, double vz) {
    positions.put(uavId, pos);  // 更新当前无人机位置
    
    List<CollisionAlert> alerts = new ArrayList<>();
    for (Map.Entry<String, DronePosition> entry : positions.entrySet()) {
        String otherId = entry.getKey();
        if (otherId.equals(uavId)) continue;
        if (now - other.getTimestamp() > 10000) continue;  // 跳过超过10s未更新的位置
        
        double distance = calculate3DDistance(pos, other);           // 当前距离
        double predictedDistance = calculatePredictedDistance(pos, other, 5.0);  // 5秒后的预测距离
        double minDistance = Math.min(distance, predictedDistance);
        
        if (minDistance <= 100.0) {  // WARNING阈值
            String severity = minDistance <= 30.0 ? "CRITICAL" : "WARNING";
            // 去重：同一对无人机5秒内只告警一次
            String pairKey = buildPairKey(uavId, otherId);
            if (lastAlertTime.get(pairKey) != null && (now - lastAlertTime.get(pairKey)) < 5000) {
                continue;
            }
            alerts.add(alert);
            lastAlertTime.put(pairKey, now);
        }
    }
}
```

**关键参数**：
- `WARNING_DISTANCE = 100m`：警告阈值，通知操作员关注
- `CRITICAL_DISTANCE = 30m`：紧急阈值，建议采取规避措施
- `LOOKAHEAD_SECONDS = 5.0`：预测窗口——基于当前速度向量，预测 5 秒后两架无人机的距离
- `ALERT_DEDUP_INTERVAL_MS = 5000`：同一对无人机 5 秒内只告警一次，避免刷屏
- 时间复杂度：O(N²)，对于 N < 500 可接受；更大规模需引入 R-tree 空间索引

### 深挖追问

#### 追问 1：预测碰撞是怎么计算的？如果无人机在转弯呢？

预测碰撞使用线性外推：

```
预测位置 = 当前位置 + 速度向量 × lookahead时间
```

这是**最简单的线性预测**——假设无人机在未来 5 秒内保持当前速度和方向不变。对于转弯场景，线性预测不准确，但 UCS 每 100ms 更新一次遥测数据，所以预测结果每 100ms 就会被修正。即使某次预测不准，0.1 秒后新的遥测到来就会重新计算。

对于需要更精确预测的场景（如无人机密集编队飞行），可以升级为：
- 二次外推（考虑加速度）
- 航线感知预测（基于已知航线计算未来轨迹交叉点）

#### 追问 2：O(N²) 的性能瓶颈在哪里？如何优化到支持 1000+ 架无人机？

N=500 时，每次更新需要计算 500 次距离（与其他所有无人机的距离），每秒 10 次更新 × 500 架 = 2,500,000 次距离计算/秒。每次距离计算涉及三角函数（Haversine），约 100ns，总计约 250ms/秒。这在一个 CPU 核心上勉强可接受。

N=1000+ 时，计算量变为 10,000,000 次/秒，约 1 秒/秒——已经处理不过来。

优化方案：
1. **空间分区（R-tree / Grid）**：将空间划分为网格，只计算同一网格及相邻网格内的无人机对的距离。复杂度降为 O(N × k)，k 是平均邻居数
2. **距离预过滤**：先用 GeoHash 前缀匹配快速排除肯定不会碰撞的（距离 > 1km），再精确计算
3. **增量计算**：只在位置变化超过阈值时重新计算，静止或低速无人机跳过

---

## Q17 — 无人机心跳维护与离线判定

### 场景总览

无人机心跳用于检测无人机是否在线。UCS 使用 Redis ZSet 作为心跳存储，配合 ShedLock 分布式定时任务进行超时检测。

### 经典场景：心跳更新 + 超时检测

**心跳更新**（每条遥测数据触发）：

在 `TelemetryRawConsumer.java:82` 中，每条遥测消息消费后更新心跳：

```java
redisService.setDroneOnline(uavId);  // SET drone:{uavId}:online "true" EX 30s
```

同时在 `RedisService.java:55-57`：

```java
public void updateDroneHeartbeat(String uavId) {
    double nowMs = System.currentTimeMillis();
    stringRedisTemplate.opsForZSet().add("drone:heartbeat", uavId, nowMs);
}
```

**超时检测**（`DroneHeartbeatService.java:43-66`）：

```java
private static final long TIMEOUT_MS = 3000;  // 3秒超时

@Scheduled(fixedRate = 1000)  // 每1秒检查一次
@SchedulerLock(name = "checkHeartbeats", lockAtLeastFor = "500ms", lockAtMostFor = "5s")
public void checkHeartbeats() {
    Set<String> timedOut = redisService.getTimedOutDrones(TIMEOUT_MS);
    for (String uavId : timedOut) {
        // 1. 清理Redis
        redisService.setDroneOffline(uavId);        // DELETE drone:{uavId}:online
        redisService.removeDroneHeartbeat(uavId);   // ZREM drone:heartbeat uavId
        // 2. 从内存快照移除
        telemetryKafkaConsumer.removeDroneFromSnapshot(uavId);
        // 3. 通知前端
        notifyDroneOffline(uavId);
    }
}
```

**不是单独的心跳线程**：心跳检测使用 Spring 的 `@Scheduled` + ShedLock，运行在 Spring 的 TaskScheduler 线程池中，不是单独开的守护线程。好处是受 ShedLock 管控（多实例只执行一次）+ 受 Spring 生命周期管理（应用关闭时优雅停止）。

**心跳数据的记录方式**：是的，**每条遥测数据都更新心跳**。无人机以 10Hz 发送遥测数据，每收到一条都会 `ZADD drone:heartbeat uavId currentTimeMs`。ZSet 的 ZADD 是幂等的——相同 member 只是更新 score，不会重复添加。

**离线判定逻辑**：`getTimedOutDrones(3000)` 查询 ZSet 中 score < (now - 3000ms) 的所有成员。如果一架无人机 3 秒没有遥测数据到达，就被判定为离线。

### 深挖追问

#### 追问 1：如果无人机短时间频繁断线重连，epoch 会不会快速上升？

不会。Epoch 和心跳是两个独立的机制：
- **心跳**：基于遥测数据的到达时间，3 秒无数据判定离线
- **Epoch**：基于消息本身携带的时间戳，用于排序和去重

短时间断线重连场景：
1. 无人机断线 → 3 秒后被判定离线 → 清理 Redis 状态
2. 无人机重连 → 发送新遥测（epoch = 当前时间戳）
3. Epoch 校验：新 epoch > Redis 中记录的 epoch → 通过校验，更新 epoch
4. epoch 只会增长到当前时间戳的数量级，不会因为断线重连而"多出来"

**epoch 上限**：有 Soft Limit = 10,000 + 定期归一化（详见 Q2）。但实际上，epoch 通常就是 Unix 毫秒时间戳，远超 10,000 是正常的。归一化针对的是长期不活跃的无人机，防止其 epoch 在 Redis 中无意义地占用空间。

---

## Q18 — 航线规划与集结点

### 场景总览

UCS 系统中航线规划和集结点（Rally Point）使用 PostgreSQL 关系型数据库存储，而不是 MongoDB。

### 经典场景：集结点管理

集结点存储在 `rally_points` 表中，使用 JPA 实体 `RallyPoint`：

```java
@Entity
@Table(name = "rally_points")
public class RallyPoint {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String name;
    private Double latitude;
    private Double longitude;
    private Double altitude;
    private String status;  // ACTIVE / INACTIVE / OCCUPIED
    // ...
}
```

**为什么用 PostgreSQL 而不是 MongoDB？**

1. **数据关系性强**：集结点与无人机、任务、团队之间有复杂的关联关系（外键），关系型数据库天然支持 JOIN 查询
2. **事务需求**：分配集结点给无人机需要事务保证（防止两架无人机抢到同一个集结点）
3. **已有 PostgreSQL 基础设施**：业务数据库已经是 PostgreSQL + TimescaleDB，不需要再引入一个新的数据库引擎
4. **数据量有限**：集结点数量通常在几十到几百个量级，关系型数据库完全够用

**如果航线数据复杂到 PostgreSQL 装不下（如大量轨迹点、3D 路径规划数据）怎么办？**

方案：将航线的轨迹点（waypoints）序列化为 JSON 存储在 PostgreSQL 的 `JSONB` 字段中。PostgreSQL 的 JSONB 支持索引和查询，性能足够。只有在需要地理空间查询（如"查找经过某个区域的所有航线"）时，才需要考虑 PostGIS 扩展或专用空间数据库。

### 深挖追问

#### 追问 1：集结点有哪些状态和规划限制？

集结点状态：`ACTIVE`（可用）、`INACTIVE`（停用）、`OCCUPIED`（已被无人机占用）。

规划限制：
- 一个集结点同一时刻只能被一架无人机占用（通过分布式锁保证）
- 集结点需要满足海拔和地理位置的安全要求（不在禁飞区内——与 GeofenceService 集成）

---

## Q19 — 大量无人机并发分配

### 场景总览

并发分配涉及多架无人机同时被分配给不同操作员。核心挑战是防止并发冲突（如两人同时抢同一架无人机）。

### 经典场景：Redis 分布式锁 + 数据库事务

`PermissionService.java:80-88`：

```java
// 获取分布式锁：lock:drone:{uavId}，TTL=5秒
String lockValue = UUID.randomUUID().toString();
boolean lockAcquired = redisService.tryAcquireLock(uavId, lockValue);
if (!lockAcquired) {
    // 其他操作者正在操作这架无人机，返回失败
    return false;
}
```

`RedisService.java` 中的锁实现：

```java
private static final String LOCK_DRONE_PREFIX = "lock:drone:%s";
private static final Duration LOCK_TTL = Duration.ofSeconds(5);

public boolean tryAcquireLock(String uavId, String lockValue) {
    String key = String.format(LOCK_DRONE_PREFIX, uavId);
    return Boolean.TRUE.equals(
        stringRedisTemplate.opsForValue().setIfAbsent(key, lockValue, LOCK_TTL));
}
```

**锁的粒度是无人机级别**：`lock:drone:px4_1` 只锁住 `px4_1` 这一架无人机，不影响其他无人机的并发分配。这意味着 100 架无人机可以同时被分配给不同操作员，互不干扰。

### 深挖追问

#### 追问 1：如果持有锁的实例崩溃了，锁会不会一直占着？

不会。锁的 TTL 是 5 秒（`LOCK_TTL = Duration.ofSeconds(5)`）。即使实例崩溃没有手动释放锁，5 秒后 Redis 会自动删除这个 key，其他实例就可以获取锁了。

这也是选择 Redis `SETNX + EX` 而不是数据库 `SELECT ... FOR UPDATE` 的原因——数据库行级锁在持有者崩溃时，需要等到数据库连接超时或手动清理。

---

## Q20 — ElasticSearch 的使用

### 场景总览

**当前 UCS 项目没有使用 ElasticSearch**。日志搜索通过 Loki（K8s 部署中配置）实现，操作日志通过 PostgreSQL 的 `operation_log` 表 + 分页查询实现。

### 如果要引入 ElasticSearch，适合的场景

1. **操作日志全文搜索**：当操作日志量达到百万级，PostgreSQL 的 LIKE 查询性能下降时，可以将操作日志同步到 ES 做全文检索
2. **无人机遥测数据分析**：如果需要对历史遥测做复杂聚合分析（而 TimescaleDB 的连续聚合不够灵活），ES 的 Aggregation 能力更强
3. **告警事件检索**：碰撞告警、围栏越界告警等事件的多维度搜索

### 深挖追问

#### 追问 1：当前的操作日志查询是怎么实现的？

`OperationLogController.java` 提供 REST API，`OperationLogRepository.java` 使用 Spring Data JPA 的分页查询：

```java
// 按操作类型 + 时间范围 + 操作者 分页查询
Page<OperationLog> findByOperationTypeAndCreatedAtBetween(
    String operationType, LocalDateTime start, LocalDateTime end, Pageable pageable);
```

当前数据量级（几千到几万条），PostgreSQL + 索引完全足够，引入 ES 反而增加运维复杂度。

---

## Q21 — 缓存击穿、穿透、雪崩防护

### 场景总览

| 问题 | 定义 | UCS 防护措施 |
|------|------|-------------|
| **缓存穿透** | 查询不存在的数据，缓存永远 Miss，直接打 DB | 布隆过滤器 + 格式校验 + 空值缓存 |
| **缓存击穿** | 热点 Key 过期瞬间，大量并发请求打 DB | Mutex Lock（Redis SETNX） |
| **缓存雪崩** | 大量 Key 同时过期，瞬时流量压垮 DB | TTL 随机抖动（±30s） |

### 经典场景：三重缓存穿透防护（T-14）

`PartitionRoutingService.java:82-101`：

```java
// T-14 (1) 布隆过滤器：O(1) 快速拒绝不存在的 uavId
@SuppressWarnings("UnstableApiUsage")
private final BloomFilter<String> droneBloomFilter = BloomFilter.create(
        Funnels.stringFunnel(StandardCharsets.UTF_8),
        100_000,   // 预期最大无人机数量
        0.01       // 1% 误判率
);

// T-14 (2) 格式校验：正则表达式拒绝非法 uavId
private static final Pattern VALID_UAV_ID = Pattern.compile(
        "^(px4_\\d+|mav_\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}_\\d+|mavlink_.+)$"
);

// T-14 (3) 空值缓存：查询结果为空时，缓存 "null" 标记，TTL=60s
private static final String NULL_CACHE_PREFIX = "drone:%s:partitions:null";
private static final Duration NULL_CACHE_TTL = Duration.ofSeconds(60);
```

在 `getPartitionsForDrone()` 中的执行顺序（`PartitionRoutingService.java:133-172`）：

```
1. 格式校验 → 不合法直接返回空
    ↓
2. 布隆过滤器 → 不在 filter 中直接返回空
    ↓  
3. 空值缓存检查 → 如果 "null" 标记存在，直接返回空
    ↓
4. L1 (Caffeine) → 命中则返回
    ↓
5. L2 (Redis) → 命中则返回
    ↓
6. L3 (数据库) → 命中则回填缓存并返回
    ↓
7. 数据库也没有 → 缓存 "null" 标记（60s TTL），返回空
```

### 深挖追问

#### 追问 1：布隆过滤器的 1% 误判率会不会导致问题？

布隆过滤器只有**误判为存在**（实际不存在但判断为可能存在），不会**误判为不存在**（实际存在但判断为不存在）。

1% 的误判率意味着：100 个恶意构造的不存在的 uavId 中，有 1 个会穿透布隆过滤器。但这 1 个还要经过空值缓存检查——第二次查询时就会被空值缓存拦截。所以实际穿透到数据库的概率极低。

10 万个条目 + 1% 误判率的布隆过滤器约占 ~120KB 内存，对于 JVM 来说可以忽略。

---

## Q22 — 电子围栏（地理围栏）

### 场景总览

`GeofenceService` 支持三种围栏类型：
1. **INCLUSION**（包含区）：无人机必须在区域内飞行，离开则告警
2. **EXCLUSION**（禁飞区）：无人机不得进入，进入则紧急告警
3. **ALERT**（监控区）：无人机进入时触发提醒，不强制限制

围栏形状支持：
- **CIRCLE**：圆心 + 半径（使用 Haversine 公式计算距离）
- **POLYGON**：多边形顶点列表（使用射线法 Ray-Casting 判断点是否在多边形内）

### 经典场景：围栏越界检测

`GeofenceService.java:82-133`：

```java
public List<GeofenceBreachEvent> checkPosition(String uavId, double lat, double lon, double alt) {
    for (GeofenceZone zone : geofences.values()) {
        // 检查高度限制
        if (zone.getMinAlt() != null && alt < zone.getMinAlt()) continue;
        if (zone.getMaxAlt() != null && alt > zone.getMaxAlt()) continue;
        
        boolean inside = isInsideZone(lat, lon, zone);
        
        switch (zone.getType()) {
            case "INCLUSION" -> { if (!inside) breached = true; }  // 离开包含区 = 违规
            case "EXCLUSION" -> { if (inside) breached = true; }   // 进入禁飞区 = 违规
            case "ALERT"     -> { if (inside) breached = true; }   // 进入监控区 = 告警
        }
        
        if (breached) {
            // 去重：同一无人机同一围栏只告警一次（直到离开后重新进入）
            Set<String> currentBreaches = droneBreachState.computeIfAbsent(uavId, k -> ConcurrentHashMap.newKeySet());
            if (currentBreaches.add(zone.getFenceId())) {
                // 新违规事件
                event.setSeverity(zone.getType().equals("EXCLUSION") ? "CRITICAL" : "WARNING");
                breaches.add(event);
            }
        }
    }
}
```

### 深挖追问

#### 追问 1：检测到越界后，系统会自动控制无人机返航吗？

当前实现中，`GeofenceService` 只负责**检测和告警**——生成 `GeofenceBreachEvent` 并通过 `ApplicationEventPublisher` 发布。是否自动执行返航命令（RTL）取决于下游的事件处理逻辑。

告警信息会通过 WebSocket 推送到前端（`/topic/drone-status` 或 `events.drone` Kafka Topic），由操作员决定是否手动发送 RTL 命令。这是一个**半自动化**的设计——完全自动控制在军事/民航领域有安全合规要求，不宜默认启用。

---

## Q23 — 批量控制命令的同时下发

### 场景总览

批量控制多架无人机时，需要保证所有无人机**尽可能同时**收到命令。

### 经典场景：Kafka 异步发送 + Epoch 标记

`CommandKafkaProducer.java:45-68`：

```java
public void sendCommand(String uavId, String commandType, String params,
                        Long userId, Long commandLogId) throws Exception {
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("uavId", uavId);
    payload.put("commandType", commandType);
    payload.put("epoch", epochValidationService.getCurrentEpoch(uavId));
    
    String json = objectMapper.writeValueAsString(payload);
    
    // 同步等待Kafka确认（最多5秒），确保命令真正到达Kafka
    var sendResult = kafkaTemplate.send(commandsDownTopic, uavId, json)
            .get(5, TimeUnit.SECONDS);
}
```

**批量发送策略**：当需要同时控制 N 架无人机时，Controller 层循环调用 `sendCommand`，每次调用独立发送到 Kafka。由于 Kafka 的生产者内部有**批量缓冲**（`linger.ms` + `batch.size`），多条消息可能在一个网络请求中发送到 Broker。

**保证同时执行**的关键不在于"同时发送"，而在于：
1. **Kafka 分区**：不同无人机的命令发送到不同分区，可以被多个网关实例并行消费
2. **Epoch 保序**：每条命令带 epoch，网关端按 epoch 顺序执行，迟到的旧命令被丢弃

### 深挖追问

#### 追问 1：如果某架无人机的命令发送失败了，其他无人机的命令会回滚吗？

不会。每架无人机的命令是独立的——一架失败不影响其他。失败的命令会在 `ControlService` 层触发降级策略：

- **主路径**：通过 Kafka 发送
- **降级路径**：如果 Kafka 发送失败（5 秒超时），直接通过 HTTP POST 发送到 DDS 网关的命令端点

指令级别使用 `acks=all`（`ucs-command/application.yml:24`），确保每条命令都被 Kafka 集群持久化后才确认。

---

## Q24 — RBAC 权限模型

### 场景总览

UCS 使用 RBAC（Role-Based Access Control）权限模型，涉及以下数据库表：

| 表名 | 作用 |
|------|------|
| `users` | 用户表 |
| `roles` | 角色表（OBSERVER、PILOT、OPERATOR、LEADER、COMMANDER） |
| `user_role_map` | 用户-角色映射（多对多） |
| `teams` | 队伍/团队表 |
| `team_members` | 团队成员表（含团队内角色） |
| `team_roles` | 团队角色表 |
| `team_drone_map` | 团队-无人机映射 |

### 经典场景：Spring Security RBAC

`SecurityConfig.java:39-63`：

```java
.authorizeHttpRequests(auth -> auth
    .requestMatchers("/api/v1/auth/**").permitAll()        // 登录注册不需要权限
    .requestMatchers("/ws/**").permitAll()                  // WebSocket握手
    .requestMatchers("/api/v1/screen/**").authenticated()   // 大屏——登录即可
    .requestMatchers("/api/v1/pilot/**").hasAnyRole("PILOT", "OPERATOR", "LEADER", "COMMANDER")
    .requestMatchers("/api/v1/leader/**").hasAnyRole("LEADER", "COMMANDER")
    .requestMatchers("/api/v1/control/**").hasAnyRole("PILOT", "OPERATOR", "LEADER", "COMMANDER")
    .requestMatchers("/api/v1/commander/**").hasRole("COMMANDER")  // 仅指挥官
    .anyRequest().authenticated()
)
```

**角色继承关系**：COMMANDER > LEADER > OPERATOR > PILOT > OBSERVER。高角色天然拥有低角色的权限（通过 `hasAnyRole` 实现）。

**RBAC vs ABAC 的区别**：
- **RBAC**（Role-Based）：权限基于角色。"你是指挥官，所以你能转移权限"
- **ABAC**（Attribute-Based）：权限基于属性。"你是这架无人机的当前控制者 + 你的角色是指挥官 + 当前时间在工作时间内，所以你能转移权限"

UCS 使用的是 RBAC，因为系统的角色层次清晰（5 级），属性条件简单。ABAC 适合权限规则复杂多变的场景（如电商平台的促销权限）。

### 深挖追问

#### 追问 1：角色权限变更后，已登录用户需要重新登录吗？

不需要。JWT Token 中嵌入了 `roles` 列表，Token 有效期内角色信息不变。但如果管理员修改了某用户的角色，有两种处理方式：
1. **等 Token 过期**：Access Token 默认 30 分钟过期，下次刷新时获取最新角色
2. **主动失效**：将旧 Token 加入 Redis 黑名单（`JwtUtil` 中的 `TOKEN_BLACKLIST_PREFIX`），强制用户重新登录

---

## Q25 — 登录鉴权与 JWT + Spring Security

### 场景总览

UCS 使用**双 Token（Access Token + Refresh Token）+ 三重验证（签名 + 过期 + 黑名单）** 的鉴权方案。

### 经典场景：JWT 生成与验证

**Token 生成**（`JwtUtil.java:144-148`）：

```java
public String generateAccessToken(Long userId, String username, List<String> roles) {
    long exp = accessTokenExpiration;  // 默认 1800000ms = 30分钟
    return buildToken(userId, username, roles, "access", exp);
}

public String generateRefreshToken(Long userId, String username) {
    long exp = refreshTokenExpiration;  // 默认 604800000ms = 7天
    return buildToken(userId, username, List.of(), "refresh", exp);
}
```

**签名算法**：支持双模式：
- **RSA-256**（优先）：配置了 `jwt.rsa.private-key` 和 `jwt.rsa.public-key` 时使用。私钥签名，公钥验证。优势：API Gateway 只需公钥即可验证 Token，无需知道私钥
- **HMAC-SHA**（降级）：未配置 RSA 时使用对称密钥。配置项 `jwt.secret`，默认 `change-me-in-production`

**三重验证**（`JwtAuthenticationFilter.java`）：

```
1. 签名验证 → RSA-256 或 HMAC-SHA，确保Token未被篡改
2. 过期验证 → 检查 exp claim
3. 黑名单验证 → Redis查询 token:blacklist:{jti}，检查Token是否已注销
```

**Spring Security 集成**（`SecurityConfig.java:66`）：

```java
.addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
```

`JwtAuthenticationFilter` 被注册在 `UsernamePasswordAuthenticationFilter` 之前。每个请求到达后：
1. 从 `Authorization: Bearer <token>` 头提取 Token
2. 验证签名 + 过期 + 黑名单
3. 解析出 userId、username、roles
4. 构造 `UsernamePasswordAuthenticationToken` 设入 `SecurityContextHolder`
5. 后续的 `@PreAuthorize` 或 `hasRole()` 就能从 SecurityContext 获取权限信息

### 深挖追问

#### 追问 1：Refresh Token 是怎么刷新 Access Token 的？

典型流程：
1. Access Token 过期，前端收到 401
2. 前端用 Refresh Token 调用 `POST /api/v1/auth/refresh`
3. 后端验证 Refresh Token 有效（签名 + 过期 + 黑名单）
4. 生成新的 Access Token + 新的 Refresh Token
5. 旧 Refresh Token 加入黑名单（一次性使用）

双 Token 的好处是：Access Token 短命（30 分钟），被泄露后危害窗口小；Refresh Token 长命（7 天），但只能用于刷新，不能直接访问 API。

---

## Q26 — Redis 数据结构选型详解

### 场景总览

（本题与 Q7 有重叠，这里更深入地讲解选型理由）

### 经典场景：各数据结构的选型对比

**1. String 类型 — Epoch 存储**

```
Key: epoch:px4_1        Value: "1713578400000"    TTL: 24h
```

为什么不用 Hash？因为 epoch 是单个值，不需要多个字段。String 的 `SET + GET` 是 O(1)，最简单高效。

**2. Set 类型 — 分区映射**

```
Key: drone:px4_1:partitions    Members: {"observer", "commander"}
Key: partition:observer:drones  Members: {"px4_1", "px4_2", "px4_3"}
```

为什么用 Set 而不是 List？
- 分区名称不需要顺序，但需要**去重**（同一分区不应出现两次）
- `SISMEMBER` O(1) 判断是否属于某分区
- `SMEMBERS` O(N) 获取所有分区
- `SADD`/`SREM` O(1) 添加/移除

**3. ZSet 类型 — 心跳（详见 Q7）**

**4. GEO 类型 — 空间索引（详见 Q9）**

**5. PubSub — 缓存失效广播**

```
Channel: cache:invalidate
Message: "partition-map:drone:px4_1:partitions"
```

PubSub 是 fire-and-forget 的，不持久化。适合缓存失效通知这种"丢了一次也不要紧（有 TTL 兜底）"的场景。

### 深挖追问

#### 追问 1：为什么心跳用 ZSet 而不是给每架无人机设一个 TTL String Key？

两种方案对比：

| 方案 | 查询超时无人机 | 更新心跳 | 优劣 |
|------|-------------|---------|------|
| ZSet | `ZRANGEBYSCORE drone:heartbeat 0 cutoff` → O(logN + M) | `ZADD` O(logN) | 一次查出所有超时无人机，精确控制超时阈值 |
| TTL String | 需要 `SCAN drone:*:heartbeat`，然后逐个检查 `TTL` | `SET + EX` O(1) | SCAN 不保证实时性，且无法设置"精确 3 秒超时" |

ZSet 方案的核心优势：**定时任务每秒执行一次，需要快速精确地获取所有超时无人机列表**。`ZRANGEBYSCORE` 是专门为此设计的操作。

---

## Q27 — Redis 高可用与集群架构

### 场景总览

UCS 在 K8s 环境中使用 **Redis Sentinel**（哨兵模式）实现高可用，而非 Redis Cluster（集群模式）。

### 经典场景：Redis Sentinel 架构

```
┌─────────────────────────────────┐
│         Redis Sentinel          │
│  Sentinel-1  Sentinel-2  Sentinel-3  │
│  (监控+选主)  (监控+选主)  (监控+选主)  │
└──────┬──────────┬──────────┬────┘
       │          │          │
  ┌────┴────┐  ┌──┴──┐  ┌───┴───┐
  │ Master  │  │Slave│  │ Slave │
  │ Redis   │←─│  1  │  │   2   │
  │(读写)   │  │(只读)│  │(只读) │
  └─────────┘  └─────┘  └───────┘
```

**节点数量**：
- 1 个 Master（读写）
- 2 个 Slave（只读副本）
- 3 个 Sentinel（监控和自动故障转移）

**为什么选 Sentinel 而不是 Cluster？**

| 特性 | Sentinel | Cluster |
|------|----------|---------|
| 数据分片 | 不分片，所有数据在 Master 上 | 16384 个 slot 分布到多个 Master |
| 适用数据量 | 单机内存够用（通常 <16GB） | 数据量超过单机内存 |
| 复杂度 | 低，客户端只需知道 Sentinel 地址 | 高，客户端需要感知 slot 映射 |
| 多 Key 操作 | 无限制 | 跨 slot 的操作受限（如 MGET 需要所有 key 在同一 slot） |

UCS 的 Redis 数据量：心跳 ZSet（~几千个 member）+ 分区 Set（~几千个 key）+ Epoch String（~几千个 key）+ 缓存 String + 分布式锁 → **总计 <100MB**，单机内存完全够用，不需要分片。

### 深挖追问

#### 追问 1：Master 宕机后，故障转移需要多长时间？期间数据会丢失吗？

**故障转移时间**：通常 5-30 秒：
- Sentinel 检测到 Master 不可达（`down-after-milliseconds`，默认 30 秒）
- Sentinel 之间投票确认（几秒）
- 选举新 Master + 切换（几秒）

**数据丢失风险**：Redis 主从复制是**异步的**——Master 接收写入后立即返回客户端，再异步复制给 Slave。如果 Master 在复制前宕机，最后几毫秒的写入会丢失。

对于 UCS 来说这是可接受的：
- Epoch 数据：丢失几毫秒的 epoch 更新不影响正确性（遥测会持续发送新 epoch）
- 心跳数据：丢失后无人机会被短暂判定为离线，重连后自动恢复
- 缓存数据：丢失后从数据库重新加载

---

## Q28 — Kafka 可靠性、高可用与 Rebalance

### 场景总览

UCS 的 Kafka 集群配置：
- **3 个 Broker**（KRaft 模式，无需 ZooKeeper）
- **16 个分区**（`telemetry.raw`、`telemetry.processed` 等主要 Topic）
- **副本因子（RF）= 3**：每个分区有 3 个副本，分布在不同 Broker 上

### 经典场景：消息可靠性保障

**生产者确认机制**：

| 服务 | acks | 含义 |
|------|------|------|
| ucs-business（遥测推送） | `1` | Leader 写入即确认。遥测数据允许极低概率丢失，换取更低延迟 |
| ucs-command（指令下发） | `all` | ISR 中所有副本写入才确认。指令不允许丢失 |

```yaml
# ucs-business/application.yml
spring.kafka.producer.acks: 1       # 遥测：Leader写入即确认
spring.kafka.producer.retries: 3    # 失败重试3次

# ucs-command/application.yml  
spring.kafka.producer.acks: all     # 指令：所有ISR副本确认
spring.kafka.producer.retries: 3
```

**消费者确认机制**：Spring Kafka 默认使用 `AckMode.BATCH`——一批消息全部处理完后自动提交 offset。如果处理异常，offset 不提交，下次重新消费。

**消息持久化**：Kafka 的消息持久化到 Broker 磁盘，保留策略由 `log.retention.hours`（默认 168 小时 = 7 天）控制。

**分区策略**：使用 `uavId` 作为 Key，Kafka 默认分区器（`murmur2(key) % numPartitions`）确保同一无人机的消息在同一分区。

### 深挖追问

#### 追问 1：Consumer Rebalance 是怎么发生的？如何避免不必要的 Rebalance？

**触发条件**：
1. 消费者加入或离开消费者组（如新实例启动/旧实例关闭）
2. 消费者超过 `session.timeout.ms` 没有发送心跳
3. 消费者超过 `max.poll.interval.ms` 没有调用 poll()

**UCS 的优化配置**：
- `session.timeout.ms = 45000`：45 秒才判定消费者死亡（默认 10 秒太短，GC 暂停可能误触发）
- `heartbeat.interval.ms = 15000`：每 15 秒一次心跳（经验法则：< session.timeout / 3）
- `max.poll.interval.ms = 600000`：允许 10 分钟的处理时间

**Rebalance 期间消息不会丢失**（因为 offset 在 Broker 端持久化），但可能**重复消费**（见 Q1 的追问 2）。

---

## Q29 — WebSocket 连接稳定性

### 场景总览

WebSocket 连接可能因网络波动、服务器重启、客户端切换网络等原因断开。

### 经典场景：重连机制

UCS 前端使用 STOMP over WebSocket，STOMP 客户端（如 `@stomp/stompjs`）内置重连机制：

```javascript
const client = new Client({
    brokerURL: 'ws://server:8086/ws',
    reconnectDelay: 5000,     // 断线后5秒重连
    heartbeatIncoming: 10000, // 服务端心跳间隔
    heartbeatOutgoing: 10000, // 客户端心跳间隔
});
```

后端的处理：
- `SessionCreationPolicy.STATELESS`：不依赖 HTTP Session，每次 WebSocket 连接通过 JWT 重新鉴权
- 无人机状态保存在 Redis 和内存快照中，WebSocket 重连后立即收到最新数据（不需要从头拉取历史）

### 深挖追问

#### 追问 1：如果服务端重启，所有 WebSocket 连接都会断开。前端怎么处理？

前端 STOMP 客户端的 `reconnectDelay` 会自动重连。K8s 部署中使用**滚动更新**（Rolling Update），一次只更新一个 Pod——旧 Pod 被终止前新 Pod 已就绪，前端的 WebSocket 被 Ingress 透明地路由到新 Pod，用户几乎感知不到。

---

## Q30 — 日志记录与分布式链路追踪

### 场景总览

UCS 的日志体系：
1. **应用日志**：SLF4J + Logback（Spring Boot 默认），按级别输出（DEBUG/INFO/WARN/ERROR）
2. **链路追踪**：OpenTelemetry + Micrometer（`application.yml` 中配置）
3. **日志收集**：Loki（K8s 部署方案中配置）

### 经典场景：OpenTelemetry 链路追踪

`application.yml` 配置：

```yaml
management:
  tracing:
    sampling:
      probability: ${TRACING_SAMPLE_RATE:0.1}   # 采样率10%
  otlp:
    tracing:
      endpoint: ${OTEL_EXPORTER_OTLP_ENDPOINT:http://localhost:4317}
```

**`probability = 0.1`**：只采集 10% 的请求做链路追踪。100% 采样会产生大量 trace 数据，影响性能和存储。10% 足以在出问题时找到代表性的慢请求。

**日志太多怎么办？**
- 级别控制：生产环境使用 INFO 级别，`com.ucs.business` 包用 INFO（`application.yml:72`）
- T-73 优化：项目中多处将高频日志从 INFO 降级到 DEBUG（如每条遥测的处理日志），避免日志洪水
- Loki：日志发送到 Loki 集中存储，支持按标签（Pod 名、服务名）+ 全文搜索

### 深挖追问

#### 追问 1：如何保证日志不丢失？

多层保障：
1. **Logback AsyncAppender**：异步写日志到文件，队列满时降级为同步（不丢弃）
2. **容器 stdout**：Spring Boot 日志输出到 stdout，被容器运行时（containerd）捕获
3. **Loki DaemonSet**：K8s 中 Promtail 以 DaemonSet 部署，实时采集 Pod 日志发送到 Loki
4. **持久化存储**：Loki 后端使用持久卷存储，日志保留 7 天

---

## Q31 — 分布式 ID 生成

### 场景总览

UCS 项目中**没有使用分布式 ID 生成器**（如 Snowflake、Leaf）。所有实体的主键都使用 PostgreSQL 的 `IDENTITY`（自增 ID）：

```java
@Id
@GeneratedValue(strategy = GenerationType.IDENTITY)
private Long id;
```

**为什么不需要分布式 ID？**

1. 每个微服务操作自己的数据库 Schema（`schema-isolation.sql` 中定义了 `ucs_business`、`ucs_telemetry`、`ucs_command`、`ucs_drone` 四个独立 Schema），ID 在各自 Schema 内自增，不会冲突
2. 跨服务引用使用业务 ID（如 `uavId = "px4_1"`）而不是数据库自增 ID
3. 当前单 PostgreSQL 实例，不存在多主写入的 ID 冲突问题

如果未来分库分表（水平拆分），才需要引入分布式 ID。

---

## Q32 — 数据加载慢的排查流程

### 场景总览

当用户反馈某个页面数据加载慢时，UCS 提供了从前端到数据库的全链路排查工具。

### 经典场景：排查流程

```
Step 1: 浏览器 DevTools Network Tab
  → 确认是哪个 API 响应慢（响应时间 > 1秒？）
  
Step 2: Actuator Metrics
  → GET /actuator/metrics/http.server.requests
  → 确认服务端处理时间（排除网络延迟）
  
Step 3: OpenTelemetry Trace
  → 在 Jaeger/Zipkin 中搜索该请求的 Trace ID
  → 查看每个 Span 的耗时（DB查询？Redis调用？Kafka发送？）
  
Step 4: 数据库慢查询
  → PostgreSQL: pg_stat_statements 扩展
  → 查看 TOP 10 慢查询
  → 检查是否缺少索引
  
Step 5: Redis 延迟
  → redis-cli --latency
  → 检查是否有 BigKey（MEMORY USAGE key）
  
Step 6: Kafka Consumer Lag
  → Prometheus 指标: kafka_consumer_fetch_manager_records_lag
  → 如果 lag 大，说明消费跟不上生产
  
Step 7: JVM 层面
  → /actuator/metrics/jvm.gc.pause
  → GC 暂停是否过长？
  → /actuator/threaddump 检查线程阻塞
```

### 深挖追问

#### 追问 1：如果定位到是数据库查询慢，怎么优化？

1. **检查执行计划**：`EXPLAIN ANALYZE SELECT ...`，看是否走了索引
2. **检查索引**：UCS 已为关键查询创建了索引，如 `idx_telemetry_uav_time ON telemetry_data (uav_id, time DESC)`
3. **分页查询**：使用 `Pageable` 分页，避免一次加载全部数据
4. **TimescaleDB chunk pruning**：确保查询条件包含 `time` 字段，让 TimescaleDB 只扫描相关 chunk

---

## Q33 — JVM 内存与垃圾回收器

### 场景总览

UCS 使用 Java 21 + Spring Boot 3.x，JVM 配置建议如下。

### 经典场景：K8s 容器中的 JVM 配置

K8s 部署文档中的推荐配置：

```yaml
env:
  - name: JAVA_OPTS
    value: "-Xms512m -Xmx1024m -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
```

| 参数 | 值 | 含义 |
|------|----|----- |
| `-Xms` | 512m | 初始堆内存。设为最大值的一半，避免频繁扩缩 |
| `-Xmx` | 1024m | 最大堆内存。根据 K8s Pod 的 memory limit 设置（建议 limit 的 70%） |
| `-XX:+UseG1GC` | — | 使用 G1 垃圾回收器，适合堆 > 4GB 或对延迟敏感的应用 |
| `-XX:MaxGCPauseMillis` | 200 | G1 的目标最大 GC 暂停时间。200ms 对实时遥测推送可接受 |
| 线程栈内存 | 默认 1MB | 使用虚拟线程后，虚拟线程栈仅几 KB，大幅降低内存占用 |

**为什么选 G1GC？**
- Java 21 默认就是 G1GC
- G1 适合中等堆大小（512MB - 4GB），可以设置暂停时间目标
- 对于更大堆或更低延迟要求，可以考虑 ZGC（`-XX:+UseZGC`）

### 深挖追问

#### 追问 1：虚拟线程对 GC 有什么影响？

虚拟线程降低了 GC 压力：
- 传统平台线程：200 个线程 × 1MB 栈 = 200MB 不在堆上（但线程局部变量在堆上）
- 虚拟线程：栈在堆上分配，但只有几 KB/线程，且空闲时可以被 GC 回收
- 总体效果：更少的固定内存占用，GC 更高效

---

## Q34 — 设计模式的应用

### 场景总览

UCS 项目中使用了以下设计模式：

1. **策略模式（Strategy）**：角色权限策略（`strategy/role/` 包）
2. **工厂模式**：线程池工厂（`namedThreadFactory()`）
3. **观察者模式（Observer）**：Spring ApplicationEvent 发布/订阅
4. **模板方法**：Kafka Consumer 的批量处理模板
5. **责任链模式**：Spring Security Filter Chain

### 经典场景：策略模式 — 角色权限

`strategy/role/` 包下有多个角色策略类：

```java
// PermissionStrategyRouter.java — 路由器（上下文）
public class PermissionStrategyRouter {
    private final Map<String, RolePermissionStrategy> strategies;
    
    public RolePermissionStrategy getStrategy(String roleName) {
        return strategies.get(roleName);
    }
}

// LeaderRoleStrategy.java — 具体策略
public class LeaderRoleStrategy implements RolePermissionStrategy {
    // Leader的权限逻辑
}

// CommanderRoleStrategy.java — 具体策略
public class CommanderRoleStrategy implements RolePermissionStrategy {
    // Commander的权限逻辑
}

// ObserverRoleStrategy.java — 具体策略
public class ObserverRoleStrategy implements RolePermissionStrategy {
    // Observer的权限逻辑
}
```

**策略模式的好处**：新增角色时只需添加一个新的 Strategy 类，不需要修改现有代码（符合开闭原则）。

### 深挖追问

#### 追问 1：Spring Security 的 Filter Chain 是怎么体现责任链模式的？

```
HTTP Request → CORS Filter → CSRF Filter → JwtAuthenticationFilter → Authorization Filter → Controller
```

每个 Filter 独立处理一个关注点（跨域、CSRF、JWT验证、权限检查）。如果某个 Filter 判定请求不合法（如 JWT 无效），直接返回 401，不传递给后续 Filter。这就是责任链——每个节点决定是否处理或传递。

---

## Q35 — Kafka 数据清理策略

### 场景总览

Kafka 的数据清理策略决定了消息在 Broker 上保留多久。

### 经典场景：默认清理配置

Kafka 默认配置（KRaft 模式）：

| 参数 | 默认值 | 含义 |
|------|--------|------|
| `log.retention.hours` | 168（7天） | 消息保留 7 天后自动删除 |
| `log.retention.bytes` | -1（不限制） | 不按大小限制保留 |
| `log.segment.bytes` | 1GB | 每个日志段文件 1GB |
| `log.cleanup.policy` | `delete` | 超过保留期的段直接删除 |

对于遥测 Topic（如 `telemetry.raw`），7 天保留已经足够——持久化由 TimescaleDB 负责，Kafka 只是传输通道。如果需要更快释放磁盘空间，可以缩短保留期到 24 小时。

对于 CDC Topic（`cdc.public.drone_partition_map`），使用 **compact** 策略（每个 key 只保留最新值）更合适，因为 CDC 事件代表的是"最终状态"而非"事件流"。

### 深挖追问

#### 追问 1：如何监控 Kafka 磁盘使用？

通过 Prometheus + kafka_exporter 暴露指标：
- `kafka_log_log_size`：每个 Topic 的磁盘占用
- `kafka_server_brokertopicmetrics_bytesin_total`：入流量
- 设置告警：当 Broker 磁盘使用 > 80% 时告警

---

## Q36 — 分布式事务

### 场景总览

UCS 项目**没有使用传统的分布式事务**（如 2PC、TCC、Saga）。原因：

1. 微服务之间主要通过 Kafka 异步通信，不存在同步 RPC 链路
2. 每个微服务操作自己的数据库 Schema，跨服务的数据一致性通过**最终一致性**保证
3. CDC（Debezium）+ 定期对账确保数据库和缓存之间的一致性

### 经典场景：最终一致性替代分布式事务

以"遥测数据写入"为例：

```
DDS网关 → Kafka telemetry.raw → ucs-telemetry-ingest (Redis状态更新)
                                                     ↓
                               Kafka telemetry.processed → ucs-telemetry-store (TimescaleDB写入)
                                                         → ucs-business (WebSocket推送)
```

这三个服务各自独立消费 Kafka 消息，互不依赖。即使 `ucs-telemetry-store` 写入 TimescaleDB 失败，不影响 `ucs-business` 的 WebSocket 推送。TimescaleDB 的写入失败会在下次重新消费时重试（Kafka offset 未提交）。

### 深挖追问

#### 追问 1：如果真的需要跨服务事务怎么办？

推荐使用 **Saga 模式**（编排式）：
1. 服务 A 完成本地事务 → 发送事件到 Kafka
2. 服务 B 消费事件 → 完成本地事务 → 发送完成事件
3. 如果服务 B 失败 → 发送补偿事件 → 服务 A 执行补偿操作（回滚）

当前 UCS 的架构已经为 Saga 模式做好了基础——Kafka 作为事件总线，各服务独立消费和处理。

---

## Q37 — 限流措施

### 场景总览

UCS 在 API Gateway 层实现了限流：`RateLimitFilter.java`。

### 经典场景：API 网关限流

`ucs-api-gateway/src/main/java/com/ucs/gateway/filter/RateLimitFilter.java`：

基于 Redis 的令牌桶或滑动窗口实现，对每个 API 端点按 IP 或用户 ID 限流。

此外，`application.yml` 中配置了 Resilience4j Bulkhead（隔离舱）：

```yaml
resilience4j:
  bulkhead:
    instances:
      weatherApi:
        maxConcurrentCalls: 5    # 最多5个并发请求
```

**线程池本身也是一种限流**：
- `telemetryProcessorPool`：队列满（1024 条）后丢弃最旧任务
- `websocketPushPool`：队列满（512 条）后调用者线程自己执行（背压）

### 深挖追问

#### 追问 1：限流和熔断有什么区别？

- **限流（Rate Limiting）**：控制单位时间内的请求数量。"每秒最多 100 个请求，超出的直接拒绝"
- **熔断（Circuit Breaking）**：当下游服务故障率超过阈值时，直接拒绝请求，不再尝试调用。"最近 10 次调用有 5 次失败，暂停调用 30 秒"

UCS 的 Resilience4j 配置：

```yaml
resilience4j:
  circuitbreaker:
    instances:
      weatherApi:
        slidingWindowSize: 10           # 滑动窗口10次调用
        failureRateThreshold: 50        # 失败率>50%触发熔断
        waitDurationInOpenState: 30s    # 熔断30秒后尝试半开
```

---

## Q38 — 微服务间远程调用与负载均衡

### 场景总览

UCS 微服务之间**不使用 RPC 远程调用**。通信方式：

1. **异步消息**（主要方式）：通过 Kafka Topic 解耦。服务之间不直接调用，而是通过消息传递
2. **HTTP 调用**（少量）：后端 → DDS 网关的命令下发（`DDS_GATEWAY_COMMAND_URL`）
3. **共享 Redis**：多个服务通过 Redis 共享状态（如心跳、分区映射、在线状态）

### 经典场景：命令下发的 HTTP 降级

`CommandKafkaProducer` 通过 Kafka 发送命令。如果 Kafka 不可用，`ControlService` 降级为直接 HTTP POST：

```java
// Kafka发送失败时的降级路径
dds.gateway.command-url: ${DDS_GATEWAY_COMMAND_URL:http://localhost:5050}
```

**为什么不用 RPC（如 gRPC、Dubbo）？**

1. UCS 的服务间通信模式是**异步事件驱动**而非同步请求-响应
2. 服务数量少（7 个），不需要复杂的服务发现和负载均衡
3. Kafka 天然提供了消息路由、负载均衡（消费者组）、重试（offset 回退）等能力

**负载均衡**：
- K8s Service + Ingress 提供 L4/L7 负载均衡
- Kafka 消费者组天然按分区负载均衡
- 不需要额外的客户端负载均衡（如 Ribbon、LoadBalancer）

### 深挖追问

#### 追问 1：如果后续需要加入 RPC，推荐什么方案？

推荐 **gRPC + Spring Cloud Gateway**：
- gRPC：高性能二进制协议，支持流式通信，适合实时数据传输
- 服务发现：K8s Service（DNS）或 Nacos（如果需要更复杂的路由规则）

---

## Q39 — 自定义异常与异常处理

### 场景总览

UCS 项目中的异常处理策略：

1. **业务逻辑异常**：通过返回值（`boolean false`、`Optional.empty()`）或抛 `RuntimeException` 表达
2. **Kafka 消费异常**：捕获并记录，不影响后续消息消费
3. **Redis 异常**：捕获并降级（如 Epoch 校验失败时放行消息）

### 经典场景：Kafka 消费者的异常隔离

```java
// TelemetryRawConsumer.java
public void consume(ConsumerRecord<String, String> record) {
    try {
        msg = JsonUtil.parse(rawValue, TelemetryMessage.class);
    } catch (Exception e) {
        log.error("[Ingest] JSON parse failed");
        return;  // 跳过这条消息，不影响后续
    }
    
    // Epoch校验 — 异常时继续（可用性优先）
    try {
        if (!epochService.validate(uavId, msg.getEpoch())) return;
    } catch (Exception e) {
        // Continue — don't block forward on epoch errors
    }
    
    // Redis更新 — 异常时继续
    try {
        redisService.updateDroneState(uavId, stateMap);
    } catch (Exception e) {
        log.warn("[Ingest] Redis update failed");
    }
    
    // 关键：转发到 processed — 即使上面都失败，也要转发
    try {
        kafkaTemplate.send(TELEMETRY_PROCESSED, uavId, rawValue);
    } catch (Exception e) {
        log.error("[Ingest] CRITICAL: Failed to forward");
    }
}
```

设计原则：**每个步骤独立 try-catch，前面的失败不阻塞后面的**。最关键的操作（转发消息）放在最后，确保即使 Redis 或 GeoHash 更新失败，消息仍然能到达下游。

### 深挖追问

#### 追问 1：为什么不定义全局异常处理器（@ControllerAdvice）来统一处理？

UCS 的核心数据处理链路不在 HTTP Controller 中，而在 Kafka Consumer 中。`@ControllerAdvice` 只能拦截 Spring MVC 的 Controller 异常，无法处理 Kafka Consumer 中的异常。

对于 HTTP API 层，`@ControllerAdvice` 仍然可以使用——统一包装错误响应为 JSON 格式。但 Kafka Consumer 必须在消费方法内部自行处理异常。

---

## Q40 — Redis 缓存淘汰与过期策略

### 场景总览

Redis 的淘汰策略和过期策略是两个不同的概念：

1. **过期策略**（Key-level TTL）：为 key 设置 TTL，到期后被删除
2. **淘汰策略**（maxmemory-policy）：当 Redis 内存达到 `maxmemory` 限制时，选择哪些 key 驱逐

### 经典场景：UCS 中的 TTL 设置

| Key | TTL | 设置位置 | 原因 |
|-----|-----|---------|------|
| `epoch:{uavId}` | 24 小时 | `EpochValidationService:TTL_HOURS=24` | 无人机离线超过24小时后清理 |
| `drone:{uavId}:online` | 30 秒 | `RedisService:HEARTBEAT_TTL=30s` | 心跳超时自动标记离线 |
| `lock:drone:{uavId}` | 5 秒 | `RedisService:LOCK_TTL=5s` | 分布式锁自动释放 |
| `drone:%s:partitions:null` | 60 秒 | `PartitionRoutingService:NULL_CACHE_TTL=60s` | 空值缓存短时间有效 |
| `token:blacklist:{jti}` | Token剩余有效期 | `JwtUtil` | Token注销后阻止使用 |

**淘汰策略推荐**：`allkeys-lru`（当内存不足时，淘汰最近最少使用的 key）。因为 UCS 的大部分 Redis 数据都有 TTL，`volatile-lru`（只淘汰有 TTL 的 key）也可以。但设成 `noeviction`（不淘汰，内存满时拒绝写入）是危险的——可能导致心跳更新失败，从而误判所有无人机离线。

### 深挖追问

#### 追问 1：Redis 的过期 key 是什么时候被真正删除的？

Redis 使用两种策略组合：
1. **惰性删除**：访问 key 时检查是否过期，过期则删除。优点是不浪费 CPU，缺点是如果 key 永远不被访问就永远不删除
2. **定期删除**：每 100ms 随机抽查 20 个有 TTL 的 key，删除其中已过期的。如果过期率 > 25%，继续抽查

这意味着过期 key 不一定在 TTL 到达的瞬间被删除，可能有几百毫秒的延迟。对 UCS 来说这不影响——心跳超时检测用的是 ZSet score 比较，不依赖 key 的物理删除。

---

## Q41 — 布隆过滤器

### 场景总览

UCS 在 `PartitionRoutingService` 中使用了 Google Guava 的布隆过滤器，用于**缓存穿透防护**（T-14）。

### 经典场景：参数设置与初始化

```java
// PartitionRoutingService.java:88-92
@SuppressWarnings("UnstableApiUsage")
private final BloomFilter<String> droneBloomFilter = BloomFilter.create(
        Funnels.stringFunnel(StandardCharsets.UTF_8),
        100_000,   // expectedInsertions: 预期最大元素数量
        0.01       // fpp: 误判率 (False Positive Probability)
);
```

**参数含义**：
- `expectedInsertions = 100,000`：预期最多存储 10 万个无人机 ID。这决定了底层 bit 数组的大小
- `fpp = 0.01`（1%）：1 万次查询中，约有 100 次会误报"可能存在"（实际不存在）
- 底层 bit 数组大小：约 **120 KB**（`-n * ln(p) / (ln(2))^2` ≈ 958,506 bits ≈ 117 KB）

**初始化**（`PartitionRoutingService.java:115-123`）：

```java
@PostConstruct
public void initBloomFilter() {
    droneRepository.findAll().forEach(drone -> {
        if (drone.getUavId() != null) {
            droneBloomFilter.put(drone.getUavId());
        }
    });
    log.info("[PartitionRouting] Bloom filter initialized with {} drones", droneRepository.count());
}
```

应用启动时，从数据库加载所有已知的 uavId 到布隆过滤器。新无人机注册时（`autoCreateDroneWithDefaultPartitions`），也会 `droneBloomFilter.put(uavId)`。

**布隆过滤器不支持删除**：如果无人机被删除（实际场景中极少发生），布隆过滤器中仍然有该 uavId 的"痕迹"。这只会导致极小概率的额外数据库查询（命中布隆过滤器但数据库没有 → 被空值缓存拦截），不影响正确性。

### 深挖追问

#### 追问 1：为什么选 Guava BloomFilter 而不是 Redis 的 BF.ADD/BF.EXISTS？

| 方案 | 查询延迟 | 共享性 | 复杂度 |
|------|---------|--------|--------|
| Guava BloomFilter（本地） | <1μs（内存操作） | 不共享（每个实例独立） | 低（一行代码） |
| Redis BloomFilter（远程） | ~1ms（网络往返） | 共享（所有实例同一个） | 中等（需要 RedisBloom 模块） |

UCS 选择 Guava 本地布隆过滤器的理由：
1. **性能**：布隆过滤器查询在分区路由的热路径上，每条遥测消息都要查一次。本地 <1μs vs 远程 ~1ms，性能差 1000 倍
2. **可用性**：不依赖 Redis 连接。即使 Redis 宕机，布隆过滤器仍然工作
3. **不需要跨实例共享**：每个实例启动时从数据库加载全量 uavId，各自维护自己的布隆过滤器。新增无人机时，其他实例最多延迟到下次重启才能感知——但空值缓存（60s TTL）已经兜底了这个窗口

#### 追问 2：如果无人机数量超过 10 万怎么办？布隆过滤器会不会失效？

布隆过滤器在元素数量超过 `expectedInsertions` 后不会"失效"，但**误判率会升高**。例如：
- 10 万个元素 + `fpp=0.01` → 实际误判率 ≈ 1%
- 20 万个元素（超出 2 倍）→ 实际误判率 ≈ 5-10%

解决方式：
1. 调大 `expectedInsertions`（如 500,000）——代价是内存从 120KB 增到 ~600KB，可以忽略
2. 使用可伸缩布隆过滤器（Scalable Bloom Filter）——自动扩容

---

## 总结

以上 41 个问题覆盖了 UCS 系统的核心技术栈：

| 技术领域 | 涉及问题 |
|---------|---------|
| **Kafka 消息中间件** | Q1, Q12, Q28, Q35 |
| **Redis 缓存与数据结构** | Q7, Q8, Q21, Q26, Q27, Q40, Q41 |
| **数据库与持久化** | Q5, Q11, Q13, Q14, Q31 |
| **并发与线程模型** | Q3, Q4, Q10, Q19 |
| **WebSocket 实时推送** | Q6, Q9, Q29 |
| **安全与权限** | Q24, Q25 |
| **无人机业务逻辑** | Q2, Q16, Q17, Q18, Q22, Q23 |
| **架构与设计模式** | Q15, Q20, Q30, Q32, Q33, Q34, Q36, Q37, Q38, Q39 |

每个问题都结合了 UCS 项目的**实际代码**（文件路径 + 行号 + 关键配置参数），而非泛泛的理论讲解。双写一致性以 **Debezium 监听 PostgreSQL WAL 日志** 为核心讲解（Q13），配合 Transactional Outbox + Post-Commit Hook 的主路径实现（Q8、Q14），形成完整的数据一致性方案。
