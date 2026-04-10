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
| `dds_gateway.py` | 修改 | 主网关代码（两个问题的全部修复） |
| `README.md` | 修改 | 更新文档，增加多实例说明和故障排查 |
| `MODIFICATIONS.md` | 新增 | 本修改说明文档 |

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
