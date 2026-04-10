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

```python
def start_offboard_heartbeat(self, uav_id, interval=0.4):
    """以 2.5Hz 发布 OffboardControlMode 心跳"""
    # 在独立线程中循环发布
    while active:
        self.publish_offboard_control_mode(uav_id, position=True)
        time.sleep(interval)  # 0.4s → 2.5Hz
```

### 2. 模式切换流程

```
1. 发布 OffboardControlMode (position=True)
2. 发布 VehicleCommand (command=176, param1=1.0, param2=6.0)
3. 启动心跳线程 (>2Hz)
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
