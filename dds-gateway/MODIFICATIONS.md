# DDS Gateway 修改说明文档

## 修改概述

本次修改解决两个关键问题：
1. **位置数据异常** — 部分无人机经纬度数据回退到初始坐标(0,0)
2. **单节点过载** — 30架无人机数据导致单个网关节点压力过大

---

## 问题1：位置数据回退到(0,0)

### 根因分析

原始代码在主循环中使用 `rclpy.spin_once(timeout_sec=0.05)` 处理 DDS 回调，**每次循环仅处理1条 DDS 消息**。

```
消息产生速率: 30架无人机 × 5个话题 × 10-50Hz ≈ 1500-7500 条/秒
消息处理速率: spin_once每次1条 × ~20次/秒 ≈ 20 条/秒
```

由于 DDS 使用 BEST_EFFORT QoS（队列深度=10），当缓冲区溢出时旧消息被丢弃。
`VehicleGlobalPosition`（位置数据）回调可能被丢弃，而 `VehicleAttitude`（姿态）
或 `VehicleLocalPosition`（本地位置）回调继续更新 `last_update` 时间戳。

结果：无人机状态显示为"活跃"（`last_update` 近期更新），但 `lat/lon` 停留在
`DroneState` 的默认初始值 `0.0`。

### 修复方案

#### 1. 独立 ROS2 Spin 线程 (`_start_spin_thread`)

将 DDS 回调处理从主循环中分离，使用独立的守护线程持续调用 `spin_once(timeout_sec=0.01)`：

```python
def _start_spin_thread(self):
    def _spin():
        while self.running and rclpy.ok():
            rclpy.spin_once(self._node, timeout_sec=0.01)
    t = threading.Thread(target=_spin, daemon=True, name='ros2-spin')
    t.start()
```

**效果**: DDS 回调处理速率从 ~20条/秒 提升到 ~数千条/秒，与消息产生速率匹配。
主循环仅负责遥测转发和发现，不再被 `spin_once` 阻塞。

#### 2. 位置有效性标记 (`position_valid`)

在 `DroneState` 中新增 `position_valid: bool = False` 字段：
- 仅在 `_on_global_position` 收到有效坐标后设为 `True`
- 主循环转发遥测时检查此标记，跳过无效位置的无人机
- 防止将默认值(0,0)发送到 Kafka/后端

```python
# 主循环中的检查
for uid, state in snapshot:
    if not state.position_valid:
        continue  # 跳过尚未收到有效GPS的无人机
```

#### 3. 坐标回退防护

在 `_on_global_position` 中增加验证逻辑：
- 如果收到的坐标在(0,0)附近（|lat|<0.1 且 |lon|<0.1）
- 且已有远离(0,0)的有效位置（如北京 39.9°N, 116.4°E）
- 则拒绝此次更新，防止 EKF 重置导致的位置跳变

#### 4. GPS 时间戳追踪

新增 `last_global_position_time` 字段，独立于 `last_update`（被所有话题回调更新），
用于精确追踪 GPS 位置数据的新鲜度。日志统计中新增 `gps_age` 指标。

#### 5. 线程安全加固

主循环中遍历 `drone_states` 和设置 `epoch` 时加锁保护：

```python
# 修改前 (无锁)
for uid, state in list(self.drone_states.items()):
    ...

# 修改后 (加锁快照)
with self._lock:
    snapshot = list(self.drone_states.items())
for uid, state in snapshot:
    ...
```

---

## 问题2：多实例水平扩展

### 设计方案

通过无人机ID分区，将30架无人机的负载分散到N个网关实例：

```
分区规则: drone_numeric_id % total_instances == instance_id
示例 (3实例):
  Instance 0: px4_3, px4_6, px4_9, px4_12, px4_15, px4_18, px4_21, px4_24, px4_27, px4_30
  Instance 1: px4_1, px4_4, px4_7, px4_10, px4_13, px4_16, px4_19, px4_22, px4_25, px4_28
  Instance 2: px4_2, px4_5, px4_8, px4_11, px4_14, px4_17, px4_20, px4_23, px4_26, px4_29
```

### 修改内容

#### 1. 新增 CLI 参数

| 参数 | 环境变量 | 默认值 | 说明 |
|------|----------|--------|------|
| `--instance-id` | `DDS_INSTANCE_ID` | `0` | 当前实例ID (0-based) |
| `--total-instances` | `DDS_TOTAL_INSTANCES` | `1` | 总实例数 |

**单实例模式完全向后兼容**：`total_instances=1` 时所有无人机归属实例0。

#### 2. 分区方法 (`_owns_drone`)

```python
def _owns_drone(self, uav_id: str) -> bool:
    if self.total_instances <= 1:
        return True  # 单实例模式，所有无人机都归属
    drone_num = self._extract_system_id(uav_id)  # px4_5 -> 5
    return drone_num % self.total_instances == self.instance_id
```

#### 3. 发现过滤 (`discover_drones_from_topics`)

每个实例扫描整个 ROS2 网络发现所有无人机，但只订阅属于自己分区的无人机。
日志中区分"全网发现数"和"本实例拥有数"。

#### 4. ROS2 节点命名

每个实例创建独立的 ROS2 节点：`ucs_dds_gateway_{instance_id}`，
避免多实例在同一 ROS2 网络上的节点名冲突。

#### 5. Kafka 消费者组

每个实例使用独立的消费者组：`dds-gateway-cmd-{instance_id}`。
所有实例都接收 `commands.down` 的全部消息，但只处理属于自己分区的无人机命令。

> 设计选择：使用独立消费者组而非共享组，因为命令必须由订阅了对应无人机的实例执行。
> 共享组会随机分配消息，可能发送到没有订阅该无人机的实例。

#### 6. HTTP 命令端口

多实例模式下自动分配端口：`base_port + instance_id`
- 实例0: 5050
- 实例1: 5051
- 实例2: 5052

单实例模式保持默认端口 5050。

#### 7. 健康检查增强

`/api/health` 端点新增字段：
```json
{
  "instanceId": 0,
  "totalInstances": 2,
  "validPositionDrones": ["px4_2", "px4_4"]
}
```

---

## 启动配置示例

### 单实例（默认，向后兼容）
```bash
python dds_gateway.py
```

### 2实例
```bash
# 终端1
python dds_gateway.py --instance-id 0 --total-instances 2

# 终端2
python dds_gateway.py --instance-id 1 --total-instances 2
```

### 3实例（推荐30架无人机场景）
```bash
# 每个实例处理约10架无人机
python dds_gateway.py --instance-id 0 --total-instances 3 &
python dds_gateway.py --instance-id 1 --total-instances 3 &
python dds_gateway.py --instance-id 2 --total-instances 3 &
```

### 环境变量方式
```bash
export DDS_INSTANCE_ID=0
export DDS_TOTAL_INSTANCES=3
export UCS_BACKEND_URL=http://localhost:8080
export KAFKA_BOOTSTRAP_SERVERS=localhost:9092
python dds_gateway.py
```

---

## 文件修改清单

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `dds_gateway.py` | 修改 | 主网关代码（两个问题的全部修复 + 动态分片接入） |
| `dds_rx_gateway.py` | 修改 | 接入动态分片协调器 |
| `dds_tx_gateway.py` | 修改 | 接入动态分片协调器 |
| `shard_coordinator.py` | 新增 | 基于 Redis 的动态分片协调器（见下节） |
| `test_shard_coordinator.py` | 新增 | 动态分片协调器单元测试（11 用例，无外部依赖） |
| `README.md` | 修改 | 更新文档，增加多实例说明和故障排查 |
| `MODIFICATIONS.md` | 新增 | 本修改说明文档 |

---

## 动态分片（Dynamic Sharding）

### 背景

初版的多实例分片要求运维在启动时为每个实例**手工指定** `--instance-id` 和
`--total-instances`。这带来三个硬问题：
1. **扩容/缩容需要全员重启**：加一个实例必须同时把现有每个实例的
   `total_instances` 改成新值，否则分片函数得到的结果不一致，同一架无人机会
   被多个实例/零个实例订阅。
2. **崩溃的实例不会被接管**：一个实例挂掉后，它那一片无人机会停留在"无人订阅"
   状态，直到人工拉起同 id 的替换实例。
3. **自动编排不可能**：K8s/Nomad/Docker Swarm 的调度器无法给 Pod 预分配稳定
   的、连续的 `instance_id`，HPA 自动扩缩更无从谈起。

### 方案概述

新增模块 `shard_coordinator.ShardCoordinator`，用**已有的 Redis**（所有网关
都依赖它做 `dds:epoch:*`）作为唯一协调点，实现完全动态的分片：

| 步骤 | 行为 |
|------|------|
| 启动时 | 随机生成一个 `instance_uuid`（进程生命周期内不变） |
| 每 5 秒 | `SET dds:shards:{gateway_type}:{instance_uuid} <json> EX 15` |
| 同一周期 | `SCAN dds:shards:{gateway_type}:*` 列出所有存活 peer |
| 同一周期 | 把 UUID 按字典序排序，自己在列表里的位置 = `rank`，列表长度 = `total` |
| 进程退出 | `DELETE` 自己的 key，让其他节点立即重均衡 |

`_owns_drone(uav_id)` 仍用 `md5(uav_id) % total == rank` 的旧公式——计算式
没变，但 `rank/total` 是每心跳重新计算的。

### 关键设计点

- **无需新基础设施**：复用 Redis，不引入 Nacos/ZK/etcd。一个 `SET EX` + 一个
  `SCAN` 就够了。
- **崩溃检测 = TTL**：Redis key 的 TTL 是心跳周期的 3 倍（15s vs 5s），单次
  心跳丢失不触发重均衡，连续两次丢失才把该实例从 peer 集合里剔除。
- **无需 Leader 选举**：按 UUID 排序是纯函数，所有 peer 看到同一个排序后的
  列表，就自动得到一致的 rank 赋值——不需要协调一个"谁是 0 号"的中心节点。
- **Redis 宕机时保守降级**：`owns_drone()` 在 Redis 不可用时返回 `True`（即
  单实例模式），保证"某一架无人机暂时被多收"而不是"某一架无人机再也没人
  收"——后者会直接触发数据缺失告警。
- **回调式重均衡**：`on_layout_change(old, new)` 回调让网关在 rank 变化时可
  以取消不再归属自己的 DDS 订阅（可选扩展点，当前实现中 `_owns_drone` 的
  命中检查已足够兜底）。

### 启用方式（环境变量）

| 变量 | 默认值 | 语义 |
|------|--------|------|
| `DDS_DYNAMIC_SHARDING` | `true` | 动态分片开关。设为 `false` 回到旧的静态模式 |
| `DDS_SHARD_HEARTBEAT_SEC` | `5` | 心跳 / peer 扫描周期（秒） |
| `DDS_SHARD_TTL_SEC` | `15` | Redis key TTL（必须 ≥ `2 × 心跳周期`） |

**向后兼容规则**：
- 未设置 `DDS_DYNAMIC_SHARDING` 且 `--total-instances > 1` ⇒ 沿用旧的静态分片
  （保证老脚本不被新行为打破）。
- 设置 `DDS_DYNAMIC_SHARDING=true` 时，`--total-instances` / `--instance-id`
  参数被忽略（日志里会 warning 一次），用动态分片接管。
- Redis 不可用 ⇒ 静默降级为 `rank=0, total=1`（单实例模式）。

### 使用示例

**3 个实例，全自动分片，任意先后启动**：
```bash
# 任意机器上跑任意数量，无需配 instance-id / total-instances
export DDS_DYNAMIC_SHARDING=true
export REDIS_HOST=10.0.0.5
python dds_gateway.py &
python dds_gateway.py &
python dds_gateway.py &
# 日志会打印:
#   [Shard/routing] Dynamic shard coordinator started uuid=3f2a... peers=3 rank=2/3
```

**任一实例崩溃** ⇒ 15s 内（1×TTL）其余实例自动把失联实例的无人机分片接管。

### 测试

`python -m unittest dds-gateway/test_shard_coordinator.py` —— 11 个用例，
使用内置的 `FakeRedis` 覆盖：
- 单实例 & 多实例分片正确性（每架无人机恰好被 1 个实例拥有）
- 实例崩溃后另一实例接管全部无人机
- Redis 宕机时降级为单实例
- `DDS_DYNAMIC_SHARDING=true/false` 环境变量解析
- `on_layout_change` 回调时序

### `dds_gateway.py` 具体改动

| 位置 | 改动 |
|------|------|
| `DroneState` 数据类 | 新增 `position_valid`, `last_global_position_time` 字段 |
| `__init__()` | 新增 `instance_id`, `total_instances` 参数 |
| `_init_ros2_node()` | 节点名改为 `ucs_dds_gateway_{instance_id}` |
| `_owns_drone()` | 新增方法 — 分区归属判断 |
| `discover_drones_from_topics()` | 增加分区过滤 |
| `_on_global_position()` | 增加坐标有效性验证和回退防护 |
| `_start_spin_thread()` | 新增方法 — 独立ROS2 spin线程 |
| `run()` | 重构主循环：去除spin_once，增加position_valid检查，加锁快照 |
| `_start_kafka_command_consumer()` | 实例独立消费者组 + 分区过滤 |
| `start_command_server()` | 多实例端口自动分配 |
| `log_statistics()` | 新增 gps_age 和 valid 统计 |
| `do_GET /api/health` | 新增 instanceId, totalInstances, validPositionDrones |
| `main()` | 新增 `--instance-id`, `--total-instances` 参数及验证 |
