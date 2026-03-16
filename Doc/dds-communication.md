# DDS 通信技术文档

## 概述

UCS 使用 ROS2/DDS (Data Distribution Service) 中间件与 PX4 飞控通信。DDS Gateway 是一个 Python ROS2 节点，负责：

1. **遥测订阅**：从 PX4 订阅无人机状态数据
2. **指令发布**：向 PX4 发送控制指令
3. **指令确认**：监听 PX4 指令执行结果

## DDS 话题

### 遥测话题（订阅）

| 话题后缀 | 消息类型 | 数据内容 |
|----------|---------|---------|
| `vehicle_global_position` | `VehicleGlobalPosition` | 经纬度、海拔高度 |
| `vehicle_local_position` | `VehicleLocalPosition` | NED 本地坐标、速度 |
| `vehicle_attitude` | `VehicleAttitude` | 四元数姿态 → 航向角 |
| `vehicle_status` | `VehicleStatus` | 解锁状态、飞行模式 |
| `battery_status` | `BatteryStatus` | 电池电量百分比 |
| `vehicle_command_ack` | `VehicleCommandAck` | 指令执行确认 |

话题命名格式：`/{uav_id}/fmu/out/{topic_suffix}`

### 控制话题（发布）

| 话题后缀 | 消息类型 | 用途 |
|----------|---------|------|
| `vehicle_command` | `VehicleCommand` | ARM/DISARM/起飞/降落/返航/模式切换 |
| `offboard_control_mode` | `OffboardControlMode` | OFFBOARD 模式控制类型配置 |
| `trajectory_setpoint` | `TrajectorySetpoint` | 位置/速度设定点 (GOTO) |

话题命名格式：`/{uav_id}/fmu/in/{topic_suffix}`

## QoS 配置

PX4 使用 BEST_EFFORT 可靠性策略发布数据。DDS Gateway 必须匹配此 QoS 配置：

```python
px4_qos = QoSProfile(
    reliability=ReliabilityPolicy.BEST_EFFORT,
    durability=DurabilityPolicy.VOLATILE,
    history=HistoryPolicy.KEEP_LAST,
    depth=10
)
```

> 如果 QoS 不匹配（如使用 RELIABLE），DDS 会拒绝连接并报告：
> `incompatible QoS - Last incompatible policy: RELIABILITY`

## 指令映射

### PX4 VehicleCommand 指令码

| 指令类型 | command 码 | param1 | param2 | param7 | 说明 |
|---------|-----------|--------|--------|--------|------|
| ARM | 400 | 1.0 | 21196.0 | - | 解锁电机 |
| DISARM | 400 | 0.0 | 21196.0 | - | 锁定电机 |
| TAKEOFF | 22 | - | - | 高度(m) | 自动起飞 |
| LAND | 21 | - | - | - | 原地降落 |
| RTL | 20 | - | - | - | 返回起飞点 |
| HOLD | 17 | - | - | - | 原地悬停 |
| OFFBOARD | 176 | 1.0 | 6.0 | - | 切换 OFFBOARD 模式 |

### VehicleCommandAck 结果码

| 结果码 | 含义 |
|-------|------|
| 0 | ACCEPTED - 指令已接受 |
| 1 | TEMPORARILY_REJECTED - 暂时拒绝 |
| 2 | DENIED - 拒绝 |
| 3 | UNSUPPORTED - 不支持 |
| 4 | FAILED - 执行失败 |
| 5 | IN_PROGRESS - 执行中 |
| 6 | CANCELLED - 已取消 |

## OFFBOARD 模式

OFFBOARD 模式允许外部系统（UCS）直接控制无人机位置。使用 OFFBOARD 模式有两个关键要求：

### 1. 心跳维持

PX4 要求在 OFFBOARD 模式下持续接收 `OffboardControlMode` 消息（频率 > 2Hz）。
如果心跳中断，PX4 会自动退出 OFFBOARD 模式。

当前心跳频率为 **4Hz**（0.25s 间隔），相比之前的 2.5Hz（0.4s）提供了更充足的安全裕量。

```python
def start_offboard_heartbeat(self, uav_id, interval=0.25):
    """以 4Hz 发布 OffboardControlMode + TrajectorySetpoint 心跳"""
    # 在独立线程中循环发布
    while active:
        self.publish_offboard_control_mode(uav_id, position=True)
        self.publish_trajectory_setpoint(uav_id)
        time.sleep(interval)  # 0.25s → 4Hz
```

**心跳停止策略**：心跳仅在收到明确的退出指令（LAND/RTL/DISARM）时才停止。
飞行中的瞬态指令拒绝（如传感器暂时未就绪）不会中断心跳，避免因意外模式切换导致飞行不稳定。

**可扩展性**：每架无人机使用一个轻量级守护线程，对 100+ 架无人机规模可支持。
对于 1000+ 架，建议改为异步事件循环或优先级队列调度。

### 2. 模式切换流程

```
1. 发布 OffboardControlMode (position=True)
2. 发布 VehicleCommand (command=176, param1=1.0, param2=6.0)
3. 启动心跳线程 (4Hz)
4. 发布 TrajectorySetpoint 控制位置
```

## 航向角计算

DDS Gateway 从 `VehicleAttitude` 的四元数数据计算航向角：

```python
def _on_attitude(self, uav_id, msg):
    q = msg.q  # 四元数 [w, x, y, z]
    siny_cosp = 2 * (q[0] * q[3] + q[1] * q[2])
    cosy_cosp = 1 - 2 * (q[2] ** 2 + q[3] ** 2)
    heading = math.degrees(math.atan2(siny_cosp, cosy_cosp)) % 360
```

前端使用此航向角旋转无人机图标：
```html
<svg style="transform: rotate(${heading}deg); transition: transform 0.5s ease;">
```

## 指令确认（Ack）延迟优化

指令确认从 PX4 到前端的完整路径：

```
PX4 VehicleCommandAck → DDS Topic → DDS Gateway → HTTP POST → Java Backend → WebSocket → Frontend
```

### 优化措施

| 优化项 | 优化前 | 优化后 | 效果 |
|-------|--------|--------|------|
| HTTP 连接 | 每次 ack 新建 TCP 连接 | `requests.Session` 持久连接 (Keep-Alive) | 省去 TCP 握手 ~50-100ms |
| 线程模型 | 每次 ack 新建线程 `threading.Thread()` | `ThreadPoolExecutor(max_workers=4)` 线程池 | 避免线程创建开销 ~5-10ms |
| 去重窗口 | 5 秒 | 2 秒 | 更快响应合法 ack |
| HTTP 超时 | 5 秒 | 3 秒 | 更快检测失败 |
| 遥测发送 | 每次新建连接 | 复用同一 HTTP 会话 | 减少遥测转发延迟 |

### 架构决策：为什么不从 Java 后端直接发布 DDS

Java 后端理论上可以直接向 DDS 网络发布消息，但存在以下工程挑战：

1. **px4_msgs IDL 编译**：需将 PX4 消息定义编译为 Java 类型桩
2. **ROS2 Java 客户端**：rclj 社区支持有限，不如 Python rclpy 成熟
3. **QoS 配置复杂**：需要手动配置 Fast-DDS QoS 策略匹配 PX4
4. **维护成本**：PX4 更新 px4_msgs 后需重新编译 Java IDL

**结论**：保持 Python Gateway 架构，通过 HTTP 会话复用 + 线程池优化，已将网关→后端延迟降至最低。
Python rclpy + px4_msgs 是 PX4 官方推荐的集成方式，稳定性和兼容性最好。

## DDS Gateway HTTP 命令服务

DDS Gateway 在端口 5050 上运行一个轻量 HTTP 服务，接收后端的指令请求：

### API 端点

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/command` | 发送控制指令到 PX4 |
| POST | `/api/heartbeat/start` | 启动 OFFBOARD 心跳 |
| POST | `/api/heartbeat/stop` | 停止 OFFBOARD 心跳 |
| GET | `/api/health` | 网关健康检查 |

### 指令请求格式

```json
{
  "uavId": "px4_1",
  "commandType": "ARM",
  "params": {}
}
```

### 指令响应格式

```json
{
  "success": true,
  "message": "ARM command sent to px4_1"
}
```
