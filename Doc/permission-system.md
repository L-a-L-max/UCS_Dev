# 权限与角色体系

## 角色定义

UCS 采用四级角色权限体系，从高到低：

| 角色 | 英文 | 权限范围 |
|------|------|---------|
| 指挥官 | COMMANDER | 全局管理：资源分配、舰队监控、数据统计 |
| 队长 | LEADER | 团队管理：成员管理、团队级任务、指令发送 |
| 飞手 | PILOT | 操控执行：单机/多机控制、详细指令面板 |
| 观察员 | OBSERVER | 只读监控：大屏展示、数据可视化 |

## 权限矩阵

| 功能 | COMMANDER | LEADER | PILOT | OBSERVER |
|------|:---------:|:------:|:-----:|:--------:|
| 查看全局地图 | O | O | O | O |
| 查看遥测数据 | O | O | O | O |
| 发送控制指令 | - | O | O | - |
| 管理团队成员 | O | O | - | - |
| 资源分配 | O | - | - | - |
| 转移团队管理权 | - | O | - | - |
| 数据统计图表 | O | O | - | - |

## 分区路由

### 概念

分区 (Partition) 是遥测数据的路由单位。每个分区包含一组无人机，用户根据权限只能看到所属分区的无人机数据。

### 路由规则

- **COMMANDER**：可见所有分区数据
- **LEADER**：可见所管理团队分配的分区
- **PILOT**：可见被分配操控的无人机所在分区
- **OBSERVER**：按配置可见指定分区

### WebSocket 分区订阅

```
/topic/telemetry/partition/{partitionName}
/topic/command-ack/partition/{partitionName}
```

前端根据用户权限动态订阅对应分区的 WebSocket 话题。

### 后端分区路由

`PartitionRoutingService` 负责：

1. 根据无人机 ID 查找所属分区
2. 根据用户角色和权限确定可见分区
3. 遥测数据到达时，路由到正确的分区话题

```java
// 遥测数据广播到分区
Set<String> partitions = partitionRoutingService.getPartitionsForDrone(uavId);
for (String partition : partitions) {
    messagingTemplate.convertAndSend(
        "/topic/telemetry/partition/" + partition, telemetryData);
}
```

## 认证流程

```
1. 用户提交用户名/密码 → POST /api/v1/auth/login
2. 后端验证凭据 → 生成 JWT Token (含角色信息)
3. 前端存储 Token → localStorage
4. 后续请求携带 Authorization: Bearer <token>
5. 前端根据 Token 中的角色信息渲染对应视图
```

## 指令权限校验

后端在处理控制指令时进行多层校验：

```
1. JWT Token 验证 → 身份合法性
2. 角色权限检查 → 是否有发送指令的权限
3. 无人机归属检查 → 是否有权控制该无人机
4. 在线状态检查 → 无人机是否在线
5. 指令发送 → 转发到 DDS Gateway
```
