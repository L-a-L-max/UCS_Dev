#!/bin/bash
##############################################
# UCS 一键启动脚本
#
# 功能:
#   1. 按依赖顺序启动全部服务
#   2. 每层服务启动后等待健康检查通过
#   3. 支持单实例/多实例两种模式
#   4. 支持选择性启动 (仅基础设施/仅微服务/全部)
#
# 使用方式:
#   chmod +x scripts/startup.sh
#
#   # 全部启动 (单实例模式)
#   ./scripts/startup.sh
#
#   # 全部启动 (多实例模式，Pre-K8S验证)
#   ./scripts/startup.sh --multi-instance
#
#   # 仅启动基础设施 (Kafka + Redis + DB + 监控)
#   ./scripts/startup.sh --infra-only
#
#   # 仅启动微服务 (假设基础设施已运行)
#   ./scripts/startup.sh --services-only
#
#   # 包含网关 (DDS + MAVLink)
#   ./scripts/startup.sh --with-gateways
#
#   # 停止全部
#   ./scripts/startup.sh --stop
##############################################

set -e

# ---- 颜色输出 ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ---- 项目根目录 ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# ---- 默认参数 ----
MODE="all"
MULTI_INSTANCE=false
WITH_GATEWAYS=false
WITH_SENTINEL=false
SKIP_BUILD=false

# ---- 参数解析 ----
for arg in "$@"; do
    case $arg in
        --multi-instance)   MULTI_INSTANCE=true ;;
        --infra-only)       MODE="infra" ;;
        --services-only)    MODE="services" ;;
        --with-gateways)    WITH_GATEWAYS=true ;;
        --with-sentinel)    WITH_SENTINEL=true ;;
        --skip-build)       SKIP_BUILD=true ;;
        --stop)             MODE="stop" ;;
        --help|-h)
            echo "用法: $0 [选项]"
            echo ""
            echo "选项:"
            echo "  --multi-instance   多实例模式 (每个微服务2个实例)"
            echo "  --infra-only       仅启动基础设施"
            echo "  --services-only    仅启动微服务 (需要基础设施已运行)"
            echo "  --with-gateways    同时启动 DDS/MAVLink 网关"
            echo "  --with-sentinel    启动 Redis Sentinel 集群"
            echo "  --skip-build       跳过 Maven 构建"
            echo "  --stop             停止全部服务"
            echo "  --help, -h         显示帮助"
            exit 0
            ;;
        *)
            echo -e "${RED}未知参数: $arg${NC}"
            echo "使用 --help 查看帮助"
            exit 1
            ;;
    esac
done

# ---- 工具函数 ----
log_step() {
    echo -e "\n${BLUE}=== [$1] $2 ===${NC}"
}

log_ok() {
    echo -e "${GREEN}  [OK] $1${NC}"
}

log_warn() {
    echo -e "${YELLOW}  [WARN] $1${NC}"
}

log_err() {
    echo -e "${RED}  [ERROR] $1${NC}"
}

# 等待服务健康检查
wait_for_health() {
    local service_name=$1
    local check_cmd=$2
    local max_wait=${3:-60}
    local interval=3
    local elapsed=0

    echo -n "  等待 $service_name 就绪..."
    while [ $elapsed -lt $max_wait ]; do
        if eval "$check_cmd" > /dev/null 2>&1; then
            echo -e " ${GREEN}OK${NC} (${elapsed}s)"
            return 0
        fi
        sleep $interval
        elapsed=$((elapsed + interval))
        echo -n "."
    done
    echo -e " ${RED}TIMEOUT (${max_wait}s)${NC}"
    return 1
}

# 等待 HTTP 端点可用
wait_for_http() {
    local name=$1
    local url=$2
    local max_wait=${3:-60}
    wait_for_health "$name" "curl -sf $url" "$max_wait"
}

# ================================================================
# 停止全部
# ================================================================
stop_all() {
    log_step "STOP" "停止全部 UCS 服务"

    echo "  停止微服务容器..."
    docker-compose -f docker-compose-microservices.yml down 2>/dev/null || true

    if [ "$MULTI_INSTANCE" = true ]; then
        docker-compose -f docker-compose-multi-instance-microservices.yml down 2>/dev/null || true
    fi

    echo "  停止监控栈..."
    docker-compose -f docker-compose-monitoring.yml down 2>/dev/null || true

    echo "  停止 Redis Sentinel..."
    docker-compose -f docker-compose-redis-sentinel.yml down 2>/dev/null || true

    echo "  停止 Redis Cluster..."
    docker-compose -f docker-compose-redis-cluster.yml down 2>/dev/null || true

    echo "  停止网关..."
    docker-compose -f docker-compose-gateways.yml down 2>/dev/null || true

    # 停止本地进程
    echo "  停止本地 Java 进程..."
    pkill -f "ucs-.*\.jar" 2>/dev/null || true

    echo "  停止本地前端..."
    pkill -f "vite" 2>/dev/null || true

    log_ok "全部服务已停止"
    exit 0
}

[ "$MODE" = "stop" ] && stop_all

# ================================================================
# 阶段 1: 基础设施
# ================================================================
start_infra() {
    log_step "1/6" "启动基础设施 (Kafka 3-Broker + Redis + PostgreSQL + TimescaleDB)"

    docker-compose -f docker-compose-microservices.yml up -d \
        kafka-1 kafka-2 kafka-3 postgres timescaledb redis 2>&1 | tail -5

    # 等待 Kafka 就绪
    wait_for_health "Kafka-1" \
        "docker exec ucs-kafka-1 /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:29092 --list" 90

    # 等待 PostgreSQL 就绪
    wait_for_health "PostgreSQL" \
        "docker exec ucs-postgres pg_isready -U ucs" 30

    # 等待 TimescaleDB 就绪
    wait_for_health "TimescaleDB" \
        "docker exec ucs-timescaledb pg_isready -U ucs" 30

    # 等待 Redis 就绪
    wait_for_health "Redis" \
        "docker exec ucs-redis redis-cli ping" 15

    # Kafka Topic 初始化
    log_step "1.1" "初始化 Kafka Topics"
    docker-compose -f docker-compose-microservices.yml up -d kafka-init 2>&1 | tail -3
    sleep 5

    # Kafka UI
    docker-compose -f docker-compose-microservices.yml up -d kafka-ui 2>&1 | tail -1
    log_ok "Kafka UI: http://localhost:8090"

    log_ok "基础设施启动完成"
}

# ================================================================
# 阶段 1.5: Redis Sentinel (可选)
# ================================================================
start_sentinel() {
    if [ "$WITH_SENTINEL" = true ]; then
        log_step "1.5" "启动 Redis Sentinel 集群 (3节点)"

        # 先启动 Redis Cluster (如果未运行)
        docker-compose -f docker-compose-redis-cluster.yml up -d 2>&1 | tail -3
        sleep 10

        # 启动 Sentinel
        docker-compose -f docker-compose-redis-sentinel.yml up -d 2>&1 | tail -3

        wait_for_health "Sentinel-1" \
            "docker exec redis-sentinel-1 redis-cli -p 26379 ping" 15
        wait_for_health "Sentinel-2" \
            "docker exec redis-sentinel-2 redis-cli -p 26379 ping" 15
        wait_for_health "Sentinel-3" \
            "docker exec redis-sentinel-3 redis-cli -p 26379 ping" 15

        log_ok "Redis Sentinel 集群启动完成"
        log_ok "Sentinel 端口: 26379, 26380, 26381"
    fi
}

# ================================================================
# 阶段 2: 监控栈
# ================================================================
start_monitoring() {
    log_step "2/6" "启动监控栈 (Prometheus + Grafana + Jaeger + Nacos)"

    docker-compose -f docker-compose-monitoring.yml up -d 2>&1 | tail -5

    wait_for_http "Prometheus" "http://localhost:9090/-/healthy" 30
    wait_for_http "Nacos" "http://localhost:8848/nacos" 45

    log_ok "Prometheus:  http://localhost:9090"
    log_ok "Grafana:     http://localhost:3001  (admin/ucs_admin)"
    log_ok "Jaeger:      http://localhost:16686"
    log_ok "Nacos:       http://localhost:8848  (nacos/nacos)"
    log_ok "监控栈启动完成"
}

# ================================================================
# 阶段 3: 构建微服务
# ================================================================
build_services() {
    if [ "$SKIP_BUILD" = true ]; then
        log_warn "跳过 Maven 构建 (--skip-build)"
        return
    fi

    log_step "3/6" "构建 ucs-platform 微服务"

    if [ -f "ucs-platform/pom.xml" ]; then
        cd ucs-platform
        mvn clean package -DskipTests -q 2>&1 | tail -10
        cd "$PROJECT_ROOT"
        log_ok "微服务构建完成"
    else
        log_warn "未找到 ucs-platform/pom.xml，跳过构建"
    fi
}

# ================================================================
# 阶段 4: 启动微服务
# ================================================================
start_services_single() {
    log_step "4/6" "启动微服务 (单实例模式)"

    docker-compose -f docker-compose-microservices.yml up -d \
        ucs-telemetry-ingest ucs-telemetry-store ucs-realtime-push \
        ucs-command ucs-drone-state ucs-business 2>&1 | tail -7

    echo "  等待微服务启动 (20s)..."
    sleep 20

    # 最后启动 API Gateway (依赖所有下游)
    docker-compose -f docker-compose-microservices.yml up -d ucs-api-gateway 2>&1 | tail -1

    wait_for_http "API Gateway" "http://localhost:8080/actuator/health" 30

    log_ok "微服务 (单实例) 启动完成"
}

start_services_multi() {
    log_step "4/6" "启动微服务 (多实例模式 — Pre-K8S 验证)"

    docker-compose -f docker-compose-multi-instance-microservices.yml up -d 2>&1 | tail -15

    echo "  等待多实例微服务启动 (30s)..."
    sleep 30

    log_ok "微服务 (多实例) 启动完成"
    echo ""
    echo -e "  ${YELLOW}多实例验证命令:${NC}"
    echo "  # 1. 验证 ShedLock (定时任务只在1个实例执行)"
    echo "  docker logs ucs-business-1 2>&1 | grep -i 'shedlock\\|scheduled'"
    echo "  docker logs ucs-business-2 2>&1 | grep -i 'shedlock\\|scheduled'"
    echo ""
    echo "  # 2. 验证 Kafka Consumer Group 分区分配"
    echo "  docker exec ucs-kafka-1 /opt/kafka/bin/kafka-consumer-groups.sh \\"
    echo "    --bootstrap-server kafka-1:29092 --describe --group ucs-telemetry-ingest"
    echo ""
    echo "  # 3. 故障恢复测试"
    echo "  docker stop ucs-business-1  # 停掉一个实例"
    echo "  # 验证 business-2 自动接管全部定时任务"
}

# ================================================================
# 阶段 5: 网关 (可选)
# ================================================================
start_gateways() {
    if [ "$WITH_GATEWAYS" = true ]; then
        log_step "5/6" "启动网关 (DDS + MAVLink)"

        if [ -f "docker-compose-gateways.yml" ]; then
            docker-compose -f docker-compose-gateways.yml up -d 2>&1 | tail -3
            log_ok "网关启动完成"
        else
            log_warn "docker-compose-gateways.yml 不存在，跳过网关启动"
            echo "  提示: 网关通常在宿主机直接运行 (需要 ROS2/DDS 或 MAVLink 环境)"
            echo "  DDS:     cd dds-gateway && python dds_gateway.py"
            echo "  MAVLink: cd mavlink-gateway && python mavlink_gateway.py"
        fi
    fi
}

# ================================================================
# 阶段 6: 前端
# ================================================================
start_frontend() {
    log_step "6/6" "启动前端"

    if [ -d "frontend/ucs-dashboard" ]; then
        cd frontend/ucs-dashboard
        if [ ! -d "node_modules" ]; then
            echo "  安装前端依赖..."
            npm install --silent 2>&1 | tail -3
        fi
        echo "  启动前端开发服务器..."
        nohup npm run dev > /tmp/ucs-frontend.log 2>&1 &
        cd "$PROJECT_ROOT"

        sleep 5
        wait_for_http "Frontend" "http://localhost:5173" 15 || log_warn "前端可能尚未完全启动，请手动检查"

        log_ok "前端: http://localhost:5173"
    else
        log_warn "前端目录不存在 (frontend/ucs-dashboard)，跳过"
    fi
}

# ================================================================
# 汇总输出
# ================================================================
print_summary() {
    echo ""
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN}   UCS 集群启动完成${NC}"
    echo -e "${GREEN}================================================${NC}"
    echo ""
    echo -e "  ${BLUE}服务地址:${NC}"
    echo "  ┌──────────────────┬───────────────────────────────┐"
    echo "  │ API Gateway      │ http://localhost:8080          │"
    echo "  │ Business Service │ http://localhost:8086          │"
    echo "  │ Telemetry Ingest │ http://localhost:8081          │"
    echo "  │ Telemetry Store  │ http://localhost:8082          │"
    echo "  │ Realtime Push    │ http://localhost:8083          │"
    echo "  │ Command Service  │ http://localhost:8084          │"
    echo "  │ Drone State      │ http://localhost:8085          │"
    echo "  │ Frontend         │ http://localhost:5173          │"
    echo "  ├──────────────────┼───────────────────────────────┤"
    echo "  │ Swagger UI       │ http://localhost:8086/swagger  │"
    echo "  │ Kafka UI         │ http://localhost:8090          │"
    echo "  │ Grafana          │ http://localhost:3001          │"
    echo "  │ Prometheus       │ http://localhost:9090          │"
    echo "  │ Jaeger           │ http://localhost:16686         │"
    echo "  │ Nacos            │ http://localhost:8848          │"
    echo "  └──────────────────┴───────────────────────────────┘"
    echo ""
    if [ "$MULTI_INSTANCE" = true ]; then
        echo -e "  ${YELLOW}模式: 多实例 (每服务2个实例)${NC}"
    else
        echo -e "  ${YELLOW}模式: 单实例${NC}"
    fi
    if [ "$WITH_SENTINEL" = true ]; then
        echo -e "  ${YELLOW}Redis Sentinel: 已启用 (26379/26380/26381)${NC}"
    fi
    echo ""
    echo "  停止全部: ./scripts/startup.sh --stop"
    echo ""
}

# ================================================================
# 主流程
# ================================================================
echo -e "${GREEN}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║     UCS 无人机集群控制系统            ║"
echo "  ║     一键启动脚本 v2.0                 ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "${NC}"

case $MODE in
    infra)
        start_infra
        start_sentinel
        start_monitoring
        ;;
    services)
        build_services
        if [ "$MULTI_INSTANCE" = true ]; then
            start_services_multi
        else
            start_services_single
        fi
        start_gateways
        start_frontend
        ;;
    all)
        start_infra
        start_sentinel
        start_monitoring
        build_services
        if [ "$MULTI_INSTANCE" = true ]; then
            start_services_multi
        else
            start_services_single
        fi
        start_gateways
        start_frontend
        print_summary
        ;;
esac
