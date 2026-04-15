#!/usr/bin/env bash
# ============================================================
# T-09: Kafka Topic 初始化脚本
#
# 创建所有业务 Topic，副本因子=3，min.insync.replicas=2
# 适用于 3-Broker KRaft 集群
#
# 使用方式:
#   1. 集群内: docker exec ucs-kafka-1 bash /scripts/init-kafka-topics.sh
#   2. 宿主机: BOOTSTRAP=localhost:9092 bash scripts/init-kafka-topics.sh
#   3. docker-compose-kafka.yml 中的 kafka-init 服务会自动执行
# ============================================================

set -euo pipefail

BOOTSTRAP="${BOOTSTRAP:-kafka-1:29092,kafka-2:29092,kafka-3:29092}"
KAFKA_BIN="${KAFKA_BIN:-/opt/kafka/bin}"

echo "============================================================"
echo " T-09: Kafka Topic 初始化 (replication_factor=3)"
echo " Bootstrap: ${BOOTSTRAP}"
echo "============================================================"

# Topic 定义: name:partitions:replication_factor
TOPICS=(
    "telemetry.raw:16:3"
    "commands.down:16:3"
    "commands.mavlink.down:16:3"
    "commands.ack:8:3"
    "events.drone:8:3"
)

for topic_spec in "${TOPICS[@]}"; do
    IFS=':' read -r TOPIC PARTITIONS REPLICAS <<< "${topic_spec}"
    echo ""
    echo "--- Creating topic: ${TOPIC} ---"
    echo "    Partitions: ${PARTITIONS}"
    echo "    Replication Factor: ${REPLICAS}"
    echo "    min.insync.replicas: 2"

    ${KAFKA_BIN}/kafka-topics.sh \
        --bootstrap-server "${BOOTSTRAP}" \
        --create --if-not-exists \
        --topic "${TOPIC}" \
        --partitions "${PARTITIONS}" \
        --replication-factor "${REPLICAS}" \
        --config min.insync.replicas=2 \
        --config retention.ms=604800000 \
        --config cleanup.policy=delete

    echo "    -> OK"
done

echo ""
echo "============================================================"
echo " Topic 列表:"
echo "============================================================"
${KAFKA_BIN}/kafka-topics.sh \
    --bootstrap-server "${BOOTSTRAP}" \
    --describe

echo ""
echo "============================================================"
echo " T-09: Topic 初始化完成"
echo "============================================================"
