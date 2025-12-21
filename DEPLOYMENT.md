# UAV 集群管控平台部署指南

本文档详细说明如何部署 UAV 集群管控平台，包括 Java 后端、Web 前端和 ROS 2 网关。

## 系统架构

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   PX4 仿真      │     │   ROS 2 网关    │     │   Java 后端     │
│   (Gazebo)      │────▶│   (Python)      │────▶│   (Spring Boot) │
│                 │     │                 │     │                 │
│  发布话题:      │     │  订阅话题       │     │  REST API       │
│  /all_uavs_gps  │     │  转发HTTP       │     │  WebSocket      │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
                                               ┌─────────────────┐
                                               │   PostgreSQL    │
                                               │   (TimescaleDB) │
                                               └─────────────────┘
                                                         │
                                                         ▼
                                               ┌─────────────────┐
                                               │   Web 前端      │
                                               │   (React)       │
                                               └─────────────────┘
```

## 服务器环境要求

### 硬件要求
- CPU: 4核以上
- 内存: 8GB以上
- 存储: 100GB以上（用于存储2年遥测数据）

### 软件要求
- Ubuntu 22.04 LTS
- Java 17+
- Node.js 18+
- PostgreSQL 14+ (推荐使用 TimescaleDB)
- ROS 2 Humble
- Python 3.10+

## 一、安装基础环境

### 1.1 安装 Java 17

```bash
sudo apt update
sudo apt install -y openjdk-17-jdk
java -version
```

### 1.2 安装 Node.js 18

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

### 1.3 安装 Maven

```bash
sudo apt install -y maven
mvn -v
```

### 1.4 安装 PostgreSQL 和 TimescaleDB

```bash
# 安装 PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# 添加 TimescaleDB 仓库
sudo sh -c "echo 'deb https://packagecloud.io/timescale/timescaledb/ubuntu/ $(lsb_release -c -s) main' > /etc/apt/sources.list.d/timescaledb.list"
wget --quiet -O - https://packagecloud.io/timescale/timescaledb/gpgkey | sudo apt-key add -
sudo apt update

# 安装 TimescaleDB
sudo apt install -y timescaledb-2-postgresql-14

# 配置 TimescaleDB
sudo timescaledb-tune --quiet --yes

# 重启 PostgreSQL
sudo systemctl restart postgresql
```

### 1.5 安装 ROS 2 Humble

```bash
# 设置 locale
sudo apt update && sudo apt install -y locales
sudo locale-gen en_US en_US.UTF-8
sudo update-locale LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
export LANG=en_US.UTF-8

# 添加 ROS 2 仓库
sudo apt install -y software-properties-common
sudo add-apt-repository universe
sudo apt update && sudo apt install -y curl
sudo curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.key -o /usr/share/keyrings/ros-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/ros-archive-keyring.gpg] http://packages.ros.org/ros2/ubuntu $(. /etc/os-release && echo $UBUNTU_CODENAME) main" | sudo tee /etc/apt/sources.list.d/ros2.list > /dev/null

# 安装 ROS 2 Humble
sudo apt update
sudo apt install -y ros-humble-desktop

# 安装 Python 依赖
sudo apt install -y python3-pip python3-colcon-common-extensions
pip3 install requests

# 配置环境
echo "source /opt/ros/humble/setup.bash" >> ~/.bashrc
source ~/.bashrc
```

## 二、配置数据库

### 2.1 创建数据库和用户

```bash
sudo -u postgres psql
```

```sql
-- 创建数据库
CREATE DATABASE ucsdb;

-- 创建用户
CREATE USER ucs_user WITH PASSWORD 'your_secure_password';

-- 授权
GRANT ALL PRIVILEGES ON DATABASE ucsdb TO ucs_user;

-- 连接到数据库
\c ucsdb

-- 启用 TimescaleDB 扩展
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- 退出
\q
```

### 2.2 创建 TimescaleDB 超表（可选，用于优化时序数据）

```sql
-- 连接数据库后执行
\c ucsdb

-- 将 uav_telemetry 表转换为超表（在应用启动创建表后执行）
SELECT create_hypertable('uav_telemetry', 'timestamp', if_not_exists => TRUE);

-- 设置数据保留策略（保留30天原始数据）
SELECT add_retention_policy('uav_telemetry', INTERVAL '30 days');

-- 启用压缩（7天后压缩）
ALTER TABLE uav_telemetry SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'uav_id'
);
SELECT add_compression_policy('uav_telemetry', INTERVAL '7 days');
```

## 三、部署后端服务

### 3.1 配置后端

编辑 `backend/src/main/resources/application-prod.properties`:

```properties
# Server Configuration
server.port=8080

# PostgreSQL/TimescaleDB Configuration
spring.datasource.url=jdbc:postgresql://localhost:5432/ucsdb
spring.datasource.driverClassName=org.postgresql.Driver
spring.datasource.username=ucs_user
spring.datasource.password=your_secure_password

# JPA Configuration
spring.jpa.database-platform=org.hibernate.dialect.PostgreSQLDialect
spring.jpa.hibernate.ddl-auto=update
spring.jpa.show-sql=false

# JWT Configuration
jwt.secret=your-very-long-and-secure-jwt-secret-key-here
jwt.expiration=86400000

# Logging
logging.level.com.ucs=INFO
```

### 3.2 构建和运行后端

```bash
cd backend

# 构建
mvn clean package -DskipTests

# 运行（使用生产配置）
java -jar target/ucs-backend-1.0.0.jar --spring.profiles.active=prod
```

### 3.3 使用 systemd 管理后端服务

创建服务文件 `/etc/systemd/system/ucs-backend.service`:

```ini
[Unit]
Description=UCS Backend Service
After=network.target postgresql.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/UCS_Dev/backend
ExecStart=/usr/bin/java -jar target/ucs-backend-1.0.0.jar --spring.profiles.active=prod
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

启动服务:

```bash
sudo systemctl daemon-reload
sudo systemctl enable ucs-backend
sudo systemctl start ucs-backend
sudo systemctl status ucs-backend
```

## 四、部署前端

### 4.1 配置前端

编辑 `frontend/ucs-dashboard/src/App.tsx`，修改 API 地址:

```typescript
const API_BASE = 'http://your-server-ip:8080';
```

### 4.2 构建前端

```bash
cd frontend/ucs-dashboard
npm install
npm run build
```

### 4.3 使用 Nginx 部署前端

安装 Nginx:

```bash
sudo apt install -y nginx
```

配置 Nginx `/etc/nginx/sites-available/ucs`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    root /var/www/ucs;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /ws {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
```

部署:

```bash
# 复制构建文件
sudo mkdir -p /var/www/ucs
sudo cp -r frontend/ucs-dashboard/dist/* /var/www/ucs/

# 启用站点
sudo ln -s /etc/nginx/sites-available/ucs /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## 五、部署 ROS 2 网关

### 5.1 构建 ROS 2 网关包

```bash
# 创建工作空间
mkdir -p ~/ucs_ws/src
cd ~/ucs_ws/src

# 复制网关代码
cp -r /path/to/UCS_Dev/ros2_gateway/uav_telemetry_gateway .

# 如果有自定义消息包，也需要复制
# cp -r /path/to/uav_msgs .

# 构建
cd ~/ucs_ws
source /opt/ros/humble/setup.bash
colcon build

# 配置环境
echo "source ~/ucs_ws/install/setup.bash" >> ~/.bashrc
source ~/.bashrc
```

### 5.2 运行网关节点

```bash
# 方式1: 直接运行
ros2 run uav_telemetry_gateway gateway_node \
    --ros-args \
    -p backend_url:=http://localhost:8080 \
    -p topic_name:=/all_uavs_gps \
    -p message_type:=uav_msgs/msg/UavGpsArray

# 方式2: 使用 launch 文件
ros2 launch uav_telemetry_gateway gateway.launch.py \
    backend_url:=http://localhost:8080 \
    topic_name:=/all_uavs_gps
```

### 5.3 使用 systemd 管理网关服务

创建服务文件 `/etc/systemd/system/ucs-gateway.service`:

```ini
[Unit]
Description=UCS ROS 2 Gateway Service
After=network.target ucs-backend.service

[Service]
Type=simple
User=ubuntu
Environment="ROS_DOMAIN_ID=0"
ExecStart=/bin/bash -c "source /opt/ros/humble/setup.bash && source /home/ubuntu/ucs_ws/install/setup.bash && ros2 run uav_telemetry_gateway gateway_node --ros-args -p backend_url:=http://localhost:8080 -p topic_name:=/all_uavs_gps"
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

启动服务:

```bash
sudo systemctl daemon-reload
sudo systemctl enable ucs-gateway
sudo systemctl start ucs-gateway
sudo systemctl status ucs-gateway
```

## 六、测试指南

### 6.1 测试后端 API

```bash
# 测试健康检查
curl http://localhost:8080/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"observer","password":"123456"}'

# 测试遥测 API（模拟网关发送数据）
curl -X POST http://localhost:8080/api/v1/telemetry/batch \
    -H "Content-Type: application/json" \
    -d '{
        "timestamp": "2024-01-01T00:00:00Z",
        "msgSeqNumber": 1,
        "homeLat": 39.9042,
        "homeLon": 116.4074,
        "homeAlt": 50.0,
        "numUavsTotal": 2,
        "numUavsActive": 2,
        "uavs": [
            {
                "uavId": 0,
                "timestamp": "2024-01-01T00:00:00Z",
                "lat": 39.9042,
                "lon": 116.4074,
                "alt": 100.0,
                "heading": 45.0,
                "groundSpeed": 10.0,
                "verticalSpeed": 0.0,
                "nedX": 0.0,
                "nedY": 0.0,
                "nedZ": -50.0,
                "vx": 7.07,
                "vy": 7.07,
                "vz": 0.0,
                "dataAge": 0.1,
                "msgCount": 100,
                "isActive": true
            }
        ]
    }'

# 查询最新状态
curl http://localhost:8080/api/v1/telemetry/latest
```

### 6.2 测试 ROS 2 网关

```bash
# 在一个终端发布测试消息
ros2 topic pub /all_uavs_gps uav_msgs/msg/UavGpsArray "{
    timestamp: {sec: 0, nanosec: 0},
    msg_seq_number: 1,
    home_lat: 39.9042,
    home_lon: 116.4074,
    home_alt: 50.0,
    num_uavs_total: 1,
    num_uavs_active: 1,
    uavs: [{
        timestamp: {sec: 0, nanosec: 0},
        id: 0,
        lat: 39.9042,
        lon: 116.4074,
        alt: 100.0,
        heading: 45.0,
        ground_speed: 10.0,
        vertical_speed: 0.0,
        ned_x: 0.0,
        ned_y: 0.0,
        ned_z: -50.0,
        vx: 7.07,
        vy: 7.07,
        vz: 0.0,
        data_age: 0.1,
        msg_count: 100,
        is_active: true
    }]
}"

# 在另一个终端查看网关日志
ros2 run uav_telemetry_gateway gateway_node
```

### 6.3 测试 WebSocket 连接

使用浏览器开发者工具或 wscat 测试:

```bash
# 安装 wscat
npm install -g wscat

# 连接 WebSocket
wscat -c ws://localhost:8080/ws

# 订阅遥测话题
> ["SUBSCRIBE", {"id": "sub-0", "destination": "/topic/telemetry"}]
```

## 七、监控和日志

### 7.1 查看服务日志

```bash
# 后端日志
sudo journalctl -u ucs-backend -f

# 网关日志
sudo journalctl -u ucs-gateway -f

# Nginx 日志
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### 7.2 数据库监控

```bash
# 连接数据库
sudo -u postgres psql -d ucsdb

# 查看遥测数据量
SELECT count(*) FROM uav_telemetry;

# 查看最新状态
SELECT * FROM uav_latest_state ORDER BY uav_id;

# 查看表大小
SELECT pg_size_pretty(pg_total_relation_size('uav_telemetry'));
```

## 八、常见问题

### Q1: 网关连接后端失败
- 检查后端服务是否运行: `sudo systemctl status ucs-backend`
- 检查防火墙: `sudo ufw status`
- 检查端口: `netstat -tlnp | grep 8080`

### Q2: ROS 2 话题收不到消息
- 检查 ROS_DOMAIN_ID 是否一致
- 检查 QoS 配置是否匹配
- 使用 `ros2 topic list` 和 `ros2 topic echo` 调试

### Q3: 数据库连接失败
- 检查 PostgreSQL 服务: `sudo systemctl status postgresql`
- 检查用户权限: `sudo -u postgres psql -c "\du"`
- 检查 pg_hba.conf 配置

### Q4: 前端无法连接 WebSocket
- 检查 Nginx 代理配置
- 检查浏览器控制台错误
- 确保 WebSocket 端点正确

## 九、性能优化建议

1. **数据库优化**
   - 使用 TimescaleDB 超表和压缩
   - 设置合理的数据保留策略
   - 定期执行 VACUUM 和 ANALYZE

2. **网关优化**
   - 调整批处理大小和超时
   - 使用消息队列（Kafka/RabbitMQ）缓冲

3. **后端优化**
   - 使用连接池
   - 批量插入数据
   - 添加适当的索引

4. **前端优化**
   - 使用 WebSocket 而非轮询
   - 实现数据降采样显示
   - 使用虚拟列表显示大量数据
