# UCS K8s 集群部署完整指南

> **目标读者**：拿到 ≥3 台全新 Ubuntu 22.04 虚拟机，希望从零搭出一套可运行的 UCS（无人机集群管控系统）K8s 集群的运维或开发同学。
>
> **覆盖范围**：从 OS 调优 → 容器运行时 → kubeadm 集群初始化 → CNI/存储 → 中间件（Kafka/Redis/PostgreSQL/Nacos）→ 七个 Spring 微服务 + Mavlink/DDS 网关 + React 前端 → Ingress / HPA / 监控 → 状态验证 → 常见故障排查。
>
> **配套补丁**：本指南假设 [PR #58](https://github.com/L-a-L-max/UCS_Dev/pull/58) 的"DDS 动态分片"已合入。若尚未合并，DDS 网关需要走旧的静态 `--instance-id/--total-instances` 模式，相应章节会另作说明。

---

## 目录

1. [集群规划](#1-集群规划)
2. [虚拟机准备工作](#2-虚拟机准备工作)
3. [操作系统初始化（所有节点）](#3-操作系统初始化所有节点)
4. [容器运行时 containerd（所有节点）](#4-容器运行时-containerd所有节点)
5. [安装 kubeadm/kubelet/kubectl（所有节点）](#5-安装-kubeadmkubeletkubectl所有节点)
6. [Master 初始化](#6-master-初始化)
7. [Worker 加入集群](#7-worker-加入集群)
8. [CNI 网络插件（Calico）](#8-cni-网络插件calico)
9. [本地存储 local-path-provisioner](#9-本地存储-local-path-provisioner)
10. [安装 Helm + Ingress-NGINX + Metrics Server](#10-安装-helm--ingress-nginx--metrics-server)
11. [构建并推送镜像](#11-构建并推送镜像)
12. [部署中间件](#12-部署中间件postgres--timescaledb--redis--kafka--nacos)
13. [部署 UCS 微服务](#13-部署-ucs-微服务)
14. [部署 DDS / Mavlink 网关](#14-部署-dds--mavlink-网关)
15. [部署前端](#15-部署前端)
16. [Ingress / TLS / 域名](#16-ingress--tls--域名)
17. [HPA（自动伸缩）配置](#17-hpa自动伸缩配置)
18. [监控（Prometheus + Grafana + Loki）](#18-监控prometheus--grafana--loki)
19. [全链路状态验证](#19-全链路状态验证)
20. [常见故障与排查](#20-常见故障与排查)
21. [日常运维操作](#21-日常运维操作)
22. [附录 A：所需端口清单](#附录-a所需端口清单)
23. [附录 B：环境变量速查表](#附录-b环境变量速查表)

---

## 1. 集群规划

### 1.1 系统架构（以 3 台 VM 为最小可用集群）

```
                                  ┌─────────────────────────────┐
                                  │   Internet / 内网客户端     │
                                  │  浏览器 / PX4 / 仿真无人机  │
                                  └──────────────┬──────────────┘
                                                 │
                              VIP / Load Balancer / Master IP:443
                                                 │
        ┌────────────────────────────────────────┴────────────────────────────────────┐
        │                              K8s 集群                                       │
        │                                                                              │
        │   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                     │
        │   │ vm-master   │    │ vm-worker-1 │    │ vm-worker-2 │                     │
        │   │ (control    │    │  (worker)   │    │  (worker)   │                     │
        │   │  plane +    │    │             │    │             │                     │
        │   │  worker)    │    │             │    │             │                     │
        │   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                     │
        │          │                  │                  │                            │
        │          └──── Calico Pod CIDR 10.244.0.0/16 ──┘                            │
        │                                                                              │
        │  ┌────────────────────────────────────────────────────────────────────┐     │
        │  │ 业务命名空间: ucs                                                   │     │
        │  │                                                                     │     │
        │  │  ┌───────────┐ ┌───────────┐ ┌───────────┐  ┌─────────────────┐   │     │
        │  │  │ Frontend  │ │ Ingress   │ │ API GW    │  │ ucs-business    │   │     │
        │  │  │ (Nginx)   │ │ NGINX     │ │ x2        │  │ x2 (WebSocket)  │   │     │
        │  │  └───────────┘ └───────────┘ └───────────┘  └─────────────────┘   │     │
        │  │  ┌───────────────┐ ┌───────────────┐ ┌──────────────────┐         │     │
        │  │  │telemetry-     │ │telemetry-     │ │ command  x2      │         │     │
        │  │  │ingest  x2~10  │ │store  x2      │ │ drone-state x2   │         │     │
        │  │  └───────┬───────┘ └───────┬───────┘ └─────────┬────────┘         │     │
        │  │          │                 │                   │                  │     │
        │  │   ┌──────┴────┐   ┌────────┴───────┐    ┌─────┴────────┐         │     │
        │  │   │ Kafka x3  │   │ TimescaleDB    │    │ PostgreSQL   │         │     │
        │  │   │ (KRaft,   │   │ (StatefulSet)  │    │ (StatefulSet)│         │     │
        │  │   │ 16 part.) │   └────────────────┘    └──────────────┘         │     │
        │  │   └──────┬────┘                                                    │     │
        │  │          │                                                         │     │
        │  │   ┌──────┴────────┐    ┌────────────────────────────────────┐    │     │
        │  │   │ Redis x6      │    │ DDS gateways (hostNetwork)         │    │     │
        │  │   │ Cluster /     │    │  - dds-routing  (replicas: 1~5)    │    │     │
        │  │   │ Sentinel      │◀──►│  - dds-rx       (replicas: 1~10)   │    │     │
        │  │   │  + dds:shards │    │  - dds-tx       (replicas: 1~10)   │    │     │
        │  │   └───────────────┘    │  动态分片 (PR #58)                 │    │     │
        │  │                        └─────────────────┬──────────────────┘    │     │
        │  │                                          │ ROS2 / DDS multicast   │     │
        │  │                                          ▼                        │     │
        │  │                                ┌────────────────────┐             │     │
        │  │                                │ mavlink-gateway    │             │     │
        │  │                                │ (UDP, hostNetwork) │             │     │
        │  │                                └────────────────────┘             │     │
        │  │                                                                    │     │
        │  │  ┌────────┐   ┌──────────────┐   ┌─────────────────┐               │     │
        │  │  │ Nacos  │   │ realtime-    │   │ Prometheus +    │               │     │
        │  │  │  x2    │   │ push x2      │   │ Grafana + Loki  │               │     │
        │  │  └────────┘   └──────────────┘   └─────────────────┘               │     │
        │  └────────────────────────────────────────────────────────────────────┘     │
        └──────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 节点角色与 IP 规划

> 以下 IP 为示例，按你的网络改即可。**重点：所有节点必须在同一二层/三层互通的网段，否则 Calico/DDS 多播会出问题。**

| 主机名         | 角色                   | 推荐配置             | IP（示例）   | 关键负载                                      |
|----------------|------------------------|----------------------|--------------|-----------------------------------------------|
| `vm-master`    | control-plane + worker | 8 vCPU / 16 GB / 200 GB | 10.0.0.10    | etcd、kube-apiserver、Postgres、Nacos         |
| `vm-worker-1`  | worker                 | 8 vCPU / 16 GB / 500 GB | 10.0.0.11    | Kafka-1、Redis-1~3、TimescaleDB、telemetry-* |
| `vm-worker-2`  | worker                 | 8 vCPU / 16 GB / 500 GB | 10.0.0.12    | Kafka-2/3、Redis-4~6、DDS 网关、Mavlink 网关 |

**生产建议**：3 节点是"最小可学习" 配置；正式环境推荐 5 节点（3 控制面 + 2+ 工作节点）以满足 etcd 集群投票，并把数据库/Kafka 拆到独立 VM（不上 K8s）。本指南默认你接受小规模（3 VM）的取舍。

### 1.3 软件版本基线

| 组件                  | 版本（本指南实测）             |
|-----------------------|-----------------------------|
| Ubuntu                | 22.04 LTS                  |
| containerd            | 1.7.x                      |
| Kubernetes            | 1.29.x                     |
| Calico                | v3.27.x                    |
| Helm                  | 3.14.x                     |
| Kafka image           | apache/kafka:3.7.0 (KRaft) |
| Redis                 | 7.2 (Bitnami chart)        |
| PostgreSQL            | 14 + TimescaleDB 2.13      |
| Nacos                 | 2.3.x                      |
| Prometheus + Grafana  | kube-prometheus-stack 56.x |

---

## 2. 虚拟机准备工作

### 2.1 创建 3 台虚拟机时确保

- 模板：Ubuntu Server 22.04 LTS（最小化安装即可）
- **CPU 必须开启虚拟化扩展**（VT-x / AMD-V），否则 containerd 启动会被宿主限制
- **关闭 swap**（K8s 强制要求）：第 3 章会再确认
- **每台至少 2 块磁盘**（可选）：`/` 50GB + `/var/lib` 独立 ≥ 200GB（Kafka/PG 数据盘）
- **网络**：桥接或同一 VLAN，节点之间能 Layer-2 直通；如需跨子网，需要 BGP/IP-in-IP 模式的 CNI（Calico 默认 IP-in-IP 即可）
- **静态 IP**：DHCP 也行，但租约变更会导致 K8s/etcd 失联，强烈建议设静态

### 2.2 SSH 与 sudo 准备

```bash
# 在每台 VM 上：建立同一个运维账号 ubuntu，加入 sudo
sudo useradd -m -s /bin/bash ubuntu
sudo passwd ubuntu
echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/ubuntu

# 建议从你本地工作机一键 ssh 免密
ssh-copy-id ubuntu@10.0.0.10
ssh-copy-id ubuntu@10.0.0.11
ssh-copy-id ubuntu@10.0.0.12
```

### 2.3 设置主机名与 /etc/hosts（所有节点同步执行）

```bash
# vm-master
sudo hostnamectl set-hostname vm-master
# vm-worker-1
sudo hostnamectl set-hostname vm-worker-1
# vm-worker-2
sudo hostnamectl set-hostname vm-worker-2

# 三台都追加（注意把 IP 换成你自己的）
sudo tee -a /etc/hosts <<'EOF'
10.0.0.10 vm-master
10.0.0.11 vm-worker-1
10.0.0.12 vm-worker-2
EOF
```

> 一旦主机名/IP 不互通，后面 `kubeadm join` 一定会卡在 `etcd not ready` 或 `kubelet certificate signing` 报错——先验证 `ping vm-master` / `ping vm-worker-1` 都能通再继续。

---

## 3. 操作系统初始化（所有节点）

### 3.1 关闭 swap 与防火墙、配置时间同步

```bash
# 1) 关闭 swap：必须，否则 kubelet 启动失败
sudo swapoff -a
sudo sed -i '/ swap / s/^/#/' /etc/fstab

# 2) 关闭 ufw（生产建议改用安全组而非主机防火墙）
sudo systemctl disable --now ufw

# 3) 时间同步（etcd 对时钟极敏感，差 500ms 就可能被踢出 quorum）
sudo apt update && sudo apt install -y chrony
sudo systemctl enable --now chrony
chronyc tracking         # 检查 Stratum 与 Last offset

# 4) selinux：Ubuntu 默认未启用，可忽略；CentOS/RHEL 用户：setenforce 0
```

### 3.2 内核模块 & sysctl

K8s/Calico 需要 `br_netfilter` 模块和若干 sysctl 项。

```bash
# 启用模块
cat <<'EOF' | sudo tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF
sudo modprobe overlay
sudo modprobe br_netfilter

# sysctl
cat <<'EOF' | sudo tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
# DDS / 大量 socket：放宽 conntrack 与 fd
fs.inotify.max_user_instances       = 8192
fs.inotify.max_user_watches         = 524288
net.core.rmem_max                   = 16777216
net.core.wmem_max                   = 16777216
net.ipv4.tcp_keepalive_time         = 600
EOF
sudo sysctl --system
```

> DDS 用的是 UDP 多播，默认 socket 缓冲区只有 ~200KB，丢包率在 100 架无人机以上会肉眼可见，所以提前把 `rmem_max/wmem_max` 拉到 16MB。

### 3.3 升级软件包（强烈推荐先重启）

```bash
sudo apt update && sudo apt -y upgrade
sudo reboot
```

---

## 4. 容器运行时 containerd（所有节点）

K8s 1.29 已经不再支持 dockershim，containerd 是默认运行时。

```bash
# 安装
sudo apt install -y containerd
sudo mkdir -p /etc/containerd

# 生成默认配置
sudo containerd config default | sudo tee /etc/containerd/config.toml >/dev/null

# 关键修改 1：让 kubelet 使用 systemd cgroup（K8s 推荐）
sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml

# 关键修改 2：国内环境替换 sandbox 镜像（如能直连 k8s.gcr.io 可跳过）
sudo sed -i 's#registry.k8s.io/pause:3.8#registry.aliyuncs.com/google_containers/pause:3.9#' /etc/containerd/config.toml

sudo systemctl enable --now containerd
sudo systemctl restart containerd
sudo ctr version    # 验证
```

---

## 5. 安装 kubeadm/kubelet/kubectl（所有节点）

```bash
# 添加 K8s apt 源（以 1.29 为例）
sudo apt update && sudo apt install -y apt-transport-https ca-certificates curl gpg
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.29/deb/Release.key \
  | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.29/deb/ /' \
  | sudo tee /etc/apt/sources.list.d/kubernetes.list

sudo apt update
sudo apt install -y kubelet kubeadm kubectl
sudo apt-mark hold kubelet kubeadm kubectl   # 防止 apt upgrade 自动升级

kubeadm version    # 应显示 v1.29.x
kubectl version --client
```

---

## 6. Master 初始化

> 只在 `vm-master` 上执行。

### 6.1 拉取镜像（提前拉避免 init 卡住）

```bash
sudo kubeadm config images pull \
  --image-repository=registry.aliyuncs.com/google_containers \
  --kubernetes-version=v1.29.0
```

### 6.2 初始化控制面

```bash
sudo kubeadm init \
  --apiserver-advertise-address=10.0.0.10 \
  --image-repository=registry.aliyuncs.com/google_containers \
  --kubernetes-version=v1.29.0 \
  --pod-network-cidr=10.244.0.0/16 \
  --service-cidr=10.96.0.0/12 \
  --control-plane-endpoint=vm-master:6443
```

`init` 完成后，命令行会输出三段关键内容，**必须立刻复制保存**：

1. **kubeconfig 复制命令**：

   ```bash
   mkdir -p $HOME/.kube
   sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
   sudo chown $(id -u):$(id -g) $HOME/.kube/config
   ```

2. **kubeadm join 命令**：形如

   ```bash
   kubeadm join vm-master:6443 --token <abcdef.xxxxxxxxxxxx> \
     --discovery-token-ca-cert-hash sha256:<hash>
   ```

   在第 7 章给 worker 节点用。如果忘记了：

   ```bash
   # 重新生成 join token
   kubeadm token create --print-join-command
   ```

3. 提示你接下来要装 CNI 才能让节点就绪——这就是第 8 章的事。

### 6.3 让 master 也能跑业务 Pod（小集群必备）

```bash
# 默认 master 有 NoSchedule 污点，3 节点环境下我们让它也参与调度
kubectl taint nodes vm-master node-role.kubernetes.io/control-plane:NoSchedule-
```

> **生产环境别这么干**——control-plane 资源被业务抢占会导致 etcd 抖动。

---

## 7. Worker 加入集群

> 在 `vm-worker-1` 和 `vm-worker-2` 上分别执行（用第 6.2 步的 join 命令）：

```bash
sudo kubeadm join vm-master:6443 --token <abcdef.xxxxx> \
  --discovery-token-ca-cert-hash sha256:<hash>
```

回到 `vm-master` 检查：

```bash
kubectl get nodes -o wide
# NAME           STATUS     ROLES           AGE   VERSION
# vm-master      NotReady   control-plane   3m    v1.29.0
# vm-worker-1    NotReady   <none>          1m    v1.29.0
# vm-worker-2    NotReady   <none>          30s   v1.29.0
```

`NotReady` 是正常的，等装完 CNI 才会变 `Ready`。

---

## 8. CNI 网络插件（Calico）

```bash
# 在 vm-master 上
kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.27.0/manifests/tigera-operator.yaml

# 自定义 Pod CIDR 与节点 IP 自动检测
cat <<'EOF' | kubectl apply -f -
apiVersion: operator.tigera.io/v1
kind: Installation
metadata:
  name: default
spec:
  calicoNetwork:
    ipPools:
      - blockSize: 26
        cidr: 10.244.0.0/16
        encapsulation: IPIP
        natOutgoing: Enabled
        nodeSelector: all()
EOF

# 等所有 calico Pod Running
kubectl -n calico-system get pods -w
```

完成后再看：

```bash
kubectl get nodes
# 三个节点都应进入 Ready
```

---

## 9. 本地存储 local-path-provisioner

PostgreSQL/Kafka/Redis 全是有状态服务，需要 PVC。生产用 Ceph/EBS，学习/单集群环境用 Rancher 的 local-path-provisioner 最简单。

```bash
kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.26/deploy/local-path-storage.yaml

# 设为默认 StorageClass
kubectl patch storageclass local-path \
  -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'

kubectl get sc
# local-path (default)  rancher.io/local-path  ...
```

> **注意**：local-path 把 PV 数据落在 Node 本地目录 `/opt/local-path-provisioner`，**Pod 不能跨节点漂移**。在 3 节点小集群可接受；生产应改为带快照能力的分布式存储。

---

## 10. 安装 Helm + Ingress-NGINX + Metrics Server

```bash
# Helm
curl https://baltocdn.com/helm/signing.asc | gpg --dearmor | sudo tee /usr/share/keyrings/helm.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/helm.gpg] https://baltocdn.com/helm/stable/debian/ all main' \
  | sudo tee /etc/apt/sources.list.d/helm-stable-debian.list
sudo apt update && sudo apt install -y helm
helm version

# Ingress-NGINX：用 NodePort 暴露到 30080/30443
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --set controller.service.type=NodePort \
  --set controller.service.nodePorts.http=30080 \
  --set controller.service.nodePorts.https=30443

# Metrics Server（HPA 必装）
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# 局域网/自签证书环境下，需要给 metrics-server 关掉证书校验：
kubectl -n kube-system patch deployment metrics-server \
  --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'

kubectl top nodes   # 出现 CPU/内存数字 = 装好了
```

---

## 11. 构建并推送镜像

> 仓库提供了 7 个 Spring Boot 微服务 + 2 个 Python 网关 + 1 个 React 前端，每个目录下都有 `Dockerfile`。

### 11.1 准备一个内网镜像仓库

最快：在 `vm-master` 上跑 Docker Registry：

```bash
# 用 K8s 跑一个最小 Registry（生产用 Harbor）
kubectl create namespace registry
kubectl -n registry apply -f - <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata: {name: registry}
spec:
  replicas: 1
  selector: {matchLabels: {app: registry}}
  template:
    metadata: {labels: {app: registry}}
    spec:
      containers:
        - name: registry
          image: registry:2
          ports: [{containerPort: 5000}]
          volumeMounts: [{name: data, mountPath: /var/lib/registry}]
      volumes:
        - name: data
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata: {name: registry}
spec:
  type: NodePort
  ports: [{port: 5000, nodePort: 30500}]
  selector: {app: registry}
EOF
```

让所有节点信任此非 TLS 仓库（每台都执行）：

```bash
sudo mkdir -p /etc/containerd/certs.d/vm-master:30500
sudo tee /etc/containerd/certs.d/vm-master:30500/hosts.toml <<'EOF'
server = "http://vm-master:30500"
[host."http://vm-master:30500"]
  capabilities = ["pull", "resolve", "push"]
  skip_verify = true
EOF
sudo systemctl restart containerd
```

### 11.2 在 master 上构建镜像并推送

```bash
git clone https://github.com/L-a-L-max/UCS_Dev.git
cd UCS_Dev

REG=vm-master:30500
TAG=v1

# 1) Maven 编译
cd ucs-platform && mvn -DskipTests package && cd ..

# 2) 后端微服务镜像
for svc in ucs-api-gateway ucs-business ucs-command ucs-drone-state \
           ucs-realtime-push ucs-telemetry-ingest ucs-telemetry-store; do
  sudo docker build -t $REG/$svc:$TAG ucs-platform/$svc
  sudo docker push $REG/$svc:$TAG
done

# 3) 前端镜像
sudo docker build -t $REG/ucs-frontend:$TAG frontend/ucs-dashboard
sudo docker push $REG/ucs-frontend:$TAG

# 4) DDS 网关：用 Python slim
cat > dds-gateway/Dockerfile <<'EOF'
FROM ros:humble-ros-base
RUN apt update && apt install -y python3-pip && \
    pip install redis kafka-python pyyaml prometheus-client
WORKDIR /app
COPY . /app
ENTRYPOINT ["python3"]
EOF
sudo docker build -t $REG/dds-gateway:$TAG dds-gateway
sudo docker push $REG/dds-gateway:$TAG

# 5) Mavlink 网关
sudo docker build -t $REG/mavlink-gateway:$TAG mavlink-gateway
sudo docker push $REG/mavlink-gateway:$TAG
```

> **没有内网仓库怎么办？** 也可以 `docker save | ssh worker docker load` 一台台导，但每次升级都要再来一遍，3 台还能凑合，5 台以上就别折腾了。

---

## 12. 部署中间件（Postgres / TimescaleDB / Redis / Kafka / Nacos）

仓库 `k8s/` 目录已有 `namespace.yaml` / `configmap.yaml` / `secrets.yaml` / `microservices-deployment.yaml`，但**中间件 manifest 缺失**——下面用 Helm 一次到位。

### 12.1 创建命名空间与 Secrets

```bash
cd ~/UCS_Dev
kubectl apply -f k8s/namespace.yaml          # 命名空间 ucs

# 数据库密码（base64：echo -n 'ucs_user' | base64）
kubectl -n ucs create secret generic ucs-db-secret \
  --from-literal=username=ucs_user \
  --from-literal=password='ChangeMe-StrongPwd!2025'

# JWT 签名密钥（≥32 字节）
kubectl -n ucs create secret generic ucs-jwt-secret \
  --from-literal=secret="$(openssl rand -base64 48)"

# 镜像仓库的 imagePullSecret（如开了基础认证）
# kubectl -n ucs create secret docker-registry regcred \
#   --docker-server=vm-master:30500 ...
```

### 12.2 PostgreSQL（业务库）

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm install postgres bitnami/postgresql \
  -n ucs --create-namespace=false \
  --set auth.username=ucs_user \
  --set auth.password='ChangeMe-StrongPwd!2025' \
  --set auth.database=ucsdb \
  --set primary.persistence.size=50Gi \
  --set primary.resources.requests.memory=2Gi \
  --set primary.resources.requests.cpu=1
```

PG 启来后导入 schema：

```bash
PG_POD=$(kubectl -n ucs get pods -l app.kubernetes.io/name=postgresql -o jsonpath='{.items[0].metadata.name}')
kubectl -n ucs cp ucs-platform/sql $PG_POD:/tmp/sql
kubectl -n ucs exec -it $PG_POD -- bash -c \
  'PGPASSWORD=ChangeMe-StrongPwd!2025 psql -U ucs_user -d ucsdb -f /tmp/sql/init.sql'
```

### 12.3 TimescaleDB（遥测时序库）

```bash
# 用 Bitnami PostgreSQL 镜像 + TimescaleDB 扩展
helm install timescaledb bitnami/postgresql \
  -n ucs \
  --set image.repository=timescale/timescaledb \
  --set image.tag=2.13.0-pg14 \
  --set auth.username=ucs_user \
  --set auth.password='ChangeMe-StrongPwd!2025' \
  --set auth.database=ucs_telemetry \
  --set primary.persistence.size=200Gi \
  --set fullnameOverride=timescaledb

# 创建 hypertable
kubectl -n ucs exec -it timescaledb-0 -- bash -c \
  "PGPASSWORD=ChangeMe-StrongPwd!2025 psql -U ucs_user -d ucs_telemetry -c \
   'CREATE EXTENSION IF NOT EXISTS timescaledb;'"
```

### 12.4 Redis Sentinel（动态分片协调 + 缓存）

```bash
helm install redis bitnami/redis \
  -n ucs \
  --set architecture=replication \
  --set sentinel.enabled=true \
  --set replica.replicaCount=2 \
  --set master.persistence.size=10Gi \
  --set replica.persistence.size=10Gi \
  --set auth.password='ChangeMe-Redis-Pwd-2025'
# 客户端连法：通过 Service redis.ucs.svc.cluster.local:26379（哨兵模式）
```

### 12.5 Kafka（KRaft 3 broker）

```bash
helm install kafka bitnami/kafka \
  -n ucs \
  --set kraft.enabled=true \
  --set controller.replicaCount=3 \
  --set broker.replicaCount=0 \
  --set persistence.size=100Gi \
  --set defaultReplicationFactor=3 \
  --set offsetsTopicReplicationFactor=3 \
  --set numPartitions=16 \
  --set listeners.client.protocol=PLAINTEXT \
  --set deleteTopicEnable=true
```

> 等 `kafka-controller-0/1/2` 三个 Pod 都 `Running` 之后，建立业务 topic：

```bash
kubectl -n ucs exec -it kafka-controller-0 -- bash -c \
'kafka-topics.sh --bootstrap-server localhost:9092 --create \
  --topic dds.telemetry --partitions 16 --replication-factor 3'

kubectl -n ucs exec -it kafka-controller-0 -- bash -c \
'kafka-topics.sh --bootstrap-server localhost:9092 --create \
  --topic dds.command --partitions 16 --replication-factor 3'

kubectl -n ucs exec -it kafka-controller-0 -- bash -c \
'kafka-topics.sh --bootstrap-server localhost:9092 --create \
  --topic dds.command.ack --partitions 16 --replication-factor 3'
```

### 12.6 Nacos（可选 — 仅当后端引用了 Nacos 时启用）

```bash
helm repo add nacos-charts https://nacos.github.io/nacos-k8s/charts
helm install nacos nacos-charts/nacos \
  -n ucs \
  --set replicaCount=2 \
  --set persistence.enabled=true \
  --set persistence.size=10Gi
```

> 项目中 `ucs-platform/` 子模块的 `application.yml` 默认会读 `spring.cloud.nacos.discovery.server-addr=nacos-service:8848`。若你不打算用 Nacos，可在每个微服务启动参数里加 `-Dspring.cloud.nacos.discovery.enabled=false`，并把 `microservices-deployment.yaml` 里 `NACOS_SERVER_ADDR` 注释掉。

---

## 13. 部署 UCS 微服务

### 13.1 修改镜像地址

仓库 `k8s/microservices-deployment.yaml` 用了 `${DOCKER_REGISTRY}` 占位，需要替换：

```bash
cd ~/UCS_Dev
export DOCKER_REGISTRY=vm-master:30500
export IMAGE_TAG=v1
envsubst < k8s/microservices-deployment.yaml > /tmp/microservices.yaml
envsubst < k8s/backend-deployment.yaml > /tmp/backend.yaml
```

### 13.2 修正 ConfigMap 指向 Helm 资源

`k8s/configmap.yaml` 默认写的是 docker-compose 时代的主机名，需要改：

```bash
kubectl -n ucs apply -f - <<'EOF'
apiVersion: v1
kind: ConfigMap
metadata:
  name: ucs-common-config
  namespace: ucs
data:
  KAFKA_BOOTSTRAP: "kafka.ucs.svc.cluster.local:9092"
  REDIS_HOST: "redis.ucs.svc.cluster.local"
  REDIS_PORT: "6379"
  REDIS_SENTINEL_NODES: "redis.ucs.svc.cluster.local:26379"
  REDIS_MASTER_NAME: "mymaster"

  DB_HOST: "postgres-postgresql.ucs.svc.cluster.local"
  DB_PORT: "5432"
  DB_NAME: "ucsdb"
  SPRING_DATASOURCE_URL: "jdbc:postgresql://postgres-postgresql.ucs.svc.cluster.local:5432/ucsdb"

  TIMESCALEDB_HOST: "timescaledb.ucs.svc.cluster.local"
  TIMESCALEDB_PORT: "5432"
  TIMESCALEDB_URL: "jdbc:postgresql://timescaledb.ucs.svc.cluster.local:5432/ucs_telemetry"

  NACOS_SERVER_ADDR: "nacos.ucs.svc.cluster.local:8848"
  NACOS_NAMESPACE: "ucs-prod"
  SPRING_PROFILES_ACTIVE: "prod"
EOF
```

### 13.3 应用 manifest

```bash
kubectl apply -f /tmp/microservices.yaml
kubectl -n ucs get pods -w
```

最终应看到（每个服务多副本）：

```
NAME                                     READY   STATUS    RESTARTS
ucs-api-gateway-7c9b...-xxxxx            1/1     Running
ucs-api-gateway-7c9b...-yyyyy            1/1     Running
ucs-business-...                         1/1     Running   x2
ucs-command-...                          1/1     Running   x2
ucs-drone-state-...                      1/1     Running   x2
ucs-realtime-push-...                    1/1     Running   x2
ucs-telemetry-ingest-...                 1/1     Running   x2
ucs-telemetry-store-...                  1/1     Running   x2
```

---

## 14. 部署 DDS / Mavlink 网关

> **关键点：DDS 用 UDP 多播做发现，K8s 默认网络（CNI）不透传多播。所以这两类网关必须以 `hostNetwork: true` 跑在 Worker 节点上。**

### 14.1 DDS 网关三件套（routing / rx / tx）

新建 `k8s/dds-gateway-deployment.yaml`：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dds-routing-gateway
  namespace: ucs
spec:
  replicas: 1                       # HPA 会根据 (UAV 数 × 阈值) 调整
  selector: {matchLabels: {app: dds-routing-gateway}}
  template:
    metadata:
      labels: {app: dds-routing-gateway}
    spec:
      hostNetwork: true             # 透传 UDP 多播给 ROS2 / DDS
      dnsPolicy: ClusterFirstWithHostNet
      containers:
        - name: gateway
          image: vm-master:30500/dds-gateway:v1
          args: ["dds_gateway.py"]
          env:
            - {name: DDS_DYNAMIC_SHARDING, value: "true"}     # PR #58
            - {name: DDS_SHARD_HEARTBEAT_SEC, value: "5"}
            - {name: DDS_SHARD_TTL_SEC, value: "15"}
            - {name: REDIS_HOST,    valueFrom: {configMapKeyRef: {name: ucs-common-config, key: REDIS_HOST}}}
            - {name: REDIS_PORT,    valueFrom: {configMapKeyRef: {name: ucs-common-config, key: REDIS_PORT}}}
            - {name: REDIS_PASSWORD, valueFrom: {secretKeyRef: {name: redis, key: redis-password}}}
            - {name: KAFKA_BOOTSTRAP_SERVERS,
               valueFrom: {configMapKeyRef: {name: ucs-common-config, key: KAFKA_BOOTSTRAP}}}
            - {name: UCS_BACKEND_URL,
               value: "http://ucs-api-gateway-service.ucs.svc.cluster.local:8080"}
            - {name: ROS_DOMAIN_ID, value: "42"}
          resources:
            requests: {cpu: "500m", memory: "512Mi"}
            limits:   {cpu: "2",    memory: "2Gi"}
          livenessProbe:
            exec: {command: ["pgrep", "-f", "dds_gateway"]}
            initialDelaySeconds: 30
            periodSeconds: 10
          lifecycle:
            preStop:
              exec: {command: ["sh", "-c", "kill -TERM 1; sleep 5"]}
---
apiVersion: apps/v1
kind: Deployment
metadata: {name: dds-rx-gateway, namespace: ucs}
spec:
  replicas: 1
  selector: {matchLabels: {app: dds-rx-gateway}}
  template:
    metadata: {labels: {app: dds-rx-gateway}}
    spec:
      hostNetwork: true
      dnsPolicy: ClusterFirstWithHostNet
      containers:
        - name: gateway
          image: vm-master:30500/dds-gateway:v1
          args: ["dds_rx_gateway.py"]
          env: # 同上，加 DDS_GATEWAY_TYPE=rx
            - {name: DDS_DYNAMIC_SHARDING, value: "true"}
            - {name: DDS_GATEWAY_TYPE, value: "rx"}
            # ... (其余环境变量同 routing)
          resources: {requests: {cpu: "500m", memory: "512Mi"}, limits: {cpu: "2", memory: "2Gi"}}
---
apiVersion: apps/v1
kind: Deployment
metadata: {name: dds-tx-gateway, namespace: ucs}
spec:
  replicas: 1
  selector: {matchLabels: {app: dds-tx-gateway}}
  template:
    metadata: {labels: {app: dds-tx-gateway}}
    spec:
      hostNetwork: true
      dnsPolicy: ClusterFirstWithHostNet
      containers:
        - name: gateway
          image: vm-master:30500/dds-gateway:v1
          args: ["dds_tx_gateway.py"]
          env:
            - {name: DDS_DYNAMIC_SHARDING, value: "true"}
            - {name: DDS_GATEWAY_TYPE, value: "tx"}
            # ... (其余环境变量同上)
          resources: {requests: {cpu: "500m", memory: "512Mi"}, limits: {cpu: "2", memory: "2Gi"}}
```

```bash
kubectl apply -f k8s/dds-gateway-deployment.yaml
```

> **没有合并 PR #58 的处理**：把 `DDS_DYNAMIC_SHARDING` 改成 `false`，并显式给 `DDS_INSTANCE_ID` / `DDS_TOTAL_INSTANCES`——但这意味着不能用 HPA。

### 14.2 Mavlink 网关

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata: {name: mavlink-gateway, namespace: ucs}
spec:
  selector: {matchLabels: {app: mavlink-gateway}}
  template:
    metadata: {labels: {app: mavlink-gateway}}
    spec:
      hostNetwork: true
      dnsPolicy: ClusterFirstWithHostNet
      nodeSelector:
        ucs.io/role: mavlink-edge   # 只在打了标签的节点上跑
      containers:
        - name: gateway
          image: vm-master:30500/mavlink-gateway:v1
          ports:
            - {containerPort: 14550, protocol: UDP, hostPort: 14550}
          env:
            - {name: KAFKA_BOOTSTRAP_SERVERS,
               valueFrom: {configMapKeyRef: {name: ucs-common-config, key: KAFKA_BOOTSTRAP}}}
            - {name: UCS_BACKEND_URL,
               value: "http://ucs-api-gateway-service.ucs.svc.cluster.local:8080"}
```

```bash
kubectl label node vm-worker-2 ucs.io/role=mavlink-edge
kubectl apply -f k8s/mavlink-gateway-daemonset.yaml
```

> 用 DaemonSet + nodeSelector 把它锁在某些边缘节点是因为 PX4/无人机需要稳定的目标 IP；多副本用 K8s Service 反而会引发 UDP 会话漂移。

---

## 15. 部署前端

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: {name: ucs-frontend, namespace: ucs}
spec:
  replicas: 2
  selector: {matchLabels: {app: ucs-frontend}}
  template:
    metadata: {labels: {app: ucs-frontend}}
    spec:
      containers:
        - name: web
          image: vm-master:30500/ucs-frontend:v1
          ports: [{containerPort: 80}]
          env:
            - {name: REACT_APP_API_BASE, value: "https://ucs.example.com"}
---
apiVersion: v1
kind: Service
metadata: {name: ucs-frontend-service, namespace: ucs}
spec:
  selector: {app: ucs-frontend}
  ports: [{port: 80, targetPort: 80}]
```

```bash
kubectl apply -f k8s/frontend-deployment.yaml
```

---

## 16. Ingress / TLS / 域名

仓库 `k8s/ingress.yaml` 已写好，只需把 `ucs.example.com` 改成你的实际域名，并做好 DNS 解析到任一节点 IP（或 LB）。

### 16.1 申请 / 准备 TLS 证书

```bash
# 自签（仅测试）
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout tls.key -out tls.crt \
  -subj "/CN=ucs.example.com/O=ucs"

kubectl -n ucs create secret tls ucs-tls-secret --cert=tls.crt --key=tls.key
```

正式环境用 cert-manager + Let's Encrypt：

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
# ... 配置 ClusterIssuer 与 Ingress 注解
```

### 16.2 部署 Ingress 与前端路由

```bash
kubectl apply -f k8s/ingress.yaml
```

把 Ingress 改成同时把 `/` 路由到前端、`/api` 与 `/ws` 路由到 api-gateway：

```yaml
spec:
  rules:
    - host: ucs.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend: {service: {name: ucs-api-gateway-service, port: {number: 8080}}}
          - path: /ws
            pathType: Prefix
            backend: {service: {name: ucs-api-gateway-service, port: {number: 8080}}}
          - path: /
            pathType: Prefix
            backend: {service: {name: ucs-frontend-service,    port: {number: 80}}}
```

访问：`https://ucs.example.com:30443/`（NodePort）或在 LB 后：`https://ucs.example.com/`。

---

## 17. HPA（自动伸缩）配置

### 17.1 后端微服务（CPU 触发）

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: {name: ucs-business-hpa, namespace: ucs}
spec:
  scaleTargetRef: {apiVersion: apps/v1, kind: Deployment, name: ucs-business}
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource: {name: cpu, target: {type: Utilization, averageUtilization: 70}}
```

### 17.2 DDS Rx 网关（Kafka 消费滞后触发）

需要先装 [kube-prometheus-stack](#18-监控prometheus--grafana--loki) 和 [Prometheus Adapter](https://github.com/kubernetes-sigs/prometheus-adapter)，把 `kafka_consumergroup_lag` 暴露成 K8s 自定义指标：

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: {name: dds-rx-gateway-hpa, namespace: ucs}
spec:
  scaleTargetRef: {apiVersion: apps/v1, kind: Deployment, name: dds-rx-gateway}
  minReplicas: 1
  maxReplicas: 10
  metrics:
    - type: External
      external:
        metric:
          name: kafka_consumergroup_lag
          selector: {matchLabels: {topic: dds.telemetry, group: dds-rx-gateway}}
        target: {type: AverageValue, averageValue: "5000"}
```

> **PR #58 的核心受益点**：HPA 拉起新 Pod 时，新 Pod 自动注册到 Redis，5–15s 内整个集群完成分片重均衡，无需运维干预。

---

## 18. 监控（Prometheus + Grafana + Loki）

### 18.1 Prometheus + Grafana

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install kps prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace \
  --set grafana.adminPassword='admin' \
  --set grafana.service.type=NodePort \
  --set grafana.service.nodePort=30300

# 访问 http://vm-master:30300  (admin/admin)
```

仓库 `monitoring/` 目录有 Grafana 看板的 JSON，可以直接 import。

### 18.2 应用埋点

- Spring Boot：已暴露 `/actuator/prometheus`，`microservices-deployment.yaml` 里有 `prometheus.io/scrape: "true"` 注解，kube-prometheus-stack 自动 scrape。
- DDS 网关：默认监听 `0.0.0.0:9100/metrics`（Python `prometheus_client`）。

```yaml
# 在 dds-routing-gateway 的 spec.template.metadata.annotations 里加：
prometheus.io/scrape: "true"
prometheus.io/port:   "9100"
```

### 18.3 日志（Loki）

```bash
helm install loki grafana/loki-stack \
  -n monitoring \
  --set promtail.enabled=true
# Grafana → Explore → 选择 Loki 数据源，搜索 {namespace="ucs"} |= "ERROR"
```

---

## 19. 全链路状态验证

### 19.1 集群层面

```bash
kubectl get nodes -o wide
# 三个节点 Ready，Roles 显示 control-plane 或 <none>

kubectl get pods -A | grep -v Running | grep -v Completed
# 应该没有任何输出（除了正在 Pending 的初始化 Job）

kubectl top nodes
kubectl top pods -n ucs
# CPU/内存出现正常数值
```

### 19.2 中间件

```bash
# Postgres
kubectl -n ucs exec postgres-postgresql-0 -- psql -U ucs_user -d ucsdb -c '\dt'

# Redis
REDIS_PWD=$(kubectl -n ucs get secret redis -o jsonpath='{.data.redis-password}' | base64 -d)
kubectl -n ucs exec redis-master-0 -- redis-cli -a "$REDIS_PWD" ping
# PONG

# 看动态分片注册情况（PR #58）
kubectl -n ucs exec redis-master-0 -- redis-cli -a "$REDIS_PWD" --scan --pattern 'dds:shards:*'
# dds:shards:routing:3f2a91c8-...
# dds:shards:rx:7b1d4f00-...

# Kafka
kubectl -n ucs exec kafka-controller-0 -- bash -c \
  'kafka-topics.sh --bootstrap-server localhost:9092 --list'
# dds.telemetry  dds.command  dds.command.ack
```

### 19.3 业务接口

```bash
# 1) 健康检查
curl -k https://vm-master:30443/api/actuator/health
# {"status":"UP",...}

# 2) 登录拿 JWT
TOKEN=$(curl -ks -X POST https://vm-master:30443/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' | jq -r .token)
echo $TOKEN

# 3) 获取无人机列表
curl -ks -H "Authorization: Bearer $TOKEN" \
  https://vm-master:30443/api/uavs
```

### 19.4 端到端：模拟一架无人机

启动 PX4 SITL（在第四台机器或本地）：

```bash
# 让 SITL 把多播发到 vm-worker-2 所在网段
export ROS_DOMAIN_ID=42
ros2 run px4_ros_com sitl_offboard_velocity_control
```

观察：

```bash
# DDS 网关收到了订阅
kubectl -n ucs logs -l app=dds-routing-gateway --tail=20
# [Shard/routing] Dynamic shard coordinator started uuid=3f2a... peers=1 rank=0/1
# [Subscribe] uav_001 owned=True

# Kafka 看到遥测
kubectl -n ucs exec kafka-controller-0 -- bash -c \
  'kafka-console-consumer.sh --bootstrap-server localhost:9092 \
   --topic dds.telemetry --max-messages 3'

# 数据库写入
kubectl -n ucs exec timescaledb-0 -- psql -U ucs_user -d ucs_telemetry \
  -c 'SELECT count(*) FROM uav_telemetry;'

# 前端看一眼
浏览器访问 https://ucs.example.com:30443/，应该出现一架在动的无人机
```

### 19.5 验证动态分片自愈

```bash
# 把 routing 网关扩到 3 副本
kubectl -n ucs scale deployment/dds-routing-gateway --replicas=3
sleep 30
kubectl -n ucs exec redis-master-0 -- redis-cli -a "$REDIS_PWD" \
  --scan --pattern 'dds:shards:routing:*' | wc -l
# 输出 3

# 杀一个看是否自动接管
kubectl -n ucs delete pod -l app=dds-routing-gateway --field-selector=status.phase=Running --limit=1
# 等 15s（一个 TTL）后再扫
kubectl -n ucs exec redis-master-0 -- redis-cli -a "$REDIS_PWD" \
  --scan --pattern 'dds:shards:routing:*' | wc -l
# 输出回到 2，新 Pod 起来后又变 3
```

---

## 20. 常见故障与排查

### 20.1 节点一直 NotReady

- `kubectl describe node <name>` 看 `Conditions`：
  - `KubeletNotReady`：CNI 没装好；执行 `kubectl -n calico-system get pods`
  - `ContainerRuntimeNotReady`：containerd 没起；`sudo systemctl status containerd`
- `journalctl -u kubelet -f` 看实时日志

### 20.2 Pod CrashLoopBackOff

```bash
kubectl -n ucs logs <pod> --previous
kubectl -n ucs describe pod <pod>   # 看 Events
```

常见原因：
- 配置 ConfigMap 引用了不存在的服务名（PG/Redis/Kafka 还没起来）
- imagePullBackOff：仓库地址写错或 worker 没装 hosts.toml
- OOMKilled：把 `resources.limits.memory` 拉大

### 20.3 DDS 网关收不到无人机

1. 确认 `hostNetwork: true`，没有这个 K8s 网络一定屏蔽多播
2. `ROS_DOMAIN_ID` 要和无人机端一致
3. 多播 IP `239.255.0.1` 在节点之间是否被交换机/防火墙挡住——`tcpdump -i any 'udp port 7400 or udp port 7401'` 看
4. 如果跨子网必须互通：换 [Cyclone DDS Discovery Server](https://github.com/eclipse-cyclonedds/cyclonedds#discovery-server) 或 Zenoh-plugin-ros2dds，把多播退化为单播

### 20.4 动态分片所有实例都觉得自己 rank=0/1

- 多半是 Redis 连不通；`kubectl -n ucs exec <pod> -- python3 -c "import redis;redis.Redis('redis').ping()"`
- 或者 `DDS_DYNAMIC_SHARDING` 没设为 `true`

### 20.5 Kafka topic 创建后 producer 连不上

- 默认 Listener `PLAINTEXT://kafka:9092`，如果你的 client 走外部 Service 必须指定 `kafka-headless` 或 NodePort
- 看 `kubectl -n ucs logs kafka-controller-0` 里有没有 `BindException`

### 20.6 HPA 不工作

```bash
kubectl -n ucs get hpa
# 如果 TARGETS 列显示 "<unknown>"，说明 metrics-server 没拿到数据
kubectl top pods -n ucs    # 必须能输出
```

`<unknown>` 90% 是 metrics-server 的 `--kubelet-insecure-tls` 没加（见 10 章）。

### 20.7 PVC Pending

- `kubectl describe pvc <name>`，看是不是没有默认 StorageClass：

```bash
kubectl get sc
# local-path 必须带 (default)
```

---

## 21. 日常运维操作

### 21.1 滚动升级一个微服务

```bash
# 重新构建并推送 v2
sudo docker build -t vm-master:30500/ucs-business:v2 ucs-platform/ucs-business
sudo docker push vm-master:30500/ucs-business:v2

# 一行触发滚动更新
kubectl -n ucs set image deployment/ucs-business ucs-business=vm-master:30500/ucs-business:v2
kubectl -n ucs rollout status deployment/ucs-business
# 失败回滚
kubectl -n ucs rollout undo deployment/ucs-business
```

### 21.2 临时扩缩容

```bash
kubectl -n ucs scale deploy/dds-rx-gateway --replicas=5
```

### 21.3 优雅删除某节点

```bash
kubectl drain vm-worker-2 --ignore-daemonsets --delete-emptydir-data
# 维护完成后
kubectl uncordon vm-worker-2
```

### 21.4 备份 etcd（生产必做）

```bash
sudo ETCDCTL_API=3 etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  snapshot save /backup/etcd-$(date +%F).db
```

### 21.5 备份 Postgres

```bash
kubectl -n ucs exec postgres-postgresql-0 -- bash -c \
  'PGPASSWORD=$POSTGRES_PASSWORD pg_dump -U ucs_user -F c ucsdb' \
  > /backup/ucsdb-$(date +%F).dump
```

### 21.6 看实时日志

```bash
# 跟单个 Pod
kubectl -n ucs logs -f -l app=ucs-business

# 多 Pod 聚合（用 stern）
brew install stern   # macOS；Linux 用 wget release binary
stern -n ucs ucs-business
```

### 21.7 进 Pod 调试

```bash
kubectl -n ucs exec -it <pod-name> -- bash
# 镜像太精简没 bash？用 ephemeral container
kubectl -n ucs debug -it <pod-name> --image=nicolaka/netshoot
```

---

## 附录 A：所需端口清单

| 端口 | 协议 | 用途 | 暴露范围 |
|------|------|------|---------|
| 22 | TCP | SSH 运维 | 运维网段 |
| 6443 | TCP | kube-apiserver | 节点之间 + kubectl 客户端 |
| 2379–2380 | TCP | etcd | 节点之间（control-plane） |
| 10250 | TCP | kubelet | 节点之间 |
| 10257/10259 | TCP | controller / scheduler | 节点之间 |
| 30000–32767 | TCP | NodePort 范围 | 客户端 |
| 30080/30443 | TCP | Ingress NGINX | 公网/内网 |
| 30300 | TCP | Grafana | 运维 |
| 30500 | TCP | 内网 docker registry | 节点之间 |
| 14550 | UDP | Mavlink | 无人机网段 |
| 7400–7500 | UDP | DDS / RTPS | 节点之间（hostNetwork 时） |
| 9092 | TCP | Kafka | namespace 内 |
| 6379/26379 | TCP | Redis / Sentinel | namespace 内 |
| 5432 | TCP | PostgreSQL | namespace 内 |
| 8848 | TCP | Nacos | namespace 内 |

---

## 附录 B：环境变量速查表

> 重点只列**部署时需要按环境调整**的；其余默认值合理。

### B.1 通用（ConfigMap `ucs-common-config`）

| KEY | 推荐值 | 说明 |
|-----|--------|------|
| `KAFKA_BOOTSTRAP` | `kafka.ucs.svc:9092` | 与 Helm chart fullname 对齐 |
| `REDIS_HOST` | `redis.ucs.svc` | Sentinel 模式下也是它 |
| `REDIS_SENTINEL_NODES` | `redis.ucs.svc:26379` | 留空走主从模式 |
| `DB_HOST` | `postgres-postgresql.ucs.svc` | |
| `TIMESCALEDB_HOST` | `timescaledb.ucs.svc` | |
| `NACOS_SERVER_ADDR` | `nacos.ucs.svc:8848` | 不用 Nacos 留空 |

### B.2 DDS 网关（PR #58 后新增）

| KEY | 默认值 | 说明 |
|-----|--------|------|
| `DDS_DYNAMIC_SHARDING` | `true` | 设 `false` 回到旧静态分片 |
| `DDS_SHARD_HEARTBEAT_SEC` | `5` | 心跳/扫描周期 |
| `DDS_SHARD_TTL_SEC` | `15` | Redis key TTL（≥ 2× 心跳） |
| `DDS_GATEWAY_TYPE` | 由脚本本身决定 | 用于区分 routing/rx/tx 的 Redis key 前缀 |
| `DDS_INSTANCE_ID` | （废弃） | 仅 `DDS_DYNAMIC_SHARDING=false` 时使用 |
| `DDS_TOTAL_INSTANCES` | （废弃） | 同上 |
| `ROS_DOMAIN_ID` | `42` | 必须与无人机端一致 |
| `KAFKA_BOOTSTRAP_SERVERS` | 见 B.1 | |
| `UCS_BACKEND_URL` | `http://ucs-api-gateway-service.ucs.svc:8080` | 给 DDS 回调后端用 |

### B.3 后端微服务

| KEY | 备注 |
|-----|------|
| `SPRING_PROFILES_ACTIVE` | `prod`，对应 `application-prod.yml` |
| `JWT_SECRET` | 来自 Secret `ucs-jwt-secret` |
| `SPRING_DATASOURCE_URL` | 见 B.1 `SPRING_DATASOURCE_URL` |
| `SPRING_DATASOURCE_USERNAME` | 来自 Secret |
| `SPRING_DATASOURCE_PASSWORD` | 来自 Secret |
| `SHEDLOCK_REDIS_HOST` | 与 `REDIS_HOST` 一致 |

---

## 结语

到此你已经走完：

1. **3 台 VM 从 OS 调优 → kubeadm 集群** 完整初始化
2. **Calico CNI + local-path-provisioner + Helm + Ingress + Metrics Server** 平台基础组件
3. **Postgres / TimescaleDB / Redis / Kafka / Nacos** 中间件（Helm 一键）
4. **7 个 Spring Boot 微服务 + DDS/Mavlink 网关 + React 前端** 全部上集群
5. **HPA + 监控 + 日志** 自动伸缩与可观测
6. **状态验证 + 端到端测试 + 常见故障排查** 闭环

后续生产化的关键演进：

| 优先级 | 工作 |
|--------|------|
| 高 | 把 Postgres/Kafka/Redis 拆出 K8s 用专属 VM/RDS，K8s 只跑无状态业务 |
| 高 | 启用 cert-manager 做 TLS 自动续期 |
| 高 | etcd 离线快照 + 异地备份 |
| 中 | 接入 SSO（Keycloak/Auth0） |
| 中 | 引入 ArgoCD 做 GitOps，所有 manifest 进 git |
| 中 | DDS 跨子网时改用 Discovery Server，避免被 K8s SDN 屏蔽多播 |
| 低 | 大规模时再考虑 Nacos（参考 PR #57 / PR #58 已讨论结论：当前 Redis 自协调已够用） |

如有任何步骤卡住，先按 `第 20 章 常见故障与排查` 自查；仍不行带 `kubectl describe`/`kubectl logs --previous` 的输出来找。
