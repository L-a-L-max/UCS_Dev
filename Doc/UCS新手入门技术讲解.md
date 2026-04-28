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

UCS 项目中 Redis 承担了多种角色，**每种数据类型都对应一个明确的业务问题**。本节为每种数据类型独立讲解一个 UCS 中的真实使用场景。

| 数据类型 | UCS 中的代表场景 | 选型核心理由 |
|---------|----------------|------------|
| **String** | 无人机在线状态（`drone:{uavId}:online`，TTL=30s） | 单值存储 + 自带 TTL，最简单高效 |
| **Set** | 分区映射（`drone:{uavId}:partitions`） | 天然去重 + O(1) 成员判定 |
| **Hash** | 无人机实时状态快照（`drone:{uavId}:state`） | 多字段聚合存储，可单字段读写 |
| **ZSet** | 心跳超时检测（`drone:heartbeat`） | 按 score 排序，可范围查询 |
| **GEO** | 半径范围查找无人机（`drone:positions`） | 内置经纬度编码与距离计算 |
| **PubSub** | 跨实例缓存失效广播（`cache:invalidate`） | fire-and-forget，零持久化开销 |

下面按"一种数据类型 = 一个独立场景"展开。

### 场景 A — String：无人机在线状态（TTL 心跳）

**问题**：前端需要快速判断"无人机 px4_1 现在是否在线"，要求 O(1) 查询、自动过期、不依赖定时任务。

**实现**（`RedisService.java:45-48`）：

```java
private static final String DRONE_ONLINE_PREFIX = "drone:%s:online";
private static final Duration HEARTBEAT_TTL = Duration.ofSeconds(30);

public void setDroneOnline(String uavId) {
    String key = String.format(DRONE_ONLINE_PREFIX, uavId);
    stringRedisTemplate.opsForValue().set(key, "true", HEARTBEAT_TTL);
}
```

**关键配置**：
- Key 格式：`drone:px4_1:online`
- Value：固定字符串 `"true"`（不需要其他值，存在即在线）
- TTL：30 秒。每收到一条遥测就 `SET` 刷新 TTL，断流 30 秒后 key 自动消失 → 无人机被判定为离线
- 对应判断：`isDroneOnline(uavId)` → `redisTemplate.hasKey(key)`，O(1)

**为什么不用 Hash 或 Set？** 在线状态本质上是单个布尔值——没有第二个字段需要存。String 的 `SET key value EX seconds` 是 Redis 最优化的命令路径，比 `HSET + EXPIRE` 少一次网络往返。

**为什么不用 ZSet？** ZSet 不支持单个 member 的过期。如果用 ZSet 存"无人机 → 在线时间戳"，离线后必须人工 `ZREM`（这正是 `drone:heartbeat` ZSet 在做的事，但它的目的不是"快速查在线状态"，而是"批量找超时的无人机"——见场景 D）。两个 Key 配合，各司其职。

### 场景 B — Set：无人机分区映射（多对多去重）

**问题**：一架无人机可能同时属于 `observer`、`commander` 两个分区，前端订阅 `commander` 分区时，需要知道有哪些无人机要推送给它。这是典型的**多对多关系**，需要双向查询：
- 给定 uavId → 它属于哪些分区？
- 给定 partition 名 → 它包含哪些无人机？

**实现**（`RedisService.java:128-167`）：

```java
private static final String DRONE_PARTITIONS_PREFIX = "drone:%s:partitions";  // uavId -> partitions
private static final String PARTITION_DRONES_PREFIX = "partition:%s:drones";  // partition -> uavIds

public void setDronePartitions(String uavId, Set<String> partitionNames) {
    String key = String.format(DRONE_PARTITIONS_PREFIX, uavId);
    stringRedisTemplate.delete(key);
    if (!partitionNames.isEmpty()) {
        stringRedisTemplate.opsForSet().add(key, partitionNames.toArray(new String[0]));
    }
}
```

**关键操作**：
- `SADD drone:px4_1:partitions observer commander` — 写入分区列表
- `SMEMBERS drone:px4_1:partitions` — 读取该无人机所属的所有分区，O(N)
- `SISMEMBER drone:px4_1:partitions commander` — 判断是否属于某分区，O(1)
- `SMEMBERS partition:commander:drones` — 反向查询某分区的所有无人机
- 双向 Set 必须**一起更新**，由 `PartitionRoutingService.afterCommit()` 保证原子性

**为什么不用 List？** List 允许重复元素，需要应用层手动去重；且 `LREM` 删除特定元素是 O(N)。Set 的 `SADD/SREM/SISMEMBER` 都是 O(1)，且天然去重——一架无人机不应该被加到 `commander` 分区两次。

**为什么不用 Hash？** Hash 适合"对象字段 → 值"的结构（如无人机状态有 lat/lon/alt 多字段），不适合"集合"语义。如果用 `HSET drone:px4_1:partitions observer 1 commander 1`，本质上是把 Hash 当 Set 用，浪费一倍 value 空间。

### 场景 C — Hash：无人机实时状态快照

**问题**：前端打开"无人机详情"面板时，需要拿到一架无人机的全部最新状态：经度、纬度、海拔、速度、电量、航向、模式…… 总共 8-12 个字段。理想方案是：
- 一次请求拿到所有字段（不能多次往返）
- 但前端某些场景只需要电量字段，希望按需读取
- 后端写入时通常只更新部分字段（如只更新经纬度）

**实现**（`DeviceShadowService.java:96`）：

```java
// 读取整个状态（前端详情面板）
Map<Object, Object> state = redisTemplate.opsForHash().entries("drone:px4_1:state");

// 单字段读取（电量监控）
Object battery = redisTemplate.opsForHash().get("drone:px4_1:state", "battery");

// 写入多个字段（遥测更新）
Map<String, Object> stateMap = Map.of(
    "lat", "39.9",
    "lon", "116.4",
    "alt", "100",
    "battery", "85.5"
);
redisTemplate.opsForHash().putAll("drone:px4_1:state", stateMap);
```

**关键命令**：
- `HSET key field value` — 单字段写入，O(1)
- `HMSET key f1 v1 f2 v2` — 多字段批量写入，O(N)
- `HGET key field` — 单字段读取，O(1)
- `HGETALL key` — 读取全部字段，O(N)，N 是字段数（通常 <20）

**为什么不用多个 String Key？** 如果用 `drone:px4_1:lat`、`drone:px4_1:lon`、`drone:px4_1:alt` 等独立 Key：
- 读取整个状态需要 `MGET` 12 个 Key 或 12 次 `GET`，网络包更大
- 内存占用高得多——每个 Key 都有独立的元数据（TTL、类型、引用计数 …）。Hash 内部用 ziplist/listpack 编码（字段数 <128 时），内存几乎只有原始数据本身的开销
- 无法做"原子读取整个对象"——多个 GET 之间可能读到不同时间点的数据

**为什么不用 String 存 JSON？** 把整个状态序列化为 JSON 存 String 也可行：
- 优点：客户端读取后直接反序列化为对象，无需遍历 Hash 字段
- 缺点：单字段更新需要"读 → 改 → 写回"全量 JSON，并发更新有 Lost-Update 问题
- UCS 选择 Hash 是因为遥测写入频率高（10Hz），且每次只更新少数字段

### 场景 D — ZSet：心跳超时批量检测

**问题**：场景 A 用 String + TTL 解决了"单架无人机是否在线"。但还有另一个需求：每秒一次定时任务要找出**所有**心跳超时（>3 秒未更新）的无人机，统一做下线处理。如果用场景 A 的 String Key，需要 SCAN 几百架无人机的 key，效率太低。

**实现**（`RedisService.java:55-75`）：

```java
private static final String DRONE_HEARTBEAT_ZSET = "drone:heartbeat";

// 心跳更新：ZADD，score = 当前毫秒时间戳
public void updateDroneHeartbeat(String uavId) {
    double nowMs = System.currentTimeMillis();
    stringRedisTemplate.opsForZSet().add(DRONE_HEARTBEAT_ZSET, uavId, nowMs);
}

// 批量找超时：score < (now - 3000) 的所有成员
public Set<String> getTimedOutDrones(long timeoutMs) {
    double cutoff = System.currentTimeMillis() - timeoutMs;
    return stringRedisTemplate.opsForZSet()
            .rangeByScore(DRONE_HEARTBEAT_ZSET, 0, cutoff);
}
```

**关键命令**：
- `ZADD drone:heartbeat 1713578400000 px4_1` — score = 时间戳，相同 member 自动覆盖
- `ZRANGEBYSCORE drone:heartbeat 0 (now-3000ms)` — O(log(N) + M)，一次拿到所有超时成员
- `ZREM drone:heartbeat px4_1` — 离线后清理

**为什么不用 List？** List 没有按值范围查询的能力，需要全量遍历（O(N)）。

**为什么不用扫描 String + TTL？** 见场景 A 的对比——SCAN 是非阻塞但**不保证实时性**，可能漏掉刚过期的 key；ZSet 用一次 `ZRANGEBYSCORE` 就能精确拿到当前所有超时成员。

**ZSet 的另一个优势**：可以分页拿"最久未活跃的 100 架无人机"做监控大屏：

```
ZRANGEBYSCORE drone:heartbeat 0 +inf LIMIT 0 100
```

### 场景 E — GEO：附近无人机查找（半径搜索）

**问题**：操作员点击地图上某个点，希望查询"以该点为中心、5 公里半径内的所有无人机"。这是典型的**地理范围查询**——用 String / Set / Hash 都做不到。

**实现**（`GeoSpatialService.java:51-58`）：

```java
public List<String> findDronesNearby(double lat, double lon, double radiusKm) {
    Circle circle = new Circle(new Point(lon, lat), new Distance(radiusKm, Metrics.KILOMETERS));
    GeoResults<RedisGeoCommands.GeoLocation<String>> results =
            stringRedisTemplate.opsForGeo().radius("drone:positions", circle);
    return results.getContent().stream()
            .map(r -> r.getContent().getName())
            .collect(Collectors.toList());
}

// 写入位置（每条遥测触发）
public void updateDronePosition(String uavId, double lat, double lon) {
    stringRedisTemplate.opsForGeo().add("drone:positions",
            new Point(lon, lat), uavId);
}
```

**关键命令**：
- `GEOADD drone:positions 116.4 39.9 px4_1` — 写入位置（参数顺序：经度 经度 纬度，不是反过来）
- `GEORADIUS drone:positions 116.4 39.9 5 km` — 半径搜索
- `GEODIST drone:positions px4_1 px4_2 km` — 两架无人机的直线距离
- `GEOSEARCH drone:positions FROMLONLAT 116.4 39.9 BYBOX 10 10 km` — 矩形范围搜索（Redis 6.2+）

**底层原理**：GEO 内部是 ZSet——经纬度被编码为 52 位 GeoHash 整数作为 score，member 是 uavId。所以 `GEOADD` 实际等价于一次 ZADD，但 Redis 帮你做了编码。

**为什么不直接用 ZSet 自己编码？** 见 Q7 旧版的追问 1：`GEORADIUS` 涉及多层网格搜索 + 距离过滤，自己实现代码量大且容易错。

**关键配置**：
- 单 Key `drone:positions` 存所有无人机的位置——无人机数量不大（<10 万）时性能足够
- 如果未来需要分区域索引，可以拆成 `drone:positions:beijing`、`drone:positions:shanghai` 等

### 场景 F — PubSub：跨实例缓存失效广播

**问题**：3 个 `ucs-business` 实例都有自己的 L1 Caffeine 本地缓存。当用户修改了 `px4_1` 的分区映射，**写入数据库的实例**会更新自己的 L1 + Redis L2，但**另外两个实例的 L1 仍然是旧值**。怎么通知它们？

**选型对比**：
- 方案 1：让 L1 TTL 设得很短（如 1 秒）——简单但失效不及时
- 方案 2：用消息队列（Kafka）广播——重量级，需要新建 Topic
- 方案 3：用 Redis PubSub——轻量级，已经有 Redis 不增加依赖

UCS 选择了方案 3 + 方案 1 兜底（L1 TTL=10s）。

**实现**（`CacheInvalidationListener.java:24-48`）：

```java
public static final String INVALIDATION_CHANNEL = "cache:invalidate";

@Override
public void onMessage(Message message, byte[] pattern) {
    String payload = new String(message.getBody());  // 格式: "region:key"
    int sep = payload.indexOf(':');
    String region = payload.substring(0, sep);
    String key = payload.substring(sep + 1);
    cacheService.invalidateL1(region, key);  // 仅清除L1
}
```

**写入端发布消息**：

```java
redisTemplate.convertAndSend("cache:invalidate", "partition-map:drone:px4_1:partitions");
```

**关键特性**：
- `PUBLISH` 是 fire-and-forget——发完即忘，不等订阅方响应
- 不持久化——离线的订阅者收不到历史消息
- 这两点对"缓存失效"恰好都是优点：丢一次没关系（L1 有 10 秒 TTL 兜底），不需要持久化（缓存本身就是临时的）

**为什么不用 Stream？** Redis Stream 类似 Kafka——持久化、消费组、ACK 等。它适合"事件溯源"或"任务队列"场景，对"通知所有人立刻清缓存"反而过于重——还要管理 consumer offset、清理历史消息。

### 深挖追问

#### 追问 1：相同的"无人机 ID + 当前位置"用了 Hash（state.lat/lon）和 GEO（positions）两份，会不会数据不一致？

会。这是用空间换查询能力的典型权衡：
- **Hash**：用于详情查询，要包含速度、电量、模式等地理之外的字段
- **GEO**：用于半径搜索，只关心经纬度

**一致性保证**：在 `TelemetryRawConsumer` 处理一条遥测消息时，会**在同一段代码里同时更新两份**：

```java
redisService.updateDroneState(uavId, stateMap);    // Hash
geoSpatialService.updateDronePosition(uavId, lat, lon);  // GEO
```

两次写入在毫秒内完成，期间的极短不一致窗口在业务上可以忽略。如果其中一个写入失败，另一个继续执行——前面的失败会在 100ms 后下一条遥测到达时被覆盖修正。如果想完全杜绝不一致，可以用 Redis 的 MULTI/EXEC 把两个写入放在同一个事务里，但实测对延迟有影响，UCS 选择"最终一致"。

#### 追问 2：Redis Stream 在哪些场景下会比 PubSub 更合适？UCS 为什么不用？

Stream 适合：
1. **任务队列**（消费者集群分摊任务）：Stream 的 Consumer Group 让一条消息只被一个消费者处理，PubSub 是广播
2. **事件溯源**（需要回放历史）：Stream 持久化所有消息，PubSub 只发当前
3. **消费方需要 ACK**：Stream 的 XACK 让生产方知道消息已被处理

UCS 的"缓存失效广播"恰好是**反过来的需求**——所有实例都要收到（广播），不需要历史回放（每次失效都是即时的），不需要 ACK（丢一次有 L1 TTL 兜底）。所以 PubSub 是更轻量的选择。如果未来需要"操作日志推送给所有监控大屏"且要支持断线重连后回放，再考虑 Stream。

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

缓存"三剑客"看名字相似，但**故障原因和防护手段完全不同**。每个问题独立讲一个 UCS 中的真实场景。

| 问题 | 故障特征 | UCS 防护层 | 代表场景 |
|------|---------|----------|---------|
| **缓存穿透** | 查询永远不存在的 key，缓存恒 Miss | 布隆过滤器 + 格式校验 + 空值缓存 | 攻击者用伪造 uavId 暴力刷接口 |
| **缓存击穿** | 单个**热点 key** 过期瞬间，并发同打 DB | Mutex Lock + 逻辑过期 | 全公司监控大屏在看的 px4_001 状态突然过期 |
| **缓存雪崩** | **大量 key** 同时过期，瞬时流量压垮 DB | TTL 抖动 ±30s + 多级缓存 + DB 限流 | 启动预热的 1000 个 key 5 分钟后集中过期 |

### 场景 A — 缓存穿透：伪造 uavId 攻击

**故障**：攻击者构造 1 万个根本不存在的 uavId（`px4_99999999_attack`、`drone_evil_001`），高频调用 `/api/v1/drones/{uavId}/partitions`。每次：
1. L1 没有 → L2 没有 → 数据库查 → 数据库也没有 → 返回空
2. **下次请求又重复同样的流程**——缓存对"空结果"什么都没存

数据库被打穿，CPU 飙到 100%。

**UCS 三层防护**（`PartitionRoutingService.java:82-101`）：

```java
// 第 1 层：格式正则——非法格式直接 reject，连布隆都不查
private static final Pattern VALID_UAV_ID = Pattern.compile(
        "^(px4_\\d+|mav_\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}_\\d+|mavlink_.+)$"
);

// 第 2 层：布隆过滤器——O(1) 判断 uavId 是否"可能存在"
@SuppressWarnings("UnstableApiUsage")
private final BloomFilter<String> droneBloomFilter = BloomFilter.create(
        Funnels.stringFunnel(StandardCharsets.UTF_8),
        100_000,   // 预期最大无人机数量
        0.01       // 1% 误判率
);

// 第 3 层：空值缓存——格式合法、布隆漏过、DB 真不存在 → 缓存 60s 的"null"标记
private static final String NULL_CACHE_PREFIX = "drone:%s:partitions:null";
private static final Duration NULL_CACHE_TTL = Duration.ofSeconds(60);
```

**执行顺序**：

```
请求 /partitions/px4_99999999_attack
    ↓ 1. 格式校验通过（符合 px4_\d+） → 进入第 2 层
    ↓ 2. 布隆 mightContain == false → 立刻返回空（99% 攻击在此被拦）
    ↓ 3. （1% 漏过）空值缓存：GET drone:xxx:partitions:null 存在 → 返回空
    ↓ 4-6. L1/L2/L3 全 Miss → 缓存 60s 的 null 标记 → 下次该 key 命中第 3 层
```

**关键配置**：
- 布隆容量 `100_000`：预留 10 万架无人机的余量（实际 <5000）
- 误判率 `0.01`：120KB 内存换 1% 误判率。降到 0.001% 内存翻倍
- 空值缓存 TTL=60 秒：足够吸收持续攻击，又能在合法新无人机上线后快速失效

**为什么三层都需要？** 单独任何一层都有漏洞：
- 仅格式校验：合法格式但不存在的 uavId 仍会打 DB
- 仅布隆：1% 误判会漏掉攻击；冷启动期间布隆还没填充，全部漏过
- 仅空值缓存：第一次仍会穿透；1 万个不同 uavId 会创建 1 万个缓存 key

### 场景 B — 缓存击穿：热点单 Key 过期瞬间打 DB

**故障**：`drone-state:px4_001` 是头号热点 key，每秒被 200 个并发请求查询（前端、监控大屏、调度服务都在看）。L2 Redis TTL=5 分钟。当 TTL 到期那一毫秒：
1. 200 个线程同时发现 L2 Miss
2. 200 个线程**同时**执行 `db.findById("px4_001")`
3. 数据库该行被重复查 200 次，连接池耗尽

**UCS 双层防护**（`MultiLevelCacheService.java:60-80`）：

```java
// 第 1 层：每 key 的 Mutex Lock
private final ConcurrentMap<String, ReentrantLock> keyLocks = new ConcurrentHashMap<>();
private static final long LOCK_TIMEOUT_MS = 500;

public String getWithMutex(String region, String key, Supplier<String> dbLoader) {
    String value = readL1(region, key);
    if (value != null) return value;
    value = readL2(key);
    if (value != null) return value;

    // L1+L2 都 Miss，竞争锁
    ReentrantLock lock = keyLocks.computeIfAbsent(key, k -> new ReentrantLock());
    if (lock.tryLock(LOCK_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
        try {
            value = readL2(key);            // 双重检查——锁内再读 L2，可能已被别人加载
            if (value != null) return value;
            value = dbLoader.get();         // 只有获得锁的线程查 DB
            if (value != null) writeL1L2(region, key, value);
            return value;
        } finally { lock.unlock(); }
    } else {
        return l1.getIfPresent(key);        // 等不到锁的线程：返回 stale 值，不阻塞
    }
}

// 第 2 层：逻辑过期（不让 key 真正过期）
private static final double LOGICAL_EXPIRY_RATIO = 0.8;  // 物理 TTL 的 80% 算"逻辑过期"

public String getLogical(String key, Supplier<String> dbLoader) {
    String value = readL2(key);  // 物理 TTL=5min，物理上不会过期到 0
    if (value != null) {
        if (isLogicallyExpired(key)) {
            asyncRefresh(key, dbLoader);  // 后台异步刷新
        }
        return value;  // 用户立刻拿到旧值，不阻塞
    }
    return getWithMutex(...);
}
```

**关键配置**：
- `LOCK_TIMEOUT_MS=500`：等不到锁就返回 stale 值或 null。延迟可控
- `LOGICAL_EXPIRY_RATIO=0.8`：物理 TTL=300s，逻辑过期=240s。提前 60 秒触发后台刷新——绝大多数读永远遇不到"真过期"
- 用 `ConcurrentMap<String, ReentrantLock>` 而不是 `synchronized(key.intern())`：String.intern() 的全局表会污染元空间

**Mutex 与逻辑过期的关系**：
- Mutex 解决"同时打 DB"——只让一个线程查
- 逻辑过期解决"用户等 DB"——查的过程中其他用户用旧值

两层叠加，热点 key 几乎不会有"等 DB"的延迟尖刺。

### 场景 C — 缓存雪崩：批量 Key 同时过期

**故障**：服务启动时执行了一次"预热"——把 1000 架无人机的分区映射全部加载到 Redis，TTL 都是精确的 5 分钟。**5 分钟后这 1000 个 key 几乎同一秒过期**：
- 1000 架无人机 × 平均 5 QPS = 5000 QPS 同时打到 DB
- 数据库瞬间过载，连锁影响其他服务

**UCS 三层防护**：

#### 第 1 层：TTL 随机抖动（写入端）（`MultiLevelCacheService.java:73-76`）

```java
private static final long L2_BASE_TTL_SECONDS = 300;
private static final long L2_TTL_JITTER_SECONDS = 30;

private long computeTTL() {
    long jitter = ThreadLocalRandom.current()
            .nextLong(-L2_TTL_JITTER_SECONDS, L2_TTL_JITTER_SECONDS + 1);
    return L2_BASE_TTL_SECONDS + jitter;  // 270s ~ 330s
}
```

效果：1000 个 key 的过期时间分散在 60 秒区间内，平均每秒只有 ~17 个 key 过期。

#### 第 2 层：多级缓存（读取端）

即使 L2 过期，L1 Caffeine 还有 10 秒 TTL（且各实例独立、随机）。读请求先打 L1，能吸收一部分。

#### 第 3 层：DB 限流降级（兜底）

`MultiLevelCacheService.java:107-117`——L2 Redis 异常时**不抛异常**，直接降级到 L3：

```java
try {
    value = redisTemplate.opsForValue().get(key);
    if (value != null) { ... }
} catch (Exception e) {
    log.debug("[Cache] L2 unavailable, falling through to DB: {}", e.getMessage());
}
// 走 dbLoader，失败也不传播给上层
```

如果数据库也撑不住，调用方的熔断器（Resilience4j）会跳闸——返回降级值（空 List 或最近一次成功的快照）。

**为什么这三层都需要？**
- 没第 1 层：所有 key 同时过期，瞬间 5000 QPS 打 DB
- 没第 2 层：哪怕分散过期，每个 key 仍可能被并发 5 次查 DB（mutex 是 Q21-B 的方案，要叠加）
- 没第 3 层：DB 真挂时整个调用链失败，雪崩传染上游服务

### 三剑客对比

| 特征 | 穿透 | 击穿 | 雪崩 |
|------|------|------|------|
| 涉及 key 数 | 多个不存在的 key | 单个热点 key | 大量同时存在的 key |
| 故障触发时刻 | 任何时刻 | key 过期瞬间 | 多个 key 集中过期瞬间 |
| 主防御 | 布隆 + 空值缓存 | Mutex + 逻辑过期 | TTL 抖动 + 限流 |
| 隐含原因 | 业务/攻击 | 设计上没想过 key 会过期 | 集中预热 / 同时写入 |

### 深挖追问

#### 追问 1：布隆过滤器的 1% 误判率会不会导致问题？

布隆过滤器只有**误判为存在**（实际不存在但说"可能存在"），不会**误判为不存在**——这是它的数学保证。"实际存在的 uavId 一定不会被布隆错杀"，业务正确性没问题。

1% 的误判率意味着：100 个恶意伪造的 uavId 中，有 1 个会"漏过"布隆。但这 1 个会被空值缓存拦截（第一次进 DB 后被记成 null 标记，第二次直接命中）。所以实际能持续打到 DB 的攻击量 = 攻击 QPS × 1% × （1 - 空值缓存命中率） ≈ 攻击 QPS × 0.01%——可以忽略。

10 万容量 + 1% 误判率的布隆过滤器约占 120KB 内存。降到 0.1% 误判率内存翻倍——对 UCS 不必要。

#### 追问 2：Mutex Lock 用 ReentrantLock 还是 Redis 分布式锁？

UCS 在 `MultiLevelCacheService` 里用的是 **JVM 内的 ReentrantLock**（`ConcurrentMap<String, ReentrantLock>`）——而**不是** Redis 分布式锁。

- 缓存击穿是"单实例"问题——同一个 JVM 里的 200 个线程同时打 DB。每实例独立加 ReentrantLock 已经把 200 个并发降到 1 个
- 用 Redis 分布式锁多 1 次网络 RTT（约 1ms），ReentrantLock 是纳秒级
- 多实例间的"重复查 DB"代价低——3 个实例 × 1 次查询 = 3 次查询，DB 完全能扛
- 业务正确性不依赖跨实例独占——重复加载只是浪费 CPU，不会写错数据

**何时才必须用分布式锁？** 如果加载到缓存的过程**有副作用**（生成新订单号、消耗配额），必须分布式锁防止重复。但缓存场景的"加载"是幂等的——重复几次结果一样。JVM 内锁就够。

---

## Q22 — 电子围栏（地理围栏）

### 场景总览

`GeofenceService` 支持三种围栏类型，**每种类型解决的业务问题不同**，本节为每种类型独立讲一个 UCS 中的真实场景。

| 类型 | 语义 | 越界判定 | 告警等级 | 代表场景 |
|------|------|---------|---------|---------|
| **INCLUSION**（包含区） | 无人机**必须在区域内**飞行 | 离开 = 违规 | WARNING | 演练空域 / 飞行许可区 |
| **EXCLUSION**（禁飞区） | 无人机**禁止进入**区域 | 进入 = 违规 | CRITICAL | 机场净空区 / 军事禁飞 |
| **ALERT**（监控区） | 无人机进入触发**软提醒** | 进入 = 告警 | INFO | 敏感设施周边 / 人员密集区 |

围栏形状支持两种：
- **CIRCLE**：圆心 + 半径（Haversine 公式计算距离）
- **POLYGON**：多边形顶点列表（射线法 Ray-Casting 判断点是否在多边形内）

下面"一种类型 = 一个独立场景"展开。

### 场景 A — INCLUSION 区：飞行许可空域守界

**问题**：演练前为团队申请了一片 2km × 2km 的合法空域。所有无人机必须在此范围内飞行——出去就是违规（影响民航/影响他队）。如果无人机被风吹出边界，需要立刻告警让操作员拉回来。

**判定逻辑**（`GeofenceService.java:82-133`）：

```java
case "INCLUSION" -> {
    if (!inside) breached = true;  // 不在区域内 = 违规
}
```

**关键代码**（多边形射线法）：

```java
private boolean isInsidePolygon(double lat, double lon, List<double[]> vertices) {
    int n = vertices.size();
    boolean inside = false;
    for (int i = 0, j = n - 1; i < n; j = i++) {
        double[] vi = vertices.get(i), vj = vertices.get(j);
        // 射线法：从测试点向右发射射线，计算与多边形边的交点数
        // 奇数次相交 = 在内部，偶数次 = 在外部
        if (((vi[1] > lon) != (vj[1] > lon)) &&
            (lat < (vj[0] - vi[0]) * (lon - vi[1]) / (vj[1] - vi[1]) + vi[0])) {
            inside = !inside;
        }
    }
    return inside;
}
```

**关键配置**：
- 高度约束：`minAlt=0, maxAlt=120m`（中国民航法规：消费级无人机不得超 120m）
- 告警等级：WARNING（不是 CRITICAL——属于"应该回来"而不是"立刻坠落"级别）
- 去重：同一架无人机短时间多次跨界只生成一个事件

**为什么不强制立刻 RTL（自动返航）？** INCLUSION 区的越界可能是因为风、信号丢失、操作员失误等多种原因——交给操作员判断更安全。强制返航在某些场景下反而有风险（比如返航路径正好穿过另一个 EXCLUSION 区）。

### 场景 B — EXCLUSION 区：机场净空保护

**问题**：演练区域附近有一个民用机场，其净空区半径 5km、高度限制 0-450m 是国家法规规定的硬约束。任何无人机**绝对不能进入**——一旦进入要立刻最高等级告警，并由调度系统自动触发紧急返航。

**判定逻辑**（与 INCLUSION 相反）：

```java
case "EXCLUSION" -> {
    if (inside) breached = true;  // 进入区域 = 违规
}
```

**圆形围栏的判定**（Haversine 距离）：

```java
private boolean isInsideCircle(double lat, double lon, GeofenceZone zone) {
    double R = 6371000;  // 地球半径（米）
    double lat1 = Math.toRadians(zone.getCenterLat());
    double lat2 = Math.toRadians(lat);
    double dLat = lat2 - lat1;
    double dLon = Math.toRadians(lon - zone.getCenterLon());
    double a = Math.sin(dLat/2) * Math.sin(dLat/2)
             + Math.cos(lat1) * Math.cos(lat2)
             * Math.sin(dLon/2) * Math.sin(dLon/2);
    double distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return distance <= zone.getRadius();
}
```

**告警差异**（`GeofenceService.java:124`）：

```java
event.setSeverity(zone.getType().equals("EXCLUSION") ? "CRITICAL" : "WARNING");
```

CRITICAL 事件会触发额外动作：
1. WebSocket 立刻推送红色弹窗到所有相关操作员
2. Kafka `events.drone.critical` Topic（独立 Topic 提高优先级）
3. 触发预设的紧急响应规则——可在 `EmergencyResponseService` 中配置自动 RTL 或自动悬停

**关键配置**：
- 半径：5000m（民航法规要求）
- 高度：minAlt=0, maxAlt=450m（飞机起降高度）
- 告警等级：CRITICAL
- 不允许例外：EXCLUSION 区的违规事件**永远不会被静默**——即使是同一架无人机重复违规

**为什么用圆而不是多边形？** 机场净空区在法规上就是用圆心 + 半径定义的——直接对齐法规更清晰。城市里的禁飞区往往是不规则的（沿街道边界），那时用 POLYGON。

### 场景 C — ALERT 区：人员密集区软提醒

**问题**：演练场地旁边有一个小学校园——它不是法规禁飞区（不需要硬性禁止），但操作员需要被提醒"附近有学校，注意飞行高度和噪声，避免拍到敏感画面"。这种"软约束"如果用 EXCLUSION 来表达，会让操作员被红色弹窗淹没；用 INCLUSION 又语义不对。

**ALERT 类型就是为这种"提示"场景设计的**：

```java
case "ALERT" -> {
    if (inside) breached = true;  // 进入区域 = 告警（不是违规）
}
```

**告警差异**：
- 严重级别：WARNING（黄色提示，不是红色弹窗）
- 操作员可以选择确认告警继续飞行，或主动避开
- 不触发自动 RTL

**关键配置**：
- 形状：通常是 POLYGON（沿学校围墙）
- 高度：可不设（任何高度进入都提醒）
- 去重间隔：建议设为 5 分钟（避免一次飞行触发多次提示）

### 三种类型对比

| 维度 | INCLUSION | EXCLUSION | ALERT |
|------|-----------|-----------|-------|
| 业务语义 | 必须留在内 | 必须留在外 | 提醒注意 |
| 越界条件 | `!inside` | `inside` | `inside` |
| 告警级别 | WARNING | CRITICAL | INFO/WARNING |
| 是否触发自动响应 | 不 | 是（紧急 RTL） | 不 |
| 典型形状 | POLYGON（任务空域） | CIRCLE（机场） | POLYGON（学校/园区） |

### 越界事件的去重逻辑

`GeofenceService.java:115-122`：

```java
Set<String> currentBreaches = droneBreachState.computeIfAbsent(
        uavId, k -> ConcurrentHashMap.newKeySet());
if (currentBreaches.add(zone.getFenceId())) {
    // 新违规事件——只在 add 返回 true（即首次进入）时生成 event
    breaches.add(event);
}
```

逻辑：用一个 `Set<fenceId>` 记录"此无人机当前正在违规的围栏"。
- 首次跨界 → `add()` 返回 true → 生成 event
- 持续在围栏内（每秒收到位置） → `add()` 返回 false → **不再重复发 event**
- 离开围栏后 → 在另一段代码里 `remove(fenceId)` → 下次再进时又会触发

这避免了"无人机在 EXCLUSION 区内悬停 10 秒就生成 100 个 CRITICAL 事件"的告警风暴。

### 深挖追问

#### 追问 1：检测到越界后，系统会自动控制无人机返航吗？

当前实现中，`GeofenceService` 只负责**检测和告警**——生成 `GeofenceBreachEvent` 并通过 `ApplicationEventPublisher` 发布。是否自动执行返航命令（RTL）取决于：

1. **告警等级**：CRITICAL 事件（EXCLUSION 区）由 `EmergencyResponseService` 监听，可配置触发自动 RTL
2. **业务规则**：可以在数据库 `geofence_zones.auto_rtl_on_breach` 字段配置每个围栏的响应策略
3. **操作员授权**：高危机型必须人工确认才能远程控制——纯自动 RTL 在军事/民航领域有合规要求

告警信息默认通过 WebSocket 推送（`/topic/drone-status`）和 Kafka `events.drone` Topic 广播，由操作员决定下一步动作。这是**半自动化**设计——避免误判导致的更危险后果。

#### 追问 2：射线法 vs `JTS` 几何库？为什么自己实现而不是用成熟的库？

**射线法的优点**：
- 实现简单（约 15 行代码），无外部依赖
- 性能足够好——单次判定 O(N)，N 是顶点数。大多数围栏 N < 20
- 不需要预处理（如建 R-Tree 索引）

**JTS 库的优势场景**（UCS 没用）：
- 需要复杂的几何运算（求交集、并集、差集）
- 围栏数量 > 1000 且需要"找出无人机在哪个围栏内"——JTS 能用 STRtree 索引把查询从 O(F×V) 降到 O(log F × V)，F 是围栏数
- 需要 GeoJSON / WKT 格式互转

**UCS 的取舍**：当前围栏数量 < 50，每次位置更新对所有围栏全扫一遍才约 750 次距离计算（50 围栏 × 平均 15 顶点）——50 微秒以内完成。引入 JTS 反而增加了 ~3MB jar 依赖和学习成本，得不偿失。如果未来围栏数量超过 500 才考虑切换。

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

## Q26 — Redis 进阶命令与特性

### 场景总览

Q7 已经覆盖了 6 种数据类型的代表场景。本题补充 UCS 中用到的 **Redis 高级特性**——这些特性不是新的数据类型，而是**操作数据的方式**。每种特性都有自己的最适场景：

| 特性 | UCS 中的代表场景 | 解决的核心问题 |
|------|---------------|--------------|
| **SETNX / SET NX EX** | 分布式锁（`lock:drone:{uavId}`） | 多实例间的互斥 |
| **Lua 脚本** | Epoch 原子比较+更新 | 多步操作的原子性 |
| **Pipeline** | 批量心跳更新 | 减少网络 RTT |
| **SCAN** | 遍历在线无人机 keys | 替代危险的 KEYS |
| **MULTI/EXEC 事务** | 分区映射双向 Set 一起改 | 多 Key 的原子可见 |
| **过期事件 / Keyspace Notification** | 监听 epoch 失效 | 异步触发清理 |

下面"一个特性 = 一个独立场景"展开。

### 场景 A — SET NX EX：无人机控制权分布式锁

**问题**：A 操作员请求接管 `px4_1` 的同一时刻，B 操作员也提交了接管请求。两个 `ucs-business` 实例都在处理，谁能成功？

**实现**（`PartitionRoutingService.java` 风格）：

```java
String lockKey = "lock:drone:" + uavId;
Boolean acquired = redisTemplate.opsForValue()
        .setIfAbsent(lockKey, currentUserId, Duration.ofSeconds(5));
if (!Boolean.TRUE.equals(acquired)) {
    throw new ConcurrentControlException("无人机正被其他用户接管，请重试");
}
try {
    transferControl(uavId, currentUserId);
} finally {
    // Lua 脚本释放：仅当 value == currentUserId 时才删除（防止误删别人的锁）
    String script = "if redis.call('get', KEYS[1]) == ARGV[1] " +
                    "then return redis.call('del', KEYS[1]) else return 0 end";
    redisTemplate.execute(new DefaultRedisScript<>(script, Long.class),
            List.of(lockKey), currentUserId);
}
```

**关键配置**：
- `SET NX EX 5` 一条命令完成"键不存在则设置 + 5 秒过期"——原子操作，宕机后锁自动释放
- TTL=5 秒：足够 transferControl 完成（实测 50-200ms），又能避免实例崩溃后锁被永久占用
- value=`currentUserId`：用于释放时校验"是不是我加的锁"

**为什么 TTL 这么短？** 业务操作本身只要几百毫秒。如果实例崩溃，锁会在最多 5 秒后释放——业务侧的"接管失败"提示一次重试即可。如果 TTL 设为 30 秒，崩溃后用户要等 30 秒才能重试。

### 场景 B — Lua 脚本：Epoch 原子"读 + 比较 + 更新"

**问题**：当无人机切换控制权（A 操作员交给 B），系统需要让旧的 epoch 失效。流程是"读取当前 epoch → 与传入 epoch 比较 → 如果传入的更新就写入"。如果用三条独立命令（GET → 应用层比较 → SET），中间可能被另一个线程插入更新，造成 lost-update。

**实现**（`EpochValidationService.java` 风格）：

```java
private static final String CAS_EPOCH_SCRIPT =
    "local current = redis.call('GET', KEYS[1]) " +
    "if current == false or tonumber(ARGV[1]) > tonumber(current) then " +
    "  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2]) " +
    "  return 1 " +
    "else return 0 end";

public boolean compareAndUpdateEpoch(String uavId, long newEpoch) {
    Long result = redisTemplate.execute(
        new DefaultRedisScript<>(CAS_EPOCH_SCRIPT, Long.class),
        List.of("epoch:" + uavId),
        String.valueOf(newEpoch),
        String.valueOf(86400)  // TTL 24 小时
    );
    return result != null && result == 1L;
}
```

**Lua 脚本的核心保证**：Redis 单线程执行，整个脚本作为**一个原子操作**——执行期间不会有任何其他命令插入。

**为什么不用 MULTI/EXEC？** MULTI/EXEC 不能在事务**内部根据中间结果做条件分支**——所有命令在 EXEC 时一起执行，无法实现"如果 A 成立才执行 B"。Lua 脚本可以。

**为什么不用 WATCH + 乐观锁？** WATCH 是"监视 + 失败重试"模式，性能差且代码繁琐。Lua 一次完成，简单可靠。

### 场景 C — Pipeline：批量心跳写入

**问题**：DDS 网关每秒收到几百架无人机的心跳消息，每架要更新两个 Redis Key（`drone:heartbeat` ZSet + `drone:{uavId}:online` String）。如果一架一架地发命令，每次都有一个 RTT（约 0.5-1ms），200 架无人机 = 400 个 RTT = 200-400ms 全花在网络上。

**实现**：

```java
redisTemplate.executePipelined((RedisCallback<Object>) connection -> {
    StringRedisConnection conn = (StringRedisConnection) connection;
    long nowMs = System.currentTimeMillis();
    for (HeartbeatBatch batch : batches) {
        conn.zAdd("drone:heartbeat", nowMs, batch.uavId);
        conn.set("drone:" + batch.uavId + ":online", "true",
                 Expiration.seconds(30), RedisStringCommands.SetOption.UPSERT);
    }
    return null;
});
```

**关键特性**：
- **Pipeline 不是事务**——命令打包发送，但 Redis 仍按到达顺序逐条执行，期间可能穿插其他客户端命令
- 客户端把 N 条命令一次性发出，Redis 执行完后一次性返回所有响应——RTT 从 N 次降到 1 次
- 实测：200 架无人机心跳，单条命令 ~250ms → Pipeline ~5ms

**Pipeline vs MULTI/EXEC vs Lua**：

| 方式 | 原子性 | 网络优化 | 适用场景 |
|------|-------|---------|---------|
| 单条命令 × N | 单命令原子 | N 次 RTT | 命令很少时 |
| Pipeline | 每条单独原子 | 1 次 RTT | 大批同类操作，**互不依赖** |
| MULTI/EXEC | 整体原子 | 1 次 RTT | 多命令必须**一起成功**或全失败 |
| Lua 脚本 | 整体原子 | 1 次 RTT | 多命令有**条件分支** |

心跳更新选 Pipeline 是因为：每条心跳之间互相独立，不需要原子性，只追求吞吐。

### 场景 D — SCAN：遍历在线无人机（替代 KEYS）

**问题**：`GatewayHealthMonitor` 需要扫描所有 `drone:*:online` keys 判断哪些无人机在线。Redis 的 `KEYS pattern` 命令会**阻塞整个 Redis 实例**直到扫描完——如果有 100 万个 key，可能阻塞几秒，期间所有其他命令都被拖慢。

**实现**（`RedisService.java:104-121`）：

```java
public Set<String> getAllOnlineDroneIds() {
    Set<String> onlineDrones = new HashSet<>();
    Set<String> keys = stringRedisTemplate.keys("drone:*:online");  // 当前实现
    if (keys != null) {
        for (String key : keys) {
            String[] parts = key.split(":");
            if (parts.length >= 3) onlineDrones.add(parts[1]);
        }
    }
    return onlineDrones;
}
```

**当前代码用了 `keys()`——这在 Key 数量大时是危险的**。生产环境推荐改造为 SCAN：

```java
public Set<String> getAllOnlineDroneIdsSafe() {
    Set<String> onlineDrones = new HashSet<>();
    ScanOptions options = ScanOptions.scanOptions()
            .match("drone:*:online")
            .count(100)  // 每次返回大约 100 条，分多次调用
            .build();
    try (Cursor<String> cursor = stringRedisTemplate.scan(options)) {
        while (cursor.hasNext()) {
            String key = cursor.next();
            String[] parts = key.split(":");
            if (parts.length >= 3) onlineDrones.add(parts[1]);
        }
    }
    return onlineDrones;
}
```

**关键点**：
- SCAN 是**游标式**遍历——每次返回少量结果 + 下一次的游标，不会阻塞 Redis
- `count` 是建议值不是精确值，实际返回数量可能略多或略少
- SCAN 在遍历过程中**不保证一致性**——可能漏掉刚插入的 key 或重复返回同一个 key（业务侧通过 Set 自动去重处理）

**为什么 UCS 当前还在用 keys()？** 因为在线无人机数量目前 <1 万，一次 KEYS 大约 5ms，影响可控。生产环境上量后必须切换到 SCAN——这是 K8s 部署文档里列的"运维 Runbook"待办项之一。

### 场景 E — MULTI/EXEC：分区映射双 Set 原子写

**问题**：场景 B（Q7）说过分区映射要双向维护 `drone:{uavId}:partitions` 和 `partition:{name}:drones` 两个 Set。如果先 SADD 第一个、再 SADD 第二个，中间客户端崩了，就出现"无人机表里有这个分区，但分区表里没有这架无人机"的状态。

**实现**：

```java
redisTemplate.execute(new SessionCallback<List<Object>>() {
    @Override
    public List<Object> execute(RedisOperations operations) {
        operations.multi();
        operations.opsForSet().add("drone:" + uavId + ":partitions", "commander");
        operations.opsForSet().add("partition:commander:drones", uavId);
        return operations.exec();
    }
});
```

**MULTI/EXEC 的语义**：
- 命令进入队列，直到 EXEC 才一起执行
- 单个 Redis 实例下，EXEC 是原子的——其他客户端在 EXEC 期间看不到中间状态
- **不保证回滚**——如果某个命令业务上失败（如 `INCR` 一个非数字 Key），其他命令仍会执行。但语法错误会让整个事务被拒绝

**Cluster 模式下的限制**：MULTI/EXEC 要求所有 Key 在同一个 slot。`drone:px4_1:partitions` 和 `partition:commander:drones` 通常不在同一个 slot——所以 UCS 在选 Sentinel（不分片）而不是 Cluster 时，这正是考量之一。

### 场景 F — Keyspace Notifications：监听 Epoch 失效

**问题**：当 `epoch:px4_1` 过期（24 小时未更新），系统希望感知到并触发"该无人机长时间不活跃，归档相关日志"的逻辑。轮询每个 epoch 的 TTL 太低效。

**配置**（Redis 服务端）：

```
CONFIG SET notify-keyspace-events Ex
# E = Keyevent events; x = expired events
# 等价的 redis.conf 配置：notify-keyspace-events Ex
```

**Java 监听**：

```java
@Configuration
public class KeyExpirationConfig {
    @Bean
    public RedisMessageListenerContainer expirationListenerContainer(
            RedisConnectionFactory cf, EpochExpiredHandler handler) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(cf);
        container.addMessageListener(handler,
                new PatternTopic("__keyevent@0__:expired"));
        return container;
    }
}

@Component
public class EpochExpiredHandler implements MessageListener {
    @Override
    public void onMessage(Message message, byte[] pattern) {
        String expiredKey = new String(message.getBody());
        if (expiredKey.startsWith("epoch:")) {
            String uavId = expiredKey.substring("epoch:".length());
            log.info("[Epoch] {} 长时间未活跃，触发清理", uavId);
        }
    }
}
```

**关键限制**：
- Keyspace Notifications **不保证投递**——Redis 重启或客户端断线时，期间过期的事件会丢失
- 不持久化——所以重要清理逻辑还要配合定时任务做兜底
- 默认关闭，必须 `CONFIG SET notify-keyspace-events` 开启

UCS 当前未启用此功能（用定时任务做对账）。本题列出是为了说明"Redis 还有这种轻量级事件机制"——客户对"什么时候必须用这个 vs 定时任务" 容易追问。

### 深挖追问

#### 追问 1：Pipeline 中如果某条命令失败（比如类型错误），后续命令还会执行吗？

会。Pipeline 不是事务——服务端按顺序逐条处理，每条命令独立成功或失败。客户端拿到的是一个 List<Object>，每个元素对应一条命令的返回值（成功值或异常）。

这与 MULTI/EXEC 不同——后者中如果有命令在入队阶段（QUEUED）就语法错误，整个事务被拒绝；如果是运行时错误（如 `INCR` 字符串），其他命令仍执行（但 EXEC 返回值里能看到那条出错）。

UCS 心跳批量场景容忍极少数失败——某次 ZADD 失败下次重试覆盖即可，所以选 Pipeline。如果是"扣库存 + 写订单"这种必须同生死的，必须用 MULTI/EXEC 或 Lua。

#### 追问 2：Lua 脚本在 Cluster 模式下需要注意什么？

**KEYS 全部在同一个 slot**：Cluster 用 CRC16 把 16384 个 slot 分配到不同节点。Lua 脚本要求 `KEYS[1..N]` **全部映射到同一个节点**，否则报 `CROSSSLOT` 错误。

**解决方案**：
1. 使用 **Hash Tag**：`{drone:px4_1}:online`、`{drone:px4_1}:state`——花括号内的部分参与 hash 计算，相同 tag 的 Key 必然在同一 slot
2. 业务上拆分脚本：每个 Lua 只操作一个 Key，多个独立调用
3. 改用 Sentinel 模式（不分片，UCS 的选择）

**ARGV 不参与 slot 计算**：所以 ARGV 可以传任意值，只有 KEYS 数组受限制。

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

UCS 项目中使用了以下设计模式，**每种模式都有自己最契合的业务场景**。本节为每种模式独立讲一个 UCS 中真实存在或最适合的场景。

| 设计模式 | UCS 中的代表场景 | 在哪里 |
|---------|---------------|-------|
| **策略模式** A | 用户角色权限策略（4 种角色） | `strategy/role/` |
| **策略模式** B | 地图服务商策略（高德/Mapbox/Google） | `strategy/map/` |
| **策略模式** C | 网关下发策略（MAVLink/DDS） | `strategy/gateway/` |
| **工厂模式** | 命名线程池工厂 | `ThreadPoolConfig.namedThreadFactory()` |
| **观察者模式** | Spring ApplicationEvent + Redis PubSub | `CacheInvalidationListener` |
| **模板方法** | Kafka Consumer 批量处理流水线 | `@KafkaListener` 框架 |
| **责任链模式** | Spring Security Filter Chain | `SecurityConfig.filterChain()` |
| **单例模式** | Spring `@Service`/`@Component` Bean | 默认作用域 |
| **门面模式** | `RedisService` 封装多种数据类型 | `business/service/RedisService.java` |
| **建造者模式** | JWT Token 链式构建 | `JwtUtil.buildToken()` |
| **适配器模式** | Kafka 失败时降级到 HTTP | `MavlinkGatewayStrategy.sendCommand()` |

策略模式在 UCS 中出现了 3 次（角色、地图、网关），但**每次解决的业务问题不同**，因此分别讲。

### 场景 A — 策略模式 / 角色权限：4 种角色的不同行为

**问题**：系统有队长（LEADER）、指挥官（COMMANDER）、操作员（PILOT）、观察员（OBSERVER）四种角色，权限差异巨大：
- 队长能下任务、转移控制权、看遥测
- 指挥官能跨团队下指令、看全局
- 操作员只能控制被分配的无人机
- 观察员只能看，不能动

如果用 `if-else` 串起来，每加一种角色都要改 `PermissionService` 的源码——违反开闭原则。

**实现**（统一接口 `RolePermissionStrategy.java`）：

```java
public interface RolePermissionStrategy {
    String getRoleName();
    String getDisplayName();
    boolean hasPermission(String action);
    Set<String> getAllowedMenus();
}
```

**具体策略**（`LeaderRoleStrategy.java:19-51`）：

```java
@Component
public class LeaderRoleStrategy implements RolePermissionStrategy {
    private static final Set<String> ALLOWED_ACTIONS = Set.of(
            "CONTROL_DRONE", "VIEW_TELEMETRY", "TRANSFER_PERMISSION",
            "MANAGE_TEAM", "ASSIGN_TASK", "VIEW_MAP",
            "VIEW_DASHBOARD", "VIEW_MONITOR"
    );
    @Override public String getRoleName() { return "LEADER"; }
    @Override public boolean hasPermission(String action) {
        if (action.startsWith("VIEW_") || action.startsWith("READ_")) return true;
        return ALLOWED_ACTIONS.contains(action);
    }
}
```

**Spring 自动收集所有策略到上下文**：

```java
@Service
public class PermissionService {
    private final Map<String, RolePermissionStrategy> strategies;
    public PermissionService(List<RolePermissionStrategy> all) {
        // Spring 自动注入所有 RolePermissionStrategy 实现
        this.strategies = all.stream().collect(
            Collectors.toMap(RolePermissionStrategy::getRoleName, Function.identity()));
    }
    public boolean checkPermission(String roleName, String action) {
        RolePermissionStrategy s = strategies.get(roleName);
        return s != null && s.hasPermission(action);
    }
}
```

**新增"飞行教官（INSTRUCTOR）"角色只需新建一个类**——零改动现有代码。

### 场景 B — 策略模式 / 地图服务商：可热切换的地图源

**问题**：UCS 部署在不同区域时，地图源选择不同：
- 国内默认用高德地图（GCJ02 坐标系）
- 国外用 Google Maps 或 Mapbox（WGS84 坐标系）
- 离线版可能用本地切片服务

每个地图服务商的 Tile URL 拼接、Geocoding API、坐标系都不一样，但**业务代码不应该感知这些差异**——前端只调用 `mapService.getTileUrl(x, y, z, "satellite")`。

**统一接口**：

```java
public interface MapProviderStrategy {
    String getProviderName();
    String getTileUrl(int x, int y, int z, String style);
    double[] geocode(String address);
    String reverseGeocode(double lat, double lng);
    String getCoordinateSystem();  // GCJ02 / WGS84 / BD09
    int getMaxZoom();
}
```

**通过 `@ConditionalOnProperty` 实现配置驱动激活**（`AmapProviderStrategy.java:18`）：

```java
@Component
@ConditionalOnProperty(name = "map.provider", havingValue = "AMAP", matchIfMissing = true)
public class AmapProviderStrategy implements MapProviderStrategy {
    @Override public String getTileUrl(int x, int y, int z, String style) {
        int serverIndex = (x + y) % 4 + 1;  // 高德的 4 台 CDN 服务器轮询
        return String.format("https://webrd0%d.is.autonavi.com/appmaptile?x=%d&y=%d&z=%d&style=%s",
                serverIndex, x, y, z, mapStyleCode(style));
    }
    @Override public String getCoordinateSystem() { return "GCJ02"; }
}
```

**关键差异**（这是策略模式价值最大的地方）：
- 高德：`webrd0[1-4].is.autonavi.com` + `style=7` + GCJ02 坐标
- Mapbox：`api.mapbox.com/styles/v1/{user}/{style}/tiles/{z}/{x}/{y}` + WGS84
- Google：`mt[0-3].google.com/vt/lyrs={lyrs}&x={x}&y={y}&z={z}` + WGS84

**配置切换**：`application.yml` 改 `map.provider: MAPBOX` 即可，重启后 Spring 只激活 Mapbox 那个 Bean。

**与场景 A 的区别**：场景 A 是"运行时按角色切换"——同一进程同时存在 4 个 Bean，按 roleName 路由；场景 B 是"启动时按配置选一个"——只有一个 Bean 被激活。两种都是策略模式，但激活方式不同。

### 场景 C — 策略模式 / 网关下发：根据 uavId 前缀路由

**问题**：UCS 同时支持两种无人机协议：
- `mavlink_192.168.1.10_14550` — 通过 MAVLink 网关（commands.mavlink.down topic）
- `dds_drone_5` — 通过 DDS 网关（commands.down topic）

`CommandService` 不应该写一堆 `if (uavId.startsWith("mavlink_")) ... else if (uavId.startsWith("dds_"))`。

**实现**（`MavlinkGatewayStrategy.java:30-92`）：

```java
@Component
public class MavlinkGatewayStrategy implements GatewayStrategy {
    @Override public String getGatewayType() { return "MAVLINK"; }
    @Override public boolean supports(String uavId) {
        return uavId != null && uavId.startsWith("mavlink_");
    }
    @Override public boolean sendCommand(String uavId, String commandType,
                                          String params, Long userId, Long commandLogId) {
        // 主路径：Kafka commands.mavlink.down
        // 降级路径：HTTP POST /api/command（适配器模式）
    }
}
```

**路由器自动选 Strategy**：

```java
@Service
public class GatewayCommandRouter {
    private final List<GatewayStrategy> strategies;
    public boolean dispatch(String uavId, ...) {
        return strategies.stream()
            .filter(s -> s.supports(uavId))
            .findFirst()
            .map(s -> s.sendCommand(uavId, ...))
            .orElseThrow(() -> new IllegalArgumentException("不支持的 uavId 格式: " + uavId));
    }
}
```

**与场景 A、B 的区别**：策略选择由**运行时数据**决定（uavId 前缀），不是角色名也不是配置。场景 A 用 Map 查找，场景 C 用 `supports()` 谓词依次试探。

### 场景 D — 工厂模式：命名线程池

**问题**：默认 `Executors.newFixedThreadPool(10)` 创建的线程名是 `pool-1-thread-1`、`pool-2-thread-1`，线上排查问题时栈帧里看不出是哪个业务的池子。

**实现**：

```java
public class NamedThreadFactory implements ThreadFactory {
    private final String prefix;
    private final AtomicInteger counter = new AtomicInteger(1);
    public NamedThreadFactory(String prefix) { this.prefix = prefix; }
    @Override public Thread newThread(Runnable r) {
        Thread t = new Thread(r, prefix + "-" + counter.getAndIncrement());
        t.setDaemon(false);
        return t;
    }
}

// 使用
ExecutorService telemetryPool = new ThreadPoolExecutor(
    10, 20, 60L, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(2000),
    new NamedThreadFactory("telemetry-async"),  // ← 工厂模式
    new ThreadPoolExecutor.CallerRunsPolicy());
```

**线程被命名为 `telemetry-async-1`、`telemetry-async-2`**——线上 jstack 一眼看出哪个池子卡住了。这就是工厂模式的核心价值：**封装对象创建过程的差异**。

### 场景 E — 观察者模式：Spring ApplicationEvent

**问题**：用户修改了无人机分区映射后，需要做一系列后续动作——清理 Caffeine L1 缓存、推送 Kafka 事件、更新审计日志……如果 `PartitionRoutingService` 直接调用所有这些下游，类间耦合度爆炸。

**实现**：

```java
// 1. 定义事件
public class PartitionMapChangedEvent extends ApplicationEvent {
    private final String uavId;
    private final Set<String> oldPartitions;
    private final Set<String> newPartitions;
    // ...
}

// 2. 发布者
@Service
public class PartitionRoutingService {
    private final ApplicationEventPublisher publisher;
    @Transactional
    public void updatePartitions(String uavId, Set<String> partitions) {
        // ... 数据库写入
        TransactionSynchronizationManager.registerSynchronization(
            new TransactionSynchronization() {
                @Override public void afterCommit() {
                    publisher.publishEvent(new PartitionMapChangedEvent(uavId, ...));
                }
            });
    }
}

// 3. 多个观察者（互不感知）
@Component class CacheInvalidationListener {
    @EventListener public void on(PartitionMapChangedEvent e) { /* 清L1 */ }
}
@Component class AuditLogListener {
    @EventListener public void on(PartitionMapChangedEvent e) { /* 写审计日志 */ }
}
```

**关键特性**：
- 同一进程内，Spring 通过 `@EventListener` 自动收集所有监听者
- 默认是同步分发（在发布者线程执行所有 listener）；加 `@Async` 可异步
- 跨进程的"观察"用 Redis PubSub 实现（见 Q7 场景 F）——也是观察者模式的分布式版

### 场景 F — 模板方法：Kafka Consumer 处理流水线

**问题**：每个 Kafka 消费者都要做：解析消息 → 业务处理 → 异常分支 → ACK / nACK。这套流水线是固定的，业务方只关心"业务处理"那一步。

**实现**（Spring Kafka 内置）：

```java
@KafkaListener(topics = "telemetry.raw", containerFactory = "telemetryFactory")
public void handle(ConsumerRecord<String, String> record) {
    // 用户只填这里——前后的反序列化、ACK、异常重试都是模板控制
    TelemetryData data = mapper.readValue(record.value(), TelemetryData.class);
    telemetryService.process(data);
}
```

**模板里固定的步骤**（在框架的 `KafkaMessageListenerContainer` 内）：
1. `poll()` 拉取一批消息
2. 反序列化（用配置的 `Deserializer`）
3. 调用用户的 `@KafkaListener` 方法
4. 异常 → 进入 `ErrorHandler`（重试或 DLQ）
5. 成功 → 提交 offset

业务方扩展的只有"用户的那一步"，其他全是模板。这是典型的"框架做共性、用户做差异性"——模板方法模式的本质。

### 场景 G — 责任链模式：Spring Security Filter Chain

**问题**：HTTP 请求要经过 CORS 检查 → CSRF 防护 → JWT 验证 → 限流 → 角色鉴权 → 进入 Controller。每个环节都可能拒绝请求。如果用 if-else 串在一个方法里，几百行代码且无法独立替换。

**实现**（`SecurityConfig.java`）：

```java
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    return http
        .cors().and()
        .csrf().disable()
        .authorizeHttpRequests(...)
        .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
        .build();
}
```

**链条结构**：

```
HTTP 请求
  → CorsFilter        判断 Origin 合法 → 不合法直接 403
  → CsrfFilter        校验 CSRF Token → 不合法直接 403
  → JwtAuthFilter     解析 Bearer → 设置 SecurityContext
  → AuthorizationFilter  @PreAuthorize 检查 → 不通过 401/403
  → Controller
```

**责任链的价值**：
- 每个 Filter 独立——可以单独添加、删除、替换（如关掉 CSRF 只需删一行）
- 任一节点决定终止链条（拒绝请求）或继续传递（`chain.doFilter()`）
- Spring Security 内置 ~15 个标准 Filter，覆盖绝大多数安全场景

### 场景 H — 单例模式：Spring Bean 默认作用域

**问题**：`PermissionService` 在 4 个 Controller 里被调用。每个请求创建一个新的实例显然浪费——它没有任何状态。

**Spring 自动实现**：

```java
@Service  // 默认 scope = singleton
public class PermissionService { ... }
```

**关键特性**：
- 整个 Spring 容器只有 1 个 `PermissionService` 实例
- 由 `DefaultListableBeanFactory` 维护，线程安全（前提：Service 内部无可变状态）
- 区别于 `@Scope("prototype")`——后者每次注入都是新实例

**容易踩的坑**：单例 Service 中如果定义了 `private List<X> tempData` 这种成员字段当作"临时变量"，多线程并发会互相覆盖。UCS 的 Service 类**全部不持有可变实例字段**——只持有依赖（其他 Bean）和不可变常量。

### 场景 I — 门面模式：RedisService 封装

**问题**：业务代码要直接调 Redis 时，要面对：`StringRedisTemplate`（针对字符串）、`RedisTemplate<String, Object>`（针对对象）、`opsForValue()` / `opsForSet()` / `opsForZSet()` / `opsForHash()`（针对不同数据类型）……一个 Service 要 import 一堆类。

**门面**（`RedisService.java`）：把这些细节封装在一组业务方法后面：

```java
@Service
public class RedisService {
    private final RedisTemplate<String, Object> redisTemplate;
    private final StringRedisTemplate stringRedisTemplate;
    public void setDroneOnline(String uavId) { ... }
    public boolean isDroneOnline(String uavId) { ... }
    public void updateDroneHeartbeat(String uavId) { ... }
    public Set<String> getTimedOutDrones(long timeoutMs) { ... }
    public void setDronePartitions(String uavId, Set<String> partitionNames) { ... }
    // ...
}
```

业务方只需 `redisService.isDroneOnline(uavId)`——不关心底层是 String 还是 ZSet，也不关心 TTL 是 30 秒还是 60 秒。这正是门面模式：**用一个简化的接口屏蔽下层的复杂性**。

### 场景 J — 建造者模式：JWT Token 链式构建

**问题**：构造一个 JWT Token 需要设置 issuer、subject、expiration、roles、jti 等十多个字段。用十几个 setter 不够直观，构造函数参数列表又会太长。

**实现**（`JwtUtil.java`）：

```java
return Jwts.builder()
        .setIssuer("ucs-backend")
        .setSubject(String.valueOf(userId))
        .setIssuedAt(new Date())
        .setExpiration(new Date(System.currentTimeMillis() + ttlMs))
        .setId(UUID.randomUUID().toString())
        .claim("username", username)
        .claim("roles", roles)
        .claim("type", tokenType)
        .signWith(privateKey, SignatureAlgorithm.RS256)
        .compact();
```

`Jwts.builder()` 返回 `JwtBuilder`，每个 setter 返回 `this`，最后 `compact()` 输出最终 String。这就是建造者模式的链式 API。

### 场景 K — 适配器模式：Kafka 失败降级到 HTTP

**问题**：MAVLink 网关下发指令首选 Kafka（性能好、有顺序保证）。但如果 Kafka 集群短暂不可用，业务上希望立刻降级到 HTTP 直连，不要让用户失败。

**实现**（`MavlinkGatewayStrategy.java:62-92`）：

```java
@Override
public boolean sendCommand(String uavId, String commandType, ...) {
    if (kafkaTemplate != null) {
        try {
            kafkaTemplate.send(commandsMavlinkDownTopic, uavId, json);
            return true;
        } catch (Exception e) {
            log.warn("[MavlinkStrategy] Kafka failed, falling back to HTTP: {}", e.getMessage());
        }
    }
    return sendCommandViaHttp(uavId, commandType, params);  // 适配器
}
```

`sendCommandViaHttp()` 把"指令对象"适配成 HTTP POST 请求——同样的输入（uavId + commandType），不同的传输层。这是适配器模式：**用同一接口接入多个下游实现**，调用方无感知。

### 深挖追问

#### 追问 1：策略模式 / 工厂模式 / 模板方法这三个非常像，到底怎么区分？

它们都是"把可变的部分提取出来"，但**变化的内容不同**：

| 模式 | 变化的是 | 何时选定 | UCS 例子 |
|------|---------|---------|---------|
| 策略模式 | **整个算法/行为** | 运行时（按 key 路由）或启动时（@ConditionalOnProperty） | 角色权限、地图服务商 |
| 工厂模式 | **对象创建过程** | 调用 factory 时 | NamedThreadFactory |
| 模板方法 | **算法的某些步骤** | 子类 / lambda 实现 | @KafkaListener 方法体 |

一句话：策略关注"用哪个算法"、工厂关注"怎么造对象"、模板关注"算法骨架里的哪个空"。

#### 追问 2：观察者模式（同进程 ApplicationEvent）和发布订阅（Redis PubSub）是同一个东西吗？

概念上是同一个模式，但**作用域和保证不同**：

| 维度 | ApplicationEvent | Redis PubSub |
|------|------------------|--------------|
| 作用域 | 同 JVM 进程内 | 跨进程 / 跨主机 |
| 持久化 | 无 | 无（消息发完即忘） |
| 顺序保证 | 单线程同步发布时有 | 一般无（多订阅者并行） |
| 延迟 | 微秒级（直接调用） | 毫秒级（网络） |
| 失败处理 | 抛异常会中断后续 listener（可改异步隔离） | 订阅方掉线收不到 |
| UCS 用法 | 进程内"分区变更" → "清 L1 + 写审计" | 跨实例"清你那边的 L1" |

经验法则：**同进程多个监听 → ApplicationEvent；跨实例广播 → Redis PubSub；跨集群可靠 → Kafka**。三层依次递增成本和保证。

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

UCS 中的异常按"产生位置 + 处理策略"分为三类，**每一类有自己最适合的处理模式**：

| 异常类型 | 产生位置 | 处理策略 | 代表场景 |
|---------|---------|---------|---------|
| **业务逻辑异常** | HTTP Controller 层 | 全局 `@ControllerAdvice` 统一转 JSON 错误响应 | 权限不足 / 参数非法 |
| **Kafka 消费异常** | `@KafkaListener` 方法内 | 局部 try-catch 隔离，失败跳过不阻塞后续 | 单条遥测 JSON 解析失败 |
| **Redis/外部依赖异常** | Service 调用第三方时 | 降级策略，使用旧值或空值兜底 | Redis 短暂不可用、Kafka 集群超时 |

下面"一类异常 = 一个独立场景"展开。

### 场景 A — 业务异常：权限校验失败

**问题**：操作员调用 `POST /api/v1/drones/px4_001/control` 但当前 JWT Token 解出的角色是 OBSERVER（无控制权限）。后端要返回结构化的 401/403，包含错误码、错误消息、追踪 ID——前端按错误码做不同提示。

**自定义异常类**（推荐结构）：

```java
@Getter
public class BusinessException extends RuntimeException {
    private final ErrorCode errorCode;
    private final Map<String, Object> details;

    public BusinessException(ErrorCode errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
        this.details = Map.of();
    }
}

public enum ErrorCode {
    PERMISSION_DENIED(40301, HttpStatus.FORBIDDEN),
    UAV_NOT_FOUND(40401, HttpStatus.NOT_FOUND),
    INVALID_DRONE_STATE(40901, HttpStatus.CONFLICT),
    EPOCH_OUTDATED(40902, HttpStatus.CONFLICT);

    private final int code;
    private final HttpStatus httpStatus;
}
```

**抛出处**（Service 层）：

```java
@Service
public class CommandService {
    public void sendCommand(String uavId, String type, Long userId) {
        if (!permissionService.hasPermission(userId, "CONTROL_DRONE")) {
            throw new BusinessException(
                ErrorCode.PERMISSION_DENIED,
                "用户无控制无人机权限"
            );
        }
        // ...
    }
}
```

**全局处理**（`GlobalExceptionHandler.java`）：

```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ApiResponse<Void>> handleBusiness(BusinessException ex) {
        log.warn("[Business] {} - {}", ex.getErrorCode(), ex.getMessage());
        return ResponseEntity
            .status(ex.getErrorCode().getHttpStatus())
            .body(ApiResponse.error(ex.getErrorCode().getCode(), ex.getMessage()));
    }
    
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidation(MethodArgumentNotValidException ex) {
        // Bean Validation 失败 → 400
    }
    
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleUnknown(Exception ex) {
        log.error("[Unknown] {}", ex.getMessage(), ex);
        return ResponseEntity.status(500).body(ApiResponse.error(50000, "服务器内部错误"));
    }
}
```

**关键设计**：
- 业务异常**继承 RuntimeException**——Spring 事务遇到 RuntimeException 默认回滚，符合业务语义
- 错误码独立于 HTTP 状态码：HTTP 状态用于 HTTP 中间件理解，业务错误码（5 位数字）用于前端精确判断
- 所有日志在 GlobalExceptionHandler 集中输出——避免业务代码到处 log.error
- `ApiResponse` 包装：成功失败统一格式，前端只判 `code == 200000`

### 场景 B — Kafka 消费异常：单条消息隔离

**问题**：`telemetry.raw` Topic 一条消息因为某个无人机固件 bug，发出来的 JSON 格式异常。如果异常向上传播，Spring Kafka 默认会重试 3 次然后停止整个 Consumer——一架坏无人机能瘫痪整个消费者实例。

**UCS 的"分段 try-catch + 错误跳过"模式**（`TelemetryRawConsumer.java`）：

```java
@KafkaListener(topics = "telemetry.raw", containerFactory = "telemetryFactory")
public void consume(ConsumerRecord<String, String> record) {
    String rawValue = record.value();
    String uavId = record.key();
    TelemetryMessage msg;

    // 阶段 1：解析 — 失败直接 return（跳过这条）
    try {
        msg = JsonUtil.parse(rawValue, TelemetryMessage.class);
    } catch (Exception e) {
        log.error("[Ingest] JSON parse failed for uavId={}: {}", uavId, e.getMessage());
        meterRegistry.counter("telemetry.parse.failed").increment();
        return;
    }

    // 阶段 2：Epoch 校验 — 失败时优先保转发可达性
    try {
        if (!epochService.validate(uavId, msg.getEpoch())) return;
    } catch (Exception e) {
        log.warn("[Ingest] Epoch check threw, continuing: {}", e.getMessage());
        // Don't block forward on epoch errors
    }

    // 阶段 3：Redis 更新 — 失败时仍要转发
    try {
        redisService.updateDroneState(uavId, msg.toStateMap());
    } catch (Exception e) {
        log.warn("[Ingest] Redis update failed for {}: {}", uavId, e.getMessage());
        meterRegistry.counter("telemetry.redis.failed").increment();
    }

    // 阶段 4：转发 — 这是关键路径，失败必须告警但不能抛
    try {
        kafkaTemplate.send(TELEMETRY_PROCESSED, uavId, rawValue);
    } catch (Exception e) {
        log.error("[Ingest] CRITICAL: failed to forward {}: {}", uavId, e.getMessage());
        meterRegistry.counter("telemetry.forward.failed").increment();
    }
}
```

**设计原则**：
- **每个步骤独立 try-catch**：前面失败不阻塞后面
- **关键路径优先**：转发到下游 `telemetry.processed` 是最重要的，前面 Redis 或 GeoHash 更新失败也不能挡
- **Counter 指标**：每类失败有独立计数，Prometheus 报警可以精确定位"是哪一步在失败"
- **方法不抛出**：永远 `return` 不 `throw`——保证 Spring Kafka 自动 ack 这条 offset，不会卡住整个 partition

**重试与死信队列（DLQ）**：对于"必须成功"的关键消息（如下行控制指令 `commands.down`），UCS 配置了 `SeekToCurrentErrorHandler` + DLQ：

```java
@Bean
public SeekToCurrentErrorHandler errorHandler(KafkaTemplate<?, ?> template) {
    return new SeekToCurrentErrorHandler(
        new DeadLetterPublishingRecoverer(template),  // 失败时发到 .DLT topic
        new FixedBackOff(1000L, 3L)  // 重试 3 次，每次间隔 1 秒
    );
}
```

`commands.down` 失败 3 次后进入 `commands.down.DLT`，由人工或定时任务处理——这与遥测的"失败就跳过"完全不同的策略。

### 场景 C — Redis/外部依赖异常：降级与熔断

**问题**：Redis 集群因为运维原因短暂不可用（30 秒）。如果业务代码每个 Redis 调用都直接抛 `RedisConnectionFailureException`，整个 API 全挂。但实际上很多 Redis 调用是**辅助路径**——失败时降级到 DB 或返回空值，比让用户看到 500 好得多。

**降级模式 1：try-catch 默默 fallback**（`MultiLevelCacheService.java:107-117`）：

```java
public String get(String region, String key, Supplier<String> dbLoader) {
    String value = readL1(region, key);
    if (value != null) return value;
    
    try {
        value = (String) redisTemplate.opsForValue().get(key);
        if (value != null) {
            l1.put(region + ":" + key, value);
            return value;
        }
    } catch (Exception e) {
        log.debug("[Cache] L2 unavailable, fall through to DB: {}", e.getMessage());
        meterRegistry.counter("cache.l2.unavailable").increment();
        // 不抛——降级到 DB
    }
    
    return dbLoader.get();
}
```

**降级模式 2：Resilience4j 熔断器**（适合调用第三方 API）：

```java
@CircuitBreaker(name = "amapGeocoding", fallbackMethod = "geocodeFallback")
public double[] geocode(String address) {
    return amapClient.geocode(address);
}

private double[] geocodeFallback(String address, Throwable t) {
    log.warn("[Amap] Circuit open, returning cached or default: {}", t.getMessage());
    return geocodeCache.getOrDefault(address, new double[]{0, 0});
}
```

**关键配置**（`application.yml`）：

```yaml
resilience4j:
  circuitbreaker:
    instances:
      amapGeocoding:
        failureRateThreshold: 50      # 50% 失败率触发熔断
        slowCallRateThreshold: 80     # 80% 慢调用（>2s）也触发
        waitDurationInOpenState: 30s  # 熔断 30 秒后尝试半开
        slidingWindowSize: 20         # 滑动窗口 20 次调用
        minimumNumberOfCalls: 10      # 至少 10 次调用才统计
```

**三种状态**：
- **CLOSED**：正常调用
- **OPEN**：失败率超阈值，所有请求直接走 fallback，不再调底层
- **HALF_OPEN**：等待 30 秒后允许少量探测请求，成功就回到 CLOSED

### 异常类型总结对比

| 维度 | 业务异常 | Kafka 消费异常 | Redis/外部依赖异常 |
|------|---------|--------------|------------------|
| 处理位置 | `@ControllerAdvice` 全局 | `@KafkaListener` 方法内局部 | Service 调用处 |
| 用户感知 | HTTP 错误响应 | 完全不感知（最终一致性） | 降级值或旧数据 |
| 是否回滚事务 | 是（RuntimeException） | 不涉及事务 | 否（catch 后继续） |
| 监控指标 | 错误码 → APM | 各阶段 counter | 熔断器状态 |
| 失败的代价 | 一次请求失败 | 一条数据丢失 | 一次降级 |

### 深挖追问

#### 追问 1：为什么不在 Kafka Consumer 里也用 `@ControllerAdvice` 统一处理？

`@ControllerAdvice` 只拦截 Spring MVC 的 Controller 异常——它绑定的是 `HandlerExceptionResolver` 链，作用域是 DispatcherServlet。Kafka Consumer 由 Spring Kafka 的 `MessageListenerContainer` 调度，根本不经过 DispatcherServlet。

如果要"统一处理 Kafka 异常"，正确的做法是：
1. 配置全局 `CommonErrorHandler`（替代 SeekToCurrentErrorHandler）
2. 实现 `RetryListener`/`RecordInterceptor` 做日志/指标
3. 对必须重试的消息配置 DLQ（死信队列）

但 UCS 的策略是**让 Consumer 自己分阶段 try-catch**——好处是每段失败都能记录精确的 counter（区分是 parse、redis、forward 哪个环节失败），全局 handler 只能笼统报"某条消息失败"。监控价值不同。

#### 追问 2：业务异常用 RuntimeException 还是 CheckedException？

UCS 选 RuntimeException，主要原因有三：

1. **Spring 事务回滚默认**：`@Transactional` 默认只对 `RuntimeException` 和 `Error` 回滚。如果用 CheckedException，要写 `@Transactional(rollbackFor = BusinessException.class)`——容易漏
2. **不污染方法签名**：CheckedException 必须在每个 throws 子句声明，深层调用栈一旦抛业务异常，每一层方法签名都要改
3. **Spring 风格统一**：Spring 全家桶（DataAccessException、HttpClientErrorException、AuthenticationException）都是 RuntimeException 体系——用 RuntimeException 与生态一致

**反方观点**：CheckedException 强制调用方处理或显式声明，安全性高。但实践中开发者常 `catch (Exception e) { /* swallow */ }`——反而更糟。

经验法则：**业务边界用 RuntimeException + 全局 handler；底层 IO 用 Java 自带的 IOException（CheckedException）保留**。

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
