# UCS 技术文档

UCS (UAV Integrated Control System) 无人机综合管控平台技术文档。

## 文档目录

| 文档 | 描述 |
|------|------|
| [架构概览](architecture.md) | 系统整体架构、组件关系、数据流 |
| [DDS 通信](dds-communication.md) | DDS/ROS2 遥测订阅与指令发布技术实现 |
| [前端技术](frontend-tech.md) | React + TypeScript + MapLibre 前端技术栈 |
| [后端 API](backend-api.md) | Spring Boot REST API 与 WebSocket 接口 |
| [权限与角色](permission-system.md) | 四级角色权限体系与分区路由 |
| [部署指南](deployment.md) | 开发环境搭建与生产部署 |

## 快速了解

UCS 平台由三个核心组件构成：

```
PX4/Gazebo 仿真 → DDS Gateway (Python/rclpy) → Backend (Spring Boot) → Frontend (React)
```

- **Frontend**: React + TypeScript SPA，使用 MapLibre GL 渲染地图，STOMP WebSocket 接收实时遥测
- **Backend**: Spring Boot REST API + WebSocket 网关，负责认证、权限、遥测分发、指令中转
- **DDS Gateway**: Python ROS2 节点，桥接 PX4 DDS 话题与后端 HTTP API
