# 前端技术文档

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 18.x | UI 框架 |
| TypeScript | 5.x | 类型安全 |
| Vite | 5.x | 构建工具 |
| MapLibre GL | 4.x | 地图渲染引擎 |
| Tailwind CSS | 3.x | 样式框架 |
| shadcn/ui | - | UI 组件库 |
| @stomp/stompjs | - | STOMP WebSocket 客户端 |
| Recharts | 2.x | 数据可视化图表 |
| Lucide React | - | 图标库 |

## 角色视图

前端根据用户角色渲染不同的视图组件：

| 角色 | 组件 | 功能 |
|------|------|------|
| COMMANDER | `CommanderView.tsx` | 全局资源分配、舰队统计、饼/柱状图 |
| LEADER | `LeaderView.tsx` | 团队管理、成员管理、指令发送 |
| PILOT | `PilotView.tsx` | 单机/多机控制、详细指令面板 |
| OBSERVER | `App.tsx` (大屏模式) | 只读仪表盘、热力图、航迹 |

## 关键功能实现

### 1. 无人机方向图标旋转

前端从 WebSocket 遥测数据中获取 `heading` 字段（航向角 0-360 度），
通过 CSS `transform: rotate()` 动态旋转无人机 SVG 图标。

```typescript
// MapPanel.tsx - createMarkerHTML
<svg style="transform: rotate(${drone.heading ?? 0}deg); transition: transform 0.5s ease;">
  <path d="M21 16v-2l-8-5V3.5..."/>  // 飞机图标
</svg>
```

`transition: transform 0.5s ease` 确保旋转动画平滑过渡。

### 2. 面板折叠/展开动画

使用 CSS `transition-all` 替代条件渲染，实现平滑的面板折叠动画：

```tsx
// 替代: {collapsed ? null : <Panel />}
// 使用:
<div className={`${collapsed ? 'w-0 min-w-0 overflow-hidden' : 'w-[420px] min-w-[320px]'} 
  transition-all duration-500 ease-in-out`}>
  <PanelContent />
</div>
```

关键点：
- 不使用条件渲染（会导致瞬间消失）
- 通过 `w-0 min-w-0 overflow-hidden` 折叠面板
- `duration-500` 表示 500ms 过渡时间
- `ease-in-out` 缓入缓出动画曲线

### 3. 动态分页

根据视口高度动态计算每页显示条数：

```typescript
useEffect(() => {
  const calculatePageSize = () => {
    const available = window.innerHeight - 220; // 减去头部、标签栏等固定区域
    setLogPageSize(Math.max(5, Math.floor(available / 68))); // 每条日志约 68px
  };
  calculatePageSize();
  window.addEventListener('resize', calculatePageSize);
  return () => window.removeEventListener('resize', calculatePageSize);
}, []);
```

分页控件固定在日志区域底部，使用 flex 布局：
```tsx
<div className="flex flex-col h-full">
  <div className="flex-1 overflow-auto">{/* 日志列表 */}</div>
  <div className="flex-shrink-0 border-t">{/* 分页控件 */}</div>
</div>
```

### 4. 舰队统计图表

使用 Recharts 库渲染饼图/柱状图，支持切换：

```typescript
const droneChartData = useMemo(() => {
  const armed = mapDrones.filter(d => d.onlineStatus && d.armed).length;
  const disarmed = mapDrones.filter(d => d.onlineStatus && !d.armed).length;
  const offline = mapDrones.filter(d => !d.onlineStatus).length;
  return [
    { name: '在线已解锁', value: armed, color: '#22c55e' },
    { name: '在线未解锁', value: disarmed, color: '#3b82f6' },
    { name: '离线', value: offline, color: '#64748b' },
  ].filter(d => d.value > 0);
}, [mapDrones]);
```

图表动画时长 600ms，使用 `animationDuration={600}` 配置。

### 5. 两阶段指令反馈

指令发送后前端分两个阶段显示反馈：

**Stage 1 - 后端已接受**（HTTP 响应）
```
[px4_1] ARM 指令已发送  (绿色背景)
```

**Stage 2 - PX4 已执行**（WebSocket 推送）
```
[px4_1] PX4 确认执行: ACCEPTED  (翠绿色背景)
```

实现方式：
1. `handleCommand()` 发送 HTTP 请求 → Stage 1 反馈
2. `useTelemetryWebSocket` 订阅 `/topic/command-ack` → `handleCommandAck()` → Stage 2 反馈

### 6. 高度/电量精度格式化

```typescript
// 高度保留两位小数
drone.altitude.toFixed(2)  // "123.45m"

// 电量保留一位小数  
drone.battery.toFixed(1)   // "87.5%"
```

### 7. 选中/取消选中逻辑

Commander 视图支持点击已选中的无人机再次点击取消选中：

```typescript
setSelectedMapDrone(prev => prev === drone.uavId ? null : drone.uavId);
```

## WebSocket 连接

前端通过 STOMP-over-WebSocket 连接后端：

```
ws://localhost:8080/ws/websocket
```

订阅的话题：

| 话题 | 用途 |
|------|------|
| `/topic/telemetry` | 全局遥测（兼容旧版） |
| `/topic/telemetry/partition/{name}` | 分区遥测（按权限路由） |
| `/topic/command-ack` | 全局指令确认 |
| `/topic/command-ack/partition/{name}` | 分区指令确认 |
| `/topic/drones` | 无人机状态列表 |
| `/topic/events` | 事件通知 |
