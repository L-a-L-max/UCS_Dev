# Kubernetes部署UCS服务操作文档（从零开始）

## 目录

1. [概述](#1-概述)
2. [环境准备](#2-环境准备)
3. [安装Kubernetes集群](#3-安装kubernetes集群)
4. [容器镜像构建](#4-容器镜像构建)
5. [部署DDS网关](#5-部署dds网关)
6. [部署后端服务](#6-部署后端服务)
7. [部署前端服务](#7-部署前端服务)
8. [部署中间件](#8-部署中间件)
9. [服务发现与负载均衡](#9-服务发现与负载均衡)
10. [自动扩缩容（HPA）](#10-自动扩缩容hpa)
11. [健康检查与探针](#11-健康检查与探针)
12. [监控与日志](#12-监控与日志)
13. [运维操作手册](#13-运维操作手册)
14. [常见问题排查](#14-常见问题排查)

---

## 1. 概述

### 1.1 为什么使用K8S部署

| 能力 | 说明 |
|------|------|
| **容器编排** | 自动管理所有服务的生命周期 |
| **自动扩缩容** | 根据CPU/内存/自定义指标自动调整实例数 |
| **服务发现** | 内置DNS，服务间通过名称互相访问 |
| **滚动更新** | 零停机部署，自动回滚 |
| **自愈能力** | 自动重启失败的容器，自动调度 |
| **大规模支持** | 适合100+架无人机的生产环境 |

### 1.2 整体架构

```
                    ┌─────────────────────────────────────────┐
                    │           Kubernetes Cluster             │
                    │                                         │
                    │  ┌──────────────────────────────────┐   │
                    │  │       Ingress Controller          │   │
                    │  │    (Nginx / Traefik)              │   │
                    │  └───────┬──────────┬───────────────┘   │
                    │          │          │                    │
                    │    ┌─────▼──┐  ┌───▼─────┐             │
                    │    │Frontend│  │ Backend  │             │
                    │    │ Deploy │  │ Deploy   │             │
                    │    │ (Nginx)│  │ (Spring) │             │
                    │    │ x2     │  │ x3       │             │
                    │    └────────┘  └───┬──────┘             │
                    │                    │                     │
                    │    ┌───────────────▼──────────────┐     │
                    │    │     DDS Gateway StatefulSet   │     │
                    │    │     (Python + ROS2)           │     │
                    │    │     Pods: dds-gw-0, 1, 2     │     │
                    │    └───────────────┬──────────────┘     │
                    │                    │                     │
                    │    ┌───────┐  ┌───▼────┐  ┌────────┐   │
                    │    │ Redis │  │ Kafka  │  │  MySQL │   │
                    │    │ SS x3 │  │ SS x3  │  │  SS x1 │   │
                    │    └───────┘  └────────┘  └────────┘   │
                    └─────────────────────────────────────────┘
```

---

## 2. 环境准备

### 2.1 硬件要求

| 节点角色 | CPU | 内存 | 磁盘 | 数量 |
|---------|-----|------|------|------|
| Master | 4核 | 8GB | 100GB SSD | 1（开发）/ 3（生产） |
| Worker | 4核 | 16GB | 200GB SSD | 2+ |
| DDS Worker | 4核 | 8GB | 100GB SSD | 1+（需要ROS2环境） |

### 2.2 软件要求

| 组件 | 最低版本 | 推荐版本 |
|------|---------|---------|
| 操作系统 | Ubuntu 20.04 | Ubuntu 22.04 LTS |
| Kubernetes | 1.26 | 1.28+ |
| Docker / containerd | 20.10 / 1.6 | 24.0 / 1.7 |
| kubectl | 与集群版本一致 | 1.28+ |
| Helm | 3.10 | 3.14+ |

### 2.3 安装基础工具

```bash
# 所有节点执行
sudo apt update && sudo apt install -y \
    apt-transport-https ca-certificates curl \
    gnupg lsb-release software-properties-common

# 安装kubectl
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.28/deb/Release.key | \
    sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.28/deb/ /' | \
    sudo tee /etc/apt/sources.list.d/kubernetes.list
sudo apt update && sudo apt install -y kubectl

# 安装Helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

---

## 3. 安装Kubernetes集群

### 3.1 方案选择

| 方案 | 适用场景 | 复杂度 |
|------|---------|--------|
| **kubeadm** | 生产环境 | 中 |
| **k3s** | 边缘/轻量环境 | 低 |
| **MicroK8s** | 开发/测试 | 低 |
| **云托管K8S** | 生产环境（推荐） | 低 |

### 3.2 使用kubeadm安装（生产推荐）

#### 所有节点：安装容器运行时

```bash
# 安装containerd
sudo apt install -y containerd
sudo mkdir -p /etc/containerd
containerd config default | sudo tee /etc/containerd/config.toml
sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
sudo systemctl restart containerd

# 关闭swap（K8S要求）
sudo swapoff -a
sudo sed -i '/swap/d' /etc/fstab

# 内核参数
cat <<EOF | sudo tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF
sudo modprobe overlay && sudo modprobe br_netfilter

cat <<EOF | sudo tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
sudo sysctl --system
```

#### 所有节点：安装kubeadm

```bash
sudo apt install -y kubelet kubeadm kubectl
sudo apt-mark hold kubelet kubeadm kubectl
```

#### Master节点：初始化集群

```bash
# 初始化（替换为实际IP）
sudo kubeadm init \
    --apiserver-advertise-address=<MASTER_IP> \
    --pod-network-cidr=10.244.0.0/16 \
    --service-cidr=10.96.0.0/12

# 配置kubectl
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config

# 安装网络插件（Calico）
kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.26.1/manifests/calico.yaml

# 获取join命令（Worker节点使用）
kubeadm token create --print-join-command
```

#### Worker节点：加入集群

```bash
# 使用Master输出的join命令
sudo kubeadm join <MASTER_IP>:6443 --token <TOKEN> --discovery-token-ca-cert-hash sha256:<HASH>
```

#### 验证集群

```bash
kubectl get nodes
# NAME        STATUS   ROLES           AGE   VERSION
# master-01   Ready    control-plane   5m    v1.28.x
# worker-01   Ready    <none>          3m    v1.28.x
# worker-02   Ready    <none>          3m    v1.28.x
```

### 3.3 使用k3s安装（轻量级方案）

```bash
# Master
curl -sfL https://get.k3s.io | sh -

# Worker（替换为Master IP和Token）
curl -sfL https://get.k3s.io | K3S_URL=https://<MASTER_IP>:6443 \
    K3S_TOKEN=$(sudo cat /var/lib/rancher/k3s/server/node-token) sh -
```

---

## 4. 容器镜像构建

### 4.1 创建命名空间

```bash
kubectl create namespace ucs
kubectl config set-context --current --namespace=ucs
```

### 4.2 DDS网关Dockerfile

创建 `dds-gateway/Dockerfile`：

```dockerfile
FROM ros:humble-ros-base

# 系统依赖
RUN apt-get update && apt-get install -y \
    python3-pip python3-venv git curl \
    && rm -rf /var/lib/apt/lists/*

# PX4 msgs（从源码构建或使用预编译包）
RUN mkdir -p /ros2_ws/src && cd /ros2_ws/src && \
    git clone --depth 1 https://github.com/PX4/px4_msgs.git && \
    cd /ros2_ws && \
    . /opt/ros/humble/setup.sh && \
    colcon build --packages-select px4_msgs

# 安装Python依赖
WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# 复制网关代码
COPY dds_gateway.py .
COPY nacos_registry.py .
COPY consistent_hash.py .

# 入口脚本
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 5050

ENTRYPOINT ["/docker-entrypoint.sh"]
```

创建 `dds-gateway/docker-entrypoint.sh`：

```bash
#!/bin/bash
set -e

# Source ROS2 environments
source /opt/ros/humble/setup.bash
source /ros2_ws/install/setup.bash

# Set ROS_DOMAIN_ID
export ROS_DOMAIN_ID=${ROS_DOMAIN_ID:-0}

# Extract ordinal from hostname (for StatefulSet: dds-gw-0, dds-gw-1, etc.)
if [ -z "$DDS_INSTANCE_ID" ]; then
    HOSTNAME=$(hostname)
    ORDINAL=${HOSTNAME##*-}
    export DDS_INSTANCE_ID=$ORDINAL
fi

echo "Starting DDS Gateway Instance $DDS_INSTANCE_ID"
exec python3 dds_gateway.py
```

创建 `dds-gateway/requirements.txt`：

```
requests>=2.28.0
kafka-python>=2.0.2
nacos-sdk-python>=0.1.12
sortedcontainers>=2.4.0
```

### 4.3 后端服务Dockerfile

创建 `backend/Dockerfile`：

```dockerfile
FROM maven:3.9-eclipse-temurin-17 AS builder
WORKDIR /build
COPY pom.xml .
COPY src ./src
RUN mvn clean package -DskipTests -q

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=builder /build/target/*.jar app.jar

ENV JAVA_OPTS="-Xms512m -Xmx1g -XX:+UseG1GC"
EXPOSE 8080

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
```

### 4.4 前端Dockerfile

创建 `frontend/ucs-dashboard/Dockerfile`：

```dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### 4.5 构建并推送镜像

```bash
# 使用私有镜像仓库（替换为实际地址）
REGISTRY=registry.example.com/ucs

# 构建DDS网关
docker build -t $REGISTRY/dds-gateway:latest -f dds-gateway/Dockerfile dds-gateway/
docker push $REGISTRY/dds-gateway:latest

# 构建后端
docker build -t $REGISTRY/backend:latest -f backend/Dockerfile backend/
docker push $REGISTRY/backend:latest

# 构建前端
docker build -t $REGISTRY/frontend:latest -f frontend/ucs-dashboard/Dockerfile frontend/ucs-dashboard/
docker push $REGISTRY/frontend:latest
```

---

## 5. 部署DDS网关

### 5.1 为什么使用StatefulSet

DDS网关需要：
- **稳定的网络标识**：每个Pod有固定的hostname（dds-gw-0, dds-gw-1, ...）
- **有序部署/缩容**：确保分片平稳迁移
- **稳定的持久存储**：如需存储本地缓存

### 5.2 StatefulSet配置

创建 `k8s/dds-gateway/statefulset.yaml`：

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: dds-gw
  namespace: ucs
  labels:
    app: dds-gateway
    component: ingest
spec:
  serviceName: dds-gw-headless
  replicas: 3
  podManagementPolicy: Parallel  # 并行启动所有Pod
  selector:
    matchLabels:
      app: dds-gateway
  template:
    metadata:
      labels:
        app: dds-gateway
        component: ingest
    spec:
      # 调度到有ROS2/DDS网络访问的节点
      nodeSelector:
        ucs/dds-capable: "true"
      # 反亲和：尽量分散到不同节点
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchExpressions:
                    - key: app
                      operator: In
                      values: ["dds-gateway"]
                topologyKey: kubernetes.io/hostname
      containers:
        - name: dds-gateway
          image: registry.example.com/ucs/dds-gateway:latest
          imagePullPolicy: Always
          ports:
            - name: http
              containerPort: 5050
              protocol: TCP
          env:
            - name: POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: DDS_USE_NACOS
              value: "false"  # K8S模式下不需要Nacos分片
            - name: DDS_TOTAL_INSTANCES
              value: "3"
            - name: UCS_BACKEND_URL
              value: "http://backend-svc:8080"
            - name: KAFKA_BOOTSTRAP_SERVERS
              value: "kafka-headless:9092"
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
          # 存活探针
          livenessProbe:
            httpGet:
              path: /api/health
              port: http
            initialDelaySeconds: 30
            periodSeconds: 15
            timeoutSeconds: 5
            failureThreshold: 3
          # 就绪探针
          readinessProbe:
            httpGet:
              path: /api/health
              port: http
            initialDelaySeconds: 10
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 2
          # 启动探针（给ROS2节点初始化足够时间）
          startupProbe:
            httpGet:
              path: /api/health
              port: http
            initialDelaySeconds: 5
            periodSeconds: 5
            failureThreshold: 12  # 最多等60秒
          # 使用宿主机网络（DDS需要multicast）
      hostNetwork: true
      dnsPolicy: ClusterFirstWithHostNet
```

### 5.3 Headless Service

创建 `k8s/dds-gateway/service.yaml`：

```yaml
# Headless Service（StatefulSet必需）
apiVersion: v1
kind: Service
metadata:
  name: dds-gw-headless
  namespace: ucs
  labels:
    app: dds-gateway
spec:
  clusterIP: None
  selector:
    app: dds-gateway
  ports:
    - name: http
      port: 5050
      targetPort: http

---
# ClusterIP Service（后端访问用）
apiVersion: v1
kind: Service
metadata:
  name: dds-gateway-svc
  namespace: ucs
  labels:
    app: dds-gateway
spec:
  type: ClusterIP
  selector:
    app: dds-gateway
  ports:
    - name: http
      port: 5050
      targetPort: http
```

### 5.4 Secret配置

```bash
# 创建Secret（替换为实际值）
kubectl create secret generic dds-gateway-secrets \
  --namespace=ucs \
  --from-literal=api-key=ucs-dds-gateway-secret-2024
```

### 5.5 DDS网络注意事项

DDS（Data Distribution Service）使用UDP multicast进行Topic发现。在K8S环境中需要特殊处理：

```yaml
# 方案1: hostNetwork（推荐，简单可靠）
# Pod直接使用宿主机网络，DDS multicast正常工作
spec:
  hostNetwork: true
  dnsPolicy: ClusterFirstWithHostNet

# 方案2: Multus CNI（高级方案）
# 为Pod分配额外的宿主机网络接口
# 需要安装 Multus CNI 插件
```

---

## 6. 部署后端服务

### 6.1 Deployment配置

创建 `k8s/backend/deployment.yaml`：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: ucs
  labels:
    app: backend
spec:
  replicas: 2
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
          image: registry.example.com/ucs/backend:latest
          imagePullPolicy: Always
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: SPRING_PROFILES_ACTIVE
              value: "k8s"
            - name: SPRING_DATASOURCE_URL
              value: "jdbc:mysql://mysql-svc:3306/ucs?useSSL=false&allowPublicKeyRetrieval=true"
            - name: SPRING_DATASOURCE_USERNAME
              valueFrom:
                secretKeyRef:
                  name: mysql-secrets
                  key: username
            - name: SPRING_DATASOURCE_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: mysql-secrets
                  key: password
            - name: SPRING_REDIS_HOST
              value: "redis-svc"
            - name: SPRING_REDIS_PORT
              value: "6379"
            - name: SPRING_KAFKA_BOOTSTRAP_SERVERS
              value: "kafka-headless:9092"
            - name: JAVA_OPTS
              value: "-Xms512m -Xmx1g -XX:+UseG1GC"
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              cpu: "2000m"
              memory: "2Gi"
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            initialDelaySeconds: 60
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: http
            initialDelaySeconds: 30
            periodSeconds: 10
          startupProbe:
            httpGet:
              path: /actuator/health
              port: http
            initialDelaySeconds: 10
            periodSeconds: 5
            failureThreshold: 24  # Spring Boot启动可能较慢
```

### 6.2 Service配置

创建 `k8s/backend/service.yaml`：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend-svc
  namespace: ucs
  labels:
    app: backend
spec:
  type: ClusterIP
  selector:
    app: backend
  ports:
    - name: http
      port: 8080
      targetPort: http
```

---

## 7. 部署前端服务

### 7.1 Deployment配置

创建 `k8s/frontend/deployment.yaml`：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: ucs
  labels:
    app: frontend
spec:
  replicas: 2
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
          image: registry.example.com/ucs/frontend:latest
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
```

### 7.2 Service和Ingress

创建 `k8s/frontend/service.yaml`：

```yaml
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
```

### 7.3 Ingress配置

创建 `k8s/ingress.yaml`：

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ucs-ingress
  namespace: ucs
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
    # WebSocket支持
    nginx.ingress.kubernetes.io/proxy-http-version: "1.1"
    nginx.ingress.kubernetes.io/configuration-snippet: |
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
spec:
  ingressClassName: nginx
  rules:
    - host: ucs.example.com
      http:
        paths:
          # 前端
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend-svc
                port:
                  number: 80
          # 后端API
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
```

---

## 8. 部署中间件

### 8.1 Redis部署

```bash
# 使用Helm安装Redis
helm repo add bitnami https://charts.bitnami.com/bitnami
helm install redis bitnami/redis \
  --namespace ucs \
  --set architecture=standalone \
  --set auth.enabled=false \
  --set master.resources.requests.memory=256Mi \
  --set master.resources.limits.memory=512Mi
```

### 8.2 Kafka部署

```bash
# 使用Helm安装Kafka
helm install kafka bitnami/kafka \
  --namespace ucs \
  --set replicaCount=3 \
  --set persistence.size=20Gi \
  --set resources.requests.memory=1Gi \
  --set resources.limits.memory=2Gi \
  --set listeners.client.protocol=PLAINTEXT \
  --set listeners.interbroker.protocol=PLAINTEXT
```

### 8.3 MySQL部署

```bash
# 创建Secret
kubectl create secret generic mysql-secrets \
  --namespace=ucs \
  --from-literal=username=ucs_admin \
  --from-literal=password=<MYSQL_PASSWORD> \
  --from-literal=root-password=<ROOT_PASSWORD>

# 使用Helm安装MySQL
helm install mysql bitnami/mysql \
  --namespace ucs \
  --set auth.existingSecret=mysql-secrets \
  --set auth.database=ucs \
  --set primary.persistence.size=50Gi \
  --set primary.resources.requests.memory=1Gi \
  --set primary.resources.limits.memory=2Gi
```

---

## 9. 服务发现与负载均衡

### 9.1 K8S内部服务发现

K8S通过CoreDNS自动为每个Service创建DNS记录：

```
# ClusterIP Service
backend-svc.ucs.svc.cluster.local → 后端Pod组的ClusterIP

# Headless Service（StatefulSet）
dds-gw-0.dds-gw-headless.ucs.svc.cluster.local → Pod dds-gw-0 的IP
dds-gw-1.dds-gw-headless.ucs.svc.cluster.local → Pod dds-gw-1 的IP
dds-gw-2.dds-gw-headless.ucs.svc.cluster.local → Pod dds-gw-2 的IP
```

### 9.2 DDS网关命令路由

后端向DDS网关发送命令时，需要根据无人机分片路由到正确的实例：

```yaml
# ConfigMap: 后端配置
apiVersion: v1
kind: ConfigMap
metadata:
  name: backend-config
  namespace: ucs
data:
  application-k8s.yml: |
    ucs:
      dds-gateway:
        instances:
          - url: http://dds-gw-0.dds-gw-headless:5050
          - url: http://dds-gw-1.dds-gw-headless:5050
          - url: http://dds-gw-2.dds-gw-headless:5050
        total-instances: 3
        api-key: ${DDS_GATEWAY_API_KEY}
```

---

## 10. 自动扩缩容（HPA）

### 10.1 安装Metrics Server

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

### 10.2 后端HPA

创建 `k8s/backend/hpa.yaml`：

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: backend-hpa
  namespace: ucs
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: backend
  minReplicas: 2
  maxReplicas: 6
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Pods
          value: 1
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Pods
          value: 1
          periodSeconds: 120
```

### 10.3 DDS网关扩缩容

DDS网关使用StatefulSet，不建议自动扩缩容（分片迁移需要协调）。推荐手动扩缩容：

```bash
# 扩容到5个实例
kubectl scale statefulset dds-gw --replicas=5 -n ucs

# 确认所有Pod就绪
kubectl get pods -l app=dds-gateway -n ucs -w

# 缩容（注意：从最大序号开始缩容）
kubectl scale statefulset dds-gw --replicas=3 -n ucs
```

如需自动扩缩容，结合Nacos动态分片使用（参见 [Nacos部署文档](./Nacos_DDS_Gateway_Deployment_Guide.md)）。

---

## 11. 健康检查与探针

### 11.1 探针类型说明

| 探针类型 | 作用 | 失败后果 |
|---------|------|---------|
| **startupProbe** | 检测容器是否启动完成 | 在成功前不运行其他探针 |
| **livenessProbe** | 检测容器是否存活 | 重启容器 |
| **readinessProbe** | 检测容器是否可以接收流量 | 从Service摘除，不删除 |

### 11.2 DDS网关健康端点

DDS网关的 `/api/health` 端点返回：

```json
{
    "status": "healthy",
    "instance_id": 0,
    "total_instances": 3,
    "uptime": 3600,
    "drones": ["px4_1", "px4_4", "px4_7"],
    "drone_count": 3,
    "ros2_node": "active",
    "kafka": "connected",
    "backend": "reachable"
}
```

### 11.3 后端健康端点

Spring Boot Actuator 提供：

```
GET /actuator/health          → 综合健康状态
GET /actuator/health/liveness  → 存活检查（不含外部依赖）
GET /actuator/health/readiness → 就绪检查（含DB/Redis/Kafka连接）
```

---

## 12. 监控与日志

### 12.1 安装Prometheus + Grafana

```bash
# 使用kube-prometheus-stack
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install monitoring prometheus-community/kube-prometheus-stack \
  --namespace monitoring --create-namespace \
  --set grafana.adminPassword=admin
```

### 12.2 关键监控指标

| 指标 | 来源 | 告警条件 |
|------|------|---------|
| Pod重启次数 | kube_pod_container_status_restarts_total | > 3/h |
| CPU使用率 | container_cpu_usage_seconds_total | > 80% |
| 内存使用 | container_memory_working_set_bytes | > 90% |
| 请求延迟 | http_request_duration_seconds | P99 > 500ms |
| DDS消息处理速率 | 自定义指标 | < 期望值的80% |

### 12.3 日志收集

```bash
# 查看DDS网关日志
kubectl logs -f statefulset/dds-gw -n ucs --all-containers

# 查看后端日志
kubectl logs -f deployment/backend -n ucs

# 使用EFK/Loki集中收集
helm install loki grafana/loki-stack \
  --namespace monitoring \
  --set promtail.enabled=true \
  --set loki.persistence.enabled=true
```

---

## 13. 运维操作手册

### 13.1 一键部署全部服务

```bash
#!/bin/bash
# deploy-all.sh

# 创建命名空间和Secret
kubectl create namespace ucs 2>/dev/null
kubectl create secret generic dds-gateway-secrets \
  --namespace=ucs --from-literal=api-key=ucs-dds-gateway-secret-2024 2>/dev/null
kubectl create secret generic mysql-secrets \
  --namespace=ucs --from-literal=username=ucs_admin \
  --from-literal=password=<PASSWORD> --from-literal=root-password=<ROOT_PWD> 2>/dev/null

# 部署中间件
helm install redis bitnami/redis -n ucs --set architecture=standalone --set auth.enabled=false
helm install kafka bitnami/kafka -n ucs --set replicaCount=3
helm install mysql bitnami/mysql -n ucs --set auth.existingSecret=mysql-secrets --set auth.database=ucs

# 等待中间件就绪
echo "等待中间件就绪..."
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=redis -n ucs --timeout=120s
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=kafka -n ucs --timeout=120s
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=mysql -n ucs --timeout=120s

# 部署应用
kubectl apply -f k8s/dds-gateway/
kubectl apply -f k8s/backend/
kubectl apply -f k8s/frontend/
kubectl apply -f k8s/ingress.yaml

# 等待应用就绪
echo "等待应用就绪..."
kubectl wait --for=condition=ready pod -l app=dds-gateway -n ucs --timeout=180s
kubectl wait --for=condition=ready pod -l app=backend -n ucs --timeout=180s
kubectl wait --for=condition=ready pod -l app=frontend -n ucs --timeout=120s

echo "部署完成!"
kubectl get pods -n ucs
```

### 13.2 滚动更新

```bash
# 更新DDS网关镜像
kubectl set image statefulset/dds-gw dds-gateway=registry.example.com/ucs/dds-gateway:v2.0 -n ucs

# 更新后端
kubectl set image deployment/backend backend=registry.example.com/ucs/backend:v2.0 -n ucs

# 查看滚动更新进度
kubectl rollout status statefulset/dds-gw -n ucs
kubectl rollout status deployment/backend -n ucs

# 回滚
kubectl rollout undo statefulset/dds-gw -n ucs
kubectl rollout undo deployment/backend -n ucs
```

### 13.3 日常运维命令

```bash
# 查看所有Pod状态
kubectl get pods -n ucs -o wide

# 查看资源使用
kubectl top pods -n ucs

# 进入容器调试
kubectl exec -it dds-gw-0 -n ucs -- bash

# 查看HPA状态
kubectl get hpa -n ucs

# 查看事件（排查问题）
kubectl get events -n ucs --sort-by='.lastTimestamp' | tail -20
```

---

## 14. 常见问题排查

### Q1: DDS网关Pod无法发现PX4 Topics

```
原因: DDS multicast在K8S overlay网络中不可用
解决方案:
1. 确认hostNetwork: true已启用
2. 确认DDS Worker节点可以直接访问PX4仿真网络
3. 检查ROS_DOMAIN_ID是否与PX4一致
4. 在Pod内测试: ros2 topic list
```

### Q2: 后端无法连接Kafka/Redis/MySQL

```
排查步骤:
1. kubectl get svc -n ucs  # 确认Service存在
2. kubectl exec -it backend-xxx -- nslookup kafka-headless
3. kubectl exec -it backend-xxx -- curl redis-svc:6379
4. kubectl logs backend-xxx  # 查看连接错误日志
```

### Q3: Pod频繁重启

```
排查步骤:
1. kubectl describe pod <pod-name> -n ucs  # 查看事件
2. kubectl logs <pod-name> --previous  # 查看上次崩溃日志
3. 检查资源限制是否太小（OOM Killed）
4. 检查探针配置是否合理（initialDelaySeconds是否足够）
```

### Q4: HPA不生效

```
排查步骤:
1. kubectl get hpa -n ucs  # 检查TARGETS列是否显示<unknown>
2. kubectl top pods -n ucs  # 确认metrics-server正常
3. 确认Deployment设置了resources.requests
4. kubectl describe hpa backend-hpa -n ucs  # 查看详细状态
```

### Q5: Ingress无法访问

```
排查步骤:
1. kubectl get ingress -n ucs  # 检查ADDRESS列
2. kubectl get pods -n ingress-nginx  # 确认Ingress Controller运行
3. curl -H "Host: ucs.example.com" http://<ingress-ip>  # 直接测试
4. kubectl logs -n ingress-nginx <ingress-pod>  # 查看Ingress日志
```

---

## 附录A：完整资源清单

```
k8s/
├── namespace.yaml
├── ingress.yaml
├── dds-gateway/
│   ├── statefulset.yaml
│   ├── service.yaml
│   └── secrets.yaml
├── backend/
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── hpa.yaml
│   └── configmap.yaml
├── frontend/
│   ├── deployment.yaml
│   └── service.yaml
└── middleware/
    ├── redis-values.yaml
    ├── kafka-values.yaml
    └── mysql-values.yaml
```

## 附录B：推荐资源配额

| 服务 | CPU Request | CPU Limit | Memory Request | Memory Limit | 副本数 |
|------|------------|-----------|---------------|-------------|--------|
| DDS网关 | 500m | 2000m | 512Mi | 2Gi | 3 |
| 后端 | 500m | 2000m | 1Gi | 2Gi | 2-6 |
| 前端 | 100m | 500m | 128Mi | 256Mi | 2 |
| Redis | 200m | 1000m | 256Mi | 512Mi | 1 |
| Kafka | 500m | 2000m | 1Gi | 2Gi | 3 |
| MySQL | 500m | 2000m | 1Gi | 2Gi | 1 |

## 附录C：Nacos与K8S方案对比

| 维度 | Nacos方案 | K8S方案 |
|------|----------|---------|
| **适用规模** | 10-100架无人机 | 50-1000+架无人机 |
| **运维复杂度** | 低 | 高 |
| **动态分片** | 一致性哈希环，自动迁移 | StatefulSet序号，需手动协调 |
| **自动扩缩容** | 手动启停实例即可 | HPA自动扩缩 |
| **服务发现** | Nacos注册中心 | K8S CoreDNS |
| **配置管理** | Nacos Config Center | ConfigMap / Secret |
| **部署成本** | 仅需Nacos Server | 需要完整K8S集群 |
| **推荐场景** | 中小规模、快速迭代 | 大规模生产、多服务协同 |

> **建议**：中小规模（<100架无人机）先使用Nacos方案快速上线，后续规模增长再迁移到K8S方案。两种方案可以共存：K8S管理容器编排，Nacos管理DDS网关动态分片。
