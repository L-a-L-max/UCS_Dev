# UCS 无人机管控平台 — K8S 单服务器裸机部署流程

## 目录

1. [概述与部署逻辑说明](#1-概述与部署逻辑说明)
2. [服务器硬件要求](#2-服务器硬件要求)
3. [操作系统初始化](#3-操作系统初始化)
4. [容器运行时安装](#4-容器运行时安装)
5. [Kubernetes 单节点集群安装](#5-kubernetes-单节点集群安装)
6. [集群基础组件部署](#6-集群基础组件部署)
7. [中间件部署（数据库/缓存/消息队列）](#7-中间件部署数据库缓存消息队列)
8. [DDS 网关部署](#8-dds-网关部署)
9. [后端服务部署](#9-后端服务部署)
10. [前端服务部署](#10-前端服务部署)
11. [Ingress 与外部访问配置](#11-ingress-与外部访问配置)
12. [PX4/Gazebo 仿真环境（可选）](#12-px4gazebo-仿真环境可选)
13. [监控与日志](#13-监控与日志)
14. [一键部署脚本](#14-一键部署脚本)
15. [验证与测试](#15-验证与测试)
16. [常见问题排查](#16-常见问题排查)

---

## 1. 概述与部署逻辑说明

### 1.1 什么是"逻辑部署"

**是的，这是逻辑部署。** Kubernetes 本质上是一种**逻辑部署**架构：

- **物理层面**：只有一台服务器（裸机），所有服务运行在同一台物理机上
- **逻辑层面**：通过 K8S 将各个服务（前端、后端、DDS网关、数据库、缓存等）隔离为独立的 Pod/容器，每个服务拥有独立的网络、存储、资源限制，彼此通过 K8S 内部 DNS 进行服务发现

这种方式的好处是：即使在单台服务器上，也能获得 K8S 的编排能力（自动重启、滚动更新、服务发现），未来需要扩展时可以无缝添加新节点。

### 1.2 与现有三虚拟机方案的区别

| 维度 | 三虚拟机方案（现有文档） | 单服务器裸机方案（本文档） |
|------|----------------------|------------------------|
| **物理机数量** | 3台虚拟机（Master + 2 Worker） | 1台物理服务器 |
| **K8S 架构** | 多节点集群 | 单节点集群（Master兼Worker） |
| **高可用** | Master和Worker分离，支持节点故障转移 | 无高可用，单点故障 |
| **资源利用** | 分布式，每台机器负载较低 | 集中式，单机需要较高配置 |
| **适用场景** | 生产环境、需要高可用 | 开发测试、验证部署流程、小规模生产 |
| **运维复杂度** | 需要管理多台机器的网络互通 | 只需维护一台机器 |

### 1.3 整体架构图（单服务器）

```
┌─────────────────────────────────────────────────────────────────┐
│                    单台物理服务器 (裸机)                            │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Kubernetes 单节点集群 (k3s)                    │  │
│  │                                                           │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │           Ingress Controller (Traefik)              │  │  │
│  │  │           监听 80/443 端口，路由外部流量               │  │  │
│  │  └──────────┬─────────────────────┬────────────────────┘  │  │
│  │             │                     │                        │  │
│  │   ┌─────────▼─────────┐ ┌────────▼──────────┐            │  │
│  │   │   Frontend Pod    │ │   Backend Pod     │            │  │
│  │   │   (Nginx+React)   │ │   (Spring Boot)   │            │  │
│  │   │   Port: 80        │ │   Port: 8080      │            │  │
│  │   └───────────────────┘ └────────┬──────────┘            │  │
│  │                                   │                        │  │
│  │   ┌───────────────────────────────▼────────────────────┐  │  │
│  │   │         DDS Gateway Pod (Python + ROS2)            │  │  │
│  │   │         hostNetwork: true (DDS需要)                 │  │  │
│  │   │         Port: 5050                                 │  │  │
│  │   └───────────────────────────────┬────────────────────┘  │  │
│  │                                   │                        │  │
│  │   ┌────────────┐ ┌───────────┐ ┌─▼──────────┐            │  │
│  │   │  Redis Pod │ │ MySQL Pod │ │  Kafka Pod │            │  │
│  │   │  Port:6379 │ │ Port:3306 │ │  Port:9092 │            │  │
│  │   └────────────┘ └───────────┘ └────────────┘            │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │        宿主机进程 (非K8S管理)                                │  │
│  │        PX4-Autopilot + Gazebo 仿真 (可选)                   │  │
│  │        通过 DDS/ROS2 与 DDS Gateway Pod 通信                │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.4 各组件的职责

| 组件 | 职责 | 为什么需要 |
|------|------|-----------|
| **Frontend** | React Web界面，提供地图、控制面板、数据展示 | 用户交互入口 |
| **Backend** | Spring Boot API服务，处理业务逻辑、权限认证 | 核心业务处理 |
| **DDS Gateway** | Python/ROS2桥接，连接PX4无人机与后端 | 无人机通信桥梁 |
| **MySQL/PostgreSQL** | 持久化数据存储（用户、任务、日志等） | 数据持久化 |
| **Redis** | 缓存、无人机在线状态、Session管理 | 高频读写性能 |
| **Kafka** | 遥测数据消息队列，异步解耦 | 高吞吐遥测流 |
| **Ingress** | 反向代理，统一入口路由 | 外部访问入口 |

---

## 2. 服务器硬件要求

### 2.1 最低配置（开发验证）

| 资源 | 最低要求 | 说明 |
|------|---------|------|
| CPU | 8核 | K8S + 所有服务至少需要 8 核 |
| 内存 | 16 GB | Kafka和Java服务内存需求较高 |
| 磁盘 | 200 GB SSD | 容器镜像、数据库、日志占用空间 |
| 网络 | 千兆网卡 | DDS通信需要稳定网络 |

### 2.2 推荐配置（小规模生产）

| 资源 | 推荐配置 | 说明 |
|------|---------|------|
| CPU | 16核+ | 预留充足的仿真和并发处理空间 |
| 内存 | 32 GB+ | 运行仿真环境 + 全部服务 |
| 磁盘 | 500 GB NVMe SSD | 高IOPS，适合数据库和Kafka |
| 网络 | 千兆/万兆网卡 | 支持多架无人机遥测数据流 |
| GPU | 可选 | 如需运行 Gazebo 渲染仿真 |

### 2.3 资源分配预估

| 服务 | CPU占用 | 内存占用 | 磁盘占用 |
|------|--------|---------|---------|
| K8S系统组件 | 1核 | 1 GB | 5 GB |
| Frontend | 0.2核 | 256 MB | 100 MB |
| Backend | 1核 | 1.5 GB | 200 MB |
| DDS Gateway | 0.5核 | 512 MB | 100 MB |
| MySQL | 1核 | 2 GB | 10-50 GB |
| Redis | 0.3核 | 512 MB | 1 GB |
| Kafka + Zookeeper | 2核 | 3 GB | 20 GB |
| PX4仿真(可选) | 2核 | 2 GB | 5 GB |
| **合计** | **~8核** | **~11 GB** | **~80 GB** |

---

## 3. 操作系统初始化

### 3.1 目的

准备一个干净的 Ubuntu 操作系统环境，安装必要的基础工具，配置网络和系统参数，使其满足 K8S 运行的前置要求。

### 3.2 安装 Ubuntu Server

推荐版本：**Ubuntu 22.04 LTS Server**

安装时选择：
- 最小化安装（Minimal Installation）
- 启用 OpenSSH Server
- 分区建议：单分区即可，全部空间分配给 `/`

### 3.3 系统初始化

```bash
# ============================================================
# 步骤 1：更新系统并安装基础工具
# 目的：确保系统软件包最新，安装后续步骤所需的基础命令行工具
# ============================================================
sudo apt update && sudo apt upgrade -y

sudo apt install -y \
    curl wget git vim \
    apt-transport-https ca-certificates \
    gnupg lsb-release \
    software-properties-common \
    net-tools iputils-ping dnsutils \
    htop iotop \
    unzip tar jq

# ============================================================
# 步骤 2：关闭 Swap
# 目的：Kubernetes 要求关闭 swap，否则 kubelet 可能无法正常启动
#       因为 K8S 的内存管理和 QoS 保证依赖于准确的内存计量
# ============================================================
sudo swapoff -a
sudo sed -i '/swap/d' /etc/fstab
# 验证 swap 已关闭
free -h | grep Swap
# 输出应为: Swap: 0B 0B 0B

# ============================================================
# 步骤 3：配置内核参数
# 目的：启用网络桥接和IP转发，这是 K8S Pod 网络通信的基础
#       - overlay: 容器文件系统需要的内核模块
#       - br_netfilter: 让 iptables 能处理桥接流量
#       - ip_forward: 允许 Pod 之间跨网络通信
# ============================================================
cat <<EOF | sudo tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF

sudo modprobe overlay
sudo modprobe br_netfilter

cat <<EOF | sudo tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF

sudo sysctl --system

# ============================================================
# 步骤 4：配置防火墙（如已启用 ufw）
# 目的：开放 K8S 和各服务所需端口
#       - 6443: K8S API Server
#       - 80/443: Ingress HTTP/HTTPS
#       - 10250: kubelet API
#       - 30000-32767: NodePort 范围
# ============================================================
sudo ufw allow 6443/tcp    # K8S API
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 443/tcp     # HTTPS
sudo ufw allow 10250/tcp   # Kubelet
sudo ufw allow 5050/tcp    # DDS Gateway
sudo ufw allow 8080/tcp    # Backend
sudo ufw allow 30000:32767/tcp  # NodePort范围
# 如果防火墙本身就是关闭的，可以跳过此步

# ============================================================
# 步骤 5：设置主机名和时区
# 目的：主机名用于 K8S 节点标识，时区确保日志时间一致
# ============================================================
sudo hostnamectl set-hostname ucs-node
sudo timedatectl set-timezone Asia/Shanghai

# 将主机名写入 hosts（避免DNS解析问题）
echo "$(hostname -I | awk '{print $1}') ucs-node" | sudo tee -a /etc/hosts
```

---

## 4. 容器运行时安装

### 4.1 目的

容器运行时是 Kubernetes 运行容器的底层引擎。K8S 不直接管理容器，而是通过 CRI (Container Runtime Interface) 调用容器运行时来创建、启动、停止容器。

本文档使用 **containerd**（K8S 官方推荐的轻量级容器运行时），同时安装 Docker CLI 用于构建镜像。

### 4.2 安装 containerd

```bash
# ============================================================
# 安装 containerd
# 目的：作为 K8S 的容器运行时，负责实际的容器生命周期管理
# ============================================================

# 添加 Docker 官方仓库（containerd 包含在其中）
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y containerd.io docker-ce docker-ce-cli

# ============================================================
# 配置 containerd 使用 systemd cgroup
# 目的：K8S 1.22+ 要求容器运行时使用 systemd cgroup 驱动
#       以保持与 kubelet 的 cgroup 管理一致
# ============================================================
sudo mkdir -p /etc/containerd
containerd config default | sudo tee /etc/containerd/config.toml > /dev/null
sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml

# 重启 containerd 使配置生效
sudo systemctl restart containerd
sudo systemctl enable containerd

# ============================================================
# 验证安装
# ============================================================
sudo systemctl status containerd
# 输出应包含: Active: active (running)

docker --version
# 输出示例: Docker version 24.x.x
```

---

## 5. Kubernetes 单节点集群安装

### 5.1 目的

在单台服务器上安装 Kubernetes 集群。由于只有一台机器，我们使用 **k3s**（轻量级 K8S 发行版），它具有以下优势：

- **单二进制文件**：安装极简，一条命令即可启动完整集群
- **内置 Traefik Ingress**：无需额外安装 Ingress Controller
- **内置 Local Storage**：支持本地持久化卷
- **资源占用低**：比 kubeadm 少用约 50% 内存
- **功能完整**：与标准 K8S API 100% 兼容

### 5.2 安装 k3s

```bash
# ============================================================
# 安装 k3s
# 目的：在本机部署一个完整的 Kubernetes 单节点集群
# 参数说明：
#   --docker: 使用 Docker 作为容器运行时（便于本地构建镜像）
#   --disable=traefik: 不使用内置 Traefik，后续手动安装 Nginx Ingress
#                      （也可以保留 Traefik，去掉此参数）
#   --write-kubeconfig-mode=644: 让非root用户也能使用 kubectl
#   --node-name: 指定节点名称
# ============================================================
curl -sfL https://get.k3s.io | sh -s - \
    --write-kubeconfig-mode=644 \
    --node-name=ucs-node \
    --kube-apiserver-arg="service-node-port-range=30000-32767"

# ============================================================
# 配置 kubectl
# 目的：设置 kubectl 命令行工具的认证配置
#       k3s 的 kubeconfig 默认在 /etc/rancher/k3s/k3s.yaml
# ============================================================
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config
export KUBECONFIG=~/.kube/config

# 写入 bashrc，使其永久生效
echo 'export KUBECONFIG=~/.kube/config' >> ~/.bashrc

# ============================================================
# 验证集群
# 目的：确认 K8S 集群已成功启动，节点处于 Ready 状态
# ============================================================
kubectl get nodes
# 期望输出:
# NAME       STATUS   ROLES                  AGE   VERSION
# ucs-node   Ready    control-plane,master   1m    v1.28.x+k3s1

kubectl get pods -A
# 所有系统 Pod 应处于 Running 状态
```

### 5.3 安装 Helm

```bash
# ============================================================
# 安装 Helm（K8S 包管理器）
# 目的：Helm 用于简化复杂应用的部署（Redis、Kafka、MySQL等）
#       类似于 apt/yum 之于操作系统，Helm 之于 K8S
# ============================================================
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# 验证
helm version
# 输出示例: version.BuildInfo{Version:"v3.14.x", ...}

# 添加常用 Helm 仓库
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
```

### 5.4 安装 kubectl 自动补全（可选但推荐）

```bash
# 目的：提高命令行操作效率
sudo apt install -y bash-completion
echo 'source <(kubectl completion bash)' >> ~/.bashrc
echo 'alias k=kubectl' >> ~/.bashrc
echo 'complete -o default -F __start_kubectl k' >> ~/.bashrc
source ~/.bashrc
```

---

## 6. 集群基础组件部署

### 6.1 目的

创建应用所需的 Namespace（命名空间）和全局配置。Namespace 是 K8S 中的逻辑隔离单位，将不同类别的资源分组管理。

### 6.2 创建 Namespace

```bash
# ============================================================
# 创建命名空间
# 目的：
#   ucs — 所有 UCS 业务服务（前端、后端、DDS网关、中间件）
#   monitoring — 监控相关服务（Prometheus、Grafana）
# ============================================================
kubectl create namespace ucs
kubectl create namespace monitoring

# 设置默认命名空间为 ucs，后续命令无需每次指定 -n ucs
kubectl config set-context --current --namespace=ucs
```

### 6.3 创建 Secret（敏感信息）

```bash
# ============================================================
# 创建数据库密钥
# 目的：K8S Secret 以加密形式存储敏感信息（密码、API Key等）
#       Pod 通过环境变量或挂载卷的方式引用 Secret
#       避免在 YAML 文件中明文存储密码
# ============================================================

# MySQL/PostgreSQL 数据库密钥
kubectl create secret generic db-secrets \
    --namespace=ucs \
    --from-literal=username=ucs_admin \
    --from-literal=password='YOUR_DB_PASSWORD_HERE' \
    --from-literal=root-password='YOUR_ROOT_PASSWORD_HERE'

# DDS Gateway API Key
kubectl create secret generic dds-gateway-secrets \
    --namespace=ucs \
    --from-literal=api-key='YOUR_DDS_API_KEY_HERE'

# 验证
kubectl get secrets -n ucs
```

---

## 7. 中间件部署（数据库/缓存/消息队列）

### 7.1 目的

UCS 平台的后端依赖三个中间件服务：
- **MySQL**：持久化存储用户信息、任务数据、飞行日志等结构化数据
- **Redis**：高速缓存无人机在线状态、Session、高频遥测数据
- **Kafka**：消息队列，DDS网关将遥测数据通过 Kafka 异步传输给后端，解耦生产和消费

### 7.2 部署 MySQL

```bash
# ============================================================
# 使用 Helm 部署 MySQL
# 目的：提供持久化关系型数据库服务
# 参数说明：
#   auth.existingSecret: 引用上一步创建的数据库密钥
#   auth.database: 自动创建名为 ucs 的数据库
#   primary.persistence.size: 数据库数据目录磁盘大小
#   primary.resources: CPU和内存限制，防止占用过多宿主机资源
# ============================================================
helm install mysql bitnami/mysql \
    --namespace ucs \
    --set auth.existingSecret=db-secrets \
    --set auth.database=ucs \
    --set primary.persistence.size=50Gi \
    --set primary.resources.requests.cpu=500m \
    --set primary.resources.requests.memory=1Gi \
    --set primary.resources.limits.cpu=2000m \
    --set primary.resources.limits.memory=2Gi

# 等待 MySQL 就绪（约1-2分钟）
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=mysql \
    -n ucs --timeout=180s

# 验证
kubectl get pods -l app.kubernetes.io/name=mysql -n ucs
# 期望输出: mysql-0   1/1   Running
```

MySQL 部署完成后，集群内其他服务通过以下地址访问：
- 主机名：`mysql.ucs.svc.cluster.local`
- 端口：`3306`

### 7.3 部署 Redis

```bash
# ============================================================
# 使用 Helm 部署 Redis
# 目的：提供高速缓存服务
# 参数说明：
#   architecture=standalone: 单实例模式（单服务器无需主从复制）
#   auth.enabled=false: 内网环境关闭认证（简化配置）
# ============================================================
helm install redis bitnami/redis \
    --namespace ucs \
    --set architecture=standalone \
    --set auth.enabled=false \
    --set master.resources.requests.cpu=200m \
    --set master.resources.requests.memory=256Mi \
    --set master.resources.limits.cpu=1000m \
    --set master.resources.limits.memory=512Mi \
    --set master.persistence.size=5Gi

# 等待 Redis 就绪
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=redis \
    -n ucs --timeout=120s

# 验证连接
kubectl exec -it $(kubectl get pod -l app.kubernetes.io/name=redis -o jsonpath='{.items[0].metadata.name}' -n ucs) \
    -n ucs -- redis-cli ping
# 期望输出: PONG
```

Redis 集群内访问地址：
- 主机名：`redis-master.ucs.svc.cluster.local`
- 端口：`6379`

### 7.4 部署 Kafka

```bash
# ============================================================
# 使用 Helm 部署 Kafka
# 目的：提供消息队列服务，用于 DDS 遥测数据的异步传输
# 参数说明：
#   controller.replicaCount=1: 单服务器只需1个实例
#   listeners.client.protocol=PLAINTEXT: 简化配置，无需TLS
#   kraft.enabled=true: 使用 KRaft 模式（无需 Zookeeper，减少资源占用）
# ============================================================
helm install kafka bitnami/kafka \
    --namespace ucs \
    --set controller.replicaCount=1 \
    --set listeners.client.protocol=PLAINTEXT \
    --set listeners.interbroker.protocol=PLAINTEXT \
    --set resources.requests.cpu=500m \
    --set resources.requests.memory=1Gi \
    --set resources.limits.cpu=2000m \
    --set resources.limits.memory=2Gi \
    --set persistence.size=20Gi

# 等待 Kafka 就绪（Kafka 启动较慢，约2-3分钟）
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=kafka \
    -n ucs --timeout=300s
```

Kafka 集群内访问地址：
- 主机名：`kafka.ucs.svc.cluster.local`
- 端口：`9092`

### 7.5 验证所有中间件

```bash
# 查看所有中间件 Pod 状态
kubectl get pods -n ucs
# 期望输出（所有 Pod 状态为 Running）：
# NAME                     READY   STATUS    AGE
# mysql-0                  1/1     Running   5m
# redis-master-0           1/1     Running   4m
# kafka-controller-0       1/1     Running   3m
```

---

## 8. DDS 网关部署

### 8.1 目的

DDS Gateway 是 UCS 系统的核心通信桥梁：
- **上行**：通过 ROS2/DDS 协议订阅 PX4 无人机的遥测数据（位置、姿态、状态等）
- **下行**：接收后端的控制指令，通过 DDS 发送给 PX4 无人机
- **转发**：将遥测数据通过 HTTP/Kafka 传递给后端服务

DDS 使用 UDP Multicast 进行服务发现，**必须使用宿主机网络**（hostNetwork: true），否则 K8S 的虚拟网络会阻断 DDS 的 Multicast 通信。

### 8.2 构建 DDS Gateway 镜像

```bash
# ============================================================
# 在服务器本地构建 DDS Gateway Docker 镜像
# 目的：将 DDS Gateway 代码和 ROS2 运行环境打包为容器镜像
# ============================================================

# 确保代码已经拉取到服务器
cd /opt/ucs
git clone https://github.com/L-a-L-max/UCS_Dev.git
cd UCS_Dev

# 创建 DDS Gateway 的 Dockerfile（如果不存在）
cat > dds-gateway/Dockerfile <<'EOF'
FROM ros:humble-ros-base

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    python3-pip python3-venv git curl \
    && rm -rf /var/lib/apt/lists/*

# 构建 PX4 消息包（ROS2 需要的消息类型定义）
RUN mkdir -p /ros2_ws/src && cd /ros2_ws/src && \
    git clone --depth 1 https://github.com/PX4/px4_msgs.git && \
    cd /ros2_ws && \
    . /opt/ros/humble/setup.sh && \
    colcon build --packages-select px4_msgs

# 安装 Python 依赖
WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# 复制网关代码
COPY . .

# 入口脚本
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 5050

ENTRYPOINT ["/docker-entrypoint.sh"]
EOF

# 创建入口脚本
cat > dds-gateway/docker-entrypoint.sh <<'EOF'
#!/bin/bash
set -e
source /opt/ros/humble/setup.bash
source /ros2_ws/install/setup.bash
export ROS_DOMAIN_ID=${ROS_DOMAIN_ID:-0}
echo "Starting DDS Gateway (ROS_DOMAIN_ID=$ROS_DOMAIN_ID)"
exec python3 dds_gateway.py
EOF

# 构建镜像
docker build -t ucs/dds-gateway:latest -f dds-gateway/Dockerfile dds-gateway/
```

### 8.3 K8S 部署配置

```bash
# ============================================================
# 创建 DDS Gateway 部署清单
# 目的：以 K8S Pod 方式运行 DDS Gateway
# 关键配置：
#   hostNetwork: true — 使用宿主机网络，DDS Multicast 才能工作
#   dnsPolicy: ClusterFirstWithHostNet — 使用宿主机网络时仍能解析K8S DNS
# ============================================================
cat > /tmp/dds-gateway.yaml <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dds-gateway
  namespace: ucs
  labels:
    app: dds-gateway
spec:
  replicas: 1
  selector:
    matchLabels:
      app: dds-gateway
  template:
    metadata:
      labels:
        app: dds-gateway
    spec:
      hostNetwork: true
      dnsPolicy: ClusterFirstWithHostNet
      containers:
        - name: dds-gateway
          image: ucs/dds-gateway:latest
          imagePullPolicy: Never    # 使用本地构建的镜像
          ports:
            - name: http
              containerPort: 5050
              protocol: TCP
          env:
            - name: UCS_BACKEND_URL
              value: "http://backend-svc.ucs.svc.cluster.local:8080"
            - name: KAFKA_BOOTSTRAP_SERVERS
              value: "kafka.ucs.svc.cluster.local:9092"
            - name: ROS_DOMAIN_ID
              value: "0"
            - name: DDS_GATEWAY_API_KEY
              valueFrom:
                secretKeyRef:
                  name: dds-gateway-secrets
                  key: api-key
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "2000m"
              memory: "2Gi"
          livenessProbe:
            httpGet:
              path: /api/health
              port: 5050
            initialDelaySeconds: 30
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /api/health
              port: 5050
            initialDelaySeconds: 10
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: dds-gateway-svc
  namespace: ucs
spec:
  type: ClusterIP
  selector:
    app: dds-gateway
  ports:
    - name: http
      port: 5050
      targetPort: 5050
EOF

kubectl apply -f /tmp/dds-gateway.yaml
```

---

## 9. 后端服务部署

### 9.1 目的

Backend 是 UCS 系统的业务核心，提供：
- REST API：用户认证、权限管理、无人机CRUD、任务管理
- WebSocket STOMP：实时遥测数据广播给前端
- 数据库交互：持久化存储业务数据
- DDS Gateway 调用：向无人机发送控制指令

### 9.2 构建后端镜像

```bash
# ============================================================
# 构建 Spring Boot 后端镜像
# 目的：将后端代码编译并打包为可运行的容器镜像
# 使用多阶段构建：
#   第一阶段(builder)：编译Java代码，生成 jar 包
#   第二阶段(runtime)：只保留 JRE + jar，镜像更小
# ============================================================
cat > backend/Dockerfile <<'EOF'
# 编译阶段
FROM maven:3.9-eclipse-temurin-17 AS builder
WORKDIR /build
COPY pom.xml .
# 先下载依赖（利用 Docker 缓存层，代码变更时不需要重新下载依赖）
RUN mvn dependency:go-offline -q
COPY src ./src
RUN mvn clean package -DskipTests -q

# 运行阶段
FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=builder /build/target/*.jar app.jar

ENV JAVA_OPTS="-Xms512m -Xmx1g -XX:+UseG1GC"
EXPOSE 8080

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
EOF

# 构建
cd /opt/ucs/UCS_Dev
docker build -t ucs/backend:latest -f backend/Dockerfile backend/
```

### 9.3 K8S 部署配置

```bash
# ============================================================
# 后端 Deployment + Service
# 目的：部署后端 Spring Boot 服务
# 关键配置：
#   SPRING_PROFILES_ACTIVE=k8s: 激活 K8S 专用配置文件
#   健康检查探针: 确保服务正常运行，异常时自动重启
# ============================================================
cat > /tmp/backend.yaml <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: ucs
  labels:
    app: backend
spec:
  replicas: 1
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
        - name: backend
          image: ucs/backend:latest
          imagePullPolicy: Never
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: SPRING_PROFILES_ACTIVE
              value: "k8s"
            - name: SPRING_DATASOURCE_URL
              value: "jdbc:mysql://mysql.ucs.svc.cluster.local:3306/ucs?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=Asia/Shanghai"
            - name: SPRING_DATASOURCE_USERNAME
              valueFrom:
                secretKeyRef:
                  name: db-secrets
                  key: username
            - name: SPRING_DATASOURCE_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: db-secrets
                  key: password
            - name: SPRING_DATA_REDIS_HOST
              value: "redis-master.ucs.svc.cluster.local"
            - name: SPRING_DATA_REDIS_PORT
              value: "6379"
            - name: SPRING_KAFKA_BOOTSTRAP_SERVERS
              value: "kafka.ucs.svc.cluster.local:9092"
            - name: DDS_GATEWAY_URL
              value: "http://dds-gateway-svc.ucs.svc.cluster.local:5050"
            - name: DDS_GATEWAY_API_KEY
              valueFrom:
                secretKeyRef:
                  name: dds-gateway-secrets
                  key: api-key
            - name: JAVA_OPTS
              value: "-Xms512m -Xmx1g -XX:+UseG1GC"
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              cpu: "2000m"
              memory: "2Gi"
          # 存活探针：检测应用是否还在运行
          # 失败后 K8S 会重启容器
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            initialDelaySeconds: 60
            periodSeconds: 15
            failureThreshold: 3
          # 就绪探针：检测应用是否可以接受请求
          # 失败后 K8S 从 Service 中摘除该 Pod（不再接收新请求）
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: http
            initialDelaySeconds: 30
            periodSeconds: 10
            failureThreshold: 3
          # 启动探针：给 Spring Boot 足够的启动时间
          # 在启动探针成功前，不会运行其他探针
          startupProbe:
            httpGet:
              path: /actuator/health
              port: http
            initialDelaySeconds: 10
            periodSeconds: 5
            failureThreshold: 24  # 最多等待 10+24*5=130 秒
---
apiVersion: v1
kind: Service
metadata:
  name: backend-svc
  namespace: ucs
spec:
  type: ClusterIP
  selector:
    app: backend
  ports:
    - name: http
      port: 8080
      targetPort: http
EOF

kubectl apply -f /tmp/backend.yaml
```

---

## 10. 前端服务部署

### 10.1 目的

Frontend 是用户直接交互的 Web 界面，提供：
- 地图面板：实时显示无人机位置、航迹
- 控制面板：发送飞行指令
- 数据面板：查看遥测数据、飞行日志
- 多角色视图：指挥官、队长、飞手、观察员不同权限视图

前端编译后是纯静态文件（HTML/CSS/JS），通过 Nginx 提供 HTTP 服务。

### 10.2 构建前端镜像

```bash
# ============================================================
# 构建 React 前端镜像
# 目的：编译 TypeScript/React 代码为静态文件，通过 Nginx 对外提供服务
# 多阶段构建：
#   第一阶段：Node.js 编译前端代码
#   第二阶段：Nginx 托管编译产物
# ============================================================

# 前端 Nginx 配置
cat > frontend/ucs-dashboard/nginx.conf <<'EOF'
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # SPA 路由：所有非文件请求都返回 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API 代理（通过 K8S Ingress 路由，此处可选）
    # 如果前端直接请求 /api，通过 Nginx 转发到后端
    location /api/ {
        proxy_pass http://backend-svc.ucs.svc.cluster.local:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # WebSocket 代理
    location /ws/ {
        proxy_pass http://backend-svc.ucs.svc.cluster.local:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Gzip 压缩
    gzip on;
    gzip_types text/plain application/json application/javascript text/css;
    gzip_min_length 1000;
}
EOF

# Dockerfile
cat > frontend/ucs-dashboard/Dockerfile <<'EOF'
# 编译阶段
FROM node:18-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# 设置后端 API 地址（构建时环境变量）
ENV VITE_API_BASE_URL=/api
ENV VITE_WS_URL=/ws
ENV VITE_BAIDU_MAP_AK=nGb4GqLhx9IMrTkm3xlZKg6dv2J2pXnu
RUN npm run build

# 运行阶段
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
EOF

# 构建
cd /opt/ucs/UCS_Dev
docker build -t ucs/frontend:latest -f frontend/ucs-dashboard/Dockerfile frontend/ucs-dashboard/
```

### 10.3 K8S 部署配置

```bash
# ============================================================
# 前端 Deployment + Service
# 目的：部署前端 Nginx 服务
# 前端资源需求很低（只是静态文件服务）
# ============================================================
cat > /tmp/frontend.yaml <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: ucs
  labels:
    app: frontend
spec:
  replicas: 1
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
        - name: frontend
          image: ucs/frontend:latest
          imagePullPolicy: Never
          ports:
            - name: http
              containerPort: 80
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"
          livenessProbe:
            httpGet:
              path: /
              port: http
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /
              port: http
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: frontend-svc
  namespace: ucs
spec:
  type: ClusterIP
  selector:
    app: frontend
  ports:
    - name: http
      port: 80
      targetPort: http
EOF

kubectl apply -f /tmp/frontend.yaml
```

---

## 11. Ingress 与外部访问配置

### 11.1 目的

Ingress 是 K8S 的统一入口网关，作用相当于传统的 Nginx 反向代理：
- 将外部请求按 URL 路径路由到对应的内部服务
- 提供 SSL/TLS 终止
- 负载均衡

k3s 默认内置了 Traefik 作为 Ingress Controller。如果安装时未禁用，可以直接使用。

### 11.2 配置 Ingress 规则

```bash
# ============================================================
# Ingress 配置
# 目的：定义外部访问路由规则
# 路由说明：
#   / → Frontend（Web界面）
#   /api → Backend（REST API）
#   /ws → Backend（WebSocket 实时通信）
# ============================================================
cat > /tmp/ingress.yaml <<'EOF'
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ucs-ingress
  namespace: ucs
  annotations:
    # 支持大文件上传（3D Tiles 数据等）
    nginx.ingress.kubernetes.io/proxy-body-size: "100m"
    # WebSocket 超时时间
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    # WebSocket 支持
    nginx.ingress.kubernetes.io/proxy-http-version: "1.1"
    nginx.ingress.kubernetes.io/configuration-snippet: |
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
spec:
  ingressClassName: traefik  # k3s 内置，如使用nginx改为 nginx
  rules:
    # 如果有域名，替换为实际域名；没有域名可以用 IP 直接访问
    - http:
        paths:
          # 后端 API
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: backend-svc
                port:
                  number: 8080
          # WebSocket
          - path: /ws
            pathType: Prefix
            backend:
              service:
                name: backend-svc
                port:
                  number: 8080
          # 前端（默认路由，放最后）
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend-svc
                port:
                  number: 80
EOF

kubectl apply -f /tmp/ingress.yaml
```

### 11.3 外部访问方式

部署完成后，有以下方式从外部访问 UCS 平台：

```bash
# 方式1：直接通过服务器 IP 访问（推荐用于测试）
# 浏览器打开: http://<服务器IP>

# 方式2：配置域名（推荐用于生产）
# 在 DNS 中将域名 A 记录指向服务器 IP
# 然后通过: http://ucs.yourdomain.com 访问

# 方式3：NodePort 直接暴露（备选方案）
# 如果 Ingress 配置有问题，可以临时用 NodePort 直接暴露前端
kubectl patch svc frontend-svc -n ucs -p '{"spec":{"type":"NodePort","ports":[{"port":80,"nodePort":30080}]}}'
# 通过 http://<服务器IP>:30080 访问
```

---

## 12. PX4/Gazebo 仿真环境（可选）

### 12.1 目的

如果需要在同一台服务器上运行 PX4 无人机仿真（用于测试验证），需要在**宿主机**上安装 ROS2 和 PX4。

> **注意**：PX4 仿真不运行在 K8S 内部，而是直接运行在宿主机上。DDS Gateway Pod（使用 hostNetwork）可以直接通过 DDS 协议与宿主机上的 PX4 仿真通信。

### 12.2 安装 ROS2 Humble

```bash
# ============================================================
# 安装 ROS2 Humble
# 目的：提供 DDS 通信基础设施，PX4 通过 ROS2/DDS 发布遥测话题
# ============================================================
sudo apt install -y software-properties-common
sudo add-apt-repository universe
sudo curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.key \
    -o /usr/share/keyrings/ros-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/ros-archive-keyring.gpg] \
    http://packages.ros.org/ros2/ubuntu $(. /etc/os-release && echo $UBUNTU_CODENAME) main" | \
    sudo tee /etc/apt/sources.list.d/ros2.list > /dev/null

sudo apt update
sudo apt install -y ros-humble-ros-base python3-colcon-common-extensions

# 添加到 bashrc
echo "source /opt/ros/humble/setup.bash" >> ~/.bashrc
source /opt/ros/humble/setup.bash
```

### 12.3 安装 PX4-Autopilot

```bash
# ============================================================
# 安装 PX4 仿真
# 目的：模拟真实无人机，产生遥测数据供系统测试
# ============================================================
cd /opt
git clone https://github.com/PX4/PX4-Autopilot.git --recursive --depth 1 -b v1.14.0
cd PX4-Autopilot
bash ./Tools/setup/ubuntu.sh   # 安装编译依赖

# 编译 SITL（Software In The Loop）仿真
make px4_sitl

# 启动单机仿真（测试用）
# make px4_sitl gazebo-classic

# 启动多机仿真（3架无人机）
# Tools/simulation/gazebo-classic/sitl_multiple_run.sh -n 3
```

### 12.4 验证 DDS 通信

```bash
# 在宿主机上启动 PX4 仿真后，检查 DDS Gateway Pod 是否能接收到话题
kubectl exec -it $(kubectl get pod -l app=dds-gateway -o jsonpath='{.items[0].metadata.name}' -n ucs) \
    -n ucs -- bash -c "source /opt/ros/humble/setup.bash && ros2 topic list"
# 期望输出应包含 /fmu/out/vehicle_global_position 等话题
```

---

## 13. 监控与日志

### 13.1 目的

监控和日志系统用于：
- **实时监控**：观察各服务的 CPU、内存、网络使用情况
- **告警**：当服务异常时自动通知运维人员
- **日志收集**：集中查看所有服务的日志，快速定位问题

### 13.2 安装 Prometheus + Grafana

```bash
# ============================================================
# 使用 Helm 部署监控套件
# 包含：
#   Prometheus: 指标采集和存储
#   Grafana: 可视化仪表盘
#   AlertManager: 告警管理
#   Node Exporter: 宿主机硬件指标采集
# ============================================================
helm install monitoring prometheus-community/kube-prometheus-stack \
    --namespace monitoring \
    --set grafana.adminPassword=admin \
    --set prometheus.prometheusSpec.retention=7d \
    --set prometheus.prometheusSpec.resources.requests.memory=512Mi \
    --set prometheus.prometheusSpec.resources.limits.memory=1Gi

# 暴露 Grafana 到外部访问（NodePort方式）
kubectl patch svc monitoring-grafana -n monitoring \
    -p '{"spec":{"type":"NodePort","ports":[{"port":80,"nodePort":30300}]}}'
# 访问: http://<服务器IP>:30300  用户名: admin  密码: admin
```

### 13.3 查看日志

```bash
# 查看各服务日志
kubectl logs -f deployment/backend -n ucs                # 后端日志
kubectl logs -f deployment/dds-gateway -n ucs            # DDS网关日志
kubectl logs -f deployment/frontend -n ucs               # 前端(Nginx)日志

# 查看所有 UCS 命名空间的事件（用于排查部署问题）
kubectl get events -n ucs --sort-by='.lastTimestamp' | tail -30

# 查看资源使用情况
kubectl top pods -n ucs
kubectl top nodes
```

---

## 14. 一键部署脚本

### 14.1 目的

将上述所有步骤整合为一个自动化脚本，一键完成从环境初始化到服务部署的全流程。

### 14.2 完整部署脚本

```bash
#!/bin/bash
# ============================================================
# UCS 平台 K8S 单服务器一键部署脚本
# 使用方式: chmod +x deploy.sh && sudo ./deploy.sh
# 前置要求: Ubuntu 22.04 LTS，已完成步骤3（系统初始化）和步骤4（容器运行时）
# ============================================================

set -e
echo "=========================================="
echo "  UCS 无人机管控平台 - K8S 单服务器部署"
echo "=========================================="

# ---------- 配置项（按需修改）----------
DB_PASSWORD="ucs_secure_password_2024"
DB_ROOT_PASSWORD="root_secure_password_2024"
DDS_API_KEY="ucs-dds-gateway-secret-2024"
UCS_REPO="https://github.com/L-a-L-max/UCS_Dev.git"
UCS_BRANCH="FUIAttemptation"
WORK_DIR="/opt/ucs"
# -----------------------------------------

echo "[1/8] 安装 k3s..."
if ! command -v k3s &> /dev/null; then
    curl -sfL https://get.k3s.io | sh -s - \
        --write-kubeconfig-mode=644 \
        --node-name=ucs-node
    mkdir -p ~/.kube
    sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
    sudo chown $(id -u):$(id -g) ~/.kube/config
    export KUBECONFIG=~/.kube/config
fi

echo "[2/8] 安装 Helm..."
if ! command -v helm &> /dev/null; then
    curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
fi
helm repo add bitnami https://charts.bitnami.com/bitnami 2>/dev/null || true
helm repo update

echo "[3/8] 创建 Namespace 和 Secret..."
kubectl create namespace ucs 2>/dev/null || true
kubectl config set-context --current --namespace=ucs

kubectl create secret generic db-secrets \
    --namespace=ucs \
    --from-literal=username=ucs_admin \
    --from-literal=password="$DB_PASSWORD" \
    --from-literal=root-password="$DB_ROOT_PASSWORD" \
    2>/dev/null || true

kubectl create secret generic dds-gateway-secrets \
    --namespace=ucs \
    --from-literal=api-key="$DDS_API_KEY" \
    2>/dev/null || true

echo "[4/8] 部署中间件..."
helm install mysql bitnami/mysql -n ucs \
    --set auth.existingSecret=db-secrets \
    --set auth.database=ucs \
    --set primary.persistence.size=50Gi \
    2>/dev/null || echo "MySQL 已存在，跳过"

helm install redis bitnami/redis -n ucs \
    --set architecture=standalone \
    --set auth.enabled=false \
    2>/dev/null || echo "Redis 已存在，跳过"

helm install kafka bitnami/kafka -n ucs \
    --set controller.replicaCount=1 \
    --set listeners.client.protocol=PLAINTEXT \
    2>/dev/null || echo "Kafka 已存在，跳过"

echo "等待中间件就绪..."
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=mysql -n ucs --timeout=180s || true
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=redis -n ucs --timeout=120s || true
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=kafka -n ucs --timeout=300s || true

echo "[5/8] 拉取代码并构建镜像..."
mkdir -p $WORK_DIR && cd $WORK_DIR
if [ ! -d "UCS_Dev" ]; then
    git clone -b $UCS_BRANCH $UCS_REPO
fi
cd UCS_Dev

# 构建后端镜像
echo "构建后端镜像..."
docker build -t ucs/backend:latest -f backend/Dockerfile backend/

# 构建前端镜像
echo "构建前端镜像..."
docker build -t ucs/frontend:latest -f frontend/ucs-dashboard/Dockerfile frontend/ucs-dashboard/

# 构建DDS网关镜像
echo "构建DDS网关镜像..."
docker build -t ucs/dds-gateway:latest -f dds-gateway/Dockerfile dds-gateway/

echo "[6/8] 部署应用服务..."
# (此处 kubectl apply 上述步骤8/9/10中的YAML文件)
# 在实际操作中，将YAML文件放在 k8s/ 目录下统一 apply
kubectl apply -f k8s/ --recursive 2>/dev/null || \
    echo "请确保 k8s/ 目录下有部署清单文件"

echo "[7/8] 配置 Ingress..."
kubectl apply -f /tmp/ingress.yaml 2>/dev/null || true

echo "[8/8] 验证部署..."
echo ""
echo "等待所有 Pod 就绪..."
sleep 10
kubectl get pods -n ucs

echo ""
echo "=========================================="
echo "  部署完成!"
echo "=========================================="
echo "  访问地址: http://$(hostname -I | awk '{print $1}')"
echo "  后端 API: http://$(hostname -I | awk '{print $1}')/api"
echo "=========================================="
```

---

## 15. 验证与测试

### 15.1 目的

确认所有服务正常运行，端到端通信无问题。

### 15.2 检查清单

```bash
# ============================================================
# 1. 检查所有 Pod 状态
# 期望：所有 Pod 状态为 Running，READY 列为 1/1
# ============================================================
kubectl get pods -n ucs -o wide

# ============================================================
# 2. 检查 Service 是否正常
# ============================================================
kubectl get svc -n ucs

# ============================================================
# 3. 测试后端 API
# ============================================================
curl http://localhost/api/actuator/health
# 期望输出: {"status":"UP"}

# ============================================================
# 4. 测试前端页面
# ============================================================
curl -I http://localhost/
# 期望输出: HTTP/1.1 200 OK

# ============================================================
# 5. 测试 DDS Gateway
# ============================================================
curl http://localhost:5050/api/health
# 期望输出: {"status":"healthy", ...}

# ============================================================
# 6. 测试 WebSocket（需要 wscat 工具）
# ============================================================
# npm install -g wscat
# wscat -c ws://localhost/ws/telemetry

# ============================================================
# 7. 测试数据库连接
# ============================================================
kubectl exec -it $(kubectl get pod -l app.kubernetes.io/name=mysql -o jsonpath='{.items[0].metadata.name}' -n ucs) \
    -n ucs -- mysql -u ucs_admin -p"$DB_PASSWORD" -e "SHOW DATABASES;"

# ============================================================
# 8. 从浏览器验证
# ============================================================
# 打开浏览器访问 http://<服务器IP>
# 应看到 UCS 管控平台登录界面
# 登录后应看到地图面板
```

### 15.3 端到端验证流程

```
1. 启动 PX4 仿真 (宿主机)
   └→ PX4 通过 DDS 发布遥测话题

2. DDS Gateway Pod 接收遥测
   └→ 转发到 Backend (HTTP/Kafka)

3. Backend 处理并通过 WebSocket 广播
   └→ Frontend 接收并在地图上渲染无人机位置

4. 前端发送控制指令
   └→ Backend → DDS Gateway → PX4 执行
```

---

## 16. 常见问题排查

### Q1: Pod 状态为 ImagePullBackOff

```
原因: K8S 无法拉取镜像
解决: 
  - 确认使用了 imagePullPolicy: Never（本地镜像）
  - 确认 docker images 中存在对应镜像
  - 如果使用 k3s，需要将镜像导入 k3s:
    docker save ucs/backend:latest | sudo k3s ctr images import -
```

### Q2: Pod 状态为 CrashLoopBackOff

```
原因: 容器启动后立即崩溃
排查:
  kubectl logs <pod-name> -n ucs          # 查看日志
  kubectl describe pod <pod-name> -n ucs  # 查看事件和退出码
常见原因:
  - 数据库连接失败（中间件尚未就绪）
  - 环境变量配置错误
  - 端口冲突（hostNetwork 模式下）
```

### Q3: DDS Gateway 无法收到 PX4 话题

```
原因: DDS Multicast 通信失败
排查:
  1. 确认 Pod 使用了 hostNetwork: true
  2. 确认 ROS_DOMAIN_ID 一致（默认为 0）
  3. 在 Pod 内执行: ros2 topic list
  4. 检查防火墙是否阻断了 UDP 7400-7500 端口
  5. 确认 PX4 仿真已启动
```

### Q4: 前端无法连接 WebSocket

```
原因: Ingress 未正确配置 WebSocket 代理
排查:
  1. 检查 Ingress annotations 中的 WebSocket 配置
  2. 确认后端 WebSocket 端点路径正确（/ws/）
  3. 浏览器开发者工具查看 WebSocket 连接状态
  4. 临时用 NodePort 直接暴露后端测试:
     kubectl patch svc backend-svc -n ucs -p '{"spec":{"type":"NodePort"}}'
```

### Q5: 服务器重启后 K8S 服务未自动恢复

```
k3s 默认已配置为 systemd 服务，重启后会自动恢复。
如果未恢复:
  sudo systemctl status k3s
  sudo systemctl restart k3s
  # 等待约1-2分钟，所有 Pod 会自动重新调度
  kubectl get pods -n ucs -w
```

### Q6: 磁盘空间不足

```
排查:
  df -h                                      # 查看磁盘使用
  docker system df                           # 查看 Docker 占用
  docker system prune -a                     # 清理无用镜像/容器
  kubectl get pvc -n ucs                     # 查看持久卷占用
```

### Q7: 单节点 Pod 无法调度（Taint 问题）

```
k3s 默认已处理 Master Taint，单节点可直接调度 Pod。
如果使用 kubeadm 安装，需要手动去除 Taint:
  kubectl taint nodes ucs-node node-role.kubernetes.io/control-plane:NoSchedule-
```

---

## 附录 A：端口汇总

| 服务 | 集群内端口 | 外部访问端口 | 协议 |
|------|-----------|-------------|------|
| Frontend | 80 | 80 (Ingress) | HTTP |
| Backend API | 8080 | /api (Ingress) | HTTP |
| Backend WebSocket | 8080 | /ws (Ingress) | WS |
| DDS Gateway | 5050 | 5050 (hostNetwork) | HTTP |
| MySQL | 3306 | 不暴露 | TCP |
| Redis | 6379 | 不暴露 | TCP |
| Kafka | 9092 | 不暴露 | TCP |
| Grafana | 3000 | 30300 (NodePort) | HTTP |
| K8S API | 6443 | 6443 | HTTPS |

## 附录 B：需要预装的软件汇总

| 软件 | 版本 | 安装阶段 | 用途 |
|------|------|---------|------|
| Ubuntu Server | 22.04 LTS | 操作系统安装 | 基础操作系统 |
| containerd | 1.7+ | 步骤4 | 容器运行时 |
| Docker CE | 24+ | 步骤4 | 构建容器镜像 |
| k3s | 最新稳定版 | 步骤5 | Kubernetes 集群 |
| Helm | 3.14+ | 步骤5 | K8S 包管理 |
| ROS2 Humble | - | 步骤12(可选) | DDS通信/仿真 |
| PX4-Autopilot | v1.14+ | 步骤12(可选) | 无人机仿真 |
| Git | 2.x | 步骤3 | 代码拉取 |

## 附录 C：部署后的运维命令速查

```bash
# --- 查看状态 ---
kubectl get pods -n ucs                     # 查看所有 Pod
kubectl get svc -n ucs                      # 查看所有 Service
kubectl top pods -n ucs                     # 查看资源使用

# --- 日志查看 ---
kubectl logs -f deploy/backend -n ucs       # 后端日志
kubectl logs -f deploy/dds-gateway -n ucs   # DDS网关日志
kubectl logs -f deploy/frontend -n ucs      # 前端日志

# --- 滚动更新 ---
docker build -t ucs/backend:latest backend/  # 重新构建镜像
kubectl rollout restart deploy/backend -n ucs # 触发滚动更新
kubectl rollout status deploy/backend -n ucs  # 查看更新进度

# --- 扩缩容 ---
kubectl scale deploy/backend --replicas=3 -n ucs  # 后端扩到3副本

# --- 问题排查 ---
kubectl describe pod <pod-name> -n ucs       # 查看 Pod 详情
kubectl exec -it <pod-name> -n ucs -- bash   # 进入容器
kubectl get events -n ucs --sort-by='.lastTimestamp'  # 查看事件

# --- 重启服务 ---
kubectl rollout restart deploy/backend -n ucs
kubectl rollout restart deploy/frontend -n ucs
kubectl rollout restart deploy/dds-gateway -n ucs

# --- 完全清理重装 ---
helm uninstall mysql redis kafka -n ucs
kubectl delete namespace ucs
# 然后从步骤6重新开始
```
