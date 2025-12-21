# 快速启动指南

本文档提供最简化的启动流程，用于快速测试系统功能。

## 前提条件

- Java 17+ 已安装
- Node.js 18+ 已安装
- PostgreSQL 已安装并配置好数据库（参考 DEPLOYMENT.md）
- ROS 2 Humble 已安装（仅网关需要）

## 一、同一虚拟机启动（所有服务在同一台机器）

### 步骤 1：启动后端服务

```bash
# 进入后端目录
cd backend

# 修改数据库密码（首次运行需要）
# 编辑 src/main/resources/application-prod.properties
# 将 spring.datasource.password=your_secure_password 改为你的实际密码

# 构建（首次运行或代码更新后）
mvn clean package -DskipTests

# 启动后端
java -jar target/ucs-backend-1.0.0.jar --spring.profiles.active=prod
```

后端启动成功后会显示：`Started UcsBackendApplication in X seconds`

### 步骤 2：启动前端（新终端）

```bash
cd frontend/ucs-dashboard
npm install  # 首次运行需要
npm run dev
```

前端启动后访问：http://localhost:5173
登录账号：`observer` / `123456`

### 步骤 3：启动 ROS 2 网关（新终端）

```bash
# 确保 ROS 2 环境已加载
source /opt/ros/humble/setup.bash
source ~/ucs_ws/install/setup.bash  # 如果已构建网关包

# 启动网关（默认订阅 /all_uavs_gps 话题）
ros2 run uav_telemetry_gateway gateway_node
```

网关会自动订阅 `/all_uavs_gps` 话题并将数据转发到后端。

## 二、跨虚拟机启动（PX4 VM + 服务 VM）

### 服务 VM（运行后端、前端、网关）

```bash
# 1. 启动后端（同上）
cd backend
java -jar target/ucs-backend-1.0.0.jar --spring.profiles.active=prod

# 2. 启动前端（同上）
cd frontend/ucs-dashboard
npm run dev

# 3. 启动网关，指定后端地址
ros2 run uav_telemetry_gateway gateway_node \
    --ros-args \
    -p backend_url:=http://localhost:8080 \
    -p topic_name:=/all_uavs_gps
```

### PX4 VM（运行仿真）

确保两台 VM 网络互通，并设置相同的 ROS_DOMAIN_ID：

```bash
# 在两台 VM 上都设置相同的 DOMAIN_ID
export ROS_DOMAIN_ID=0

# 检查话题是否可见
ros2 topic list
# 应该能看到 /all_uavs_gps
```

### 跨 VM 网关配置（如果网关在 PX4 VM 上运行）

如果网关运行在 PX4 VM 上，需要指定服务 VM 的 IP：

```bash
# 在 PX4 VM 上运行网关
ros2 run uav_telemetry_gateway gateway_node \
    --ros-args \
    -p backend_url:=http://<服务VM的IP>:8080 \
    -p topic_name:=/all_uavs_gps
```

## 三、验证系统工作

### 1. 检查后端 API

```bash
# 测试登录
curl http://localhost:8080/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"observer","password":"123456"}'
```

### 2. 检查 ROS 2 话题

```bash
# 查看话题列表
ros2 topic list

# 查看话题数据
ros2 topic echo /all_uavs_gps
```

### 3. 检查网关状态

网关每 10 秒会输出状态日志：
```
[INFO] Gateway status: received=X, sent=X, errors=X
```

### 4. 检查前端显示

1. 打开浏览器访问 http://localhost:5173
2. 使用 `observer` / `123456` 登录
3. 查看地图上是否显示无人机位置
4. 右上角应显示 WebSocket 连接状态

## 四、常见问题

### Q: 后端启动报错 "TINYINT does not exist"
A: 确保使用最新代码，已修复 PostgreSQL 兼容性问题（PR #24）

### Q: 网关连接后端失败
A: 检查后端是否启动，检查 backend_url 参数是否正确

### Q: 前端看不到无人机数据
A: 
1. 检查后端是否有数据：`curl http://localhost:8080/api/v1/telemetry/latest`
2. 检查网关是否收到 ROS 话题数据
3. 检查浏览器控制台是否有 WebSocket 错误

### Q: ROS 2 话题跨 VM 不可见
A: 
1. 确保两台 VM 网络互通（可以 ping 通）
2. 确保 ROS_DOMAIN_ID 相同
3. 检查防火墙设置

## 五、启动顺序总结

```
1. PostgreSQL 数据库（通常已作为系统服务运行）
      ↓
2. Java 后端（等待启动完成）
      ↓
3. ROS 2 网关（连接后端）
      ↓
4. Web 前端（连接后端）
      ↓
5. PX4 仿真（发布 /all_uavs_gps 话题）
```

详细部署说明请参考 [DEPLOYMENT.md](./DEPLOYMENT.md)
