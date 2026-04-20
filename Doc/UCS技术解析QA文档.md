# UCS 技术解析 QA 文档

> 面向：**Java/后端技术面试场景**。
> 形式：每题给出 *典型场景 → 一层回答 → 追问 1（深挖原理）→ 追问 2（深挖实现细节 / 参数值）→ 追问 3（深挖边界 / 权衡 / 失败模式）*。
> 素材全部来自项目实际代码、配置与设计文档，所有数字、类名、函数名均可在代码中检索到。

---

## 目录

1. [Q1 — MAVLink 网关 UDP 收包为什么不用 NIO 反应堆？](#q1--mavlink-网关-udp-收包为什么不用-nio-反应堆)
2. [Q2 — DDS 网关为什么订阅端 QoS 必须 BEST_EFFORT？](#q2--dds-网关为什么订阅端-qos-必须-best_effort)
3. [Q3 — 多网关实例如何做到互不抢同一架飞机？](#q3--多网关实例如何做到互不抢同一架飞机)
4. [Q4 — Kafka Key 为什么必须是 `uav_id`？换成别的值会怎样？](#q4--kafka-key-为什么必须是-uav_id换成别的值会怎样)
5. [Q5 — `acks=1` vs `acks=all` 在项目里分别用在哪？为什么？](#q5--acks1-vs-acksall-在项目里分别用在哪为什么)
6. [Q6 — 为什么 ingest 消费者 `max-poll-records=1`，store 却是 `500`？](#q6--为什么-ingest-消费者-max-poll-records1store-却是-500)
7. [Q7 — `commandProcessorPool` 为什么要用 `DiscardOldestPolicy`？](#q7--commandprocessorpool-为什么要用-discardoldestpolicy)
8. [Q8 — 虚拟线程 `spring.threads.virtual.enabled=true` 到底改了什么？](#q8--虚拟线程-springthreadsvirtualenabledtrue-到底改了什么)
9. [Q9 — 分区映射的 Redis 和 PG 是怎么保证双写一致性的？](#q9--分区映射的-redis-和-pg-是怎么保证双写一致性的)
10. [Q10 — 遥测 Redis 状态写失败为什么允许继续转发？](#q10--遥测-redis-状态写失败为什么允许继续转发)
11. [Q11 — `batchInsert` 为什么能做到 50k rows/s？](#q11--batchinsert-为什么能做到-50k-rowss)
12. [Q12 — WebSocket `partitionName` 的映射和推送隔离是怎么做的？](#q12--websocket-partitionname-的映射和推送隔离是怎么做的)
13. [Q13 — 视口过滤的 GeoHash 为什么比 `GEORADIUS` 更合适？](#q13--视口过滤的-geohash-为什么比-georadius-更合适)
14. [Q14 — Epoch 机制到底防什么？它和 Kafka 消费位点是什么关系？](#q14--epoch-机制到底防什么它和-kafka-消费位点是什么关系)
15. [Q15 — 命令幂等：`SETNX` + TTL 的"单刀匕首"靠谱吗？](#q15--命令幂等setnx--ttl-的单刀匕首靠谱吗)
16. [Q16 — 多级缓存的"击穿、雪崩、穿透"项目里分别怎么处理？](#q16--多级缓存的击穿雪崩穿透项目里分别怎么处理)
17. [Q17 — 对同一条数据的"增/改/删"并发到达时，数据库和缓存怎么收敛？](#q17--对同一条数据的增改删并发到达时数据库和缓存怎么收敛)
18. [Q18 — API Gateway 为什么要把 JWT 校验前置，下游还要二次校验吗？](#q18--api-gateway-为什么要把-jwt-校验前置下游还要二次校验吗)
19. [Q19 — `@Scheduled` + `@SchedulerLock` 的 `lockAtLeastFor` 和 `lockAtMostFor` 分别防什么？](#q19--scheduled--schedulerlock-的-lockatleastfor-和-lockatmostfor-分别防什么)
20. [Q20 — 一个 Kafka Consumer 处理太慢会发生什么？项目里怎么预防？](#q20--一个-kafka-consumer-处理太慢会发生什么项目里怎么预防)

---

## Q1 — MAVLink 网关 UDP 收包为什么不用 NIO 反应堆？

### 典型场景
50 架真机同时以 10Hz 通过 UDP 14550 向一台 Mavlink 网关发送遥测（MAVLink v2 包，单包 30–300 字节）。网关进程持续读取、解析、写 Kafka。
**定位**：`mavlink-gateway/mavlink_gateway.py` 的 `_start_udp_listener` / `_udp_loop`。

### 一层回答
网关用的是 **"1 条阻塞 UDP 接收线程 + 后续线程池并行派发"** 的最朴素模型：

```python
# L1076-1105
self._udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
self._udp_socket.bind((self.listen_host, self.listen_port))  # 0.0.0.0:14550
self._udp_socket.settimeout(1.0)
...
while self.running:
    data, addr = self._udp_socket.recvfrom(65535)  # 阻塞 1s 超时
    msgs = self._parse_mavlink_bytes(data, mav)
    for parsed_msg in msgs:
        self._dispatch_mavlink_message(parsed_msg, addr, 'udp')
```

之所以不上 NIO（Python 里对应 `asyncio.DatagramProtocol` 或 `selectors`），是因为 UDP 收包本身是**内核缓冲 + 单个 fd**的模型：内核帮你把 50 架飞机的包攒进一个 socket buffer，只要用户线程 `recvfrom` 足够快，一条线程就能喂饱下游 10Hz × 50 架 = 500 pkt/s。引入反应堆反而把"读包"的 I/O 复用和"解析/下发"的 CPU 混在一起，复杂度不值当。

### 追问 1（深挖原理）：单线程收包的理论吞吐上限是多少？会不会丢包？

- **单线程吞吐**：Linux 上 `recvfrom` + 一次 `copy_to_user` 的 syscall 开销 ≈ 几 μs，单线程纯收包上限在 **数十万 pkt/s** 量级，对 500 pkt/s 是 1000× 余量。
- **丢包风险**：UDP 丢包发生在**内核 socket buffer 溢出**时（`netstat -s | grep RcvbufErrors`）。默认 `SO_RCVBUF` 大约 212992 字节，50 架飞机各 300B × 10Hz ≈ 150 KB/s，远小于缓冲，不会溢出。
- **额外保险**：
  - `recvfrom(65535)`：一次读满，避免 N 次 syscall。
  - 代码里 `settimeout(1.0)`：让线程周期性检查 `self.running`，便于 graceful shutdown。
  - `SO_REUSEADDR`：崩溃重启时不等 TIME_WAIT，可立即 rebind。

### 追问 2（深挖实现）：解析完的消息为什么不在收包线程里直接发 Kafka？线程切换不增加延迟吗？

看起来确实是"收包 → 解析 → 派发"全在 `_udp_loop` 里串行跑，**并没有**切到别的线程。真正"切线程"只发生在**下发命令的回路**：

```python
# __init__, L216-258
self._command_executor = ThreadPoolExecutor(max_workers=10, thread_name_prefix='cmd-dispatch')
self._ack_executor     = ThreadPoolExecutor(max_workers=4,  thread_name_prefix='ack-fwd')
```

- **收包线程**：`_udp_loop` 里的 `send_to_kafka` 是 `KafkaProducer.send()` — **异步 API**，内部有后台 I/O 线程，调用方立即返回，不会阻塞收包。
- **命令下发线程池**（10）：Kafka Consumer 拿到一条 `commands.down` → `submit` 到线程池 → 并行发给多架飞机，不阻塞 Kafka poll。
- **ACK 转发线程池**（4）：收到 `COMMAND_ACK` → `submit` 到 ack pool → 并行写 `commands.ack`。

两个池**完全隔离**：即使真机 ACK 洪水般涌来也不会挤占命令下发池的 10 条线程。

### 追问 3（边界 / 权衡）：如果真机数量从 50 涨到 500，这个模型还能扛吗？瓶颈在哪？

**瓶颈不在收包**，而在：

1. **Kafka Producer 单实例吞吐**：`batch_size=16384, linger_ms=0` 表示无攒批立即发。500 架 × 10Hz = 5000 msg/s，每条 200B ≈ 1MB/s，单实例 `KafkaProducer` 仍是绰绰有余。
2. **命令下发池**：10 线程如果遇到"500 机同时起飞"，会出现排队。需要把 `max_workers` 扩到 64 或改成 Bulkhead + 分架调度。
3. **Redis Epoch 读**：每帧遥测都 `GET mavlink:epoch:{uav_id}`，5000 QPS 对 Redis 单实例仍是轻量；但可以在进程内加 10s 本地缓存进一步减压。
4. **pymavlink 解析 CPU**：纯 Python，单核 ≈ 2–3 万 msg/s 解析上限。500 机 × 10Hz 仍在 10% 余量内，但 2000 机 × 10Hz 就需要拆网关实例（见 Q3 多实例分片）。

---

## Q2 — DDS 网关为什么订阅端 QoS 必须 BEST_EFFORT？

### 典型场景
启动 DDS 网关后，发现 ROS2 `topic list` 里能看到 `/px4_1/fmu/out/vehicle_attitude`，但 `topic echo` 一条数据也没有，订阅回调从未触发。
**定位**：`dds-gateway/dds_gateway.py::_subscribe_with_px4_msgs` L354-415。

### 一层回答
项目显式把订阅端 QoS 设成与 PX4 发布端相同的 `BEST_EFFORT + VOLATILE`：

```python
qos = QoSProfile(
    reliability=ReliabilityPolicy.BEST_EFFORT,
    durability=DurabilityPolicy.VOLATILE,
    depth=5,
)
```

原因是 **DDS 规范要求"订阅端 QoS 必须兼容发布端"**。`RELIABLE`（订阅要求可靠）在 DDS 等级上严于 `BEST_EFFORT`（发布端承诺仅尽力而为），于是发布方会判定"你要求的我给不了"，直接**不建立匹配**，一条数据都不会投递。

### 追问 1（深挖原理）：为什么 PX4 选 BEST_EFFORT 而不是 RELIABLE？

- PX4 输出话题频率高（`vehicle_local_position` 50Hz+），对 ACK/重传敏感。
- 飞控芯片内存与 CPU 都极其有限，不能维护"每条消息的确认状态"。
- 遥测本身"下一帧很快就来了"，丢 1 帧 20ms 的数据无关紧要，追求**低延迟**而非"不丢"。
- 对比：`commands.down` 如果用 DDS 发，会用 `RELIABLE`——指令丢了就是事故。但我们的指令回路走的是 Kafka + MAVLink/UDP，不走 DDS。

### 追问 2（深挖实现）：`depth=5` 是什么？VOLATILE 又防什么？

- **depth=5**：订阅端缓冲 5 条消息的历史队列。订阅回调处理慢时最多缓 5 条，再来就覆盖最老的。遥测场景下 `depth=5` 足够——慢于 0.5s 的消费者本来就该扩容。
- **VOLATILE durability**：发布端**不保留**历史，新订阅者只收到"订阅之后"的数据。对比 `TRANSIENT_LOCAL`（发布端保留最近 N 条给晚来的订阅者）——遥测不需要回放，选 VOLATILE 省发布端内存。

### 追问 3（边界 / 权衡）：如果订阅回调处理太慢会怎样？如何监控？

- **丢消息**：BEST_EFFORT + depth=5 下，订阅队列满了会直接覆盖最老的；没有异常，没有日志，静默丢失。
- **监控**：
  - 用 `rclpy` 的 `subscription.get_publisher_count()` / `ros2 topic hz` 对比"发布频率 vs 我方 callback 频率"。
  - 业务层：网关把 `uav_id, last_ts` 写 Redis（`mavlink:online:{uav_id}` TTL 30s / `dds:epoch:{uav_id}`）；如果 15s 内没更新，`DroneHeartbeatService` 会触发离线事件，运营能看到。
- **处理**：
  - 把每个话题的回调换成"只拷贝数据、丢到 `ThreadPoolExecutor`"，避免在 DDS 回调线程里做 I/O。
  - 单机带不动时走 Q3 多实例分片。

---

## Q3 — 多网关实例如何做到互不抢同一架飞机？

### 典型场景
3 台 DDS 网关副本部署在 K8s，总共 200 架 PX4 仿真飞机在同一个 ROS2 域内。怎么保证每架飞机**只被 1 台网关**订阅？

**定位**：`dds-gateway/dds_gateway.py::_owns_drone`（多实例分片函数）。

### 一层回答
用**无状态一致性哈希**：

```python
def _owns_drone(self, uav_id: str) -> bool:
    return hash(uav_id) % self.total_instances == self.instance_id
```

每个副本启动时知道自己的 `instance_id`（0..N-1）和 `total_instances`。扫描 ROS2 话题发现飞机时，只对 `hash(uav_id) % N == instance_id` 的飞机执行 `subscribe_to_drone`，其他飞机一概不订阅。

### 追问 1（深挖原理）：为什么不用 ZK/Etcd 做 leader 选举，而是每个实例自己算？

- **零依赖**：这套分片不需要中心协调，意味着网关没有"master 宕机"这个故障点。
- **无状态**：进程重启后重新计算自己该管哪些飞机，不需要恢复状态。
- **幂等**：两个实例同时 `subscribe` 到同一架飞机**不会崩**（DDS 允许多个订阅），只是多发 Kafka，下游靠 Epoch 去重（见 Q14）。
- 代价：扩缩容时会有一次"哈希重分布"——第 4 个实例加入后，每架飞机都可能被重新分到别的实例。短暂的重复订阅/漏订阅由 Epoch + Kafka 分区 key 兜底。

### 追问 2（深挖实现）：`hash(uav_id)` 在 Python 里是进程内随机盐化的吗？多实例之间结果一致吗？

这里有个陷阱：**Python 3.3+ `hash(str)` 默认加随机盐**（`PYTHONHASHSEED`）——不同进程对同一字符串的 `hash()` 返回值不同！这会让副本 A 和副本 B 对 `"px4_5"` 得到不同的模值，同一架飞机可能被 0 个或 2 个实例认领。

代码实际用法：`total_instances`/`instance_id` 通过环境变量配置，项目**建议部署时统一设置 `PYTHONHASHSEED=0`**（docker-compose-gateways.yml 里可以 `environment: PYTHONHASHSEED=0`）。若没设置，就要把 `hash` 换成 `zlib.crc32` / `hashlib.md5` 这类确定性哈希。

此外，Mavlink 网关也有同一套分片逻辑，`_owns_drone` 的语义是**一致**的，避免 DDS 和 Mavlink 两端对同一 uav_id 判定矛盾。

### 追问 3（边界 / 权衡）：扩容时"短暂重复订阅"具体会带来什么？

- **Kafka 层**：两个实例都写 `telemetry.raw` key=`px4_1`，**同一条遥测产生两条 Kafka 记录**。
- **Consumer 层**：`TelemetryRawConsumer` 会看到两次，两次 Epoch 相同 → `epochService.validate` 返回 true 两次（`<` 才拒绝，`==` 不拒绝），重复写 Redis 和转发 `telemetry.processed`。
- **数据库层**：`TelemetryRepository.batchInsert` 使用简单 INSERT，**不做去重**，会产生重复时序行。
- **业务层可见性**：TimescaleDB 里同一 `(uav_id, time)` 会有两行，查询时最新位姿多出一点点噪声。
- **收敛**：扩缩容通常 <10s，假设 10Hz 遥测 → 100 条重复。相比 TB 级历史数据是噪声级别，**允许最终去重任务离线处理**。

---

## Q4 — Kafka Key 为什么必须是 `uav_id`？换成别的值会怎样？

### 典型场景
设计评审时有人提议"遥测量大，Key 用 `uav_id + minute_bucket` 让分区更均匀"。要不要接受？

**定位**：`dds_gateway.py::send_to_kafka` L985，`CommandKafkaProducer.java` L60，`TelemetryRawConsumer.java` L98。

### 一层回答
**绝对不能改**。`Key = uav_id` 是全系统有序性保证的基石。Kafka 默认分区器：
```
partition = murmur2(key.getBytes()) % num_partitions
```
同一 Key 永远落同一分区，同一分区被同一 Consumer 线程顺序消费，**保证"同一架飞机的消息被下游按真实时间顺序看到"**。
换 `uav_id + minute_bucket` 后：每分钟跳分区 → 分区内仍有序、跨分区无序 → 跨分钟的两条消息可能被**不同消费者线程乱序**消费，下游看到的状态会回跳。

### 追问 1（深挖原理）：有序性具体体现在哪些操作上？

1. **Epoch 校验**（`EpochValidationService.validate`）：比较 `msgEpoch >= current`。如果 uav_id 的消息乱序到达，新 Epoch 先写入 → 旧 Epoch 再来时被判定为过期 → 即使是合法状态也丢掉。
2. **Redis 状态覆盖**（`RedisClusterService.updateDroneState`）：后写覆盖前写。乱序 → 旧数据覆盖新数据，前端看到的状态会"倒流"。
3. **Device Shadow**（`DeviceShadowService.updateReported`）：lastReportedAt 写晚到的可能更小，delta 计算错位。
4. **命令下发**：如果两次 `commands.down` 乱序，后到的 "LAND" 可能在 "TAKEOFF" 之前被执行。

### 追问 2（深挖实现）：`murmur2` 的分布均匀性如何？有没有数据倾斜风险？

- Murmur2 对字符串的均匀性在实践中很好；uav_id 本身形如 `px4_1..px4_200` 已经是均匀分布。
- **风险场景**：如果某 10 架飞机特别活跃（日常 50Hz，其他 10Hz），它们恰好都哈希到 partition 0 → partition 0 压力 5× 其他。
- **现状规模**：`KAFKA_NUM_PARTITIONS=16`，`consumer concurrency=4`（每组 4 实例消费 16 分区 ≈ 每实例 4 分区）。流量没到倾斜会影响稳定性的量级。
- **若真的倾斜**：
  - 选项 A：自定义 `Partitioner`，对高频 uav 单独散列。
  - 选项 B：按 `uav_id` 取模而非 murmur：`int(uav_id.split('_')[1]) % 16`，可预测均匀但依赖命名规则。

### 追问 3（边界 / 权衡）：`uav_id=null` 或缺失时会怎样？

- Kafka 默认分区器在 key=null 时用 **Round Robin**（新版本是 Sticky Partitioner）轮询分区，消息丢失原有顺序。
- 项目代码在 `TelemetryPushConsumer.consumeBatch` L66 有防御：`if (uavId == null) continue;`，直接跳过；`TelemetryKafkaConsumer.consumeTelemetry` L66-68 同样。
- 生产者侧 `send(topic, uavId, json)` 如果 `uavId=null` 会抛 NPE（`StringSerializer` 不允许 null），会被业务层 catch 后记日志。
- **防御策略**：Gateway 在 `_dispatch_mavlink_message` / 订阅回调最前面校验 `if not uav_id: return`，从源头不让空 key 进 Kafka。

---

## Q5 — `acks=1` vs `acks=all` 在项目里分别用在哪？为什么？

### 典型场景
两台 Kafka broker 之间复制延迟抖动到 500ms，此时同时发生：Gateway 写 `telemetry.raw`，Command 服务写 `commands.down`。两种写入各自的表现？

**定位**：
- Gateway：`dds_gateway.py::_init_kafka` L695 `acks=1`。
- 后端：`ucs-command/application.yml` L24 `acks: all`；`ucs-business/application.yml` L45 `acks: 1`。

### 一层回答
- **Gateway（遥测）**：`acks=1`，Leader 副本写入内存就算成功。复制延迟抖动 → 主写成功立即返回；如果正好 Leader 挂了且 Follower 没复制完，这条遥测会丢。但丢 1 条 100ms 的数据影响可忽略。**选延迟优先**。
- **Command（指令）**：`acks=all` + `KAFKA_MIN_INSYNC_REPLICAS=2` → 必须 2 个 ISR 副本都 fsync 成功才返回。500ms 延迟期间 producer 阻塞等待；但一旦返回成功，即使整个数据中心断电，指令也不丢。**选可靠性优先**。

### 追问 1（深挖原理）：`acks=all` + `min.insync.replicas=2` 的失败模式是什么？

- **正常**：3 副本，2 个 ISR 都 ack 才成功。
- **退化 1**：1 个 Follower 掉队（`replica.lag.time.max.ms` 超时）→ ISR 降到 2（Leader + 1 Follower），仍满足 `min.insync.replicas=2`，写入继续。
- **退化 2**：又掉 1 个 → ISR=1，Producer 收到 `NotEnoughReplicasException` → **写失败**。这时候宁可不写，也不要"只 Leader 独苗上的数据"。
- **对比 `acks=1`**：ISR=1 也照常写。Leader 挂了这条丢，但业务不中断。
- 项目选择：指令宁可 `NotEnoughReplicasException` 让上层降级（重试或走 HTTP 应急通道），也绝不"以为成功其实丢了"。

### 追问 2（深挖实现）：`retries=3` 和 `retry.backoff.ms` 如何配合？幂等性开了吗？

- 两边都 `retries: 3`（见 `ucs-command/application.yml` L25，`dds_gateway.py::_init_kafka` L696）。
- 默认 `retry.backoff.ms=100`，三次之间 100ms 等待。三次失败后 `producer.send().get()` 抛异常。
- **幂等性 Producer**（`enable.idempotence=true`）：如果开启，`acks` 自动被 Kafka 升级到 `all`，`retries` 提升到 `Integer.MAX_VALUE`，且 Producer 端通过 `PID + SequenceNumber` 保证重试不会产生重复。
- 现状：项目配置里**没有显式开 `enable.idempotence`**。Spring Kafka 2.5+ 默认开启（具体取决于客户端版本）。生产环境推荐显式加：
  ```yaml
  producer.properties.enable.idempotence: true
  ```

### 追问 3（边界 / 权衡）：`commands.down` 写成功了但 Gateway 消费者崩了，会丢指令吗？

- **Kafka 持久化**保证指令已写入 3 副本，不丢。
- **Gateway 消费者**侧：`auto-offset-reset` + `offset commit` 模式决定"上次消费到哪"；代码里 Python `KafkaConsumer` 默认 `enable_auto_commit=True, auto_commit_interval_ms=5000`。
- **风险**：如果消费者拉了消息、5s 内没提交 offset 就崩了 → 重启后从上次 commit 处重读 → **同一指令被消费两次**。
- **兜底**：Epoch 保证重启后 epoch++，旧的不会被重发；`IdempotencyService.tryAcquire(requestId)` SETNX + TTL 10min 保证 10 分钟内同一 `requestId` 只执行一次。
- 也就是说，"指令不丢"靠 `acks=all`，"指令不重"靠 Epoch + Redis SETNX 幂等。

---

## Q6 — 为什么 ingest 消费者 `max-poll-records=1`，store 却是 `500`？

### 典型场景
同一个 `telemetry.processed` Topic，`ucs-realtime-push`/`ucs-business` 开 batch=true，`ucs-telemetry-ingest` 却 `max-poll-records=1`。设计是不是精神分裂？

**定位**：
- `ucs-telemetry-ingest/application.yml` L17 `max-poll-records: 1`，`fetch-min-size: 1`，`fetch-max-wait: 100`。
- `ucs-telemetry-store/application.yml` L17 `max-poll-records: 500`，`fetch-min-size: 65536`，`fetch-max-wait: 500`。

### 一层回答
**两个 Topic、两个语义**：
- `ingest` 消费 **`telemetry.raw`**（未校验），职责是 *逐条* Epoch 校验 + 写 Redis + 转发。逐条处理 → 每条的校验结果独立，一条失败不影响下一条 → 批量反而没意义，还会增加单次 poll 的响应时间。
- `store` 消费 **`telemetry.processed`**（已校验），职责是 *批量* JDBC 入库，攒越多一次事务越省 fsync。

### 追问 1（深挖原理）：`fetch-min-size=64KB` + `fetch-max-wait=500ms` 组合是什么机制？

这是 Kafka Broker 侧的**批量优化**：

- Consumer 发 `FetchRequest` 时告诉 Broker："我最少要 64KB，最多等你 500ms"。
- Broker 的行为：
  - 若当前可读数据 ≥ 64KB → 立刻返回。
  - 否则挂起请求，直到攒够 64KB 或到 500ms → 返回当前所有数据。
- 效果：流量低时 **~500ms 延迟**换取批大；流量高时几乎不延迟但批满。
- 对比 `ingest` 的 `fetch-min-size=1, fetch-max-wait=100`：只要有 1 字节就返回，最多等 100ms。目的就是逐条处理。

### 追问 2（深挖实现）：`max-poll-records=500` 和 `batch="true"` 配合时，一次 poll 的实际批大小是多少？

- **`@KafkaListener(batch="true")`**：Spring Kafka 把一次 `consumer.poll()` 拿到的所有 records 直接当 `List<ConsumerRecord<K,V>>` 传给方法（`TelemetryBatchConsumer.consumeBatch(List<...>)`）。
- 实际批大小 = `min(max-poll-records, 本次 Fetch 返回的记录数)`。
- 在高流量下：接近 500 条/批 → 单次事务处理 500 条 → `batchInsert` 再以 500 一批 flush → 吞吐最大化。
- 低流量下：500ms 等完可能只有 10 条 → `batchInsert` 仍走 JDBC batch（只是批小）→ 延迟不漂移。

### 追问 3（边界 / 权衡）：如果 ingest 也用 batch 处理会怎样？

- **优势**：减少 Kafka 拉取次数、减少 Redis 调用（可以 pipeline）。
- **代价**：
  - 逐条的 Epoch 校验失败不应跳过整批，代码要更复杂（抽出失败记录，成功的仍转发）。
  - 转发到 `telemetry.processed` 如果攒批 → 延迟增加 → 前端推送延迟增加。
- **实测数据**（项目目标）：`ucs-telemetry-ingest` 设计吞吐 ~10k msg/s（50 架×10Hz×20 字段），单条 <3ms 处理时间，不需要 batch 也能 hold 住。
- 也就是说，**ingest 的瓶颈不是 Kafka poll，而是 Redis/Kafka 写**；batch 并不能显著提升。反而 `concurrency=4` 横向扩展是更合适的优化。

---

## Q7 — `commandProcessorPool` 为什么要用 `DiscardOldestPolicy`？

### 典型场景
批量指令风暴：调度系统突然对 50 架飞机同时触发"返航"，一瞬间 50 条 `commands.down` 涌入 ucs-command。`commandProcessorPool` 被打满，新来的任务怎么办？

**定位**：`ucs-platform/ucs-command/src/main/java/com/ucs/command/config/ThreadPoolConfig.java`，L30-43。

### 一层回答
```java
new ThreadPoolExecutor(
    4,                                             // core
    16,                                            // max
    60L, TimeUnit.SECONDS,
    new LinkedBlockingQueue<>(256),                // queue
    namedThreadFactory("cmd-processor"),
    new ThreadPoolExecutor.DiscardOldestPolicy()   // reject policy
);
```

当 `max=16` 满 + `queue=256` 满 + 再来第 273 条任务：**DiscardOldestPolicy** 丢掉队列最前面的那条（最早入队的），把新的塞进去。

**原因**：绝不能让 Kafka Consumer 线程被阻塞（HA-first）。

### 追问 1（深挖原理）：为什么不用 `CallerRunsPolicy`？它不是更"稳"吗？

`CallerRunsPolicy` 的行为是"谁提交给我就让谁自己跑"——这里"谁"就是 Kafka Consumer 的 `poll()` 线程。

后果：
1. Consumer 线程阻塞在跑命令逻辑（几十毫秒 ~ 几秒，取决于下游响应）。
2. `max.poll.interval.ms=600000`（10 分钟）：期间 Consumer 不 poll。如果处理一批用了 10 分钟以上，`ConsumerCoordinator` 认定它"挂了"，触发 **rebalance**。
3. Rebalance 期间整个组暂停消费；rebalance 完成后分区被别的实例领走；等这个实例回来又 rebalance 一次……**可用性直线下降**。

`DiscardOldestPolicy` 让 Consumer 线程**永不阻塞**：submit 瞬间返回，poll 持续。老任务被丢弃可以用业务层幂等/重试兜底。

### 追问 2（深挖实现）：`queue=256` 和 `core=4 / max=16` 怎么配合？扩容触发点在哪？

`ThreadPoolExecutor` 的经典行为：

1. 活跃线程 < `core=4` → 直接 new thread。
2. 活跃线程 = 4，队列没满（<256）→ **入队**，不新建线程。
3. 活跃线程 = 4，队列满 → 新建线程，直到活跃 = `max=16`。
4. 活跃 = 16 且队列满 → 触发 `RejectedExecutionHandler`（这里是 DiscardOldest）。

也就是说，只有队列先被装满，才会触发从 4 扩到 16 的**二次扩容**。这个设计意味着"**突发峰值先攒队列，再扩线程**"——对 CPU 友好。

`allowCoreThreadTimeOut(true)`：空闲 60s 后，连 core=4 也允许被回收。

### 追问 3（边界 / 权衡）：丢掉的指令会怎么办？用户怎么知道？

- 按 `DiscardOldestPolicy` 的源码：`e.getQueue().poll(); e.execute(r);` — 只是 silently 丢弃，没异常、没日志。
- **业务补偿**：`IdempotencyService` 的 SETNX 已在 REST Controller 入口完成；丢弃发生在"队列排队阶段"（业务逻辑未执行），SETNX 锁可能已持有 → 需要在 reject 分支 **release 幂等锁 + 记 metrics**。
- 项目改进点（注释 L22 有提到 "The rejected command is logged + metrics counter incremented for alerting"）：应在拒绝回调里打印 warn 日志 + Prometheus counter `command_rejected_total`，运维看到后触发扩容。
- **用户感知**：REST `POST /api/v1/commands/takeoff` 在 Kafka 写成功时就返回 200，用户看不到后端内部拒绝。这里依赖的是 `commands.ack` 轮询：几秒内没收到 ack → 前端显示"指令未响应"→ 用户可以手动重试。

---

## Q8 — 虚拟线程 `spring.threads.virtual.enabled=true` 到底改了什么？

### 典型场景
所有 Java 微服务 `application.yml` 开头都有：
```yaml
spring:
  threads:
    virtual:
      enabled: ${VIRTUAL_THREADS_ENABLED:true}
```
但 `CommandProcessorPool` 仍然用 `ThreadPoolExecutor`，没改成虚拟线程。这个配置到底影响了谁？

**定位**：`ucs-telemetry-ingest/application.yml` L5-8；`ucs-command/ThreadPoolConfig.java` 保留传统池。

### 一层回答
`spring.threads.virtual.enabled=true` 在 Spring Boot 3.2+ (Java 21+) 会让以下路径自动切到 **虚拟线程**：

1. **Tomcat**：每个 HTTP 请求 → 1 个虚拟线程（`AsyncTaskExecutor` 替换为 `VirtualThreadTaskExecutor`）。
2. **`@Async`**：默认 executor 变成虚拟线程执行器。
3. **Spring Kafka 的 `ListenerContainer`**：如果 `concurrency>1`，容器线程是平台线程（不变），但 `KafkaListener` 方法内部如果 `@Async` 调用下游会走虚拟线程。
4. **`@Scheduled`**：同样切到虚拟线程池。

**没改**的是自己手动 `new ThreadPoolExecutor(...)` 创建的池——如 `ThreadPoolConfig.commandProcessorPool`。这是因为 **命令派发是 CPU + 外部 I/O 混合，且有明确的拒绝策略需求**，维持传统池更可控。

### 追问 1（深挖原理）：虚拟线程为什么对 I/O 密集型特别友好？

- 传统平台线程：1:1 绑定 OS 线程，OS 调度、开销 ~MB 栈、切换成本高。Tomcat 默认 200 线程 → 并发上限 200。
- 虚拟线程：由 JVM 调度，**挂起/阻塞在 I/O 时自动让出 carrier 线程**，其他虚拟线程可以继续跑。成本极低（几 KB 栈），JVM 里开几百万都不夸张。
- 对项目的意义：`ucs-telemetry-ingest` 里每条记录都做 Redis HSET + Kafka send，两次 I/O 各 ~1ms。平台线程模型下 `concurrency=4` 意味着最多 4 条在跑；虚拟线程下 Redis 阻塞时 carrier 被让出，4 条可以"同时在跑但位置不同"——有效并发 ≈ 40+。

### 追问 2（深挖实现）：`synchronized` 和 `ThreadLocal` 在虚拟线程下有什么坑？

- **`synchronized`**：Java 21 下，在 `synchronized` 块里调用阻塞 API 会 **pin（锁定）carrier 线程**——虚拟线程不能让出，等于退化成平台线程。项目应把这类代码换成 `ReentrantLock`。
- **`ThreadLocal`**：虚拟线程每次运行可能绑到不同的 carrier，但 ThreadLocal 仍是**线程本地**（Virtual Thread 本身也被视为一个 "thread"）。所以通常没问题，但**百万级虚拟线程时 ThreadLocal 是内存风险**——它的 Map 永久持有。推荐用 `ScopedValue`（Java 21 预览）。
- 项目里：`TelemetryRawConsumer.consume()` 方法主要调 `EpochValidationService` 和 `redisService`，这些都基于 Lettuce（Netty 异步非阻塞）→ 不会 pin。`jdbcTemplate.batchUpdate` 是阻塞 JDBC → 但在 `ucs-telemetry-store` 这块设置了 `concurrency=4`，实际接入数不会爆。

### 追问 3（边界 / 权衡）：为什么不全部都上虚拟线程？

- **CPU 密集任务**不适合：虚拟线程的价值在"挂起让出"，纯 CPU 任务无挂起点，切换反而是开销。
- **需要精确的拒绝策略/背压**：`ThreadPoolConfig.commandProcessorPool` 里 `DiscardOldestPolicy` 这种行为，虚拟线程模型里不好实现（虚拟线程理论"无限"，不会触发拒绝）。
- **数据库连接池本身是瓶颈**：HikariCP `maximum-pool-size=20`。虚拟线程再多，能同时打开的连接还是 20，超过就排队等连接。虚拟线程反而让"等连接的线程"占用 JDK 内部资源更久。
- **结论**：请求入口（Tomcat）用虚拟线程；下游 I/O 调用走非阻塞客户端（Lettuce/Reactor Kafka 也可以）；纯派发/限流/批处理仍用传统池。项目选择是合理的"混合模式"。

---

## Q9 — 分区映射的 Redis 和 PG 是怎么保证双写一致性的？

### 典型场景
Commander 用户在管理面板给无人机 `px4_5` 加上了新分区 `team_alpha`。这个变更写 PostgreSQL `drone_partition_map` 表，**同时**要写 Redis `drone:px4_5:partitions` Set（下次 push 服务广播要用到）。两边必须一致，否则：
- DB 写成功、Redis 没写 → 前端看不到这架飞机出现在 team_alpha 里。
- Redis 写成功、DB 事务回滚 → Redis 多了幻影映射，重启就消失。

**定位**：`ucs-business/src/main/java/com/ucs/business/service/PartitionRoutingService.java` L28-65（大段注释）。

### 一层回答
采用 **Transactional Outbox + Post-Commit Hook + 重试队列 + 周期对账** 四件套：

1. **DB-first 写**：`@Transactional` 方法里 `UPDATE drone_partition_map`。PG 是 source of truth。
2. **afterCommit 回调**：注册 `TransactionSynchronization.afterCommit()`，在事务提交成功后才写 Redis。
3. **失败入队**：afterCommit 里写 Redis 失败 → 操作被 `Runnable` 化并入 `ConcurrentLinkedQueue<Runnable> pendingRedisSyncQueue`。
4. **周期对账**：`@Scheduled(fixedDelay=60_000)` + `@SchedulerLock` 每 60s：扫队列重试 + 全量对账（DB `findAllActive` vs Redis Set，补差异）。

### 追问 1（深挖原理）：为什么不用"延迟双删"？它经典缺陷是什么？

延迟双删：`删 Redis → 写 DB → sleep N 毫秒 → 再删 Redis`。

缺陷：
1. **N 是玄学**：生产环境 DB 写延迟抖动 5ms~500ms；N 设小了还没失效就读到旧值，N 设大了业务长时间看不到新值。
2. **第二删失败无兜底**：如果第二次删 Redis 失败（Redis 抖动），脏 cache 就长期存在，只能等 TTL 自动过期。
3. **不适配事务回滚**：第二次删发生在"可能的事务之外"。如果 DB 事务在 sleep 期间回滚（很少见但理论可能），删掉的 Redis 又回填不了。

Post-Commit Hook 精确解决这些：
- **确定性保证**：Redis 写绝不会在 DB 回滚情况下执行（afterCommit 只在成功 commit 后触发）。
- **有重试**：失败入队，周期对账兜底。
- **无玄学 sleep**：写 Redis 紧跟 commit，延迟仅 = 网络 + Redis 操作 ~1ms。

### 追问 2（深挖实现）：`TransactionSynchronization.afterCommit()` 内部机制是什么？如果服务在 commit 后、afterCommit 执行前挂了会怎样？

- **机制**：`@Transactional` 代理在 Spring `TransactionSynchronizationManager` 维护一个 `synchronizations` 列表。事务 commit 成功后，Spring **同步地**调用所有注册的 `afterCommit()`。
- **失败窗口**：commit 返回成功 → 进程 JVM crash → afterCommit **没机会跑** → Redis 没写。重启后 pendingRedisSyncQueue 也是内存结构，已丢失。
- **兜底**：`@Scheduled` 每 60s 的全量对账：从 DB 查所有 `isActive=true` 的 `DronePartitionMap`，逐个比对 Redis Set，缺的补上、多的删掉。60s 内收敛。
- **极端优化**：把 pendingRedisSyncQueue 改成 Redis List 或 DB outbox 表。但成本太高，项目选择 60s 内存级对账，够用。

### 追问 3（边界 / 权衡）：对账任务多实例会抢着跑吗？性能开销多大？

- **多实例**：`@SchedulerLock(name="...reconcile...", lockAtMostFor="30m", lockAtLeastFor="5m")` → 同一时刻只有一个实例跑。ShedLock 用 Redis SET NX PX 实现分布式锁。
- **开销**：
  - DB 查全量 `SELECT uavId, partitionName FROM drone_partition_map WHERE is_active=true`（有 `(partition_name, is_active)` 索引）。假设 10k 架飞机 × 平均 2 分区 = 20k 行，单次查询 <100ms。
  - Redis 逐个比对：20k 次 SISMEMBER，pipeline 化后 <500ms。
  - 总耗时 ~1s，60s 跑一次，CPU 占用率 <1%。
- **不跑会怎样**：
  - 正常流程 99% 情况下不会失败；对账真正触发修正的频次 < 每天一次。
  - 关掉对账后，偶发不一致的窗口会从 60s 拉到 "永久"（直到 TTL/重启）。不可接受。

---

## Q10 — 遥测 Redis 状态写失败为什么允许继续转发？

### 典型场景
Redis 节点重启，断 3 秒。期间 50 架飞机的遥测继续以 10Hz 到达 `ucs-telemetry-ingest`。代码里 `redisService.updateDroneState(...)` 抛异常。此时 `TelemetryRawConsumer` 应该中止消费吗？

**定位**：`TelemetryRawConsumer.java` L68-103（3 步 try/catch 独立 + 第 4 步 CRITICAL）。

### 一层回答
**不中止**：

```java
// 2. Redis update (each step independent — Redis failure must NOT block forward)
try { redisService.updateDroneState(uavId, stateMap); ... }
catch (Exception e) { log.warn("[Ingest] Redis update failed ..."); }

// 3. GeoHash
try { geoService.updateDronePosition(...); } catch (Exception e) { log.warn(...); }

// 4. CRITICAL: Forward to telemetry.processed — MUST succeed
try { kafkaTemplate.send(...); } catch (Exception e) { log.error("CRITICAL: ..."); }
```

Redis 是**旁路缓存**（secondary），Kafka `telemetry.processed` 是**数据主链路**。Redis 失败 → 降级为 warn，继续转发；Kafka 失败 → 错误码 ERROR + "CRITICAL"，告警。

### 追问 1（深挖原理）：Redis 短暂不可用时，下游 `ucs-realtime-push` 会受什么影响？

`ucs-realtime-push` 自己也要用 Redis（`redisClusterService.getDronePartitions(uavId)` 查分区）。Redis 挂的时候：
- `getDronePartitions` 返回空 Set（代码有 try/catch 降级 L87-89 `RedisClusterService.java`）。
- 该架飞机暂时**不会被推到任何分区 Topic**，但仍会进全量 `/topic/telemetry`。
- 前端大屏仍显示，只是分区视图缺失。
- Redis 恢复后，下一帧遥测 100ms 后重新填充 `drone:*:partitions` Set，恢复正常。

**最坏情况**：Redis 挂掉 2 分钟 → 1200 帧分区视图丢失；全量视图不受影响 → 运营有感但非事故级。

### 追问 2（深挖实现）：如果 Kafka 转发失败（第 4 步），offset 还会提交吗？

- Spring Kafka 默认 `AckMode=BATCH`：本次 poll 的所有消息**方法返回后**自动提交 offset。
- 代码第 4 步 `catch (Exception e) { log.error(...); }` **吞了异常**，方法正常返回 → offset 仍会被 commit。这意味着该条消息"被跳过且丢失"。
- 改进空间：
  - 选项 A：throw 出去让 `DefaultErrorHandler` 走 DLQ（死信队列）。
  - 选项 B：在 catch 里把消息写本地 disk 或 `kafka-retry` topic 延迟重试。
  - 现状：项目把这个选项留给了"运维告警"——`log.error("CRITICAL: ...")` 会被 Prometheus alert rule 抓到，人工介入。
- **权衡**：遥测是 10Hz 流式数据，单条丢掉无感知；构建复杂的 DLQ 重放逻辑反而增加运维复杂度。

### 追问 3（边界 / 权衡）：如果 Redis 长时间不可用（24h），Epoch 校验会怎样？

- `EpochValidationService.validate()` 里 catch 到 Redis 异常：
  ```java
  catch (Exception e) {
      log.debug("[Epoch] Redis unavailable ..., allowing message");
      return true;  // ← 降级：放行
  }
  ```
- 也就是说**Redis 挂时 Epoch 校验整体失效，全部放行**。24h 内如果遇到"网关重启 → 老指令残留"的场景，残留指令会被消费并执行。
- 这个设计是**可用性优先**：宁可偶尔放一条过期指令，不要让整个消费链路卡住。
- 业务层补偿：
  - 网关本身也在 Redis 重连后立刻把 epoch 重新 `INCR` 写入，Redis 恢复瞬间就有新的 epoch baseline。
  - 指令幂等（SETNX）独立于 Epoch，即便 Epoch 失效，同一 `requestId` 仍不会被执行两次。

---

## Q11 — `batchInsert` 为什么能做到 50k rows/s？

### 典型场景
`ucs-telemetry-store` 需要把 `telemetry.processed` 消息持久化到 TimescaleDB `telemetry_data` hypertable。目标吞吐 >50k rows/s。单机怎么做到？

**定位**：`TelemetryRepository.batchInsert` + `TelemetryBatchConsumer.consumeBatch` + `application.yml`。

### 一层回答
关键是**四层叠加的批量**：

1. Kafka Broker：`fetch-min-size=64KB, fetch-max-wait=500ms` → 每次 Fetch 接近满载。
2. Kafka Consumer：`max-poll-records=500` → Listener 一次拿到最多 500 条。
3. `@KafkaListener(batch="true")` → 方法参数就是 `List<ConsumerRecord>`。
4. JDBC `batchUpdate(INSERT_SQL, records, 500, setter)` → 500 条一个 batch，`PreparedStatement.executeBatch()` 合并一次网络往返。

配合 `concurrency=4` 横向并行、HikariCP `maximum-pool-size=20`。

理论吞吐：4 并行 × 500 条/batch ÷ 20ms（单 batch 耗时）= 100k rows/s；实际受 TimescaleDB chunk 写入和 WAL fsync 限制，大约 50k rows/s。

### 追问 1（深挖原理）：`jdbcTemplate.batchUpdate` 在 JDBC 协议层做了什么？

- 标准 JDBC Batch：多次 `addBatch()` + 一次 `executeBatch()`。JDBC 驱动会把 N 条 SQL 攒成一个**网络 packet** 发给数据库。
- PostgreSQL JDBC 驱动特别处理：若 URL 里加 `reWriteBatchedInserts=true`，驱动会把 N 次 INSERT 合并成一条 `INSERT ... VALUES (...), (...), (...)` 多值语句，进一步减少 parse/plan 开销。
- 项目代码里 `jdbc:postgresql://...` 默认没开 `reWriteBatchedInserts`。如果开启，吞吐可再翻倍。
- **为什么 500 一批**：
  - 太小（如 50）：网络往返成本占比高。
  - 太大（如 5000）：`PreparedStatement` 参数个数达到 PG 上限（int16 = 32767；每行 10 参数 → 3276 行上限）。
  - 500 × 10 = 5000 参数，远低于上限，且一次 packet ~50KB 是 TCP/BDP 友好大小。

### 追问 2（深挖实现）：TimescaleDB hypertable 对批量写入有什么特殊优化？

- **Hypertable**：对 `telemetry_data` 按 `time` 字段自动分片到多个 `chunk`（默认 7 天一个）。
- **按 chunk 并行写**：一批 500 行如果都落在同一 chunk，可用 chunk-local WAL 并行；跨 chunk 时每个 chunk 独立写入。
- **索引策略**：`(uav_id, time DESC)` 复合索引。写入成本 ~ log(n) per chunk，chunk 小 → 索引浅 → 写入快。
- **压缩**（可选）：旧 chunk (>30 天) 可以列存压缩，存储 5× 节省，但写入要避开压缩窗口。
- **Retention Policy**：`DataRetentionService` 周期删除老 chunk（见 `ucs-telemetry-store/src/main/java/com/ucs/store/service/DataRetentionService.java`），防表爆炸。

### 追问 3（边界 / 权衡）：如果一条 INSERT 失败（数据错误），整批会回滚吗？

- `jdbcTemplate.batchUpdate` 不开显式事务时走自动提交：
  - 默认行为依赖 JDBC 驱动：PG 驱动一旦 batch 中某条失败，`executeBatch` 抛 `BatchUpdateException`，返回的 `int[][]` 里 `Statement.EXECUTE_FAILED=-3`。
  - 方法里 `for (int r : batchResult) if (r >= 0) totalInserted++;` **累加成功行数**，失败的静默跳过。
- **优点**：不因一条脏数据全批回滚。
- **缺点**：丢失错误上下文。项目里 catch 了顶层 `Exception`，只打日志 `log.error("Batch insert failed: {}", e.getMessage())`。
- **改进**：
  - 在 `setter` 里预校验字段（非 null、数值范围）。
  - 失败单独写 `dead-letter.raw` topic，手动审核。
  - 现状：项目评估成本后选择"打日志 + 丢弃"——时序数据可接受亚秒级脏数据损失。

---

## Q12 — WebSocket `partitionName` 的映射和推送隔离是怎么做的？

### 典型场景
用户 `zhangsan`（id=2，role=pilot）登录系统。她应该看到：她管理的 5 架飞机 + commander/observer 全局分区。其他用户 `lisi` 不应看到 `zhangsan` 管的飞机细节。

**定位**：
- 分区名计算：`PartitionNameUtil.computePartitionName` L24。
- 登录返回：`AuthService.login` L82-91。
- 后端广播：`WebSocketGatewayService.broadcastToPartitions`。
- 前端订阅：`/topic/telemetry/partition/{partitionName}`。

### 一层回答
分区名按 *角色 + 用户* 确定性计算，Redis Set 存"一架飞机属于哪些分区"，广播时按分区分组消息。前端只订阅"自己 partitions 数组里的 topic"，就看不到别的分区的数据。

计算规则：
- `observer` 角色 → 固定 `"observer"`
- `commander` 角色 → 固定 `"commander"`
- `pilot/leader/operator` → `{姓氏首字母}{名字首字母}_{userId}`，如 `zhangsan id=2` → `"zs_2"`

### 追问 1（深挖原理）：分区与无人机的关系存在哪里？怎么查询？

- **PostgreSQL**：`drone_partition_map` 表，`(uav_id, partition_name, is_active, ...)`。
- **Redis（读优化）**：`drone:{uavId}:partitions` → `Set<partitionName>`，以及反向 `partition:{partitionName}:drones` → `Set<uavId>`。
- 查询路径（`PartitionRoutingService.getPartitionsForDrone`）：
  1. Redis 读 Set → 命中即返回。
  2. Miss → 查 DB 布隆过滤器（L88-92，10 万量级 1% 误判）→ DB。
  3. 空值缓存：DB 也查不到 → 写入 `drone:{uavId}:partitions:null` TTL 60s（防穿透）。
- 写入路径走 Q9 的 afterCommit 双写。

### 追问 2（深挖实现）：`broadcastToPartitions` 具体做了什么？如果一架飞机属于多个分区，会被推几次？

`TelemetryKafkaConsumer.broadcastToPartitionsNow`（也叫做 `TelemetryPushConsumer` 的同名流程）：

```java
Map<String, List<Map<String, Object>>> partitionData = new LinkedHashMap<>();
for (drone in allDroneSnapshot) {
    Set<String> partitions = partitionRoutingService.getPartitionsForDrone(uavId);
    for (String p : partitions) {
        partitionData.computeIfAbsent(p, k -> new ArrayList<>()).add(droneData);
    }
}
webSocketGatewayService.broadcastToPartitions(partitionData, now);
// -> messagingTemplate.convertAndSend("/topic/telemetry/partition/" + p, msg)
```

- 一架飞机属于 2 个分区（如 `observer` + `zs_2`），`convertAndSend` 会被调用 2 次——**每个分区 Topic 上都带一次这条飞机**。
- 订阅 `observer` 的用户和订阅 `zs_2` 的用户都能看到。
- 对比"在消息里标记属于哪些分区让前端自己过滤"：后端多发一份的开销很小（STOMP broker 是引用转发），但安全性好得多——前端想看不是自己分区的 topic 需要显式订阅，订阅权限可在 server 端加 interceptor 拦截。

### 追问 3（边界 / 权衡）：这种"业务层隔离"算不算安全隔离？绕过方式是什么？

**这是业务层隔离，不是安全隔离**。

- 前端用户如果手动构造 STOMP SUBSCRIBE 到 `/topic/telemetry/partition/commander`，**后端默认不拒绝**——STOMP SimpleBroker 不做订阅权限。
- 绕过实测：浏览器 console 里执行 `client.subscribe('/topic/telemetry/partition/commander', console.log)` 直接就能收到全量数据。
- **如果要强安全隔离**：
  - 方式 A：加 `ChannelInterceptor` 拦截 `SUBSCRIBE` 帧，校验 JWT claims 里的 partition 列表是否包含目标 partitionName。
  - 方式 B：用 Spring Security 的 `@MessageMapping` + `@PreAuthorize`。
  - 方式 C：敏感数据走 user destinations `/user/queue/...`（Spring 自动按 sessionId 隔离）。
- 现状选择：**UCS 是内网工具，运维背景的内部用户**，业务隔离 + JWT 先过 Gateway 已经够用。生产级做法推荐加 SUBSCRIBE 拦截。

---

## Q13 — 视口过滤的 GeoHash 为什么比 `GEORADIUS` 更合适？

### 典型场景
大屏地图从"中国全国"缩放到"某小区 1km × 1km"。这时 50 架飞机分布全国，只有 3 架在视口内。前端希望后端推"这 3 架的详细数据"，其他 47 架忽略。

**定位**：`ViewportController.updateViewport` L33-55；`GeoSpatialService.getDronesInViewport` L63-79；`GeoHashUtil`。

### 一层回答
代码实际实现的是 **GeoHash 覆盖法**：

```java
public Set<String> getDronesInViewport(double minLat, double maxLat, double minLon, double maxLon) {
    Set<String> geoHashes = GeoHashUtil.coverBoundingBox(minLat, maxLat, minLon, maxLon);
    for (String hash : geoHashes) {
        Set<String> members = redisTemplate.opsForSet().members("geohash:" + hash);
        result.addAll(members);
    }
    return result;
}
```

- `coverBoundingBox`：把视口拆成若干个 GeoHash 单元格（根据 zoom 确定 precision）。
- 每个单元格一个 Redis Set (`geohash:{hash}` → `Set<uavId>`)，`SMEMBERS` O(k)。
- 总耗时 = O(cells × 每 cell 飞机数)。视口通常覆盖 4-9 个 cells。

**对比 `GEORADIUS`**（代码里 `getDronesNearby` 用到）：
- `GEORADIUS` 是"以点为中心 + 半径"的圆形查询，视口是**矩形**，不能精确匹配（要么算外接圆多查、要么算内接圆少查）。
- `GEORADIUS` 底层也是 GeoHash 网格扫描，Redis 内部做的，O(log n + k) 类似。
- 但 `GEORADIUS` 每次都扫整个 `drone:positions` 有序集合（Z-order index），O(log n) 中 n = 全量飞机数；GeoHash 单元格 Set 的 n = 单元格内的飞机数，**基数更小**。

### 追问 1（深挖原理）：GeoHash 是怎么把二维坐标压成一维字符串的？

- GeoHash 是对经纬度交替二分后编码成 base32 字符串。每增加 1 字符，精度提高约 32 倍。
- 常用精度：
  - precision=5 → ~4.9km × 4.9km
  - precision=7 → ~153m × 153m
  - precision=9 → ~4.8m × 4.8m
- 关键性质：**前缀相同 → 位置相近**。所以"一个矩形视口"可以用 `前缀匹配`+ 有限数量的"相邻单元格"表达。
- `coverBoundingBox` 的实现思路：
  1. 根据 BBox 大小选 precision（大视口 precision=4，小视口 precision=7）。
  2. 扫描 BBox 内所有 GeoHash cell，返回 Set。
  3. 对每个 cell 的反向索引 Set 取并集。

### 追问 2（深挖实现）：`geohash:{hash}` 这个 Set 是谁维护的？飞机移动时怎么办？

`GeoSpatialService.updateDronePosition`（`TelemetryRawConsumer` 第 3 步调用）：

```java
public void updateDronePosition(String uavId, double lat, double lon) {
    redisTemplate.opsForGeo().add(DRONE_POSITIONS_GEO, new Point(lon, lat), uavId);  // GEO 索引
    String geoHash = GeoHashUtil.encode(lat, lon);
    redisTemplate.opsForSet().add("geohash:" + geoHash, uavId);  // 反向索引
}
```

**问题**：飞机从 cell A 飞到 cell B，cell A 的 Set 里还留着旧 uavId，导致"飞机已经飞走了但视口里仍看到它"。

代码层面的处理：
- `TelemetryRawConsumer` 每 100ms 调一次 `updateDronePosition` → 飞机 100ms 内跑完一个 GeoHash cell 的距离 → 需要 cell 够大（precision ≤ 6，即 >600m）或飞机够慢（<16m/s）。
- `removeDronePosition` 需要知道上一帧的 cell，但这信息没存——代码只在飞机离线时调 `removeDronePosition(uavId, lastLat, lastLon)`，飞行途中不清理。
- **结果**：视口查询会偶发返回"刚飞离的飞机"——误差 1 cell 宽（150m-4.8km），业务可接受。
- **更精确做法**：用 Redis `GEORADIUS`（Z-order 数据结构，移动时自动更新坐标，无需反向索引）。代码在 `getDronesNearby` 里用，但视口查询没用——因为 BBox 不是圆。

### 追问 3（边界 / 权衡）：如果用 PostGIS 的 `ST_Within` 查询，会不会比 Redis 方案更准？

- **准确性**：`ST_Within(point, bbox)` 对每架飞机实时判定，无延迟，无噪声。
- **性能**：每次视口变化 = 一次 SQL → DB 压力。假设 100 用户同时拖地图，每秒产生 100 次 `ST_Within` → DB QPS 100。
- **Redis 方案**：
  - 写侧：每帧遥测写一次 GEO + Set，总 QPS = 50 架 × 10Hz = 500。
  - 读侧：视口查询 SMEMBERS × 几个 cell，QPS 几乎为 0（只在用户拖动时）。
  - **读远高于写的系统里，Redis GeoHash 更优**。
- **实时性**：项目用 Redis 牺牲 100ms-1s 的位置精度，换 10 倍查询性能和 TimescaleDB 的低负载。实时看板可接受；如果做"精准几何查询"（飞机是否越过禁飞区）要用 PostGIS。

---

## Q14 — Epoch 机制到底防什么？它和 Kafka 消费位点是什么关系？

### 典型场景
DDS 网关 v1 实例崩溃，K8s 拉起 v2 实例。在 v1 挂掉前的 5 秒里，ucs-command 发了"起飞"命令到 `commands.down`（未被 v1 消费）。v2 启动后消费到这条 5 秒前的命令，应该执行吗？

**定位**：
- 网关侧：`mavlink_gateway.py` L159-162（`_epoch_map` + `self._redis_epoch_prefix = 'dds:epoch:'`）。
- 后端侧：`EpochValidationService.java` L41-67 `validate(uavId, msgEpoch)`。
- 与位点的区别：Kafka offset 是"这条消息读过没"，Epoch 是"这条消息相对于当前'代次'算不算过期"。

### 一层回答
Epoch = **网关实例的"任期代数号"**：

- 网关启动：`redis.incr('dds:epoch:' + uav_id)` 把每架飞机的 epoch +1。
- 网关发遥测时：`msg.epoch = self._epoch_map[uav_id]`。
- 后端发指令时：`command.epoch = current_epoch_from_redis`。
- 消费端（Gateway 收 command / ucs-telemetry-ingest 收遥测）：比较 `msgEpoch >= currentEpoch`，`<` 即过期丢弃。

**具体场景**：v1 任期 epoch=5，发的遥测标 epoch=5。v1 挂 → v2 启动 → `INCR` 到 6。v2 消费 5 秒前 ucs-command 发的"起飞"（那条指令标 epoch=5）→ `5 < 6` → 丢弃。用户看到"指令未响应"，手动重试 → 新指令标 epoch=6 → 执行。

### 追问 1（深挖原理）：Epoch 和 Kafka 消费位点（offset）的分工？

- **Offset**：Kafka Broker 记录的"这个 ConsumerGroup 消费到第几条"。offset 的目的是"重启后不重复消费"。
- **Epoch**：业务层语义的"这个消息/指令属于哪代网关"。offset 不知道也不关心业务代数。
- **配合使用**：
  - v2 启动后从 `commands.down` 的上次 offset 开始消费 → 可能消费到"v1 时代"残留的指令 → Epoch 过滤掉。
  - 即使有人手动 reset offset 到 earliest 重放，Epoch 仍然生效——旧 epoch 永远被新代数拒绝。
- **一个不是另一个的替代品**：Offset 保消费进度，Epoch 保业务新鲜度。

### 追问 2（深挖实现）：`periodicMaintenance` 里把 epoch > 10000 归一化为 1，为什么？会不会与"后发 epoch 更大"冲突？

```java
@Scheduled(fixedRate = 6 * 60 * 60 * 1000)
@SchedulerLock(name = "epochMaintenance", ...)
public void periodicMaintenance() {
    ScanOptions options = ScanOptions.scanOptions().match("epoch:*").count(200).build();
    // ...
    if (epoch > EPOCH_SOFT_LIMIT /* 10_000 */) {
        redisTemplate.opsForValue().set(key, "1", TTL_HOURS, TimeUnit.HOURS);
    }
}
```

- **防 overflow**：`INCR` 累积多年后可能溢出 long，虽然还远，但代码保守 cap 10000。
- **冲突处理**：归一化瞬间 epoch 从 10001 → 1。此时如果有 "epoch=9998" 的消息在飞 → 进入 `validate` 时 current=1，msg=9998 → `msg > current` 被认为是新消息 → 更新 epoch=9998 → 跳回去了。
- 这个归一化**不是原子与指令流**的，严格说有瞬时不一致窗口。但 6 小时一次 + 维护锁持续 5-30 分钟 + 业务层有幂等兜底 → 风险极低。
- 实际 `EPOCH_SOFT_LIMIT=10000` 表示"10k 次网关重启+每个 uav_id 单独递增"——日常运行 1 个月也不会触发，只是防御性代码。

### 追问 3（边界 / 权衡）：如果所有 Epoch 都归零，会发生什么？怎么恢复？

- **Redis 灾难清空**：所有 `epoch:*` key 消失。
- 之后：
  - `validate(uavId, msgEpoch)` 里 `currentStr == null` → `current = 0L` → 任何 `msgEpoch >= 0` 都通过。
  - 网关侧 `redis.incr` 把 `epoch:px4_1` 从 0 加到 1。
  - 新的消息 epoch = 1，发出去。
- 恢复窗口：若在清空期间 `commands.down` 里有 "旧 epoch = 5" 的残留未消费 → 清空后看到 current=0 → 通过 → 可能被错误执行。
- **设计兜底**：
  1. `IdempotencyService.tryAcquire(requestId)` — 10 分钟 TTL，即便 Epoch 失效，同一 requestId 10 分钟内不会被执行两次。
  2. `commands.down` 积压一般 <1 秒（Gateway 在线消费），极端场景也 <1 分钟（Gateway 重启期）——残留指令在用户重试后被新指令覆盖意图。
- **运维建议**：Redis 做持久化（AOF + RDB）+ 主从；Epoch 灾难场景几乎不会出现。

---

## Q15 — 命令幂等：`SETNX` + TTL 的"单刀匕首"靠谱吗？

### 典型场景
前端点"起飞"按钮，用户手抖点了 3 次。3 个请求几乎同时到达 `ucs-command`。我们希望真机**只起飞一次**。

**定位**：`ucs-command/src/main/java/com/ucs/command/service/IdempotencyService.java`。

### 一层回答
```java
public boolean tryAcquire(String requestId) {
    Boolean result = stringRedisTemplate.opsForValue()
            .setIfAbsent("cmd:idempotent:" + requestId, "1", Duration.ofMinutes(10));
    return Boolean.TRUE.equals(result);
}
```

`SET key value NX EX 600` 是 Redis 原子操作：

- 同一 requestId 第 1 次 → `setIfAbsent` 返回 true，允许执行。
- 第 2、3 次 → 返回 false，拒绝。
- 10 分钟后 TTL 过期 → 允许同一 requestId 重新提交（"10 分钟"是业务窗口，超过视为全新请求）。

### 追问 1（深挖原理）：为什么不是 `SET` 再 `EXISTS`？有什么竞态？

朴素错误实现：
```java
if (redis.exists(key)) return false;  // A
redis.set(key, "1");                   // B
```

两个线程几乎同时过了 A 判断（都看到 key 不存在）→ 都走到 B → 都写成功 → 都认为"我是首次" → **幂等失效**。

`SET ... NX` 是 **Redis 侧一次完成的原子 CAS**：要么只有一个客户端把 key 从"不存在"写到"1"，其他返回 nil。单命令不被打断，天然解决竞态。

### 追问 2（深挖实现）：`requestId` 怎么生成？是前端生成还是后端？有哪些坑？

代码里接口 `CommandController.sendCommand` L30-36：
```java
if (command.getCommandId() == null || command.getCommandId().isEmpty()) {
    command.setCommandId(UUID.randomUUID().toString());
}
```

- **前端可传**（推荐）：按钮点击的时候生成一个 UUID，所有重试用同一个 → 即便网络抖动多次提交也只执行一次。
- **后端兜底**：前端没传则后端 UUID。后端兜底意味着"用户连点 3 次 = 3 个 UUID = 3 次执行"——幂等失效。
- 坑 1：**前端如果 form 每次 submit 都重新生成 UUID**，那就等于没做幂等。
- 坑 2：**负载均衡后不同节点看到同一 requestId**？`SETNX` 在 Redis 单点/集群上都是原子，不受后端实例影响。
- 坑 3：`IdempotencyService.release()` 在命令执行失败时调用——但如果失败后马上自动重试，TTL 内拒绝是合理的；`release` 用于"用户明确要求重试且后端知道上次失败"的路径。

### 追问 3（边界 / 权衡）：TTL=10min 后怎么办？如果真机 15 分钟才执行完需要幂等更久怎么办？

- 10 分钟内再传同一 requestId → 被拒绝（commandType=TAKEOFF 可能已执行完，拒绝合理）。
- 超过 10 分钟 → 视为新请求，可能导致重复执行。
- **为什么不做得更长**：
  - Redis 内存：每条 ~100B，10 min × 10 QPS × 指令 = 6000 条 ~600KB，可接受。
  - TTL 太长 → 用户真的想重发相同 requestId 做调试，会被阻塞。
- **更严格场景**（如支付）：
  - 把幂等 key 持久化到 DB（unique index）。
  - 用 Redis 做 fast-path，DB 做 slow-path。
- UCS 的指令不是金融级，SETNX+TTL 10min 足以；释放 key 的能力（`release`）给了"确认失败后立即放行重试"的灵活度。

---

## Q16 — 多级缓存的"击穿、雪崩、穿透"项目里分别怎么处理？

### 典型场景
`MultiLevelCacheService` 做 `drone-state` / `partition-map` 之类的热点查询。峰值下：
- 一条热 key 过期 → 所有请求打到 DB（击穿）。
- 大批 key 同时过期 → DB 雪崩。
- 攻击者伪造不存在的 uavId 查询 → 全部穿透到 DB。

**定位**：`ucs-common/cache/MultiLevelCacheService.java` L18-80；`PartitionRoutingService` L81-101。

### 一层回答
**击穿**：单 key mutex + 逻辑过期 + 异步刷新。

**雪崩**：L2 TTL 随机化（300s ± 30s）+ 降级（Redis 挂返回 stale L1 数据）。

**穿透**：布隆过滤器 + uavId 正则 + 空值缓存（60s）。

### 追问 1（深挖原理）：击穿的"单 key mutex"具体怎么工作？

```java
private final ConcurrentMap<String, ReentrantLock> keyLocks = new ConcurrentHashMap<>();
// ...
if (L1 miss && L2 miss) {
    Lock lock = keyLocks.computeIfAbsent(key, k -> new ReentrantLock());
    if (lock.tryLock(500, TimeUnit.MILLISECONDS)) {
        try {
            // 双检锁
            value = redisTemplate.opsForValue().get(key);
            if (value == null) {
                value = dbLoader.get();      // 只有拿锁的线程查 DB
                // 写回 L2 + L1
            }
        } finally { lock.unlock(); }
    } else {
        // 500ms 拿不到锁 → 返回 stale / null
    }
}
```

- **第一个线程**进来查 DB，写回缓存。
- **后续并发线程**看到 lock 被占 → 阻塞 500ms（`LOCK_TIMEOUT_MS=500`）。
- 这 500ms 内第一个线程大概率已经写完缓存 → 后续线程第二次读 L2 → 命中。
- 第一个线程查 DB 超过 500ms（DB 慢）→ 后续线程超时返回 null，但 DB 只被访问了一次，压力被压住。
- 对比"分布式 Redis 锁"（`SETNX`）：项目用进程内锁，轻量 10x，代价是每实例一次 DB 查询。4 实例 → 最多 4 次并发到 DB，可接受。

### 追问 2（深挖实现）：雪崩的 TTL 抖动和逻辑过期分别做什么？

- **TTL 抖动**：
  ```java
  long jitter = ThreadLocalRandom.current().nextLong(-30, 31);
  long ttl = L2_BASE_TTL_SECONDS + jitter;   // 300 ± 30s
  ```
  1000 个 key 原本 300s 后同时过期 → 加 ±30s 后在 270-330s 之间均匀分布 → 每秒最多失效 1000/60 ≈ 17 个 key，DB 压力平滑。
- **逻辑过期**：
  ```java
  long logicalExpiry = System.currentTimeMillis() + (long)(L2_BASE_TTL_SECONDS * LOGICAL_EXPIRY_RATIO * 1000);
  // LOGICAL_EXPIRY_RATIO = 0.8 → 240s 就"逻辑过期"，但 Redis 物理 TTL 仍是 300s
  ```
  - 240-300s 期间访问：返回 stale 数据 + **异步**在虚拟线程里跑 `dbLoader` 刷新。
  - 300s 后：物理过期，走击穿的 mutex 路径。
  - 好处：用户永远不等 DB（除非冷启动）。

### 追问 3（深挖实现）：穿透的布隆过滤器误判率怎么控制？

- `PartitionRoutingService` L88-92：
  ```java
  BloomFilter.create(Funnels.stringFunnel(UTF_8), 100_000, 0.01);
  ```
  - 10 万预期数量，1% 误判率（`1% 的"不存在 uavId"被放过进 DB`）。
  - 不存在的 uavId 99% 被布隆过滤器拦住 → DB 零压力。
- **叠加 uavId 正则**：
  ```java
  VALID_UAV_ID = "^(px4_\\d+|mav_\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}_\\d+|mavlink_.+)$"
  ```
  格式不对的直接拒绝，不耗布隆过滤器 hash 计算。
- **空值缓存**：`drone:{uavId}:partitions:null` TTL 60s。即使攻击者持续用同一个"格式合法但不存在"的 uavId 攻击，也只打一次 DB。
- **三件套组合后**：攻击者不合法 ID → 正则拒 99.99%；合法 ID 但不在 BF → 拒 99%；漏进来 1% → 空值缓存再拦 60s。

---

## Q17 — 对同一条数据的"增/改/删"并发到达时，数据库和缓存怎么收敛？

### 典型场景
两个管理员同时对 `px4_5` 操作：
- T=0ms  管理员 A 提交"给 px4_5 加分区 team_alpha"。
- T=10ms 管理员 B 提交"从 px4_5 删除所有分区"。
- T=15ms 管理员 A 改成"让 px4_5 只属于 team_beta"。

最终数据库和 Redis 都应该反映：`px4_5 ∈ {team_beta}`。

**定位**：`PartitionRoutingService` 的 `@Transactional` 方法系列（add/remove/updatePartitions）+ Q9 的 afterCommit 机制。

### 一层回答
**"DB 事务串行化 + afterCommit 投影到 Redis + 周期对账"** 三层共同收敛：

1. DB 写 `drone_partition_map` 在 `@Transactional` 边界下，三条操作按 **PG 行锁 + 事务隔离级别（默认 READ COMMITTED）** 串行化：A 先 commit、B 再 commit、A 第二次 commit，最终 DB 里只有 `{team_beta}`。
2. 每个事务 commit 成功后，afterCommit 投影到 Redis：A1 → Redis 加 team_alpha；B → Redis 清空；A2 → Redis 写 {team_beta}。投影顺序 **与 DB commit 顺序相同**。
3. 假如投影过程中 Redis 有一次失败（假设 B 失败），pendingRedisSyncQueue 会重试；60s 对账也会兜底。

最终 DB 和 Redis 都收敛到 `{team_beta}`。

### 追问 1（深挖原理）：为什么"afterCommit 的顺序 = DB commit 顺序"？有什么边界？

- Spring 的 `TransactionSynchronizationManager` 是**线程绑定**的。一个事务的 afterCommit 只会在该事务所在线程里运行。
- A1 在线程 t1 commit → t1 里同步调 afterCommit1 写 Redis。
- B 在线程 t2 commit → t2 里同步调 afterCommit_B 写 Redis。
- A2 在线程 t3 commit → t3 里同步调 afterCommit_A2 写 Redis。
- **如果三个 afterCommit 并行**：Redis 操作本身不是幂等的（SADD/SREM/SET 顺序敏感），存在可能的乱序。
- **代码现状**：afterCommit 里的 Redis 写用 `StringRedisTemplate`，Lettuce 单连接管线化有序 → 单 key 操作通常顺序提交；但**跨线程没有严格 happen-before**。
- **边界问题**：A1 commit 早于 B，但 afterCommit_A1 的网络包到达 Redis 晚于 afterCommit_B → Redis 看到 B 先、A1 后 → 最终态错误。
- **兜底**：60s 全量对账。从 DB `SELECT * WHERE is_active=true` → 与 Redis Set 逐个比较 → 差异强制修正。**不依赖 afterCommit 顺序正确**，只要求 DB 正确 + 最终有一次对账。

### 追问 2（深挖实现）：PG 行锁在这里的具体作用是什么？三条事务会不会有死锁？

- `@Transactional` 默认隔离 READ COMMITTED。对 `drone_partition_map` 的 `INSERT/UPDATE` 用 `FOR UPDATE` 隐式行锁。
- A1 `INSERT (px4_5, team_alpha)` 行锁独立（新行）。
- B `DELETE WHERE uav_id=px4_5` 锁该 uav_id 下所有行（含 A1 刚插的那行）。
- A2 在 B commit 后 `UPDATE/INSERT (px4_5, team_beta)`，独立行。
- 死锁场景：A1 和 B **同时**想要"自己的行 + 对方的行"。代码实践里：`PartitionRoutingService.addPartition` 只加自己要加的行；`removePartition` 按 uav_id 删；没有跨事务引用彼此的情况。
- 如果出现死锁：PG 自动检测并回滚其中一个 → 业务层收到异常 → Resilience4j retry 或抛 HTTP 500 给前端。

### 追问 3（深挖实现）：如果 A1 的 afterCommit 还没跑，B 就 commit 了，会怎样？

- 实际时间线（坏情况）：
  ```
  T=10ms  A1 DB commit 成功 → afterCommit_A1 入队，尚未执行
  T=11ms  B DB commit 成功 → afterCommit_B 入队，尚未执行
  T=12ms  afterCommit_B 先执行（线程调度抖动）→ Redis DEL drone:px4_5:partitions
  T=13ms  afterCommit_A1 执行 → Redis SADD drone:px4_5:partitions team_alpha
  最终 Redis = {team_alpha}，但 DB（B 后 commit）= {}
  ```
- **DB 和 Redis 不一致**（Redis 多 team_alpha）。
- **收敛路径**：60s 内 `reconcile` 跑一次：
  - `SELECT uav_id, partition_name FROM drone_partition_map WHERE is_active AND uav_id='px4_5'` → 空集。
  - Redis `SMEMBERS drone:px4_5:partitions` → {team_alpha}。
  - 对账逻辑：DB 没有 → Redis 多了 → `SREM team_alpha`。
- **窗口 60s 内**：前端可能看到 px4_5 被分到 team_alpha，管理员 B 觉得"我明明删了怎么还在"。这是**最终一致**的代价。
- **改进方向**：
  - 用 CDC（debezium）把 DB binlog 写到 Kafka，消费者按顺序投影到 Redis → 严格保序。
  - 用分布式锁把 add/remove/update 同 uav_id 的操作串行化（性能下降）。
  - 当前项目评估：分区变更是运营低频操作（日级），60s 窗口 + 最终对账足够。

---

## Q18 — API Gateway 为什么要把 JWT 校验前置，下游还要二次校验吗？

### 典型场景
`ucs-business` 的 `/api/v1/drones/{uavId}/assign` 需要 Commander 权限。这个权限校验是在 `ucs-api-gateway` 里做、还是在 `ucs-business` 自己做？

**定位**：
- Gateway：`ucs-api-gateway/JwtAuthGatewayFilter.java` L84-150。
- Business：`ucs-business/security/*` + `@PreAuthorize("hasRole('commander')")`（Spring Security）。

### 一层回答
**两层都做，各有职责**：

- **API Gateway**：只做 **身份**（is this a valid token？），解析后把 `userId`、`username`、`roles` 透传到 HTTP 请求头 `X-User-Id` 等。白名单路径（登录、注册、刷新）跳过。
- **下游微服务**：做 **授权**（is this user allowed to do this action？）——基于角色、资源归属、分区范围。

### 追问 1（深挖原理）：为什么不全在 Gateway 里做？

- Gateway 不知道业务规则：比如"这架飞机是不是这个用户的分区"。
- 复杂授权逻辑塞到 Gateway 层 → Gateway 变重 → 每加一个业务规则要重新发布 Gateway → 违反"关注点分离"。
- Gateway 只保"没 token 的请求根本进不来"；具体"能不能做"交给业务服务。
- 性能：Gateway 做一次 JWT 验签（RS256 几百 μs），下游拿到解析后的字段无需再验签。减少重复加解密。

### 追问 2（深挖实现）：JWT 篡改或重放怎么防？

- **篡改**：RS256 用私钥签名、公钥验证。任何对 Payload 的改动都会让签名失效。Gateway 里：
  ```java
  parserBuilder.verifyWith(useRsa ? rsaPublicKey : hmacKey);
  ```
  `parseSignedClaims(token)` 失败抛异常 → 返回 401。
- **重放**：JWT 是 stateless，没有服务端 session。重放同一 token 默认是允许的（直到过期）。
- 项目对策：
  - Access Token TTL=30min，重放窗口有限。
  - Refresh Token TTL=7d 但只能走 `/api/v1/auth/refresh` → 可以服务端维护黑名单（项目现状没启用）。
  - 敏感操作（如 commands）叠加 `IdempotencyService` SETNX，同 requestId 10min 内执行一次。
- **加强方案**：
  - token 里加 `jti`（唯一 ID），服务端短期缓存已使用 jti。
  - TLS 强制（HTTPS/WSS）防中间人截获 token。
  - Refresh Token rotation：每次 refresh 发新 token，老 refresh 作废。

### 追问 3（边界 / 权衡）：WebSocket `/ws` 为什么在白名单里？怎么做权限？

Gateway 的 `JwtAuthGatewayFilter.WHITE_LIST` 包含 `"/ws"`：

```java
private static final List<String> WHITE_LIST = List.of(
    "/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/auth/refresh",
    "/api/v1/dds-gateway", "/api/v1/public", "/api/v1/map",
    "/api/v1/telemetry", "/actuator", "/ws"
);
```

- **原因**：SockJS 握手先用 HTTP upgrade，后续是 WS 协议帧。一般的 Gateway JWT Filter 拦不了 WS 帧内的 STOMP 命令。强拦 upgrade 又会破坏握手逻辑。
- **权限点下沉到 WebSocket**：
  - **STOMP CONNECT 帧里带 `Authorization`**：后端 `StompChannelInterceptor` 解析并验签 JWT，设置 `Principal`。
  - **SUBSCRIBE 帧拦截**：自定义 `ChannelInterceptor` 或 Spring Security 的 `AbstractSecurityWebSocketMessageBrokerConfigurer`，校验 destination 是否在用户 partitions 范围内。
  - **MESSAGE 帧**（`@MessageMapping`）：`@PreAuthorize` 或方法内手动校验。
- 现状：项目代码在 `ViewportController` 中看到 `SimpMessageHeaderAccessor` 拿 `sessionId`，但**没显式 Principal 校验**——安全假设是"Gateway 之外不开放 `/ws` 端口"。生产环境建议补上 STOMP CONNECT 的 JWT 校验（见 Q12 追问 3 同样讨论）。

---

## Q19 — `@Scheduled` + `@SchedulerLock` 的 `lockAtLeastFor` 和 `lockAtMostFor` 分别防什么？

### 典型场景
部署 3 实例的 ucs-business。`PartitionRoutingService.reconcile()` 和 `TelemetryPersistenceService.flushBuffer()` 都是 `@Scheduled`。如果 3 实例同时跑，会：
- 重复写 DB、重复写 Redis。
- 短时间内读 DB 3 次，浪费连接。

**定位**：
- `EpochValidationService.periodicMaintenance`：`@Scheduled(fixedRate=6h) @SchedulerLock(name="epochMaintenance", lockAtLeastFor="5m", lockAtMostFor="30m")`。
- `TelemetryPersistenceService.flushBuffer`：`@Scheduled(fixedDelay=5000) @SchedulerLock(name="flushTelemetryBuffer", lockAtLeastFor="3s", lockAtMostFor="15s")`。

### 一层回答
- `@SchedulerLock(name="xxx")`：ShedLock 用 Redis `SET NX PX` 抢锁，同一 name 全集群只有一个实例持有。
- `lockAtMostFor="30m"`：**崩溃保护**。持有锁的实例挂了（来不及释放）→ 最多 30 分钟后锁自动过期，其他实例接管。防死锁。
- `lockAtLeastFor="5m"`：**时钟/延迟保护**。即使方法 2 分钟跑完就释放锁，实际持有至少 5 分钟。防止"一个实例刚跑完 5 秒，另一个实例立刻又跑一遍"（比如 DB 复制延迟导致双写）。

### 追问 1（深挖原理）：ShedLock 的 Redis 锁是怎么续期的？

- ShedLock 抢锁时：`SET shedlock:xxx "<hostId>-<lockUntil>" NX PX <lockAtMostFor>`。
- 持锁期间**不做续期**（这是 ShedLock 和 Redisson 重入锁的区别）。
- 方法执行时间 > `lockAtMostFor` 会怎样？**锁自动释放，另一个实例可能抢到**。这是 ShedLock 的已知限制：适合短任务，长任务需要把 `lockAtMostFor` 设得足够大。
- 代码设计：`flushBuffer` 平均 <1s，`lockAtMostFor=15s` 有 15× 余量。
- 对比 Redisson RLock：会开 watchdog 每 10s 续期。但项目选 ShedLock 因为它更轻量（只依赖 Redis，不需要 Redisson 库）。

### 追问 2（深挖实现）：`lockAtLeastFor` 具体是怎么实现的？为什么能防双写？

- 方法正常执行结束时，ShedLock **不会立刻删 Redis key**，而是：
  ```
  current_time = now()
  target_release_time = lock_acquired_at + lockAtLeastFor
  if current_time < target_release_time:
      SET shedlock:xxx "..." PX (target_release_time - current_time)
  else:
      DEL shedlock:xxx
  ```
- 效果：方法快跑完了也得等到 `lockAtLeastFor` 才释放。
- 防双写的场景：
  - 实例 A 跑完 flushBuffer（1s）→ DB 已写入。
  - DB 到从库的复制延迟 2s。
  - 若此时实例 B 立刻抢锁并跑 flushBuffer → 它可能读不到 A 刚写的数据（从库）→ 又写一次 → 重复。
  - `lockAtLeastFor=3s` > 复制延迟 2s → B 至少要等 3s 才能抢锁 → 从库已同步 → 不会重复。

### 追问 3（边界 / 权衡）：如果 `lockAtLeastFor > lockAtMostFor` 会怎样？

- ShedLock 文档明确：`lockAtLeastFor <= lockAtMostFor`，否则配置非法。
- 逻辑上：
  - `lockAtLeastFor=10m, lockAtMostFor=5m` 的意思是"至少持 10 分钟但最多 5 分钟自动过期"——自相矛盾。
  - 实际 ShedLock 会在 5 分钟后被 Redis TTL 自动释放，`lockAtLeastFor` 等于失效。
- **项目里两者的常见比例**：
  - `flushBuffer`：3s / 15s ≈ 1:5
  - `epochMaintenance`：5m / 30m ≈ 1:6
  - 公式经验：`lockAtMostFor = 3-6 × 期望执行时间`；`lockAtLeastFor = 0.5-2 × 期望执行时间`。
- **设错会怎样**：
  - `lockAtMostFor` 太小 → 任务没跑完就释放，并行执行 → 双写/重复。
  - `lockAtLeastFor` 太大 → 一次任务失败后要等很久才能再次触发 → 数据延迟。
  - 项目经验数值是保守的。

---

## Q20 — 一个 Kafka Consumer 处理太慢会发生什么？项目里怎么预防？

### 典型场景
某天 TimescaleDB 磁盘告急，所有 INSERT 延迟从 1ms 涨到 500ms。`ucs-telemetry-store` 的 `TelemetryBatchConsumer.consumeBatch` 单批从 100ms 涨到 30s。会发生什么？

**定位**：
- 配置：`ucs-telemetry-store/application.yml` L20-23 `session.timeout.ms`, `heartbeat.interval.ms`, `max.poll.interval.ms`。
- 实际消费：`TelemetryBatchConsumer.consumeBatch`。

### 一层回答
Kafka Consumer 有两个关键超时：

1. `session.timeout.ms=45000`（45s）：不发 heartbeat 超过这个时间就被踢出组。
2. `max.poll.interval.ms=600000`（10min）：两次 `poll()` 间隔超过这个时间也会被踢。

批处理卡住 30s：
- Heartbeat 是**独立后台线程**发的，30s 内每 15s 发一次，`session.timeout` 不会触发。
- 但 30s 没 poll → 看 `max.poll.interval.ms=600000`，30s << 600s，**还安全**。
- 如果单批卡 10 分钟以上 → 被踢 → rebalance → 其他实例接管该分区 → 重复消费本批。

### 追问 1（深挖原理）：heartbeat 和 poll interval 分别防什么？

- **Heartbeat (`heartbeat.interval.ms=15000`)**：证明 JVM 活着。后台 HeartbeatThread 每 15s 发一次，只要进程/网络没挂，`session.timeout` 就不会到。
- **Poll interval (`max.poll.interval.ms=600000`)**：证明**业务线程**还在消费。假设业务死循环了、或 consume 方法阻塞了，heartbeat 还在发（JVM 没死），但实际已经不消费 → 其他实例应该接管。`max.poll.interval` 检测这类"僵尸消费者"。
- 配合：
  - session.timeout：JVM 级健康。
  - max.poll.interval：业务级健康。
  - 两者都触发 rebalance，但语义不同。

### 追问 2（深挖实现）：项目为什么 `max.poll.interval.ms=10 min` 这么长？

- 默认是 5 分钟。项目调大到 10 分钟因为：
  - 批量消费（`batch="true"` + `max-poll-records=500`）偶尔会遇到 DB 慢查询，单批最坏几分钟。
  - 10 分钟留足余量；设小了 → 一次慢批就触发 rebalance → 组暂停 → 重复消费 → 更慢 → 级联故障。
- 代价：真正死掉的 consumer 要 10 分钟才被踢。但：
  - K8s liveness probe 会更早发现进程异常并重启。
  - Prometheus alert 会更早告警。
- 业务兜底：Epoch + 幂等保证重复消费无副作用。

### 追问 3（边界 / 权衡）：如果确实遇到 DB 超慢（批延迟 15 分钟以上），项目会发生什么？怎么诊断、怎么恢复？

**链式反应**：

1. 单批 15 分钟 > `max.poll.interval.ms=10min` → Coordinator 认为该实例挂了 → 踢出组 → rebalance。
2. 实例 A 的分区被分给 B → B 从 A 的 last committed offset 重新拉 → 重复消费本批。
3. A 跑完 `consumeBatch` 后想 commit offset → 发现自己不再属于组（Generation ID 已变）→ `CommitFailedException` → 回滚整次 batch。
4. B 同样可能跑 15 分钟 → 再被踢 → C 接管 → 无限循环 → 整个 `store-group` 瘫痪。

**诊断**：
- `kafka-consumer-groups.sh --describe --group store-group`：看 lag 是否持续增长、CURRENT-OFFSET 是否卡住。
- Prometheus `kafka_consumergroup_lag` 指标 + 告警。
- 实例日志：反复出现 `CommitFailedException` / `Revoking partitions` / `Assigning partitions`。

**恢复**：
- 根因：DB 慢。先修 DB（扩磁盘、杀慢查询）。
- 临时缓解：把 `max.poll.interval.ms` 调到 30min，或把 `max-poll-records` 从 500 减到 100，单批更小。
- 暂停消费：`kafka-consumer-groups.sh --pause` 或直接 scale down Consumer 实例到 0，DB 恢复后再拉起。
- **关键预防**：
  - `concurrency=4` 分散压力。
  - 告警触发 **自动扩容** Consumer（K8s HPA 基于 lag）。
  - DLQ：超时的批写到 `telemetry.processed.dlq` 延迟处理。
- **项目现状**：没有自动扩容也没有 DLQ，依赖运维人工介入 + Epoch/幂等保证重复无副作用。对于"最坏一次持续几分钟的故障"能扛；对于真正的 DB 慢查询长时间不修复，会有数据堆积。

---

## 附录：关键类/配置速查表

| 用途 | 位置 |
|---|---|
| Kafka Topic 名 | `ucs-common/config/KafkaTopicConstants.java` |
| Redis key 前缀 | `ucs-common/config/RedisKeyConstants.java` |
| Epoch 校验 | `ucs-common/service/EpochValidationService.java` |
| 多级缓存 | `ucs-common/cache/MultiLevelCacheService.java` |
| 分区双写 | `ucs-business/service/PartitionRoutingService.java` |
| 命令幂等 | `ucs-command/service/IdempotencyService.java` |
| 命令线程池 | `ucs-command/config/ThreadPoolConfig.java` |
| JWT 过滤器 | `ucs-api-gateway/filter/JwtAuthGatewayFilter.java` |
| 限流过滤器 | `ucs-api-gateway/filter/RateLimitFilter.java` |
| 批量入库 | `ucs-telemetry-store/repository/TelemetryRepository.java` |
| WebSocket 配置 | `ucs-realtime-push/config/WebSocketConfig.java` |
| 分区名计算 | `ucs-business/util/PartitionNameUtil.java` |
| Kafka 集群 | `docker-compose-kafka.yml`（3 broker + KRaft） |
| Mavlink 网关 | `mavlink-gateway/mavlink_gateway.py` |
| DDS 网关 | `dds-gateway/dds_gateway.py` |

---

*本文档按"**问题 → 一层回答 → 3 层追问**"组织，每一条都能在代码里找到对应实现。读完本文应能独立应对"UCS 分布式架构"方向的 2–3 小时深度技术面试。*
