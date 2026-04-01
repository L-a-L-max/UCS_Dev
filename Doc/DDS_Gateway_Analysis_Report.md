# DDS网关架构分析与优化方案报告

## 问题一：DDS网关收发功能拆分方案

### 现状分析

当前 `dds_gateway.py`（约2050行）承担了两大核心职责：

1. **数据接收路由（Ingest）**：订阅PX4 DDS Topic（`vehicle_global_position`、`vehicle_local_position`、`vehicle_attitude`、`vehicle_status`、`battery_status`、`vehicle_command_ack`），解析遥测数据，以10Hz频率经Kafka/HTTP转发至后端。
2. **控制指令下发（Command）**：通过HTTP Server（端口5050+）和Kafka Consumer接收后端指令，转换为PX4 DDS消息（`VehicleCommand`、`OffboardControlMode`、`TrajectorySetpoint`）发布。同时维护Offboard心跳（4Hz）和轨道飞行心跳（10Hz）。

单进程同时处理高频遥测采集与低延迟指令下发，在30架无人机场景下已出现性能瓶颈：
- GIL竞争：Python GIL导致遥测回调线程与指令处理线程无法真正并行
- 资源抢占：10Hz遥测转发、4Hz心跳发布、Kafka消费均在同一进程竞争CPU
- 锁竞争：`self._lock` 保护 `drone_states`，遥测回调和指令处理同时访问

### 拆分方案

```
┌─────────────────┐     ┌──────────────────┐
│  Ingest Gateway  │     │  Command Gateway  │
│  (数据接收网关)   │     │  (指令下发网关)    │
├─────────────────┤     ├──────────────────┤
│ • DDS订阅全部    │     │ • Kafka Consumer  │
│   遥测Topic      │     │   (commands.down) │
│ • 数据聚合/过滤  │     │ • HTTP指令接口    │
│ • Kafka Producer │     │ • DDS Publisher   │
│ • (0,0)坐标保护  │     │   (VehicleCommand)│
│ • 10Hz转发后端   │     │ • Offboard心跳4Hz │
│                  │     │ • Orbit心跳10Hz   │
│ 特点：高吞吐     │     │ 特点：低延迟      │
│ CPU密集型        │     │ 实时性要求高       │
└────────┬─────────┘     └────────┬─────────┘
         │                        │
         ▼                        ▼
    Kafka Topic              PX4 DDS
  (telemetry.raw)        (VehicleCommand等)
```

#### 具体实现步骤

1. **创建 `ingest_gateway.py`**：
   - 保留DDS订阅逻辑（`_subscribe_with_px4_msgs`中的所有`/fmu/out/`订阅）
   - 保留数据处理回调（`_on_global_position`、`_on_local_position`等）
   - 保留Kafka Producer和后端HTTP转发
   - 保留(0,0)坐标保护、位置有效性检查
   - 移除所有Publisher创建和指令处理代码

2. **创建 `command_gateway.py`**：
   - 保留DDS Publisher创建（`_get_or_create_publisher`）
   - 保留指令处理（`handle_command`全部逻辑）
   - 保留Offboard心跳（`start_offboard_heartbeat`）和Orbit心跳
   - 保留Kafka Consumer（`commands.down`消费）
   - 保留HTTP Server（`start_command_server`）
   - 需要维护轻量级`drone_states`用于NED坐标转换（可订阅`local_position`和`global_position`）

3. **共享状态同步**：
   - 指令网关需要无人机当前NED位置用于GOTO计算
   - 方案A（推荐）：指令网关订阅`local_position`和`global_position`的只读副本
   - 方案B：通过Redis共享位置状态（增加~1ms延迟，对指令场景可接受）

### 收益评估

| 指标 | 拆分前 | 拆分后（预估） |
|------|--------|---------------|
| 遥测处理延迟 | ~50ms | ~20ms（无GIL竞争） |
| 指令响应延迟 | ~30ms | ~10ms（专用进程） |
| 单实例无人机容量 | ~15架 | 遥测30架 / 指令50架 |
| 进程隔离 | 无 | 遥测崩溃不影响指令 |

---

## 问题二：动态分片方案 — Nacos vs K8S

### 现状分析

当前静态分片逻辑（`dds_gateway.py`第207-223行）：
```python
def _owns_drone(self, uav_id: str) -> bool:
    h = int(hashlib.md5(uav_id.encode()).hexdigest(), 16)
    return (h % self._total_instances) == self._instance_id
```

问题：
- 启动时需手动指定 `--instance-id` 和 `--total-instances`
- 扩缩容需重启所有实例并重新指定参数
- 无法应对运行时负载变化

### 方案对比

| 维度 | Nacos方案 | K8S方案 |
|------|-----------|---------|
| 服务发现 | Nacos注册中心 | K8S Service + Endpoints |
| 分片协调 | Nacos Naming + 一致性哈希 | StatefulSet序号分片 |
| 动态扩缩 | 实例注册/注销触发重分片 | HPA + 自定义Controller |
| 运维复杂度 | 中（需维护Nacos集群） | 高（需K8S集群） |
| 适合阶段 | 中期（10-100架） | 大规模（100+架） |
| 对Python支持 | Nacos SDK（nacos-sdk-python） | 原生支持（Pod内运行） |

### 推荐方案：分阶段实施

#### 第一阶段（当前 → 100架）：Nacos + 一致性哈希

```
┌──────────────────────────────────────────────┐
│                  Nacos 集群                    │
│  ┌─────────────────────────────────────────┐  │
│  │  Service: dds-gateway-ingest            │  │
│  │  Instances: [gw-0, gw-1, gw-2, ...]    │  │
│  │  Metadata: { weight, capacity }         │  │
│  └─────────────────────────────────────────┘  │
└──────────────────────┬───────────────────────┘
                       │ 注册/心跳/监听
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   ┌─────────┐   ┌─────────┐   ┌─────────┐
   │ Ingest-0│   │ Ingest-1│   │ Ingest-2│
   │ (hash   │   │ (hash   │   │ (hash   │
   │  ring)  │   │  ring)  │   │  ring)  │
   └─────────┘   └─────────┘   └─────────┘
```

实现要点：
1. 每个网关实例启动时注册到Nacos（`nacos-sdk-python`）
2. 监听实例变化事件，动态更新一致性哈希环
3. 无人机ID通过哈希环分配到实例，扩缩容时仅少量无人机需重映射
4. 支持权重分配（高性能节点承载更多无人机）

```python
# 一致性哈希示例
class ConsistentHashRing:
    def __init__(self, virtual_nodes=150):
        self.ring = SortedDict()
        self.virtual_nodes = virtual_nodes
    
    def add_node(self, instance_id: str, weight: int = 1):
        for i in range(self.virtual_nodes * weight):
            key = md5(f"{instance_id}:{i}".encode()).hexdigest()
            self.ring[key] = instance_id
    
    def get_node(self, uav_id: str) -> str:
        h = md5(uav_id.encode()).hexdigest()
        idx = self.ring.bisect_right(h) % len(self.ring)
        return self.ring.peekitem(idx)[1]
```

#### 第二阶段（100架+）：K8S容器编排

- 使用K8S StatefulSet部署网关实例
- 利用K8S HPA根据CPU/内存自动扩缩
- 自定义CRD（Custom Resource Definition）管理分片映射
- Nacos可替换为K8S原生Service Discovery

### 结论

**推荐先使用Nacos**，理由：
1. 当前系统规模（30架）更适合Nacos的轻量级方案
2. Nacos的Python SDK成熟，集成成本低
3. 后续可平滑迁移到K8S（Nacos也可部署在K8S上）
4. K8S的运维成本过高，不适合当前阶段

---

## 问题三：网关延迟与并发能力优化

### 无人机显示离线分析

30架无人机、3个实例测试中出现个别离线，可能原因：

1. **心跳超时**：后端 `DroneHeartbeatService` 使用Redis TTL（30秒）检测在线状态，如果网关转发延迟导致心跳刷新不及时，会误判为离线
2. **GIL瓶颈**：每个实例处理约10架无人机的遥测数据（每架6个Topic，每个10-50Hz），Python GIL导致回调处理堆积
3. **锁竞争**：`self._lock` 是全局锁，遥测回调和数据转发竞争同一把锁
4. **Kafka延迟**：`linger_ms=0` 但在高负载下batch仍可能积压

### 延迟优化方案

#### 1. 无锁数据结构优化
```python
# 当前：全局锁保护所有drone_states
with self._lock:
    drone_snapshot = list(self.drone_states.items())

# 优化：使用ConcurrentDict或per-drone锁
from concurrent.futures import ThreadPoolExecutor
# 每个drone独立锁，消除跨drone锁竞争
self._drone_locks = defaultdict(threading.Lock)
```

#### 2. 批量聚合发送
```python
# 当前：每架无人机独立发送HTTP/Kafka（10Hz × N架）
# 优化：攒批发送，减少网络往返
# 在100ms窗口内聚合多架无人机数据，一次Kafka produce
```

#### 3. 异步I/O替代线程
```python
# 当前：threading + time.sleep
# 优化：asyncio + aiohttp + aiokafka
# 避免GIL竞争，提高I/O并发
```

#### 4. 心跳参数调优
- 增大心跳TTL：30s → 60s（容忍更大延迟波动）
- 增加心跳频率：后端从5s一次改为3s一次
- 添加重连保护：短暂离线后的快速恢复窗口

### 并发能力提升

| 方案 | 预计提升 | 实施难度 |
|------|---------|---------|
| 收发拆分（问题一） | 2x | 中 |
| asyncio重构 | 3-5x | 高 |
| per-drone锁 | 1.5x | 低 |
| 批量聚合发送 | 1.5x | 低 |
| 多进程（multiprocessing） | N倍（N核） | 中 |
| C++/Rust重写核心路径 | 10x+ | 极高 |

**推荐优先级**：per-drone锁 → 批量聚合 → 收发拆分 → asyncio重构

---

## 问题四：多机控制6架以上无响应分析

### 问题根因

Kafka数据正常但无人机无响应，说明问题在网关侧的DDS发布环节：

1. **Offboard心跳瓶颈**：每架无人机需要独立的4Hz心跳线程（`_heartbeat_loop`），6架即6个线程同时以0.25s间隔发布DDS消息。Python线程切换开销 + GIL竞争导致心跳不及时（PX4要求>2Hz），OFFBOARD模式超时退出。

2. **DDS发布序列化**：`publish_vehicle_command`、`publish_trajectory_setpoint` 等方法通过ROS2 Publisher发布，底层可能存在序列化瓶颈。6架×4Hz = 24次/秒的TrajectorySetpoint发布。

3. **指令处理串行化**：Kafka Consumer或HTTP Server收到批量指令后，`handle_command` 串行处理每架无人机的指令，耗时累积。

### 解决方案

#### 1. 合并心跳线程（最关键）
```python
# 当前：每架无人机独立心跳线程
# 问题：6个线程 × 4Hz = 24次DDS发布/秒，GIL竞争严重

# 优化：单一心跳调度线程，批量发布所有活跃无人机的setpoint
def _unified_heartbeat_loop(self):
    """Single thread publishes heartbeats for ALL active drones at 4Hz."""
    while self.running:
        t0 = time.monotonic()
        for uav_id in list(self._heartbeat_active.keys()):
            if not self._heartbeat_active.get(uav_id):
                continue
            self.publish_offboard_control_mode(uav_id, position=True)
            sp = self._heartbeat_setpoints.get(uav_id, {})
            self.publish_trajectory_setpoint(uav_id, 
                sp.get('x', nan), sp.get('y', nan),
                sp.get('z', nan), yaw=sp.get('yaw', nan))
        elapsed = time.monotonic() - t0
        sleep_time = max(0, 0.25 - elapsed)
        time.sleep(sleep_time)
```

#### 2. 并行指令下发
```python
# 当前：串行处理批量指令
for uav_id in uav_ids:
    handle_command(uav_id, command_type, params)  # 每个约50ms

# 优化：线程池并行
with ThreadPoolExecutor(max_workers=10) as pool:
    futures = [pool.submit(handle_command, uid, cmd, params) for uid in uav_ids]
    results = [f.result(timeout=5) for f in futures]
```

#### 3. Epoch保护机制已有
当前代码已实现epoch管理（`_get_or_increment_epoch`），确保过期指令被丢弃，这是正确的。

---

## 问题五：(0,0)坐标保护改进方案

### 现状

当前代码（第436-443行）已实现坐标回滚保护：
```python
if s.position_valid and abs(lat) < 1.0 and abs(lon) < 1.0:
    logger.debug("[GPS] %s rejected (0,0) rollback", uav_id)
    return
```

### 改进方案

#### 1. 增加速度一致性检查
```python
def _on_global_position(self, uav_id, msg):
    with self._lock:
        s = self.drone_states.get(uav_id)
        if not s:
            return
        lat, lon, alt = msg.lat, msg.lon, msg.alt
        
        # 改进1：(0,0)回滚保护（已有）
        if s.position_valid and abs(lat) < 1.0 and abs(lon) < 1.0:
            logger.debug("[GPS] %s rejected (0,0) rollback", uav_id)
            s.last_update = time.time()
            return
        
        # 改进2：跳变检测 - 如果位移超过物理极限（基于速度和时间），丢弃
        if s.position_valid and s.ground_speed is not None:
            dt = time.time() - s.last_update
            if dt > 0 and dt < 5:  # 只在合理时间窗口内检测
                from math import radians, cos, sqrt
                dlat = (lat - s.lat) * 111320  # 近似米
                dlon = (lon - s.lon) * 111320 * cos(radians(s.lat))
                distance = sqrt(dlat**2 + dlon**2)
                max_possible = (s.ground_speed + 10) * dt  # 允许加速度余量
                if distance > max(max_possible, 100):  # 至少100m容忍
                    logger.warning("[GPS] %s rejected jump: %.0fm in %.1fs (speed=%.1fm/s)",
                                   uav_id, distance, dt, s.ground_speed)
                    return
        
        # 改进3：高度异常检测
        if s.position_valid and abs(alt - s.alt) > 500:  # 500m跳变
            logger.warning("[GPS] %s rejected altitude jump: %.1f -> %.1f",
                           uav_id, s.alt, alt)
            return
        
        s.lat = lat
        s.lon = lon
        s.alt = alt
```

#### 2. 前端防御增强
前端已有坐标交换检测（App.tsx第315-319行），可增加：
- 坐标缓存：收到(0,0)时使用上次有效坐标
- 平滑插值：大幅跳变时使用线性插值过渡

#### 3. 数据质量标记
在遥测数据中增加 `gpsQuality` 字段，标记GPS信号质量，前端可据此显示警告图标。

---

## 问题六：后端单实例瓶颈与多实例部署方案

### 单实例瓶颈分析

后端Spring Boot单实例在以下场景成为瓶颈：

1. **WebSocket连接数**：每个客户端（Observer/Commander/Leader/Pilot）维持一个STOMP连接。30架无人机 × 10Hz遥测 × N个分区 = 高频消息广播。单实例Tomcat默认最大200线程。

2. **Kafka消费延迟**：`TelemetryKafkaConsumer` 消费遥测数据并广播到WebSocket，单消费者吞吐有限。

3. **Redis/DB压力**：遥测入库、在线状态更新、分区路由查询均集中在单实例。

4. **控制指令延迟**：指令需要通过HTTP/Kafka转发到DDS网关，单实例下可能因WebSocket广播占用线程而延迟指令处理。

### 多实例部署方案

#### 推荐：K8S容器编排 + Spring Cloud（无需Nacos）

理由：
- 后端是Java Spring Boot，K8S原生支持
- Spring Boot Actuator + K8S探针天然集成
- WebSocket需要Session粘性，K8S Ingress支持
- Kafka消费者组天然支持多实例消费

```
┌─────────────────────────────────────────────────┐
│                    K8S Cluster                    │
│                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ UCS-API  │  │ UCS-API  │  │ UCS-API  │       │
│  │ Pod-0    │  │ Pod-1    │  │ Pod-2    │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
│       │              │              │              │
│  ┌────▼──────────────▼──────────────▼────┐       │
│  │         K8S Service (ClusterIP)        │       │
│  └────────────────┬──────────────────────┘       │
│                   │                               │
│  ┌────────────────▼──────────────────────┐       │
│  │   Ingress (Nginx/Traefik)             │       │
│  │   - WebSocket: sticky session          │       │
│  │   - REST API: round-robin              │       │
│  └────────────────────────────────────────┘       │
│                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Redis    │  │PostgreSQL│  │  Kafka   │       │
│  │ Cluster  │  │  Primary │  │  Cluster │       │
│  └──────────┘  └──────────┘  └──────────┘       │
└───────────────────────────────────────────────────┘
```

#### K8S配置要点

```yaml
# Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ucs-backend
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  template:
    spec:
      containers:
      - name: ucs-backend
        resources:
          requests: { cpu: "500m", memory: "512Mi" }
          limits: { cpu: "2000m", memory: "2Gi" }
        readinessProbe:
          httpGet: { path: /actuator/health, port: 8080 }
        livenessProbe:
          httpGet: { path: /actuator/health, port: 8080 }

# HPA
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target: { type: Utilization, averageUtilization: 70 }
```

#### WebSocket多实例问题

WebSocket是有状态连接，多实例需要：
1. **Sticky Session**：Ingress配置session affinity，确保同一客户端连接到同一Pod
2. **消息广播**：使用Redis Pub/Sub或Kafka作为消息总线，确保所有实例的WebSocket客户端都能收到消息
3. **当前代码已支持**：`RealtimePushService` 通过Spring的 `SimpMessagingTemplate` 发送，配合Spring Session + Redis可实现多实例

#### Nacos vs K8S 对比结论

| 场景 | 推荐 |
|------|------|
| DDS网关（Python） | **Nacos**（轻量、Python友好） |
| 后端服务（Java Spring） | **K8S**（生态成熟、原生支持） |
| 全栈部署 | K8S + Nacos（Nacos运行在K8S中） |

**结论**：DDS网关建议使用Nacos实现动态分片（问题二已述），后端服务建议使用K8S容器编排。两者不冲突，Nacos可以部署在K8S集群中，DDS网关也可以通过K8S管理但使用Nacos做服务发现。
