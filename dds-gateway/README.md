# DDS Gateway - PX4 Telemetry Forwarder

DDS 网关：订阅 PX4 仿真无人机的 DDS 话题，将遥测数据转发至 UCS 后端。
支持单实例和多实例部署模式，可水平扩展以处理大规模无人机集群。

## 架构说明

### 单实例模式（默认）
```
PX4 仿真无人机 (px4_1, px4_2, ...)
    │ DDS Topics: /{px4_x}/fmu/out/vehicle_*
    ▼
┌─────────────────────────────┐
│  DDS Gateway (Python)        │  ← 本脚本
│  - 发现 DDS 网络中的无人机     │
│  - 订阅遥测话题               │
│  - 实时10Hz转发 (Kafka/REST)  │
└─────────────┬───────────────┘
              │ Kafka: telemetry.raw / REST: POST /api/v1/dds-gateway/telemetry
              ▼
┌─────────────────────────────┐
│  UCS Backend (Spring Boot)   │
│  - 分区路由 (PartitionRouting)│
│  - WebSocket 广播            │
│  - 数据持久化                 │
└─────────────┬───────────────┘
              │ WebSocket: /topic/telemetry/partition/{name}
              ▼
┌─────────────────────────────┐
│  前端 (React)                │
│  - 按分区订阅遥测数据          │
│  - 地图展示无人机位置          │
└─────────────────────────────┘
```

### 多实例模式（水平扩展）
```
PX4 仿真无人机 (px4_1 ~ px4_30)
    │ DDS Topics (共享ROS2网络)
    ├─────────────────────────────────────────┐
    ▼                                         ▼
┌──────────────────────┐  ┌──────────────────────┐
│ Gateway Instance 0    │  │ Gateway Instance 1    │
│ 处理: px4_2,4,6,...   │  │ 处理: px4_1,3,5,...   │
│ Port: 5050            │  │ Port: 5051            │
│ Kafka group:          │  │ Kafka group:          │
│   dds-gateway-cmd-0   │  │   dds-gateway-cmd-1   │
└──────────┬───────────┘  └──────────┬───────────┘
           │                         │
           └─────────┬───────────────┘
                     ▼
              Kafka / Backend
```

## 安装依赖

```bash
pip install -r requirements.txt
```

> 注意：`cyclonedds` 需要系统安装 CycloneDDS C 库。
> Ubuntu: `sudo apt install cyclonedds-dev`
> 或参考: https://github.com/eclipse-cyclonedds/cyclonedds-python

## 使用方法

### 1. 启动后端服务

```bash
cd backend
mvn spring-boot:run
```

### 2. 单实例启动（默认，向后兼容）

**自动发现模式**（推荐）：
```bash
python dds_gateway.py --backend-url http://localhost:8080
```

**预知无人机数量时（推荐，启动更快）**：
```bash
# 预先订阅20架无人机的所有话题，无需等待话题发现
python dds_gateway.py --drone-count 20
```

**手动指定无人机**：
```bash
python dds_gateway.py --drones px4_1 px4_2 px4_3 px4_4
```

**使用环境变量**：
```bash
export UCS_BACKEND_URL=http://localhost:8080
export DDS_GATEWAY_API_KEY=ucs-dds-gateway-secret-2024
export DDS_POLL_INTERVAL=1.0
python dds_gateway.py
```

### 3. 多实例启动（水平扩展）

当单节点无法承受大量无人机数据时，可以启动多个实例分担负载。

**示例：2个实例处理30架无人机**
```bash
# 终端1: 实例0 — 处理 px4_2, px4_4, px4_6, ... (偶数ID)
python dds_gateway.py --instance-id 0 --total-instances 2

# 终端2: 实例1 — 处理 px4_1, px4_3, px4_5, ... (奇数ID)
python dds_gateway.py --instance-id 1 --total-instances 2
```

**示例：3个实例处理30架无人机**
```bash
# 实例0: px4_3, px4_6, px4_9, px4_12, ...
python dds_gateway.py --instance-id 0 --total-instances 3

# 实例1: px4_1, px4_4, px4_7, px4_10, ...
python dds_gateway.py --instance-id 1 --total-instances 3

# 实例2: px4_2, px4_5, px4_8, px4_11, ...
python dds_gateway.py --instance-id 2 --total-instances 3
```

**使用环境变量**：
```bash
export DDS_INSTANCE_ID=0
export DDS_TOTAL_INSTANCES=3
python dds_gateway.py
```

**使用 systemd 模板**：
```bash
# /etc/systemd/system/dds-gateway@.service
# 启动: systemctl start dds-gateway@0 dds-gateway@1 dds-gateway@2
[Service]
Environment=DDS_INSTANCE_ID=%i
Environment=DDS_TOTAL_INSTANCES=3
ExecStart=/usr/bin/python3 /path/to/dds_gateway.py
```

### 4. 参数说明

| 参数 | 环境变量 | 默认值 | 说明 |
|------|----------|--------|------|
| `--backend-url` | `UCS_BACKEND_URL` | `http://localhost:8080` | 后端地址 |
| `--api-key` | `DDS_GATEWAY_API_KEY` | `ucs-dds-gateway-secret-2024` | 网关 API 密钥 |
| `--interval` | `DDS_POLL_INTERVAL` | `1.0` | 轮询间隔(秒) |
| `--drones` | - | 自动发现 | 手动指定无人机 ID |
| `--verbose` | - | false | 详细日志 |
| `--instance-id` | `DDS_INSTANCE_ID` | `0` | 实例ID (0-based) |
| `--total-instances` | `DDS_TOTAL_INSTANCES` | `1` | 总实例数 (1=单实例) |
| `--drone-count` | `DDS_DRONE_COUNT` | `0` | 预期无人机总数 (>0时主动订阅px4_1..N) |

### 5. 多实例分区规则

无人机按以下规则分配到实例：
```
drone_numeric_id % total_instances == instance_id
```
例如 `px4_5` 的 numeric_id=5，若 total_instances=3，则 5%3=2，分配到 instance 2。

每个实例拥有独立的：
- **ROS2 节点名**: `ucs_dds_gateway_{instance_id}`
- **Kafka 消费者组**: `dds-gateway-cmd-{instance_id}`
- **HTTP 命令端口**: `5050 + instance_id`（实例0=5050, 实例1=5051, ...）

## API 协议

### 网关 → 后端

```
POST /api/v1/dds-gateway/telemetry
Header: X-Gateway-Key: <api-key>
Content-Type: application/json

{
  "timestamp": "2024-01-01T00:00:00Z",
  "drones": [
    {
      "uavId": "px4_1",
      "lat": 39.9042,
      "lon": 116.4074,
      "alt": 100.0,
      "heading": 45.0,
      "groundSpeed": 10.0,
      "verticalSpeed": 0.5,
      "vx": 7.07, "vy": 7.07, "vz": 0.5,
      "nedX": 100.0, "nedY": 200.0, "nedZ": -100.0,
      "armed": true,
      "flightMode": "OFFBOARD",
      "batteryPercent": 85.0
    }
  ]
}
```

### 健康检查

```
GET /api/health  (网关本地HTTP端口)
→ {
    "status": "ok",
    "instanceId": 0,
    "totalInstances": 2,
    "drones": ["px4_2", "px4_4"],
    "validPositionDrones": ["px4_2", "px4_4"],
    "subscriptions": 10
  }

GET /api/v1/dds-gateway/health  (后端)
→ {"status": "ok", "timestamp": "...", "service": "ucs-dds-gateway-api"}
```

## 话题订阅机制

网关采用 **动态发现 + 主动订阅** 的双重策略，不硬编码任何话题名：

1. **动态发现**：每5秒扫描ROS2话题列表，自动发现 `/px4_*/fmu/out/*` 格式的话题
2. **主动订阅**：即使话题尚未在ROS2中注册，也会预先创建订阅（ROS2/DDS会在发布者出现时自动连接）
3. **订阅重试**：每个发现周期检查已有无人机的订阅完整性（6个话题），自动补订缺失的话题
4. **`--drone-count` 预订阅**：设置后立即为 px4_1..N 创建全部订阅，无需等待话题发现

这确保了：
- 无人机在网关之后启动也能被发现
- 无人机数量变化时自动适应
- 多实例模式下每个实例只订阅自己负责的无人机

## 故障排查

### 前端只显示部分无人机 / 全部离线
- 使用 `--drone-count N` 参数确保所有无人机被预先订阅
- 检查日志中 `[Discovery] Tracking X drones (Y with valid position)` — Y=0 表示GPS未初始化
- 检查日志中 `[Subscribe] Drone px4_X: ... topics subscribed` — 确认6/6订阅完成
- 确认网关实例配置正确：单实例不需要 `--total-instances`，多实例需要覆盖所有分区

### 无人机位置数据显示为(0,0)
- 检查日志中 `[Position] Rejected` 警告 — 表示网关正在过滤无效坐标
- 检查日志中 `valid=True/False` — False 表示该无人机尚未收到有效GPS数据
- 确认 PX4 仿真器已设置正确的 Home 位置（非默认的赤道/本初子午线）

### 多实例模式下某些无人机未被处理
- 确认所有实例使用相同的 `--total-instances` 值
- 检查分区规则：`px4_N` 中 N 的数值 % total_instances 决定所属实例
- 使用健康检查 API 确认各实例负责的无人机列表

### DDS 消息丢失/延迟
- 日志中 `[SpinThread]` 应显示 spin thread 已启动
- 检查 `gps_age` 统计 — 值过大表示 VehicleGlobalPosition 消息接收延迟
