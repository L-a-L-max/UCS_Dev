#!/usr/bin/env bash
# ============================================================
# T-56: TLS 证书生成脚本 (Kafka + Redis)
#
# 用途: 为 Kafka Broker 和 Redis 节点生成自签名 TLS 证书
# 运行: chmod +x generate-certs.sh && ./generate-certs.sh
#
# 生成文件:
#   ca/ca-cert.pem, ca/ca-key.pem          — CA 根证书
#   kafka/kafka-keystore.jks                — Kafka Broker 密钥库
#   kafka/kafka-truststore.jks              — Kafka 信任库
#   redis/redis-cert.pem, redis/redis-key.pem — Redis TLS 证书
#
# 生产环境请替换为正式 CA 签发的证书
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/certs"
VALIDITY_DAYS=365
KEY_SIZE=2048
CA_PASS="ca-secret-changeme"
KAFKA_PASS="kafka-secret-changeme"

echo "=== T-56: Generating TLS certificates ==="
mkdir -p "${OUTPUT_DIR}"/{ca,kafka,redis}

# ---- 1. CA 根证书 ----
echo "[1/5] Generating CA root certificate..."
openssl req -new -x509 -keyout "${OUTPUT_DIR}/ca/ca-key.pem" \
    -out "${OUTPUT_DIR}/ca/ca-cert.pem" \
    -days ${VALIDITY_DAYS} \
    -subj "/CN=UCS-CA/O=UCS/C=CN" \
    -passout "pass:${CA_PASS}" 2>/dev/null

# ---- 2. Kafka Broker 证书 ----
echo "[2/5] Generating Kafka broker keystore..."
keytool -genkeypair -alias kafka-broker \
    -keyalg RSA -keysize ${KEY_SIZE} \
    -validity ${VALIDITY_DAYS} \
    -keystore "${OUTPUT_DIR}/kafka/kafka-keystore.jks" \
    -storepass "${KAFKA_PASS}" \
    -keypass "${KAFKA_PASS}" \
    -dname "CN=kafka-broker,O=UCS,C=CN" 2>/dev/null

echo "[3/5] Signing Kafka broker certificate with CA..."
keytool -certreq -alias kafka-broker \
    -keystore "${OUTPUT_DIR}/kafka/kafka-keystore.jks" \
    -storepass "${KAFKA_PASS}" \
    -file "${OUTPUT_DIR}/kafka/kafka-broker.csr" 2>/dev/null

openssl x509 -req -CA "${OUTPUT_DIR}/ca/ca-cert.pem" \
    -CAkey "${OUTPUT_DIR}/ca/ca-key.pem" \
    -in "${OUTPUT_DIR}/kafka/kafka-broker.csr" \
    -out "${OUTPUT_DIR}/kafka/kafka-broker-signed.pem" \
    -days ${VALIDITY_DAYS} -CAcreateserial \
    -passin "pass:${CA_PASS}" 2>/dev/null

keytool -importcert -alias ca-root \
    -file "${OUTPUT_DIR}/ca/ca-cert.pem" \
    -keystore "${OUTPUT_DIR}/kafka/kafka-keystore.jks" \
    -storepass "${KAFKA_PASS}" -noprompt 2>/dev/null

keytool -importcert -alias kafka-broker \
    -file "${OUTPUT_DIR}/kafka/kafka-broker-signed.pem" \
    -keystore "${OUTPUT_DIR}/kafka/kafka-keystore.jks" \
    -storepass "${KAFKA_PASS}" -noprompt 2>/dev/null

echo "[4/5] Creating Kafka truststore..."
keytool -importcert -alias ca-root \
    -file "${OUTPUT_DIR}/ca/ca-cert.pem" \
    -keystore "${OUTPUT_DIR}/kafka/kafka-truststore.jks" \
    -storepass "${KAFKA_PASS}" -noprompt 2>/dev/null

# ---- 3. Redis TLS 证书 ----
echo "[5/5] Generating Redis TLS certificate..."
openssl genrsa -out "${OUTPUT_DIR}/redis/redis-key.pem" ${KEY_SIZE} 2>/dev/null
openssl req -new -key "${OUTPUT_DIR}/redis/redis-key.pem" \
    -out "${OUTPUT_DIR}/redis/redis.csr" \
    -subj "/CN=redis-node/O=UCS/C=CN" 2>/dev/null
openssl x509 -req -in "${OUTPUT_DIR}/redis/redis.csr" \
    -CA "${OUTPUT_DIR}/ca/ca-cert.pem" \
    -CAkey "${OUTPUT_DIR}/ca/ca-key.pem" \
    -out "${OUTPUT_DIR}/redis/redis-cert.pem" \
    -days ${VALIDITY_DAYS} -CAcreateserial \
    -passin "pass:${CA_PASS}" 2>/dev/null

# ---- 清理临时文件 ----
rm -f "${OUTPUT_DIR}"/kafka/*.csr "${OUTPUT_DIR}"/redis/*.csr "${OUTPUT_DIR}"/ca/*.srl

echo ""
echo "=== TLS certificates generated successfully ==="
echo "  CA:    ${OUTPUT_DIR}/ca/"
echo "  Kafka: ${OUTPUT_DIR}/kafka/"
echo "  Redis: ${OUTPUT_DIR}/redis/"
echo ""
echo "Next steps:"
echo "  1. Copy kafka-keystore.jks and kafka-truststore.jks to backend/src/main/resources/"
echo "  2. Set environment variables: KAFKA_SSL_KEYSTORE_PASS, KAFKA_SSL_TRUSTSTORE_PASS"
echo "  3. Uncomment TLS config in application.properties"
echo "  4. Mount redis-cert.pem and redis-key.pem into Redis container"
echo "  5. Add 'tls-cert-file' and 'tls-key-file' to Redis config"
