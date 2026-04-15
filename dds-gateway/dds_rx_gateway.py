#!/usr/bin/env python3
"""
DDS Rx Gateway — 接收端网关（遥测数据采集）

从PX4无人机通过ROS2/DDS订阅遥测数据，经过100ms缓冲聚合后批量发送到Kafka telemetry.raw。
与DDS Tx Gateway配合工作，实现收发分离以消除GIL竞争并支持独立扩缩容。

架构升级2.1 — T-01: DDS网关收发拆分（Rx部分）
                T-04: Rx Gateway批量发送与降频优化
                T-06: 网关连接状态存入Redis

数据流:
    PX4 Drone --DDS/ROS2--> DDS Rx Gateway --Kafka(telemetry.raw)--> Backend

Kafka Producer配置 (T-04):
    batch_size=16384, linger_ms=100, compression_type='lz4', acks=1

Redis连接状态 (T-06):
    gateway:dds:connections:{uav_id} → Hash {ros_namespace, domain_id, connected_at, gateway_type}
    TTL=60s, 每次心跳/遥测更新时刷新

Usage:
    python dds_rx_gateway.py [--backend-url URL] [--interval 0.1]

Environment Variables:
    KAFKA_BOOTSTRAP_SERVERS  Kafka brokers (default: kafka-1:9092,kafka-2:9092,kafka-3:9092)
    REDIS_HOST               Redis host (default: redis)
    REDIS_PORT               Redis port (default: 6379)
    UCS_BACKEND_URL          Backend URL for HTTP fallback
    DDS_GATEWAY_API_KEY      API key for authentication
    ROS_DOMAIN_ID            ROS2 domain ID (must match PX4 simulator)
"""

import argparse
import hashlib
import json
import logging
import math
import os
import signal
import sys
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set

import redis
import requests

# rclpy QoS imports
try:
    from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy, DurabilityPolicy
except ImportError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('dds-rx-gateway')

# ============================================================
# PX4 Topic Configuration
# ============================================================

TOPIC_SUFFIX_VARIANTS = {
    'vehicle_global_position': ['vehicle_global_position'],
    'vehicle_local_position': ['vehicle_local_position', 'vehicle_local_position_v1'],
    'vehicle_attitude': ['vehicle_attitude'],
    'vehicle_status': ['vehicle_status', 'vehicle_status_v1'],
    'battery_status': ['battery_status', 'battery_status_v1'],
    'vehicle_command_ack': ['vehicle_command_ack'],
}

ALL_KNOWN_SUFFIXES = set()
for _variants in TOPIC_SUFFIX_VARIANTS.values():
    ALL_KNOWN_SUFFIXES.update(_variants)


@dataclass
class DroneState:
    """Aggregated state for a single drone."""
    uav_id: str
    lat: float = 0.0
    lon: float = 0.0
    alt: float = 0.0
    heading: float = 0.0
    ground_speed: float = 0.0
    vertical_speed: float = 0.0
    vx: float = 0.0
    vy: float = 0.0
    vz: float = 0.0
    ned_x: float = 0.0
    ned_y: float = 0.0
    ned_z: float = 0.0
    armed: bool = False
    flight_mode: str = "UNKNOWN"
    battery_percent: float = -1.0
    last_update: float = 0.0
    msg_count: int = 0
    home_lat: float = 0.0
    home_lon: float = 0.0
    home_alt: float = 0.0
    ref_alt: float = 0.0
    ref_alt_valid: bool = False
    epoch: int = 0
    position_valid: bool = False


class DdsRxGateway:
    """
    DDS Rx Gateway — 只负责接收遥测数据并发送到Kafka。

    职责:
    1. 通过ROS2/DDS订阅PX4遥测话题 (global_position, attitude, status等)
    2. 100ms缓冲聚合 (T-04): 同一uav_id在100ms窗口内只保留最新数据
    3. 批量发送到Kafka telemetry.raw (LZ4压缩, batch_size=16384)
    4. Epoch管理: 通过Redis INCR生成递增代际ID
    5. 连接状态存入Redis (T-06): gateway:dds:connections:{uav_id}
    6. 发送事件到Kafka events.drone (上线/离线)
    """

    def __init__(self, backend_url: str, api_key: str, poll_interval: float = 0.1,
                 instance_id: int = 0, total_instances: int = 1):
        self.backend_url = backend_url.rstrip('/')
        self.api_key = api_key
        self.poll_interval = poll_interval
        self.instance_id = instance_id
        self.total_instances = total_instances

        # Drone states
        self.drone_states: Dict[str, DroneState] = {}
        self.running = False
        self._lock = threading.Lock()
        self._drone_locks: Dict[str, threading.Lock] = defaultdict(threading.Lock)
        self._stats = defaultdict(int)
        self._stats_lock = threading.Lock()
        self._last_stats_time = time.time()

        # ROS2
        self._rclpy_available = False
        self._px4_msgs_available = False
        self._node = None
        self._subscriptions: Dict[str, object] = {}

        try:
            import rclpy
            self._rclpy_available = True
        except ImportError:
            logger.error("[Init] rclpy not available")

        try:
            import px4_msgs.msg
            self._px4_msgs_available = True
        except ImportError:
            logger.warning("[Init] px4_msgs not available")

        # Epoch map (persisted in Redis)
        self._epoch_map: Dict[str, int] = {}
        self._redis_epoch_prefix = 'dds:epoch:'

        # Redis
        self._redis = None
        try:
            redis_host = os.environ.get('REDIS_HOST', 'redis')
            redis_port = int(os.environ.get('REDIS_PORT', 6379))
            redis_db = int(os.environ.get('REDIS_DB', 0))
            redis_password = os.environ.get('REDIS_PASSWORD', None)
            self._redis = redis.Redis(
                host=redis_host, port=redis_port, db=redis_db,
                password=redis_password, decode_responses=True,
                socket_connect_timeout=3, socket_timeout=2,
            )
            self._redis.ping()
            logger.info("[Redis] Connected to %s:%d db=%d", redis_host, redis_port, redis_db)
        except Exception as e:
            logger.warning("[Redis] Connection failed (%s), epoch will use memory-only", e)
            self._redis = None

        # Kafka Producer — T-04 优化配置
        self._kafka_producer = None
        self._kafka_enabled = False
        self._kafka_bootstrap = os.environ.get(
            'KAFKA_BOOTSTRAP_SERVERS', 'kafka-1:9092,kafka-2:9092,kafka-3:9092')
        self._init_kafka()

        # T-04: 100ms聚合缓冲区
        self._telemetry_buffer: Dict[str, dict] = {}
        self._buffer_lock = threading.Lock()

        # HTTP session for backend fallback
        self._http_session = requests.Session()
        self._http_session.headers.update({
            'X-Gateway-Key': api_key,
            'Content-Type': 'application/json',
        })

    # ============================================================
    # Kafka Producer (T-04: batch + LZ4 compression)
    # ============================================================

    def _init_kafka(self):
        """Initialize Kafka producer with T-04 optimized settings."""
        try:
            from kafka import KafkaProducer
            self._kafka_producer = KafkaProducer(
                bootstrap_servers=self._kafka_bootstrap,
                key_serializer=lambda k: k.encode('utf-8') if k else None,
                value_serializer=lambda v: json.dumps(v).encode('utf-8'),
                # T-04: 批量优化配置
                batch_size=16384,       # 16KB batch (aggregate small messages)
                linger_ms=100,          # 100ms linger (match buffer flush interval)
                compression_type='lz4', # LZ4 compression (fast, ~3x compression)
                # T-10: 遥测生产者 acks=1 (leader确认即可, 遥测允许少量丢失)
                acks=1,
                retries=3,
                retry_backoff_ms=100,
                max_block_ms=5000,
            )
            self._kafka_enabled = True
            logger.info("[Kafka] Producer initialized: %s (batch=16384, linger=100ms, lz4)",
                        self._kafka_bootstrap)
        except ImportError:
            logger.warning("[Kafka] kafka-python not installed")
        except Exception as e:
            logger.warning("[Kafka] Producer init failed: %s", e)

    # ============================================================
    # Multi-Instance Partitioning
    # ============================================================

    def _owns_drone(self, uav_id: str) -> bool:
        """Check if this instance owns a drone (hash-based partitioning)."""
        if self.total_instances <= 1:
            return True
        h = int(hashlib.md5(uav_id.encode('utf-8')).hexdigest(), 16)
        owner = h % self.total_instances
        return owner == self.instance_id

    # ============================================================
    # Epoch Management (persisted in Redis)
    # ============================================================

    def _get_or_increment_epoch(self, uav_id: str, is_new: bool = False) -> int:
        """Get current epoch for a drone, incrementing on reconnection."""
        redis_key = f"{self._redis_epoch_prefix}{uav_id}"

        if uav_id not in self._epoch_map and self._redis:
            try:
                stored = self._redis.get(redis_key)
                if stored is not None:
                    self._epoch_map[uav_id] = int(stored)
                    logger.info("[Epoch] Loaded %s epoch=%d from Redis",
                                uav_id, self._epoch_map[uav_id])
            except Exception as e:
                logger.warning("[Epoch] Redis GET failed for %s: %s", uav_id, e)

        if uav_id not in self._epoch_map:
            self._epoch_map[uav_id] = 1
        elif is_new:
            self._epoch_map[uav_id] += 1

        if self._redis:
            try:
                self._redis.set(redis_key, self._epoch_map[uav_id])
            except Exception as e:
                logger.warning("[Epoch] Redis SET failed for %s: %s", uav_id, e)

        return self._epoch_map[uav_id]

    def _start_epoch_maintenance(self):
        """Periodic epoch cleanup: normalize large epochs, evict stale drones."""
        EPOCH_SOFT_LIMIT = 10000
        MAX_IDLE_SECONDS = 24 * 3600
        MAINTENANCE_INTERVAL = 6 * 3600

        def _loop():
            while self.running:
                time.sleep(MAINTENANCE_INTERVAL)
                if not self.running:
                    break
                now = time.time()
                normalized = evicted = 0
                for uav_id in list(self._epoch_map.keys()):
                    state = self.drone_states.get(uav_id)
                    idle_s = (now - state.last_update) if (state and state.last_update > 0) else float('inf')
                    redis_key = f"{self._redis_epoch_prefix}{uav_id}"

                    if idle_s > MAX_IDLE_SECONDS:
                        self._epoch_map.pop(uav_id, None)
                        if self._redis:
                            try:
                                self._redis.delete(redis_key)
                            except Exception:
                                pass
                        evicted += 1
                        continue

                    epoch = self._epoch_map.get(uav_id, 0)
                    if epoch > EPOCH_SOFT_LIMIT:
                        self._epoch_map[uav_id] = 1
                        if self._redis:
                            try:
                                self._redis.set(redis_key, 1)
                            except Exception:
                                pass
                        normalized += 1

                if normalized > 0 or evicted > 0:
                    logger.info("[EpochMaint] normalized=%d, evicted=%d, remaining=%d",
                                normalized, evicted, len(self._epoch_map))

        t = threading.Thread(target=_loop, daemon=True, name='epoch-maintenance')
        t.start()

    # ============================================================
    # T-06: 网关连接状态存入Redis
    # ============================================================

    def _update_connection_state_redis(self, uav_id: str):
        """Store/refresh DDS connection state in Redis (T-06).

        Key: gateway:dds:connections:{uav_id}
        Value: Hash {ros_namespace, domain_id, connected_at, gateway_type, last_heartbeat}
        TTL: 60s (auto-expire if gateway crashes without cleanup)
        """
        if not self._redis:
            return
        try:
            key = f"gateway:dds:connections:{uav_id}"
            domain_id = os.environ.get('ROS_DOMAIN_ID', '0')
            now_iso = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            mapping = {
                'ros_namespace': f'/{uav_id}',
                'domain_id': domain_id,
                'gateway_type': 'DDS',
                'last_heartbeat': now_iso,
                'instance_id': str(self.instance_id),
            }
            # Only set connected_at on first registration
            if not self._redis.exists(key):
                mapping['connected_at'] = now_iso

            self._redis.hset(key, mapping=mapping)
            self._redis.expire(key, 60)  # TTL 60s
        except Exception as e:
            logger.debug("[Redis] Connection state update failed for %s: %s", uav_id, e)

    def _remove_connection_state_redis(self, uav_id: str):
        """Remove connection state from Redis on drone disconnect."""
        if not self._redis:
            return
        try:
            self._redis.delete(f"gateway:dds:connections:{uav_id}")
        except Exception:
            pass

    # ============================================================
    # ROS2 Node Initialization
    # ============================================================

    def _init_ros2_node(self) -> bool:
        """Initialize ROS2 node for DDS subscription."""
        try:
            import rclpy
            if not rclpy.ok():
                rclpy.init()
            self._node = rclpy.create_node(
                f'dds_rx_gateway_{self.instance_id}',
                allow_undeclared_parameters=True,
                automatically_declare_parameters_from_overrides=True
            )
            logger.info("[ROS2] Node created: %s", self._node.get_name())
            return True
        except Exception as e:
            logger.error("[ROS2] Node creation failed: %s", e)
            return False

    # ============================================================
    # Topic Discovery & Subscription (same as original gateway)
    # ============================================================

    def discover_drones_from_topics(self) -> List[str]:
        """Discover drone IDs from available ROS2 topics."""
        if not self._node:
            return []
        try:
            topics = self._node.get_topic_names_and_types()
            drone_ids = set()
            for topic_name, _ in topics:
                parts = topic_name.strip('/').split('/')
                if len(parts) >= 3 and parts[1] == 'fmu' and parts[2] == 'out':
                    drone_id = parts[0]
                    suffix = parts[3] if len(parts) > 3 else ''
                    if suffix in ALL_KNOWN_SUFFIXES:
                        drone_ids.add(drone_id)
            return sorted(drone_ids)
        except Exception as e:
            logger.error("[Discovery] Failed: %s", e)
            return []

    def subscribe_to_drone(self, uav_id: str):
        """Subscribe to all known PX4 topics for a drone."""
        if not self._px4_msgs_available or not self._node:
            return
        self._subscribe_with_px4_msgs(uav_id)

    def _subscribe_with_px4_msgs(self, uav_id: str):
        """Create ROS2 subscriptions using px4_msgs types."""
        import px4_msgs.msg as px4

        qos = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
            history=HistoryPolicy.KEEP_LAST,
            depth=5
        )

        topic_handlers = {
            'vehicle_global_position': (px4.VehicleGlobalPosition, self._on_global_position),
            'vehicle_local_position': (px4.VehicleLocalPosition, self._on_local_position),
            'vehicle_attitude': (px4.VehicleAttitude, self._on_attitude),
            'vehicle_status': (px4.VehicleStatus, self._on_vehicle_status),
            'battery_status': (px4.BatteryStatus, self._on_battery_status),
        }

        for base_topic, (msg_type, handler) in topic_handlers.items():
            variants = TOPIC_SUFFIX_VARIANTS.get(base_topic, [base_topic])
            for variant in variants:
                topic = f"/{uav_id}/fmu/out/{variant}"
                sub_key = f"{uav_id}:{variant}"
                if sub_key in self._subscriptions:
                    continue
                try:
                    def make_cb(uid, h):
                        return lambda msg: h(uid, msg)

                    sub = self._node.create_subscription(
                        msg_type, topic, make_cb(uav_id, handler), qos)
                    self._subscriptions[sub_key] = sub
                    logger.info("[Subscribe] %s (%s)", topic, msg_type.__name__)
                except Exception as e:
                    logger.debug("[Subscribe] Failed %s: %s", topic, e)

    # ============================================================
    # Telemetry Callbacks (populate drone state)
    # ============================================================

    def _on_global_position(self, uav_id: str, msg):
        """Process VehicleGlobalPosition — lat/lon/alt/heading."""
        lock = self._drone_locks[uav_id]
        with lock:
            if uav_id not in self.drone_states:
                self.drone_states[uav_id] = DroneState(uav_id=uav_id)
            s = self.drone_states[uav_id]

            lat = msg.lat if hasattr(msg, 'lat') else 0.0
            lon = msg.lon if hasattr(msg, 'lon') else 0.0

            # Skip invalid coordinates
            if lat == 0.0 and lon == 0.0:
                return

            # GPS jump detection (>1km)
            if s.position_valid:
                dlat = abs(lat - s.lat)
                dlon = abs(lon - s.lon)
                if dlat > 0.01 or dlon > 0.01:
                    logger.warning("[GPS] Jump detected for %s: (%.6f,%.6f)->(%.6f,%.6f)",
                                   uav_id, s.lat, s.lon, lat, lon)
                    with self._stats_lock:
                        self._stats[f'{uav_id}/gps_jump_rejected'] += 1
                    return

            s.lat = lat
            s.lon = lon
            s.alt = msg.alt if hasattr(msg, 'alt') else 0.0
            s.heading = math.degrees(msg.heading) if hasattr(msg, 'heading') else 0.0
            if s.heading < 0:
                s.heading += 360.0
            s.position_valid = True
            s.last_update = time.time()
            s.msg_count += 1

        with self._stats_lock:
            self._stats[f'{uav_id}/global_position'] += 1
            self._stats['total_messages'] += 1

    def _on_local_position(self, uav_id: str, msg):
        """Process VehicleLocalPosition — NED position, velocities, ref_alt."""
        lock = self._drone_locks[uav_id]
        with lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return
            s.ned_x = msg.x if hasattr(msg, 'x') else 0.0
            s.ned_y = msg.y if hasattr(msg, 'y') else 0.0
            s.ned_z = msg.z if hasattr(msg, 'z') else 0.0
            s.vx = msg.vx if hasattr(msg, 'vx') else 0.0
            s.vy = msg.vy if hasattr(msg, 'vy') else 0.0
            s.vz = msg.vz if hasattr(msg, 'vz') else 0.0
            if hasattr(msg, 'ref_alt') and msg.ref_alt > 0:
                s.ref_alt = msg.ref_alt
                s.ref_alt_valid = True
            speed_h = math.sqrt(s.vx ** 2 + s.vy ** 2)
            s.ground_speed = speed_h
            s.vertical_speed = -s.vz  # NED: vz negative = climbing
            s.last_update = time.time()
            s.msg_count += 1
        with self._stats_lock:
            self._stats[f'{uav_id}/local_position'] += 1
            self._stats['total_messages'] += 1

    def _on_attitude(self, uav_id: str, msg):
        """Process VehicleAttitude — quaternion to heading."""
        lock = self._drone_locks[uav_id]
        with lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return
            if hasattr(msg, 'q') and len(msg.q) >= 4:
                q0, q1, q2, q3 = msg.q[0], msg.q[1], msg.q[2], msg.q[3]
                yaw = math.atan2(2.0 * (q0 * q3 + q1 * q2), 1.0 - 2.0 * (q2 * q2 + q3 * q3))
                hdg = math.degrees(yaw)
                if hdg < 0:
                    hdg += 360.0
                s.heading = hdg
            s.last_update = time.time()
            s.msg_count += 1
        with self._stats_lock:
            self._stats[f'{uav_id}/attitude'] += 1
            self._stats['total_messages'] += 1

    def _on_vehicle_status(self, uav_id: str, msg):
        """Process VehicleStatus — armed state and flight mode."""
        lock = self._drone_locks[uav_id]
        with lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return
            if hasattr(msg, 'arming_state'):
                s.armed = (msg.arming_state == 2)
            if hasattr(msg, 'nav_state'):
                s.flight_mode = self._nav_state_to_mode(msg.nav_state)
            s.last_update = time.time()
            s.msg_count += 1
        with self._stats_lock:
            self._stats[f'{uav_id}/vehicle_status'] += 1
            self._stats['total_messages'] += 1

    def _on_battery_status(self, uav_id: str, msg):
        """Process BatteryStatus — battery percentage."""
        lock = self._drone_locks[uav_id]
        with lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return
            if hasattr(msg, 'remaining') and msg.remaining >= 0:
                s.battery_percent = msg.remaining * 100.0
            s.last_update = time.time()
            s.msg_count += 1
        with self._stats_lock:
            self._stats[f'{uav_id}/battery_status'] += 1
            self._stats['total_messages'] += 1

    @staticmethod
    def _nav_state_to_mode(nav_state: int) -> str:
        modes = {
            0: "MANUAL", 1: "ALTCTL", 2: "POSCTL", 3: "AUTO_MISSION",
            4: "AUTO_LOITER", 5: "AUTO_RTL", 6: "ACRO",
            14: "OFFBOARD", 15: "STABILIZED", 17: "AUTO_TAKEOFF",
            18: "AUTO_LAND", 19: "AUTO_FOLLOW_TARGET", 20: "AUTO_PRECLAND",
            21: "ORBIT",
        }
        return modes.get(nav_state, f"NAV_{nav_state}")

    # ============================================================
    # T-04: Telemetry Buffer & Batch Kafka Send
    # ============================================================

    def _flush_telemetry_buffer(self):
        """Flush aggregated telemetry buffer to Kafka (called every 100ms).

        T-04 Design:
        - Same uav_id within 100ms window keeps only the latest data
        - Reduces Kafka sends from 10K/s to ~100/s for 1000 drones
        - LZ4 compression further reduces network bandwidth
        """
        with self._buffer_lock:
            if not self._telemetry_buffer:
                return
            buffer_snapshot = dict(self._telemetry_buffer)
            self._telemetry_buffer.clear()

        if not self._kafka_enabled or not self._kafka_producer:
            return

        timestamp_ms = int(time.time() * 1000)
        send_count = 0
        for uav_id, data in buffer_snapshot.items():
            try:
                data['timestamp'] = timestamp_ms
                data['epoch'] = self._epoch_map.get(uav_id, 0)
                data['gatewayType'] = 'DDS'
                self._kafka_producer.send('telemetry.raw', key=uav_id, value=data)
                send_count += 1
            except Exception as e:
                logger.error("[Kafka] Send failed for %s: %s", uav_id, e)
                with self._stats_lock:
                    self._stats['kafka_errors'] += 1

        if send_count > 0:
            with self._stats_lock:
                self._stats['kafka_success'] += send_count
                self._stats['buffer_flushes'] += 1

    def _buffer_drone_telemetry(self, uav_id: str, drone_data: dict):
        """Add drone telemetry to the aggregation buffer.

        T-04: Within the 100ms window, only the latest data for each uav_id is kept.
        """
        with self._buffer_lock:
            self._telemetry_buffer[uav_id] = drone_data

    # ============================================================
    # Kafka Event Sending
    # ============================================================

    def send_event_to_kafka(self, event_type: str, uav_id: str, level: str, detail: str):
        """Send a drone event to events.drone Kafka topic."""
        if not self._kafka_enabled or not self._kafka_producer:
            return
        try:
            from datetime import datetime, timezone
            event = {
                'eventType': event_type,
                'uavId': uav_id,
                'level': level,
                'detail': detail,
                'timestamp': datetime.now(timezone.utc).isoformat(),
            }
            self._kafka_producer.send('events.drone', key=uav_id, value=event)
            logger.info("[Kafka] Event: %s %s %s", event_type, uav_id, detail)
        except Exception as e:
            logger.error("[Kafka] Event send failed: %s", e)

    # ============================================================
    # Backend HTTP Fallback
    # ============================================================

    def send_to_backend(self, payload: dict) -> bool:
        """Send telemetry to backend REST API (fallback when Kafka is down)."""
        try:
            resp = self._http_session.post(
                f"{self.backend_url}/api/v1/dds-gateway/telemetry",
                json=payload, timeout=5)
            if resp.status_code == 200:
                with self._stats_lock:
                    self._stats['backend_success'] += 1
                return True
            else:
                logger.error("[Backend] HTTP %d", resp.status_code)
                with self._stats_lock:
                    self._stats['backend_errors'] += 1
                return False
        except Exception as e:
            logger.error("[Backend] Send failed: %s", e)
            with self._stats_lock:
                self._stats['backend_errors'] += 1
            return False

    def check_backend_health(self) -> bool:
        endpoints = ["/api/v1/dds-gateway/health", "/actuator/health"]
        for ep in endpoints:
            try:
                resp = requests.get(f"{self.backend_url}{ep}", timeout=5)
                if resp.status_code == 200:
                    return True
            except Exception:
                pass
        return False

    # ============================================================
    # Statistics
    # ============================================================

    def log_statistics(self):
        now = time.time()
        if now - self._last_stats_time < 10:
            return
        elapsed = now - self._last_stats_time
        self._last_stats_time = now
        with self._stats_lock:
            stats_snapshot = dict(self._stats)

        logger.info("=" * 60)
        logger.info("[Stats] %.0fs | Drones: %d | Subs: %d | Kafka: ok=%d err=%d | Flushes: %d",
                    elapsed, len(self.drone_states), len(self._subscriptions),
                    stats_snapshot.get('kafka_success', 0),
                    stats_snapshot.get('kafka_errors', 0),
                    stats_snapshot.get('buffer_flushes', 0))

        with self._lock:
            uav_ids = list(self.drone_states.keys())
        for uid in uav_ids:
            lock = self._drone_locks[uid]
            with lock:
                s = self.drone_states.get(uid)
                if not s:
                    continue
                age = now - s.last_update if s.last_update > 0 else -1
                logger.info("[Stats]   %-10s msgs=%-6d lat=%.6f lon=%.6f alt=%.1f armed=%-5s mode=%-12s age=%.1fs",
                            uid, s.msg_count, s.lat, s.lon, s.alt, s.armed, s.flight_mode, age)
        logger.info("=" * 60)

    # ============================================================
    # ROS2 Spin Thread
    # ============================================================

    def _start_spin_thread(self):
        """Dedicated ROS2 spin thread for continuous DDS callback processing."""
        import rclpy

        def _spin_loop():
            logger.info("[SpinThread] Started")
            while self.running and rclpy.ok():
                try:
                    rclpy.spin_once(self._node, timeout_sec=0.01)
                except Exception as e:
                    if self.running:
                        logger.error("[SpinThread] Error: %s", e)
                        time.sleep(0.01)
            logger.info("[SpinThread] Stopped")

        t = threading.Thread(target=_spin_loop, daemon=True, name='ros2-spin')
        t.start()

    # ============================================================
    # Main Loop
    # ============================================================

    def run(self):
        """Main loop: discover drones, aggregate telemetry, flush to Kafka."""
        self.running = True
        logger.info("=" * 60)
        logger.info("[Startup] DDS Rx Gateway (Instance %d/%d)",
                    self.instance_id, self.total_instances)
        logger.info("[Startup] Backend: %s", self.backend_url)
        logger.info("[Startup] Kafka: %s", self._kafka_bootstrap)
        logger.info("[Startup] Buffer flush: 100ms | Compression: LZ4")
        logger.info("=" * 60)

        if not self._rclpy_available:
            logger.error("[Startup] ROS2 not available. Exiting.")
            return
        if not self._init_ros2_node():
            logger.error("[Startup] Failed to init ROS2 node. Exiting.")
            return

        self._start_spin_thread()
        self._start_epoch_maintenance()

        # Backend health check
        for attempt in range(3):
            if self.check_backend_health():
                break
            time.sleep(5)
        else:
            logger.warning("[Startup] Backend unreachable. Continuing anyway...")

        cycle = 0
        import rclpy

        _last_sent: Dict[str, float] = {}
        SEND_INTERVAL = 0.1       # 10Hz per drone
        DISCOVERY_INTERVAL = 5.0
        BUFFER_FLUSH_INTERVAL = 0.1  # T-04: flush buffer every 100ms
        _last_discovery = 0.0
        _last_flush = 0.0

        while self.running and rclpy.ok():
            try:
                now = time.time()

                # Discovery every ~5s
                if now - _last_discovery >= DISCOVERY_INTERVAL:
                    _last_discovery = now
                    new_drones = self.discover_drones_from_topics()
                    for uid in new_drones:
                        if not self._owns_drone(uid):
                            continue
                        is_new = uid not in self.drone_states
                        if is_new:
                            logger.info("[Discovery] NEW drone: %s", uid)
                            self.subscribe_to_drone(uid)
                            epoch = self._get_or_increment_epoch(uid, is_new=True)
                            self.drone_states[uid].epoch = epoch
                            self.send_event_to_kafka('DRONE_ONLINE', uid, 'INFO',
                                                     f'Drone {uid} connected (epoch={epoch})')
                            # T-06: Store connection state in Redis
                            self._update_connection_state_redis(uid)
                        else:
                            self.subscribe_to_drone(uid)

                # Collect telemetry into buffer (10Hz per drone)
                with self._lock:
                    uav_ids_snapshot = list(self.drone_states.keys())
                for uid in uav_ids_snapshot:
                    lock = self._drone_locks[uid]
                    with lock:
                        state = self.drone_states.get(uid)
                        if not state or not state.position_valid:
                            continue
                        if now - state.last_update > 5:
                            continue
                        last = _last_sent.get(uid, 0)
                        if now - last < SEND_INTERVAL:
                            continue
                        _last_sent[uid] = now

                        # Compute relative altitude
                        if state.ref_alt_valid and state.alt > 0:
                            rel_alt = state.alt - state.ref_alt
                        else:
                            rel_alt = -state.ned_z

                        drone_data = {
                            "uavId": state.uav_id,
                            "lat": state.lat,
                            "lon": state.lon,
                            "alt": rel_alt,
                            "altAmsl": state.alt,
                            "heading": state.heading,
                            "groundSpeed": state.ground_speed,
                            "verticalSpeed": state.vertical_speed,
                            "vx": state.vx,
                            "vy": state.vy,
                            "vz": state.vz,
                            "nedX": state.ned_x,
                            "nedY": state.ned_y,
                            "nedZ": state.ned_z,
                            "armed": state.armed,
                            "flightMode": state.flight_mode,
                            "batteryPercent": state.battery_percent,
                            "epoch": state.epoch,
                        }

                    # T-04: Buffer instead of immediate send
                    self._buffer_drone_telemetry(uid, drone_data)

                    # T-06: Refresh Redis connection state
                    self._update_connection_state_redis(uid)

                # T-04: Flush buffer every 100ms
                if now - _last_flush >= BUFFER_FLUSH_INTERVAL:
                    _last_flush = now
                    self._flush_telemetry_buffer()

                self.log_statistics()
                cycle += 1
                time.sleep(0.05)

            except KeyboardInterrupt:
                break
            except Exception as e:
                logger.error("[MainLoop] %s", e, exc_info=True)
                time.sleep(1)

        self._cleanup()
        logger.info("[Shutdown] DDS Rx Gateway stopped")

    def _cleanup(self):
        try:
            import rclpy
            if self._node:
                self._node.destroy_node()
            if rclpy.ok():
                rclpy.shutdown()
        except Exception as e:
            logger.debug("[Shutdown] %s", e)
        if self._kafka_producer:
            try:
                self._kafka_producer.flush(timeout=3)
                self._kafka_producer.close(timeout=3)
            except Exception:
                pass

    def stop(self):
        self.running = False


# ============================================================
# Health HTTP Server (for Docker healthcheck / K8s probe)
# ============================================================

def _start_health_server(gateway: DdsRxGateway, port: int = 5070):
    """Lightweight health endpoint for container orchestration."""
    from http.server import HTTPServer, BaseHTTPRequestHandler

    class HealthHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == '/api/health':
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'status': 'ok',
                    'type': 'dds-rx-gateway',
                    'drones': list(gateway.drone_states.keys()),
                    'subscriptions': len(gateway._subscriptions),
                    'instance_id': gateway.instance_id,
                }).encode())
            else:
                self.send_response(404)
                self.end_headers()

        def log_message(self, format, *args):
            logger.debug("[Health] %s", format % args)

    server = HTTPServer(('0.0.0.0', port), HealthHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True, name='health-server')
    t.start()
    logger.info("[Health] Listening on port %d", port)


def main():
    parser = argparse.ArgumentParser(description='DDS Rx Gateway — Telemetry Receiver')
    parser.add_argument('--backend-url',
                        default=os.environ.get('UCS_BACKEND_URL', 'http://localhost:8080'))
    parser.add_argument('--api-key',
                        default=os.environ.get('DDS_GATEWAY_API_KEY', 'ucs-dds-gateway-secret-2024'))
    parser.add_argument('--interval', type=float,
                        default=float(os.environ.get('DDS_POLL_INTERVAL', '0.1')))
    parser.add_argument('--instance-id', type=int,
                        default=int(os.environ.get('DDS_RX_INSTANCE_ID', '0')))
    parser.add_argument('--total-instances', type=int,
                        default=int(os.environ.get('DDS_RX_TOTAL_INSTANCES', '1')))
    parser.add_argument('--health-port', type=int,
                        default=int(os.environ.get('DDS_RX_HEALTH_PORT', '5070')))
    parser.add_argument('--verbose', '-v', action='store_true')
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    gateway = DdsRxGateway(
        backend_url=args.backend_url,
        api_key=args.api_key,
        poll_interval=args.interval,
        instance_id=args.instance_id,
        total_instances=args.total_instances,
    )

    _start_health_server(gateway, port=args.health_port)

    def signal_handler(sig, frame):
        logger.info("[Signal] %s received, stopping...", sig)
        gateway.stop()

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    gateway.run()


if __name__ == '__main__':
    main()
