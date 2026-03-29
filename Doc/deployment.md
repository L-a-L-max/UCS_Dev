# 部署指南

## 环境要求

| 组件 | 要求 |
|------|------|
| Java | JDK 17+ |
| Node.js | 18+ |
| Python | 3.10+ |
| ROS2 | Humble Hawksbill |
| PostgreSQL | 14+ |
| Redis | 7+ |
| PX4-Autopilot | v1.14+ |
| Gazebo | Garden |

## 开发环境搭建

### 1. 后端 (Spring Boot)

```bash
cd backend

# 配置数据库和 Redis
cp src/main/resources/application.properties.example src/main/resources/application.properties
# 编辑 application.properties 填写数据库连接信息

# 构建并运行
./mvnw spring-boot:run
# 后端启动在 http://localhost:8080
```

关键配置项：
```properties
# 数据库
spring.datasource.url=jdbc:postgresql://localhost:5432/ucs
spring.datasource.username=ucs
spring.datasource.password=<password>

# Redis
spring.data.redis.host=localhost
spring.data.redis.port=6379

# DDS Gateway
dds.gateway.url=http://localhost:5050
dds.gateway.api-key=<your-gateway-key>
```

### 2. 前端 (React/Vite)

```bash
cd frontend/ucs-dashboard

# 安装依赖
npm install

# 开发模式
npm run dev
# 前端启动在 http://localhost:5173

# 生产构建
npm run build
```

### 3. DDS Gateway (Python/ROS2)

```bash
cd dds-gateway

# 确保 ROS2 环境已激活
source /opt/ros/humble/setup.bash

# 安装 Python 依赖
pip install -r requirements.txt

# 运行网关
python dds_gateway.py --config config.yaml
# HTTP 命令服务启动在 http://localhost:5050
```

### 4. PX4 仿真

```bash
# 启动多机仿真
cd PX4-Autopilot

# 单机
make px4_sitl gazebo-classic

# 多机 (例如 3 架)
Tools/simulation/gazebo-classic/sitl_multiple_run.sh -n 3
```

## 启动顺序

建议按以下顺序启动各组件：

```
1. PostgreSQL + Redis (基础设施)
2. PX4/Gazebo 仿真 (数据源)
3. DDS Gateway (中间件桥接)
4. Backend (API 服务)
5. Frontend (用户界面)
```

## 端口分配

| 服务 | 端口 | 协议 |
|------|------|------|
| Frontend (dev) | 5173 | HTTP |
| Backend | 8080 | HTTP + WebSocket |
| DDS Gateway | 5050 | HTTP |
| PostgreSQL | 5432 | TCP |
| Redis | 6379 | TCP |
| Gazebo | 11345 | TCP |

## 生产部署

### Docker Compose (推荐)

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:14
    environment:
      POSTGRES_DB: ucs
      POSTGRES_USER: ucs
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  backend:
    build: ./backend
    ports:
      - "8080:8080"
    depends_on:
      - postgres
      - redis
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/ucs
      SPRING_DATA_REDIS_HOST: redis
      DDS_GATEWAY_URL: http://dds-gateway:5050

  frontend:
    build: ./frontend/ucs-dashboard
    ports:
      - "80:80"
    depends_on:
      - backend

  dds-gateway:
    build: ./dds-gateway
    network_mode: host  # DDS 需要主机网络
    depends_on:
      - backend
```

### Nginx 反向代理

```nginx
server {
    listen 80;
    server_name ucs.example.com;

    # 前端静态文件
    location / {
        root /var/www/ucs/dist;
        try_files $uri $uri/ /index.html;
    }

    # 后端 API 代理
    location /api/ {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket 代理
    location /ws/ {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## 常见问题

### DDS 连接不上 PX4

确认 QoS 配置匹配。PX4 使用 `BEST_EFFORT` 可靠性策略：
```python
px4_qos = QoSProfile(
    reliability=ReliabilityPolicy.BEST_EFFORT,
    durability=DurabilityPolicy.VOLATILE
)
```

### WebSocket 连接失败

检查 CORS 配置。后端需要允许前端域名：
```java
registry.addMapping("/**")
    .allowedOriginPatterns("*")
    .allowedMethods("GET", "POST", "PUT", "DELETE");
```

### 多机仿真无人机 ID 冲突

确保每架无人机使用唯一的命名空间前缀：
```
px4_1, px4_2, px4_3 ...
```
DDS Gateway 会自动为每架无人机创建独立的话题订阅。
