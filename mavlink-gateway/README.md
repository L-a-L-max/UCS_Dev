# MAVLink Routing Gateway

MAVLink路由网关，用于接入真实无人机。功能与DDS网关完全对称，区别仅在数据源：DDS话题 → MAVLink数据包。

## 架构

```
真实无人机 --MAVLink(UDP/TCP)--> MAVLink网关 --Kafka--> 后端服务
后端服务 --Kafka(commands.down)--> MAVLink网关 --MAVLink--> 真实无人机
```

后端和前端 **无需任何修改**，因为MAVLink网关输出的Kafka消息格式与DDS网关完全一致。

## 快速开始

### 安装依赖

```bash
pip install -r requirements.txt
```

### 启动（UDP模式，默认）

```bash
python mavlink_gateway.py --listen udp:0.0.0.0:14550
```

### 启动（TCP模式）

```bash
python mavlink_gateway.py --listen tcp:0.0.0.0:5760
```

### 环境变量配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `KAFKA_BOOTSTRAP_SERVERS` | `localhost:9092` | Kafka broker 地址 |
| `REDIS_HOST` | `localhost` | Redis 地址 |
| `REDIS_PORT` | `6379` | Redis 端口 |
| `REDIS_DB` | `0` | Redis 数据库索引 |
| `REDIS_PASSWORD` | (无) | Redis 密码 |
| `UCS_BACKEND_URL` | `http://localhost:8080` | 后端服务地址 |
| `DDS_GATEWAY_API_KEY` | `ucs-dds-gateway-secret-2024` | 网关认证密钥 |
| `MAVLINK_INSTANCE_ID` | `0` | 多实例模式下的实例ID |
| `MAVLINK_TOTAL_INSTANCES` | `1` | 多实例模式下的总实例数 |
| `MAVLINK_COMMAND_PORT` | `5060` | HTTP命令接口端口 |

## 核心功能

### 1. 遥测数据接收

监听UDP/TCP端口，解析以下MAVLink消息：

| MAVLink消息 | ID | 提取字段 |
|-------------|-----|---------|
| HEARTBEAT | #0 | armed状态、飞行模式 |
| GLOBAL_POSITION_INT | #33 | 经纬度、海拔(AMSL)、相对高度、速度、航向 |
| LOCAL_POSITION_NED | #32 | NED坐标、速度 |
| ATTITUDE | #30 | 航向（yaw → heading） |
| SYS_STATUS | #1 | 电池电量 |
| BATTERY_STATUS | #147 | 电池电量 |
| COMMAND_ACK | #77 | 命令执行确认 |

### 2. 遥测数据转发

解析后的数据映射为与DDS网关完全一致的JSON格式，发送到 `telemetry.raw` Kafka话题：

```json
{
  "uavId": "mavlink_192.168.1.101_14550",
  "lat": 39.9042,
  "lon": 116.4074,
  "alt": 15.3,
  "altAmsl": 65.3,
  "heading": 180.5,
  "groundSpeed": 3.2,
  "verticalSpeed": 0.1,
  "armed": true,
  "flightMode": "OFFBOARD",
  "batteryPercent": 85.0,
  "epoch": 3
}
```

### 3. 控制命令下发

消费 `commands.down` Kafka话题，将命令转换为MAVLink `COMMAND_LONG` 发送给无人机：

| UCS命令 | MAVLink命令 |
|---------|------------|
| TAKEOFF | ARM + OFFBOARD + SET_POSITION_TARGET |
| LAND | MAV_CMD_NAV_LAND (#21) |
| RTL | MAV_CMD_NAV_RETURN_TO_LAUNCH (#20) |
| HOLD | OFFBOARD + 当前位置 SET_POSITION_TARGET |
| GOTO | OFFBOARD + 目标位置 SET_POSITION_TARGET |
| ORBIT | OFFBOARD + 圆形轨迹 SET_POSITION_TARGET |
| DISARM | MAV_CMD_COMPONENT_ARM_DISARM (#400) |

### 4. UAV ID 映射

真实无人机的uav_id由源IP和端口自动生成：`mavlink_{ip}_{port}`

映射关系通过三级缓存存储：
1. **本地内存** — 最快查找
2. **Redis** — 跨实例共享（TTL=1h）
3. **PostgreSQL** — 持久化（通过Kafka事件异步写入）

### 5. Epoch校验

与DDS网关完全一致的epoch机制：
- 新无人机连接时分配epoch=1
- 重连时epoch+1
- epoch持久化到Redis（key: `mavlink:epoch:{uavId}`）
- 命令下发前校验epoch，拒绝过期命令
- 定期维护：清理24h无活动的epoch，超过10000的重置为1

## 多实例部署

```bash
# 实例0
python mavlink_gateway.py --instance-id 0 --total-instances 3

# 实例1
python mavlink_gateway.py --instance-id 1 --total-instances 3

# 实例2
python mavlink_gateway.py --instance-id 2 --total-instances 3
```

无人机通过hash(uav_id)自动分配到对应实例。

## 与DDS网关的关系

两个网关可以 **同时运行**，分别服务仿真和真实无人机：

```
仿真无人机 --DDS--> DDS网关 --Kafka--> 后端
真实无人机 --MAVLink--> MAVLink网关 --Kafka--> 后端
```

后端通过uav_id前缀区分数据来源：
- `px4_*` → 仿真无人机（DDS网关）
- `mavlink_*` → 真实无人机（MAVLink网关）

## 测试

### 使用SITL仿真测试

将PX4 SITL的MAVLink输出重定向到网关：

```bash
# 1. 启动MAVLink网关
python mavlink_gateway.py --listen udp:0.0.0.0:14550

# 2. 启动PX4 SITL，MAVLink输出到网关
# 在PX4配置中设置 MAV_0_UDP_PRT=14550, MAV_0_REMOTE_IP=<gateway_ip>
# 或者使用mavlink-router转发
mavlink-routerd -e <gateway_ip>:14550 /dev/ttyACM0:115200
```

### 无需QGC

当仿真无人机的MAVLink配置指向网关后，不再需要QGC连接。网关完全替代QGC的遥测接收和命令发送功能。
