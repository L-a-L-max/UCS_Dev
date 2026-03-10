# DDS Gateway - PX4 Telemetry Forwarder

DDS 网关：订阅 PX4 仿真无人机的 DDS 话题，将遥测数据转发至 UCS 后端。

## 架构说明

```
PX4 仿真无人机 (px4_1, px4_2, ...)
    │ DDS Topics: /{px4_x}/fmu/out/vehicle_*
    ▼
┌─────────────────────────────┐
│  DDS Gateway (Python)        │  ← 本脚本
│  - 发现 DDS 网络中的无人机     │
│  - 订阅遥测话题               │
│  - 聚合数据并批量转发          │
└─────────────┬───────────────┘
              │ REST API: POST /api/v1/dds-gateway/telemetry
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

### 2. 启动 DDS Gateway

**自动发现模式**（推荐）：
```bash
python dds_gateway.py --backend-url http://localhost:8080
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

### 3. 参数说明

| 参数 | 环境变量 | 默认值 | 说明 |
|------|----------|--------|------|
| `--backend-url` | `UCS_BACKEND_URL` | `http://localhost:8080` | 后端地址 |
| `--api-key` | `DDS_GATEWAY_API_KEY` | `ucs-dds-gateway-secret-2024` | 网关 API 密钥 |
| `--interval` | `DDS_POLL_INTERVAL` | `1.0` | 轮询间隔(秒) |
| `--drones` | - | 自动发现 | 手动指定无人机 ID |
| `--verbose` | - | false | 详细日志 |

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
GET /api/v1/dds-gateway/health
→ {"status": "ok", "timestamp": "...", "service": "ucs-dds-gateway-api"}
```
