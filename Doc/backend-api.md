# 后端 API 文档

## 技术栈

| 技术 | 用途 |
|------|------|
| Spring Boot 3.x | Web 框架 |
| Spring Security + JWT | 认证与授权 |
| Spring WebSocket (STOMP) | 实时遥测推送 |
| PostgreSQL | 关系数据库 |
| Redis | 无人机在线状态缓存 |
| Swagger/OpenAPI | API 文档自动生成 |

## 认证

所有 API（除 `/api/v1/auth/**`）均需 JWT Token。

```
Authorization: Bearer <token>
```

### 登录

```
POST /api/v1/auth/login
Content-Type: application/json

{
  "username": "pilot1",
  "password": "password"
}

Response:
{
  "token": "eyJhbGciOi...",
  "role": "PILOT",
  "username": "pilot1"
}
```

## 无人机控制 API

### 发送控制指令

```
POST /api/v1/pilot/control
Authorization: Bearer <token>
Content-Type: application/json

{
  "uavId": "px4_1",
  "commandType": "ARM",
  "params": {}
}
```

支持的 `commandType`：

| 指令 | 描述 | 额外参数 |
|------|------|---------|
| `ARM` | 解锁电机 | - |
| `DISARM` | 锁定电机 | - |
| `TAKEOFF` | 自动起飞 | `altitude` (默认 5m) |
| `LAND` | 原地降落 | - |
| `RTL` | 返航 | - |
| `HOLD` | 悬停 | - |
| `OFFBOARD` | 切换 OFFBOARD 模式 | - |
| `GOTO` | 飞往指定坐标 | `latitude`, `longitude`, `altitude` |

### 响应格式

**Stage 1 - 后端响应**
```json
{
  "success": true,
  "message": "ARM command sent to px4_1",
  "commandId": "cmd-12345",
  "status": "SENT"
}
```

**Stage 2 - PX4 确认**（通过 WebSocket 推送）
```json
{
  "type": "command_ack",
  "uavId": "px4_1",
  "command": 400,
  "result": 0,
  "resultText": "ACCEPTED",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

## DDS Gateway 通信 API

### 遥测数据接收

```
POST /api/v1/dds-gateway/telemetry
X-Gateway-Key: <gateway-api-key>
Content-Type: application/json

{
  "uav_id": "px4_1",
  "latitude": 39.9042,
  "longitude": 116.4074,
  "altitude": 50.25,
  "heading": 180.5,
  "speed": 5.2,
  "battery_pct": 87.5,
  "armed": true,
  "flight_mode": "OFFBOARD",
  "timestamp": 1705312200.0
}
```

### 指令确认接收

```
POST /api/v1/dds-gateway/command-ack
X-Gateway-Key: <gateway-api-key>
Content-Type: application/json

{
  "uavId": "px4_1",
  "command": 400,
  "result": 0,
  "timestamp": 1705312200.0
}
```

## 团队管理 API

### 获取团队信息

```
GET /api/v1/team/info?teamId={teamId}
Authorization: Bearer <token>
```

### 获取团队成员

```
GET /api/v1/team/members?teamId={teamId}
Authorization: Bearer <token>
```

### 转移团队管理权

```
POST /api/v1/team/transfer
Authorization: Bearer <token>
Content-Type: application/json

{
  "teamId": 1,
  "newLeaderId": 5
}
```

## 操作日志 API

### 查询操作日志

```
GET /api/v1/logs?page={page}&size={size}
Authorization: Bearer <token>

Response:
{
  "content": [
    {
      "id": 1,
      "timestamp": "2025-01-15T10:30:00",
      "operator": "pilot1",
      "action": "ARM",
      "target": "px4_1",
      "result": "SUCCESS",
      "detail": "ARM command sent"
    }
  ],
  "totalPages": 5,
  "totalElements": 42
}
```

## WebSocket 端点

连接地址：`ws://localhost:8080/ws/websocket`

协议：STOMP over WebSocket

### 订阅话题

| 话题 | 数据内容 |
|------|---------|
| `/topic/telemetry` | 全局遥测数据 |
| `/topic/telemetry/partition/{name}` | 分区遥测数据（按权限路由） |
| `/topic/command-ack` | 全局指令确认 |
| `/topic/command-ack/partition/{name}` | 分区指令确认 |
| `/topic/drones` | 无人机状态列表 |
| `/topic/events` | 系统事件通知 |

## 配置项

关键配置在 `application.properties`：

| 配置项 | 描述 | 默认值 |
|--------|------|--------|
| `server.port` | 后端服务端口 | 8080 |
| `dds.gateway.url` | DDS 网关地址 | `http://localhost:5050` |
| `dds.gateway.api-key` | 网关通信密钥 | - |
| `spring.datasource.url` | PostgreSQL 连接 | - |
| `spring.data.redis.host` | Redis 地址 | localhost |
