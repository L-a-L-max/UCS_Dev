# DDS网关优化修改说明与验证标准

## 修改概述

本次优化基于《DDS网关架构分析与优化方案报告》的建议，对 `dds-gateway/dds_gateway.py` 进行了以下核心优化：

| 序号 | 优化项 | 影响范围 | 风险等级 |
|------|--------|---------|---------|
| 1 | 每架无人机细粒度锁 | 全局并发性能 | 低 |
| 2 | GPS跳变检测（速度模型） | 位置数据质量 | 低 |
| 3 | 高度异常检测 | 位置数据质量 | 低 |
| 4 | 批量Kafka发送 | 网络开销 | 低 |
| 5 | 统计计数器线程安全 | 数据统计准确性 | 低 |
| 6 | ThreadPoolExecutor并行命令派发 | 多机控制响应速度 | 低 |

---

## 1. 每架无人机细粒度锁（Per-Drone Fine-Grained Locks）

### 修改内容

**原有设计**：单一全局锁 `self._lock` 保护所有无人机状态，任何一架无人机的回调处理都会阻塞其他所有无人机。

**优化后**：
- `self._lock`（全局锁）仅用于保护 `drone_states` 字典结构（如遍历键列表、添加/删除无人机）
- `self._drone_locks[uav_id]`（每架无人机独立锁）用于保护单架无人机的状态更新
- 使用 `defaultdict(threading.Lock)` 自动为每架新无人机创建独立锁

### 涉及方法

| 方法名 | 修改说明 |
|--------|---------|
| `__init__` | 新增 `_drone_locks`、`_stats_lock`、`_command_executor` |
| `_on_global_position` | 使用 `_drone_locks[uav_id]` 替代 `_lock` |
| `_on_local_position` | 使用 `_drone_locks[uav_id]` 替代 `_lock` |
| `_on_attitude` | 使用 `_drone_locks[uav_id]` 替代 `_lock` |
| `_on_vehicle_status` | 使用 `_drone_locks[uav_id]` 替代 `_lock` |
| `_on_battery_status` | 使用 `_drone_locks[uav_id]` 替代 `_lock` |
| `build_telemetry_payload` | 全局锁获取键列表快照，逐架使用细粒度锁读取状态 |
| `log_statistics` | 同上 |
| `run`（主循环批量发送） | 同上 |
| `_heartbeat_loop` | 到达检测使用 `_drone_locks[uav_id]` |
| `_orbit_loop` | 轨道计算使用 `_drone_locks[uav_id]` |

### 性能影响

- 锁争用从 O(N) 降至 O(1)（N=无人机数量）
- 30架无人机场景下，理论并发吞吐量提升约30倍
- 不同无人机的回调处理完全不阻塞

### 验证标准

```
1. 启动3个网关实例，30架无人机
2. 观察日志：不应出现 "Lock contention" 或线程等待超时
3. 通过 /api/health 端点检查所有无人机状态正常更新
4. 遥测数据延迟应 < 100ms（观察Stats日志中的时间戳差）
5. 并发安全：不应出现 KeyError、数据竞争等异常
```

---

## 2. GPS跳变检测（Velocity-Based Jump Detection）

### 修改内容

在 `_on_global_position` 方法中新增三层GPS数据保护：

#### 第1层：(0,0) 坐标回滚拒绝
```python
if s.position_valid and abs(lat) < 1.0 and abs(lon) < 1.0:
    # 拒绝：位置已有效时，(0,0)坐标为GPS未定位的回滚值
```

#### 第2层：速度模型跳变检测
```python
# 计算物理上可能的最大移动距离
max_possible = (ground_speed + 10) * dt  # 允许加速余量
if distance > max(max_possible, 100):    # 至少100m容差
    # 拒绝：位置跳变超过物理极限
```

计算逻辑：
- `dlat_m = (lat - s.lat) * 111320`（纬度差转换为米）
- `dlon_m = (lon - s.lon) * 111320 * cos(radians(s.lat))`（经度差转换为米，考虑纬度修正）
- `distance = sqrt(dlat_m² + dlon_m²)`
- 容差：`max(max_possible, 100m)`，确保低速时也有合理容差

#### 第3层：高度异常检测
```python
if s.position_valid and abs(alt - s.alt) > 500:
    # 拒绝：单次更新高度变化 > 500m，属于传感器异常
```

### 统计记录

每次拒绝都会记录到 `_stats` 中：
- `{uav_id}/gps_jump_rejected`：速度模型拒绝次数
- `{uav_id}/alt_jump_rejected`：高度异常拒绝次数

在 `log_statistics` 中汇总输出。

### 验证标准

```
1. 正常飞行：所有有效位置更新应被接受，无误拒绝
2. 模拟GPS跳变：手动发送经纬度突变的DDS消息，应被拒绝
   - 日志输出: "[GPS] px4_X rejected jump: XXXm in X.Xs (speed=X.Xm/s)"
3. 模拟(0,0)回滚：位置有效后发送(0,0)坐标，应被拒绝
   - 日志输出: "[GPS] px4_X rejected (0,0) rollback"
4. 模拟高度异常：发送高度突变>500m的消息，应被拒绝
   - 日志输出: "[GPS] px4_X rejected altitude jump"
5. 统计面板：Stats日志中应显示 GPS-jump-rejected 计数
```

---

## 3. 批量Kafka发送（Batch Kafka Sending）

### 修改内容

**原有设计**：主循环中逐架无人机检查并发送遥测，每架单独一次Kafka/HTTP调用。

**优化后**：
1. 全局锁获取无人机ID快照
2. 遍历所有无人机，使用细粒度锁读取状态
3. 过滤条件：
   - 跳过超过5s未更新的无人机（`last_update > 5s ago`）
   - 跳过GPS位置无效的无人机（`position_valid == False`）
   - 跳过发送频率限制内的无人机（`< SEND_INTERVAL = 0.1s`）
4. 将所有满足条件的无人机数据收集到 `batch_drones` 列表
5. **一次性**发送整个批次到Kafka/HTTP

### 涉及代码位置

`run()` 方法主循环中的遥测转发部分。

### 性能影响

- Kafka网络调用从 N次/周期 降至 1次/周期
- HTTP后备调用同样从 N次 降至 1次
- 减少序列化开销和网络往返延迟
- 对于30架无人机，网络开销降低约97%

### 验证标准

```
1. 启动30架无人机，观察Kafka消费端
2. 验证：每个发送周期(0.1s)仅产生1条Kafka消息（包含多架无人机数据）
3. 消息格式验证：
   {
     "timestamp": "2024-xx-xxTxx:xx:xx.xxxxZ",
     "drones": [
       {"uavId": "px4_1", "lat": ..., "lon": ..., ...},
       {"uavId": "px4_2", "lat": ..., "lon": ..., ...},
       ...
     ]
   }
4. 后端接收验证：确认后端可正确解析批量格式
5. Stats日志：kafka_success 计数应明显低于之前（每批+1而非每架+1）
```

---

## 4. 统计计数器线程安全（Thread-Safe Statistics）

### 修改内容

新增 `self._stats_lock`（`threading.Lock`），保护 `self._stats`（`defaultdict(int)`）的所有读写操作。

### 涉及方法

| 方法 | _stats操作 | 是否已加锁 |
|------|-----------|-----------|
| `_on_global_position` | 消息计数 | 是 |
| `_on_local_position` | 消息计数 | 是 |
| `_on_attitude` | 消息计数 | 是 |
| `_on_vehicle_status` | 消息计数 | 是 |
| `_on_battery_status` | 消息计数 | 是 |
| `_on_vehicle_command_ack` | 命令确认计数 | 是 |
| `_consume_loop` (Kafka) | 命令消费/过期/过时计数 | 是 |
| `send_to_kafka` | kafka_success/errors | 是 |
| `send_to_backend` | backend_success/errors | 是 |
| `log_statistics` | 读取快照 | 是 |

### 验证标准

```
1. 高负载下运行（30+架无人机），统计数据应准确一致
2. Stats日志中的 total_messages 应 = 所有 topic 计数之和
3. 不应出现负数、异常大数值或 KeyError
```

---

## 5. ThreadPoolExecutor并行命令派发

### 修改内容

在 `__init__` 中新增：
```python
self._command_executor = ThreadPoolExecutor(max_workers=10, thread_name_prefix='cmd-dispatch')
```

用于多机控制场景下并行发送命令到多架无人机，避免串行发送导致的响应延迟。

### 验证标准

```
1. 选择6+架无人机执行批量命令（如GOTO）
2. 所有无人机应在2秒内开始响应（而非串行等待）
3. 日志中不应出现 "ThreadPool exhausted" 或类似警告
```

---

## 6. 编码任务修改说明

### 任务1：悬停保持

**文件**: `frontend/ucs-dashboard/src/pages/LeaderView.tsx`

**修改**: 在GOTO命令发送后追加HOVER命令调用。当无人机到达目标位置后，自动发送悬停指令以保持高度，防止无人机到达后开始下降。

**验证标准**:
```
1. 在队长端选择一架无人机，点击地图位置执行GOTO
2. 无人机到达目标位置后应保持悬停（高度不变）
3. 不应出现到达后持续下降的情况
```

### 任务2：高度保持

**文件**: `frontend/ucs-dashboard/src/pages/LeaderView.tsx`

**修改**: 通过地图点击控制无人机前往目标位置时，默认不发送高度参数（或发送当前高度），仅在详情面板明确指定时才改变高度。

**验证标准**:
```
1. 通过点击地图控制无人机移动，无人机应保持当前高度
2. 通过详情面板指定高度时，无人机应改变到指定高度
3. 多架无人机同时操作时，各架高度互不影响
```

### 任务3：队员端多机控制

**文件**: `frontend/ucs-dashboard/src/pages/PilotView.tsx`

**修改**: 参考队长端实现，修复队员端多机控制逻辑。原问题是只有选中的第一架无人机会执行指令，修改后遍历所有选中的无人机并依次发送命令。

**验证标准**:
```
1. 在队员端选择多架无人机（3架以上）
2. 执行飞行任务（如起飞、GOTO、悬停等）
3. 所有选中的无人机都应执行命令，而非仅第一架
```

### 任务4：高德3D地图修复

**文件**: `frontend/ucs-dashboard/src/components/map/AMap3DPanel.tsx`

**修改**:
- 实现无人机聚焦功能（点击无人机后地图中心移动到该无人机位置）
- 修复实时数据渲染（确保3D地图中的无人机位置/高度实时更新）
- 无人机模型尺寸缩小为原来的1/4

**验证标准**:
```
1. 点击3D地图中的无人机，地图应自动居中到该无人机
2. 无人机飞行时，3D地图中的位置应实时更新
3. 无人机模型大小应为修改前的1/4
4. 高度参数格式正确（3D地图支持altitude）
```

### 任务5：Observer端数据渲染

**文件**: `frontend/ucs-dashboard/src/App.tsx`

**修改**: 修复Observer端WebSocket连接和数据渲染逻辑。Observer端无法显示无人机数据是因为WebSocket数据订阅路径或角色判断存在问题，修改后Observer可以正常接收并渲染遥测数据。

**验证标准**:
```
1. 启动多架无人机
2. 确认Commander、队长端、队员端均可渲染数据
3. 切换到Observer界面，应能看到相同的无人机数据
4. Redis中observer分区数据应被正确消费并显示
```

### 任务6：数据库与Redis双写一致性

**文件**: 
- `backend/src/main/java/com/ucs/service/PartitionRoutingService.java`
- `ucs-platform/ucs-business/src/main/java/com/ucs/business/service/PartitionRoutingService.java`

**修改**: 实现 Transactional Outbox + Post-Commit Hook 企业级方案（而非延迟双删除策略），确保数据库与Redis的双写一致性。

**方案说明**:
1. **Transactional Outbox**: 分区变更与Outbox事件在同一数据库事务内写入，保证原子性
2. **Post-Commit Hook**: 事务提交后立即同步Redis，减少数据不一致窗口
3. **重试队列**: 如果Redis同步失败，加入重试队列后台重试
4. **定期对账**: 后台线程定期比对数据库与Redis数据，修复不一致

**验证标准**:
```
1. 修改无人机分区时，数据库和Redis应同步更新
2. 模拟Redis短暂不可用，恢复后数据应自动对齐
3. 不应使用延迟双删除策略
4. 查看日志：应有 "Post-commit Redis sync" 相关日志
5. 对账线程日志：定期输出对账结果
```

---

## 附录：文件变更清单

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `dds-gateway/dds_gateway.py` | 优化 | 细粒度锁、GPS保护、批量发送、统计线程安全 |
| `frontend/ucs-dashboard/src/pages/LeaderView.tsx` | 修复 | 悬停保持、高度保持 |
| `frontend/ucs-dashboard/src/pages/PilotView.tsx` | 修复 | 队员端多机控制 |
| `frontend/ucs-dashboard/src/components/map/AMap3DPanel.tsx` | 修复 | 3D地图聚焦、实时渲染、模型缩小 |
| `frontend/ucs-dashboard/src/App.tsx` | 修复 | Observer端数据渲染 |
| `backend/.../PartitionRoutingService.java` | 新增 | 双写一致性方案 |
| `ucs-platform/.../PartitionRoutingService.java` | 新增 | 双写一致性方案（平台模块） |
| `Doc/DDS_Gateway_Analysis_Report.md` | 新增 | 架构分析报告 |
| `Doc/Nacos_DDS_Gateway_Deployment_Guide.md` | 新增 | Nacos部署文档 |
| `Doc/K8S_Service_Deployment_Guide.md` | 新增 | K8S部署文档 |
| `Doc/DDS_Gateway_Optimization_Notes.md` | 新增 | 本文档 |
