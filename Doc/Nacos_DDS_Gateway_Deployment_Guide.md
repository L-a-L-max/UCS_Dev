# Nacos部署DDS网关操作文档（从零开始）

## 目录

1. [概述](#1-概述)
2. [环境准备](#2-环境准备)
3. [安装Nacos Server](#3-安装nacos-server)
4. [DDS网关Nacos集成开发](#4-dds网关nacos集成开发)
5. [一致性哈希动态分片](#5-一致性哈希动态分片)
6. [部署与启动](#6-部署与启动)
7. [验证与测试](#7-验证与测试)
8. [运维与监控](#8-运维与监控)
9. [常见问题排查](#9-常见问题排查)

---

## 1. 概述

### 1.1 为什么选择Nacos部署DDS网关

| 因素 | 说明 |
|------|------|
| **服务注册与发现** | DDS网关实例启动时自动注册到Nacos，下线时自动注销 |
| **动态分片** | 基于一致性哈希环，新增/移除实例时仅迁移少量无人机 |
| **配置管理** | 运行时动态修改网关配置（心跳间隔、分片策略等），无需重启 |
| **Python友好** | `nacos-sdk-python` 成熟稳定，集成成本低 |
| **轻量级** | 相比K8S，运维成本显著更低，适合中等规模（10-100架无人机） |

### 1.2 架构概览

```
                    ┌─────────────────────┐
                    │    Nacos Server      │
                    │  (服务注册中心)       │
                    │  Port: 8848          │
                    └──────────┬──────────┘
                               │ 注册/心跳/监听
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │ DDS Gateway  │  │ DDS Gateway  │  │ DDS Gateway  │
    │ Instance 0   │  │ Instance 1   │  │ Instance 2   │
    │ (一致性哈希)  │  │ (一致性哈希)  │  │ (一致性哈希)  │
    │              │  │              │  │              │
    │ px4_1,px4_4  │  │ px4_2,px4_5  │  │ px4_3,px4_6  │
    └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
           │                 │                 │
           ▼                 ▼                 ▼
      PX4 DDS Topics    PX4 DDS Topics    PX4 DDS Topics
```

---

## 2. 环境准备

### 2.1 系统要求

| 组件 | 最低版本 | 推荐版本 |
|------|---------|---------|
| 操作系统 | Ubuntu 20.04 / CentOS 7 | Ubuntu 22.04 |
| Java (Nacos运行) | JDK 8 | JDK 17 |
| Python (DDS网关) | 3.8 | 3.10+ |
| ROS2 | Humble | Humble |
| 内存 | 4GB | 8GB+ |

### 2.2 安装基础依赖

```bash
# Ubuntu 22.04
sudo apt update && sudo apt install -y \
    openjdk-17-jdk \
    python3 python3-pip python3-venv \
    wget curl unzip net-tools

# 验证Java版本
java -version
# 输出应包含: openjdk version "17.x.x"

# 验证Python版本
python3 --version
# 输出应为: Python 3.10.x 或更高
```

### 2.3 安装Python依赖

```bash
cd /path/to/UCS_Dev/dds-gateway

# 创建虚拟环境（推荐）
python3 -m venv venv
source venv/bin/activate

# 安装网关依赖
pip install requests kafka-python

# 安装Nacos SDK
pip install nacos-sdk-python

# 安装一致性哈希依赖
pip install sortedcontainers
```

### 2.4 确保ROS2环境可用

```bash
# Source ROS2 环境
source /opt/ros/humble/setup.bash

# 确认px4_msgs可用
python3 -c "import px4_msgs.msg; print('px4_msgs OK')"

# 设置ROS_DOMAIN_ID（必须与PX4仿真一致）
export ROS_DOMAIN_ID=0
```

---

## 3. 安装Nacos Server

### 3.1 下载Nacos

```bash
# 下载Nacos 2.3.x（推荐稳定版）
NACOS_VERSION=2.3.2
cd /opt
wget https://github.com/alibaba/nacos/releases/download/${NACOS_VERSION}/nacos-server-${NACOS_VERSION}.tar.gz
tar -xzf nacos-server-${NACOS_VERSION}.tar.gz
cd nacos
```

### 3.2 配置Nacos

#### 单机模式（开发/测试）

```bash
# 编辑配置文件
vi conf/application.properties
```

关键配置项：

```properties
# 端口
server.port=8848

# 数据存储（单机模式使用嵌入式数据库）
spring.datasource.platform=

# 鉴权（生产环境必须启用）
nacos.core.auth.enabled=true
nacos.core.auth.server.identity.key=nacos
nacos.core.auth.server.identity.value=nacos
nacos.core.auth.plugin.nacos.token.secret.key=UWNfRGV2X05hY29zX1NlY3JldF9LZXlfMjAyNA==
```

#### 集群模式（生产）

```bash
# 编辑集群配置
vi conf/cluster.conf
```

```
# 三节点集群
192.168.1.10:8848
192.168.1.11:8848
192.168.1.12:8848
```

### 3.3 启动Nacos

```bash
# 单机模式启动
sh bin/startup.sh -m standalone

# 集群模式启动
sh bin/startup.sh

# 验证启动成功
curl -s http://localhost:8848/nacos/v1/console/health/readiness
# 输出: OK

# 访问Web控制台
# 浏览器打开: http://<server-ip>:8848/nacos
# 默认账号: nacos / nacos
```

### 3.4 配置Nacos命名空间

```bash
# 创建DDS网关专用命名空间
curl -X POST "http://localhost:8848/nacos/v1/console/namespaces" \
  -d "customNamespaceId=dds-gateway&namespaceName=DDS-Gateway&namespaceDesc=DDS网关服务空间"
```

---

## 4. DDS网关Nacos集成开发

### 4.1 创建Nacos配置模块

在 `dds-gateway/` 目录下创建 `nacos_registry.py`：

```python
#!/usr/bin/env python3
"""
Nacos Service Registry for DDS Gateway.

Handles:
- Service registration with heartbeat
- Instance discovery and change notification
- Dynamic consistent-hash ring updates
"""

import json
import logging
import os
import socket
import threading
import time
from typing import Callable, Dict, List, Optional, Set

import nacos

logger = logging.getLogger('nacos-registry')

# Default configuration
DEFAULT_NACOS_ADDR = os.environ.get('NACOS_SERVER_ADDR', 'localhost:8848')
DEFAULT_NAMESPACE = os.environ.get('NACOS_NAMESPACE', 'dds-gateway')
DEFAULT_GROUP = os.environ.get('NACOS_GROUP', 'DDS_GATEWAY')
SERVICE_NAME = 'dds-gateway-ingest'  # or 'dds-gateway-command' for command gateway


class NacosRegistry:
    """Nacos service registry client for DDS gateway instances."""

    def __init__(self, service_name: str = SERVICE_NAME,
                 nacos_addr: str = DEFAULT_NACOS_ADDR,
                 namespace: str = DEFAULT_NAMESPACE,
                 group: str = DEFAULT_GROUP):
        self.service_name = service_name
        self.group = group
        self.instance_ip = self._get_local_ip()
        self.instance_port = int(os.environ.get('DDS_COMMAND_PORT', '5050'))
        self.instance_id = f"{self.instance_ip}:{self.instance_port}"
        self._running = False
        self._on_instances_changed: Optional[Callable] = None

        # Initialize Nacos client
        self.client = nacos.NacosClient(
            nacos_addr,
            namespace=namespace,
            username=os.environ.get('NACOS_USERNAME', 'nacos'),
            password=os.environ.get('NACOS_PASSWORD', 'nacos'),
        )
        logger.info("[NacosRegistry] Initialized: server=%s, namespace=%s, service=%s",
                     nacos_addr, namespace, service_name)

    def _get_local_ip(self) -> str:
        """Get local IP address for service registration."""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception:
            return "127.0.0.1"

    def register(self, metadata: Optional[Dict] = None):
        """Register this gateway instance with Nacos."""
        meta = metadata or {}
        meta.update({
            'instance_id': self.instance_id,
            'start_time': str(int(time.time())),
            'version': '2.0',
        })
        try:
            self.client.add_naming_instance(
                self.service_name,
                self.instance_ip,
                self.instance_port,
                group_name=self.group,
                metadata=meta,
                weight=1.0,
                enabled=True,
                healthy=True,
            )
            logger.info("[NacosRegistry] Registered: %s:%d (service=%s)",
                        self.instance_ip, self.instance_port, self.service_name)
        except Exception as e:
            logger.error("[NacosRegistry] Registration failed: %s", e)
            raise

    def deregister(self):
        """Deregister this gateway instance from Nacos."""
        try:
            self.client.remove_naming_instance(
                self.service_name,
                self.instance_ip,
                self.instance_port,
                group_name=self.group,
            )
            logger.info("[NacosRegistry] Deregistered: %s:%d", self.instance_ip, self.instance_port)
        except Exception as e:
            logger.error("[NacosRegistry] Deregistration failed: %s", e)

    def get_instances(self) -> List[Dict]:
        """Get all healthy instances of this service."""
        try:
            result = self.client.list_naming_instance(
                self.service_name,
                group_name=self.group,
                healthy_only=True,
            )
            hosts = result.get('hosts', [])
            instances = []
            for h in hosts:
                instances.append({
                    'ip': h.get('ip'),
                    'port': h.get('port'),
                    'instance_id': f"{h.get('ip')}:{h.get('port')}",
                    'weight': h.get('weight', 1.0),
                    'metadata': h.get('metadata', {}),
                    'healthy': h.get('healthy', True),
                })
            return instances
        except Exception as e:
            logger.error("[NacosRegistry] Failed to get instances: %s", e)
            return []

    def subscribe(self, callback: Callable[[List[Dict]], None]):
        """Subscribe to instance changes. Callback receives updated instance list."""
        self._on_instances_changed = callback

        def _listener(event):
            instances = self.get_instances()
            logger.info("[NacosRegistry] Instance change detected: %d instances",
                        len(instances))
            if self._on_instances_changed:
                self._on_instances_changed(instances)

        try:
            self.client.subscribe(
                _listener,
                service_name=self.service_name,
                group_name=self.group,
            )
            logger.info("[NacosRegistry] Subscribed to instance changes")
        except Exception as e:
            logger.error("[NacosRegistry] Subscribe failed: %s", e)

    def start_heartbeat(self, interval: float = 5.0):
        """Start background heartbeat thread."""
        self._running = True

        def _heartbeat():
            while self._running:
                try:
                    self.client.send_heartbeat(
                        self.service_name,
                        self.instance_ip,
                        self.instance_port,
                        group_name=self.group,
                    )
                except Exception as e:
                    logger.warning("[NacosRegistry] Heartbeat failed: %s", e)
                time.sleep(interval)

        t = threading.Thread(target=_heartbeat, daemon=True, name='nacos-heartbeat')
        t.start()
        logger.info("[NacosRegistry] Heartbeat started (interval=%.1fs)", interval)

    def stop(self):
        """Stop heartbeat and deregister."""
        self._running = False
        self.deregister()

    def get_config(self, data_id: str, default: str = '{}') -> dict:
        """Get configuration from Nacos Config Center."""
        try:
            content = self.client.get_config(data_id, self.group)
            return json.loads(content) if content else json.loads(default)
        except Exception as e:
            logger.warning("[NacosRegistry] Config fetch failed for %s: %s", data_id, e)
            return json.loads(default)

    def watch_config(self, data_id: str, callback: Callable[[dict], None]):
        """Watch for configuration changes."""
        def _on_change(args):
            try:
                config = json.loads(args['content'])
                callback(config)
            except Exception as e:
                logger.error("[NacosRegistry] Config parse error: %s", e)

        self.client.add_config_watcher(data_id, self.group, _on_change)
        logger.info("[NacosRegistry] Watching config: %s/%s", self.group, data_id)
```

### 4.2 一致性哈希环模块

创建 `dds-gateway/consistent_hash.py`：

```python
#!/usr/bin/env python3
"""
Consistent Hash Ring for dynamic drone-to-gateway mapping.

Features:
- Virtual nodes for balanced distribution
- Weighted nodes (high-performance nodes handle more drones)
- Thread-safe operations
- Minimal remapping on node addition/removal
"""

import hashlib
import logging
import threading
from typing import Dict, List, Optional, Set, Tuple

from sortedcontainers import SortedDict

logger = logging.getLogger('consistent-hash')


class ConsistentHashRing:
    """Thread-safe consistent hash ring for drone assignment."""

    def __init__(self, virtual_nodes: int = 150):
        """
        Args:
            virtual_nodes: Number of virtual nodes per real node (per unit weight).
                          Higher values = better balance, more memory.
                          150 is a good default for <100 nodes.
        """
        self._ring: SortedDict = SortedDict()
        self._nodes: Dict[str, int] = {}  # node_id -> weight
        self._virtual_nodes = virtual_nodes
        self._lock = threading.Lock()

    def _hash(self, key: str) -> str:
        """Deterministic hash using MD5."""
        return hashlib.md5(key.encode('utf-8')).hexdigest()

    def add_node(self, node_id: str, weight: int = 1):
        """Add a node to the ring with the given weight.
        
        Args:
            node_id: Unique identifier for the node (e.g., "192.168.1.10:5050")
            weight: Node weight (higher = handles more drones). Default 1.
        """
        with self._lock:
            if node_id in self._nodes:
                logger.debug("[HashRing] Node %s already in ring, updating weight", node_id)
                self.remove_node(node_id)
            self._nodes[node_id] = weight
            for i in range(self._virtual_nodes * weight):
                vnode_key = self._hash(f"{node_id}:vnode:{i}")
                self._ring[vnode_key] = node_id
            logger.info("[HashRing] Added node %s (weight=%d, vnodes=%d, total_ring=%d)",
                        node_id, weight, self._virtual_nodes * weight, len(self._ring))

    def remove_node(self, node_id: str):
        """Remove a node and all its virtual nodes from the ring."""
        with self._lock:
            weight = self._nodes.pop(node_id, 1)
            keys_to_remove = []
            for i in range(self._virtual_nodes * weight):
                vnode_key = self._hash(f"{node_id}:vnode:{i}")
                keys_to_remove.append(vnode_key)
            for key in keys_to_remove:
                self._ring.pop(key, None)
            logger.info("[HashRing] Removed node %s (ring_size=%d)", node_id, len(self._ring))

    def get_node(self, key: str) -> Optional[str]:
        """Get the node responsible for the given key (e.g., uav_id).
        
        Uses clockwise lookup: find the first virtual node with hash >= key hash.
        """
        with self._lock:
            if not self._ring:
                return None
            h = self._hash(key)
            idx = self._ring.bisect_right(h)
            if idx >= len(self._ring):
                idx = 0  # Wrap around
            return self._ring.peekitem(idx)[1]

    def get_all_nodes(self) -> List[str]:
        """Get all registered node IDs."""
        with self._lock:
            return list(self._nodes.keys())

    def get_node_count(self) -> int:
        """Get the number of registered nodes."""
        with self._lock:
            return len(self._nodes)

    def get_distribution(self, keys: List[str]) -> Dict[str, List[str]]:
        """Get the distribution of keys across nodes.
        
        Useful for debugging: shows which drones are assigned to which node.
        """
        dist: Dict[str, List[str]] = {}
        for key in keys:
            node = self.get_node(key)
            if node:
                dist.setdefault(node, []).append(key)
        return dist

    def update_nodes(self, instances: List[Dict]):
        """Update the ring with a new set of instances (from Nacos).
        
        Args:
            instances: List of instance dicts with 'instance_id' and optional 'weight'.
        """
        with self._lock:
            new_ids = {inst['instance_id'] for inst in instances}
            old_ids = set(self._nodes.keys())

            # Remove departed nodes
            for node_id in old_ids - new_ids:
                self._lock.release()
                self.remove_node(node_id)
                self._lock.acquire()

            # Add new nodes
            for inst in instances:
                node_id = inst['instance_id']
                weight = int(inst.get('weight', 1))
                if node_id not in self._nodes:
                    self._lock.release()
                    self.add_node(node_id, weight)
                    self._lock.acquire()

        logger.info("[HashRing] Ring updated: %d nodes", len(self._nodes))
```

---

## 5. 一致性哈希动态分片

### 5.1 网关集成Nacos分片

修改 `dds_gateway.py` 的 `__init__` 和 `_owns_drone` 方法：

```python
# 在 DDSGateway.__init__ 中添加:

# 动态分片（Nacos模式）
self._use_nacos = os.environ.get('DDS_USE_NACOS', 'false').lower() == 'true'
if self._use_nacos:
    from nacos_registry import NacosRegistry
    from consistent_hash import ConsistentHashRing

    self._hash_ring = ConsistentHashRing(virtual_nodes=150)
    self._nacos = NacosRegistry()
    self._nacos.register(metadata={
        'capacity': os.environ.get('DDS_DRONE_CAPACITY', '15'),
    })
    self._nacos.start_heartbeat()

    # 初始化哈希环
    instances = self._nacos.get_instances()
    self._hash_ring.update_nodes(instances)

    # 监听实例变化，动态更新哈希环
    def _on_instances_changed(new_instances):
        self._hash_ring.update_nodes(new_instances)
        logger.info("[DynamicShard] Hash ring updated: %d nodes",
                    self._hash_ring.get_node_count())

    self._nacos.subscribe(_on_instances_changed)
    logger.info("[DynamicShard] Nacos dynamic sharding enabled")
```

```python
# 修改 _owns_drone 方法:

def _owns_drone(self, uav_id: str) -> bool:
    if self.total_instances <= 1 and not self._use_nacos:
        return True

    if self._use_nacos:
        # 动态分片：一致性哈希环
        owner = self._hash_ring.get_node(uav_id)
        return owner == self._nacos.instance_id
    else:
        # 静态分片（向后兼容）
        h = int(hashlib.md5(uav_id.encode('utf-8')).hexdigest(), 16)
        return (h % self.total_instances) == self.instance_id
```

### 5.2 分片迁移流程

当新实例加入时，一致性哈希环自动完成分片迁移：

```
1. 新实例注册到Nacos
2. 所有实例收到实例变更通知
3. 各实例更新本地哈希环
4. 部分无人机被重新分配到新实例
5. 新实例自动订阅被分配的无人机Topic
6. 旧实例在下次discovery cycle中发现不再拥有某些无人机，停止处理
```

迁移比例估算：`N / (N + 1)` 的无人机保持不变（N为原实例数）。例如3→4实例，约75%无人机不迁移。

---

## 6. 部署与启动

### 6.1 启动Nacos Server

```bash
# 确保Nacos已启动
cd /opt/nacos
sh bin/startup.sh -m standalone

# 验证
curl http://localhost:8848/nacos/v1/console/health/readiness
```

### 6.2 配置环境变量

```bash
# 创建环境配置文件: dds-gateway/.env
cat > /path/to/UCS_Dev/dds-gateway/.env << 'EOF'
# Nacos配置
DDS_USE_NACOS=true
NACOS_SERVER_ADDR=localhost:8848
NACOS_NAMESPACE=dds-gateway
NACOS_GROUP=DDS_GATEWAY
NACOS_USERNAME=nacos
NACOS_PASSWORD=nacos

# 后端配置
UCS_BACKEND_URL=http://localhost:8080
DDS_GATEWAY_API_KEY=ucs-dds-gateway-secret-2024

# Kafka配置
KAFKA_BOOTSTRAP_SERVERS=localhost:9092

# ROS2
ROS_DOMAIN_ID=0
EOF
```

### 6.3 启动网关实例

```bash
# Source环境
source /opt/ros/humble/setup.bash
source /path/to/UCS_Dev/dds-gateway/venv/bin/activate
set -a; source /path/to/UCS_Dev/dds-gateway/.env; set +a

# 启动实例0（端口5050）
DDS_COMMAND_PORT=5050 python3 dds_gateway.py

# 在另一个终端启动实例1（端口5051）
DDS_COMMAND_PORT=5051 python3 dds_gateway.py

# 在另一个终端启动实例2（端口5052）
DDS_COMMAND_PORT=5052 python3 dds_gateway.py
```

### 6.4 使用systemd管理（生产环境）

```bash
# 创建systemd服务文件
sudo cat > /etc/systemd/system/dds-gateway@.service << 'EOF'
[Unit]
Description=DDS Gateway Instance %i
After=network.target nacos.service
Wants=nacos.service

[Service]
Type=simple
User=ucs
WorkingDirectory=/opt/UCS_Dev/dds-gateway
EnvironmentFile=/opt/UCS_Dev/dds-gateway/.env
Environment=DDS_COMMAND_PORT=505%i
ExecStart=/opt/UCS_Dev/dds-gateway/venv/bin/python3 dds_gateway.py
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# 启动3个实例
sudo systemctl daemon-reload
sudo systemctl enable --now dds-gateway@0
sudo systemctl enable --now dds-gateway@1
sudo systemctl enable --now dds-gateway@2

# 查看状态
sudo systemctl status dds-gateway@{0,1,2}

# 查看日志
journalctl -u dds-gateway@0 -f
```

### 6.5 动态扩缩容

```bash
# 扩容：直接启动新实例，Nacos自动感知
sudo systemctl enable --now dds-gateway@3

# 缩容：停止实例，Nacos自动检测下线，哈希环自动重平衡
sudo systemctl stop dds-gateway@3
sudo systemctl disable dds-gateway@3
```

---

## 7. 验证与测试

### 7.1 验证Nacos注册

```bash
# 查看已注册的网关实例
curl -s "http://localhost:8848/nacos/v1/ns/instance/list?serviceName=dds-gateway-ingest&groupName=DDS_GATEWAY" \
  | python3 -m json.tool

# 预期输出：
# {
#   "hosts": [
#     {"ip": "192.168.1.10", "port": 5050, "healthy": true, ...},
#     {"ip": "192.168.1.10", "port": 5051, "healthy": true, ...},
#     {"ip": "192.168.1.10", "port": 5052, "healthy": true, ...}
#   ]
# }
```

### 7.2 验证分片分布

```bash
# 查看每个实例负责的无人机（通过health API）
for port in 5050 5051 5052; do
  echo "=== Instance on port $port ==="
  curl -s http://localhost:$port/api/health | python3 -m json.tool
done
```

### 7.3 验证动态扩缩容

```bash
# 1. 记录当前分片分布
for port in 5050 5051 5052; do
  curl -s http://localhost:$port/api/health | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(f'Port {$port}: {len(d[\"drones\"])} drones: {d[\"drones\"]}')
"
done

# 2. 启动新实例
DDS_COMMAND_PORT=5053 python3 dds_gateway.py &

# 3. 等待10秒，重新检查分片分布
sleep 10
for port in 5050 5051 5052 5053; do
  curl -s http://localhost:$port/api/health | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(f'Port {$port}: {len(d[\"drones\"])} drones: {d[\"drones\"]}')
"
done
# 预期：部分无人机从旧实例迁移到新实例
```

---

## 8. 运维与监控

### 8.1 Nacos监控面板

- 访问 `http://<nacos-ip>:8848/nacos`
- 查看「服务管理」→「服务列表」→ `dds-gateway-ingest`
- 查看实例健康状态、权重、元数据

### 8.2 关键指标监控

| 指标 | 获取方式 | 告警阈值 |
|------|---------|---------|
| 实例数量 | Nacos API | < 预期数量 |
| 实例健康状态 | Nacos健康检查 | 任意实例unhealthy |
| 无人机分布均衡度 | `api/health` 统计 | 偏差 > 30% |
| 遥测延迟 | 网关日志 Stats | > 100ms |
| Kafka发送成功率 | 网关日志 Stats | < 99% |

### 8.3 日志收集

```bash
# 推荐使用ELK或Loki收集网关日志
# 所有实例日志都包含instance_id前缀，便于区分

# 查看关键日志
journalctl -u "dds-gateway@*" --since "5 minutes ago" | grep -E "\[HashRing\]|\[NacosRegistry\]|\[Stats\]"
```

---

## 9. 常见问题排查

### Q1: 网关注册失败

```
检查清单:
1. Nacos Server 是否正常运行: curl http://localhost:8848/nacos/v1/console/health/readiness
2. 网络连通性: ping <nacos-ip>
3. 命名空间是否创建: Nacos控制台 → 命名空间
4. 账号密码是否正确: 检查 NACOS_USERNAME/NACOS_PASSWORD
```

### Q2: 分片不均匀

```
可能原因:
1. 虚拟节点数过少 → 增大 virtual_nodes 参数（默认150）
2. 节点权重不一致 → 检查各实例注册的weight
3. 无人机ID分布不均匀 → 正常现象，增加虚拟节点可缓解
```

### Q3: 扩容后部分无人机丢失数据

```
原因: 分片迁移期间存在短暂的"无主"窗口
解决:
1. 确保新实例先启动并完成注册再开始处理
2. 后端DroneHeartbeatService的30s TTL可容忍短暂离线
3. 可增加"预热期"：新实例加入后等待5s再开始接管
```

### Q4: Nacos宕机后网关是否正常

```
是的。网关在本地缓存了最后一次的哈希环状态。
Nacos宕机后:
- 现有实例继续按缓存的分片规则工作
- 无法感知新实例加入或旧实例退出
- Nacos恢复后自动重新同步
```

---

## 附录：环境变量参考

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `DDS_USE_NACOS` | `false` | 是否启用Nacos动态分片 |
| `NACOS_SERVER_ADDR` | `localhost:8848` | Nacos服务地址 |
| `NACOS_NAMESPACE` | `dds-gateway` | Nacos命名空间ID |
| `NACOS_GROUP` | `DDS_GATEWAY` | Nacos服务分组 |
| `NACOS_USERNAME` | `nacos` | Nacos用户名 |
| `NACOS_PASSWORD` | `nacos` | Nacos密码 |
| `DDS_COMMAND_PORT` | `5050` | 网关HTTP命令端口 |
| `DDS_DRONE_CAPACITY` | `15` | 单实例建议最大无人机数 |
| `UCS_BACKEND_URL` | `http://localhost:8080` | 后端API地址 |
| `KAFKA_BOOTSTRAP_SERVERS` | `localhost:9092` | Kafka地址 |
| `ROS_DOMAIN_ID` | `0` | ROS2 Domain ID |
