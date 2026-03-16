# 系统架构概览

## 整体架构

UCS 采用前后端分离的全栈架构，结合 ROS2/DDS 中间件实现无人机实时遥测与控制。

```
┌──────────────────────────────────────────────────────────┐
│                    PX4/Gazebo 仿真集群                      │
│   px4_1, px4_2, px4_3 ...                                │
│   发布 DDS 话题: /fmu/out/*                                │
└──────────────┬───────────────────────────┬────────────────┘
               │ 遥测订阅                    │ 指令发布
               ▼                           ▲
┌──────────────────────────────────────────────────────────┐
│              DDS Gateway (Python/rclpy)                   │
│   - 订阅 /fmu/out/* 遥测话题                               │
│   - 发布 /fmu/in/* 控制指令                                │
│   - HTTP 服务端口 5050 接收后端指令请求                       │
│   - 遥测数据 HTTP POST 转发到后端                           │
└──────────────┬───────────────────────────┬────────────────┘
               │ HTTP POST /telemetry      │ HTTP POST /command
               ▼                           ▲
┌──────────────────────────────────────────────────────────┐
│              Backend (Spring Boot / Java)                 │
│   - REST API (认证/权限/无人机/任务/团队/天气)                │
│   - WebSocket STOMP 网关 (遥测/指令确认广播)                 │
│   - Redis (无人机在线状态/缓存)                              │
│   - PostgreSQL (持久化存储)                                 │
│   端口: 8080                                              │
└──────────────┬───────────────────────────────────────────┘
               │ WebSocket + REST
               ▼
┌──────────────────────────────────────────────────────────┐
│              Frontend (React/TypeScript)                  │
│   - MapLibre GL 地图渲染                                   │
│   - STOMP WebSocket 实时遥测                               │
│   - 四角色视图 (Commander/Leader/Pilot/Observer)             │
└──────────────────────────────────────────────────────────┘
```

## 组件职责

### Frontend (`frontend/ucs-dashboard/`)

| 模块 | 职责 |
|------|------|
| `App.tsx` | 路由入口，认证状态管理，角色分发 |
| `CommanderView.tsx` | 指挥官视图：全局资源分配、舰队统计图表 |
| `LeaderView.tsx` | 队长视图：团队级任务管理、成员管理 |
| `PilotView.tsx` | 飞手视图：单机/多机控制、指令发送 |
| `MapPanel.tsx` | 地图面板：无人机标记、航迹、热力图 |
| `useTelemetryWebSocket.ts` | WebSocket Hook：遥测订阅、指令确认监听 |

### Backend (`backend/`)

| 模块 | 职责 |
|------|------|
| `DDSGatewayController` | 接收 DDS 网关遥测数据和指令确认 |
| `ControlController` | 处理前端控制指令请求 |
| `ControlService` | 指令权限校验、DDS 网关调用、日志记录 |
| `DdsCommandService` | HTTP 客户端，调用 DDS 网关指令 API |
| `WebSocketGatewayService` | 分区遥测广播、指令确认推送 |
| `PartitionRoutingService` | 基于权限的遥测数据分区路由 |
| `RedisService` | 无人机在线状态、缓存管理 |

### DDS Gateway (`dds-gateway/`)

| 模块 | 职责 |
|------|------|
| `DDSGateway` | ROS2 节点主类，管理订阅和发布 |
| 遥测订阅 | 订阅 `vehicle_global_position`, `vehicle_attitude`, `vehicle_status` 等 |
| 指令发布 | 发布 `vehicle_command`, `offboard_control_mode`, `trajectory_setpoint` |
| 指令确认 | 订阅 `vehicle_command_ack`，转发给后端 |
| HTTP 命令服务 | 端口 5050，接收后端指令请求 |

## 数据流

### 遥测数据流 (Drone → Frontend)

```
PX4 → DDS Topic → DDSGateway._on_*() → build_telemetry_payload()
  → HTTP POST /api/v1/dds-gateway/telemetry → DDSGatewayController
  → PartitionRoutingService (分区路由)
  → WebSocketGatewayService.broadcastToPartitions()
  → STOMP /topic/telemetry/partition/{name}
  → Frontend useTelemetryWebSocket → handlePartitionData()
```

### 控制指令流 (Frontend → Drone)

```
Frontend handleCommand() → HTTP POST /api/v1/pilot/control
  → ControlService.sendControlCommand()
  → 权限校验 + 在线检查
  → DdsCommandService.sendCommand()
  → HTTP POST DDS Gateway :5050/api/command
  → DDSGateway.handle_command()
  → publish_vehicle_command() → DDS Topic /fmu/in/vehicle_command
  → PX4 执行指令
```

### 指令确认流 (Drone → Frontend)

```
PX4 VehicleCommandAck → DDS Topic /fmu/out/vehicle_command_ack
  → DDSGateway._on_vehicle_command_ack()
  → HTTP POST /api/v1/dds-gateway/command-ack
  → DDSGatewayController.receiveCommandAck()
  → STOMP /topic/command-ack
  → Frontend handleCommandAck() → 两阶段反馈 UI
```
