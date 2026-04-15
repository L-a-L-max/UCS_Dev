#!/usr/bin/env python3
"""
DDS Tx Gateway — 发送端网关（命令下发）

从Kafka commands.down消费控制命令，通过ROS2/DDS发送到PX4无人机。
与DDS Rx Gateway配合工作，实现收发分离以消除GIL竞争并支持独立扩缩容。

架构升级2.1 — T-01: DDS网关收发拆分（Tx部分）
                T-05: Tx Gateway命令优先级队列与重试
                T-06: 网关连接状态存入Redis（命令侧刷新）
                T-10: 命令生产者acks=all + 幂等

数据流:
    Backend --Kafka(commands.down)--> DDS Tx Gateway --DDS/ROS2--> PX4 Drone

T-05 命令优先级与重试:
    紧急命令 (RTL, LAND, EMERGENCY_STOP, HOLD): 最多重试3次, 100ms退避
    普通命令 (TAKEOFF, GOTO, ORBIT等): 发送一次, 不重试

Usage:
    python dds_tx_gateway.py [--backend-url URL]

Environment Variables:
    KAFKA_BOOTSTRAP_SERVERS  Kafka brokers (default: kafka-1:9092,kafka-2:9092,kafka-3:9092)
    REDIS_HOST               Redis host (default: redis)
    UCS_BACKEND_URL          Backend URL
    DDS_GATEWAY_API_KEY      API key
    ROS_DOMAIN_ID            ROS2 domain ID
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
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Optional

import redis
import requests

try:
    from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy, DurabilityPolicy
except ImportError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('dds-tx-gateway')

# T-05: 紧急命令列表 — 重试3次，100ms退避
URGENT_COMMANDS = {'RTL', 'LAND', 'EMERGENCY_STOP', 'HOLD', 'DISARM'}


@dataclass
class DroneState:
    """Minimal drone state for Tx Gateway (needed for command execution)."""
    uav_id: str
    lat: float = 0.0
    lon: float = 0.0
    alt: float = 0.0
    ned_x: float = 0.0
    ned_y: float = 0.0
    ned_z: float = 0.0
    armed: bool = False
    flight_mode: str = "UNKNOWN"
    home_lat: float = 0.0
    home_lon: float = 0.0
    home_alt: float = 0.0
    ref_alt: float = 0.0
    ref_alt_valid: bool = False
    epoch: int = 0
    last_update: float = 0.0


def _latlon_to_ned(lat, lon, alt, home_lat, home_lon, home_alt):
    EARTH_RADIUS = 6371000.0
    dlat = math.radians(lat - home_lat)
    dlon = math.radians(lon - home_lon)
    north = dlat * EARTH_RADIUS
    east = dlon * EARTH_RADIUS * math.cos(math.radians(home_lat))
    down = -(alt - home_alt)
    return north, east, down


class DdsTxGateway:
    """
    DDS Tx Gateway — 只负责消费Kafka命令并通过DDS发送给PX4。

    职责:
    1. 从Kafka commands.down消费控制命令
    2. Epoch验证: 丢弃过期命令 (msg_epoch < current_epoch)
    3. 时间戳验证: 丢弃超过60s的命令
    4. T-05 紧急命令优先级: RTL/LAND/EMERGENCY_STOP/HOLD 最多重试3次
    5. 通过ROS2/DDS将命令发送给PX4
    6. 发送ACK到Kafka commands.ack
    7. OFFBOARD心跳: 4Hz发送OffboardControlMode + TrajectorySetpoint
    """

    def __init__(self, backend_url: str, api_key: str,
                 instance_id: int = 0, total_instances: int = 1):
        self.backend_url = backend_url.rstrip('/')
        self.api_key = api_key
        self.instance_id = instance_id
        self.total_instances = total_instances

        self.drone_states: Dict[str, DroneState] = {}
        self.running = False
        self._lock = threading.Lock()
        self._drone_locks: Dict[str, threading.Lock] = defaultdict(threading.Lock)
        self._stats = defaultdict(int)
        self._stats_lock = threading.Lock()
        self._command_executor = ThreadPoolExecutor(max_workers=10, thread_name_prefix='cmd')

        # Epoch
        self._epoch_map: Dict[str, int] = {}
        self._redis_epoch_prefix = 'dds:epoch:'

        # ROS2
        self._rclpy_available = False
        self._px4_msgs_available = False
        self._node = None
        self._command_publishers = {}

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
            logger.info("[Redis] Connected to %s:%d", redis_host, redis_port)
        except Exception as e:
            logger.warning("[Redis] Connection failed: %s", e)
            self._redis = None

        # Kafka — T-10: 命令ACK生产者 acks=all + 幂等
        self._kafka_producer = None
        self._kafka_enabled = False
        self._kafka_bootstrap = os.environ.get(
            'KAFKA_BOOTSTRAP_SERVERS', 'kafka-1:9092,kafka-2:9092,kafka-3:9092')
        self._init_kafka_producer()

        # Heartbeat / Orbit state
        self._heartbeat_threads = {}
        self._heartbeat_active = {}
        self._heartbeat_setpoints = {}
        self._orbit_threads = {}
        self._orbit_active = {}

        # ROS2 Subscription for drone state (Tx needs position for GOTO/HOLD)
        self._subscriptions = {}

    # ============================================================
    # Kafka Producer (for ACK — T-10: acks=all, idempotent)
    # ============================================================

    def _init_kafka_producer(self):
        """Initialize Kafka producer for command ACKs with strong durability."""
        try:
            from kafka import KafkaProducer
            self._kafka_producer = KafkaProducer(
                bootstrap_servers=self._kafka_bootstrap,
                key_serializer=lambda k: k.encode('utf-8') if k else None,
                value_serializer=lambda v: json.dumps(v).encode('utf-8'),
                # T-10: 命令生产者配置 — 强一致性
                acks='all',              # 所有ISR副本确认
                retries=5,               # 重试5次
                retry_backoff_ms=200,    # 200ms退避
                enable_idempotence=True, # 幂等生产者（防止重复）
                max_block_ms=5000,
            )
            self._kafka_enabled = True
            logger.info("[Kafka] ACK Producer initialized (acks=all, idempotent)")
        except ImportError:
            logger.warning("[Kafka] kafka-python not installed")
        except Exception as e:
            logger.warning("[Kafka] Producer init failed: %s", e)

    # ============================================================
    # Kafka Command Consumer
    # ============================================================

    def _start_kafka_command_consumer(self):
        """Start consuming from commands.down topic.

        T-05: Urgent commands get priority processing + retry.
        """
        if not self._kafka_enabled:
            logger.info("[KafkaCmd] Kafka not enabled, skipping consumer")
            return

        try:
            from kafka import KafkaConsumer as _KafkaConsumer
            consumer = _KafkaConsumer(
                'commands.down',
                bootstrap_servers=self._kafka_bootstrap,
                group_id=f'dds-tx-gateway-{self.instance_id}',
                value_deserializer=lambda v: json.loads(v.decode('utf-8')),
                auto_offset_reset='latest',
                max_poll_records=1,       # Process one command at a time
                enable_auto_commit=True,
                consumer_timeout_ms=1000,
            )
            logger.info("[KafkaCmd] Consumer initialized for commands.down")
        except Exception as e:
            logger.warning("[KafkaCmd] Consumer creation failed: %s", e)
            return

        def _consume_loop():
            logger.info("[KafkaCmd] Consumer thread started")
            while self.running:
                try:
                    records = consumer.poll(timeout_ms=1000)
                    for tp, messages in records.items():
                        for msg in messages:
                            try:
                                self._process_command_message(msg.value)
                            except Exception as e:
                                logger.error("[KafkaCmd] Processing error: %s", e)
                except Exception as e:
                    if self.running:
                        logger.error("[KafkaCmd] Poll error: %s", e)
                        time.sleep(1)
            try:
                consumer.close()
            except Exception:
                pass
            logger.info("[KafkaCmd] Consumer stopped")

        t = threading.Thread(target=_consume_loop, daemon=True, name='kafka-cmd-consumer')
        t.start()

    def _process_command_message(self, data: dict):
        """Process a single command message from Kafka.

        T-05: Urgent commands (RTL, LAND, EMERGENCY_STOP, HOLD) retry up to 3 times.
        """
        uav_id = data.get('uavId', '')
        command_type = data.get('commandType', '').upper()
        params_raw = data.get('params', '{}')
        if isinstance(params_raw, str):
            params = json.loads(params_raw) if params_raw else {}
        else:
            params = params_raw

        # Filter: only DDS drones (not mavlink_ prefix)
        if uav_id.startswith('mavlink_'):
            return

        # Multi-instance partitioning
        if not self._owns_drone(uav_id):
            return

        # Epoch validation
        msg_epoch = data.get('epoch', 0)
        current_epoch = self._epoch_map.get(uav_id, 0)
        if current_epoch > 0 and msg_epoch > 0 and msg_epoch < current_epoch:
            logger.warning("[KafkaCmd] Stale command: %s -> %s epoch=%d < %d",
                           command_type, uav_id, msg_epoch, current_epoch)
            return

        # Timestamp validation (60s window)
        ts_str = data.get('timestamp', '')
        if ts_str:
            try:
                msg_time = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
                age = (datetime.now(timezone.utc) - msg_time).total_seconds()
                if age > 60:
                    logger.warning("[KafkaCmd] Expired: %s -> %s age=%.1fs",
                                   command_type, uav_id, age)
                    return
            except (ValueError, TypeError):
                pass

        logger.info("[KafkaCmd] Processing: %s -> %s params=%s", command_type, uav_id, params)

        # T-05: 紧急命令重试逻辑
        max_retries = 3 if command_type in URGENT_COMMANDS else 1
        result = None

        for attempt in range(max_retries):
            result = self.handle_command(uav_id, command_type, params)
            success = result.get('success', False) if isinstance(result, dict) else False

            if success:
                break

            if attempt < max_retries - 1:
                logger.warning("[KafkaCmd] Retry %d/%d for urgent %s -> %s",
                               attempt + 1, max_retries, command_type, uav_id)
                time.sleep(0.1 * (attempt + 1))  # 100ms, 200ms, 300ms backoff

        # Send ACK
        command_log_id = data.get('commandLogId', 0)
        epoch = data.get('epoch', 0)
        self._send_command_ack(uav_id, command_type, epoch, command_log_id, result)

        with self._stats_lock:
            self._stats['commands_processed'] += 1

    # ============================================================
    # Command ACK
    # ============================================================

    def _send_command_ack(self, uav_id: str, command_type: str, epoch: int,
                          command_log_id, result: dict):
        if not self._kafka_enabled or not self._kafka_producer:
            return
        try:
            success = result.get('success', False) if isinstance(result, dict) else False
            detail = result.get('message', '') if isinstance(result, dict) else str(result)
            ack = {
                'uavId': uav_id,
                'command': command_type,
                'success': success,
                'detail': detail,
                'epoch': epoch,
                'commandId': command_log_id,
                'timestamp': datetime.now(timezone.utc).isoformat(),
            }
            self._kafka_producer.send('commands.ack', key=uav_id, value=ack)
            logger.info("[ACK] %s -> %s success=%s", command_type, uav_id, success)
        except Exception as e:
            logger.error("[ACK] Send failed: %s", e)

    # ============================================================
    # Multi-Instance & Epoch
    # ============================================================

    def _owns_drone(self, uav_id: str) -> bool:
        if self.total_instances <= 1:
            return True
        h = int(hashlib.md5(uav_id.encode('utf-8')).hexdigest(), 16)
        return (h % self.total_instances) == self.instance_id

    def _load_epoch(self, uav_id: str):
        """Load epoch from Redis into local cache."""
        if uav_id in self._epoch_map:
            return
        if self._redis:
            try:
                stored = self._redis.get(f"{self._redis_epoch_prefix}{uav_id}")
                if stored is not None:
                    self._epoch_map[uav_id] = int(stored)
            except Exception:
                pass

    # ============================================================
    # ROS2 Node & Publishers
    # ============================================================

    def _init_ros2_node(self) -> bool:
        try:
            import rclpy
            if not rclpy.ok():
                rclpy.init()
            self._node = rclpy.create_node(f'dds_tx_gateway_{self.instance_id}')
            logger.info("[ROS2] Node created: %s", self._node.get_name())
            return True
        except Exception as e:
            logger.error("[ROS2] Node creation failed: %s", e)
            return False

    def _extract_system_id(self, uav_id: str) -> int:
        try:
            parts = uav_id.split('_')
            if len(parts) >= 2 and parts[-1].isdigit():
                return int(parts[-1])
        except (ValueError, IndexError):
            pass
        return 1

    def _get_or_create_publisher(self, topic: str, msg_type):
        if topic not in self._command_publishers:
            self._command_publishers[topic] = self._node.create_publisher(msg_type, topic, 10)
        return self._command_publishers[topic]

    def publish_vehicle_command(self, uav_id: str, command: int, param1: float = 0.0,
                                 param2: float = 0.0, param3: float = 0.0,
                                 param5: float = 0.0, param6: float = 0.0,
                                 param7: float = 0.0) -> bool:
        if not self._rclpy_available or not self._px4_msgs_available or not self._node:
            return False
        try:
            import px4_msgs.msg as px4
            topic = f"/{uav_id}/fmu/in/vehicle_command"
            pub = self._get_or_create_publisher(topic, px4.VehicleCommand)
            target_sys = self._extract_system_id(uav_id)

            msg = px4.VehicleCommand()
            msg.command = command
            msg.param1 = param1
            msg.param2 = param2
            msg.param3 = param3
            msg.param5 = param5
            msg.param6 = param6
            msg.param7 = param7
            msg.target_system = target_sys
            msg.target_component = 1
            msg.source_system = 255
            msg.source_component = 190
            msg.from_external = True
            msg.timestamp = int(time.time() * 1e6)

            pub.publish(msg)
            logger.info("[Command] VehicleCommand cmd=%d -> %s (sys=%d)",
                        command, uav_id, target_sys)
            return True
        except Exception as e:
            logger.error("[Command] Publish failed: %s", e)
            return False

    def publish_offboard_control_mode(self, uav_id: str, position: bool = True) -> bool:
        if not self._rclpy_available or not self._px4_msgs_available or not self._node:
            return False
        try:
            import px4_msgs.msg as px4
            topic = f"/{uav_id}/fmu/in/offboard_control_mode"
            pub = self._get_or_create_publisher(topic, px4.OffboardControlMode)
            msg = px4.OffboardControlMode()
            msg.position = position
            msg.velocity = False
            msg.acceleration = False
            msg.attitude = False
            msg.body_rate = False
            msg.timestamp = int(time.time() * 1e6)
            pub.publish(msg)
            return True
        except Exception as e:
            logger.error("[Command] OffboardControlMode failed: %s", e)
            return False

    def publish_trajectory_setpoint(self, uav_id: str, x: float, y: float, z: float,
                                      yaw: float = float('nan'), log: bool = False) -> bool:
        if not self._rclpy_available or not self._px4_msgs_available or not self._node:
            return False
        try:
            import px4_msgs.msg as px4
            topic = f"/{uav_id}/fmu/in/trajectory_setpoint"
            pub = self._get_or_create_publisher(topic, px4.TrajectorySetpoint)
            msg = px4.TrajectorySetpoint()
            msg.position = [x, y, z]
            msg.yaw = yaw
            msg.timestamp = int(time.time() * 1e6)
            pub.publish(msg)
            if log:
                logger.info("[Setpoint] [%.2f, %.2f, %.2f] -> %s", x, y, z, uav_id)
            return True
        except Exception as e:
            logger.error("[Setpoint] Failed: %s", e)
            return False

    # ============================================================
    # ROS2 State Subscription (Tx needs drone position for GOTO/HOLD)
    # ============================================================

    def _subscribe_drone_state(self, uav_id: str):
        """Subscribe to key topics for command execution context."""
        if not self._px4_msgs_available or not self._node:
            return

        import px4_msgs.msg as px4
        qos = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
            history=HistoryPolicy.KEEP_LAST, depth=5)

        for variant in ['vehicle_global_position']:
            topic = f"/{uav_id}/fmu/out/{variant}"
            sub_key = f"{uav_id}:{variant}"
            if sub_key in self._subscriptions:
                continue
            try:
                def make_cb(uid):
                    return lambda msg: self._on_position(uid, msg)
                sub = self._node.create_subscription(
                    px4.VehicleGlobalPosition, topic, make_cb(uav_id), qos)
                self._subscriptions[sub_key] = sub
            except Exception:
                pass

        for variant in ['vehicle_local_position', 'vehicle_local_position_v1']:
            topic = f"/{uav_id}/fmu/out/{variant}"
            sub_key = f"{uav_id}:{variant}"
            if sub_key in self._subscriptions:
                continue
            try:
                def make_cb_local(uid):
                    return lambda msg: self._on_local_position(uid, msg)
                sub = self._node.create_subscription(
                    px4.VehicleLocalPosition, topic, make_cb_local(uav_id), qos)
                self._subscriptions[sub_key] = sub
            except Exception:
                pass

    def _on_position(self, uav_id: str, msg):
        lock = self._drone_locks[uav_id]
        with lock:
            if uav_id not in self.drone_states:
                self.drone_states[uav_id] = DroneState(uav_id=uav_id)
            s = self.drone_states[uav_id]
            lat = msg.lat if hasattr(msg, 'lat') else 0.0
            lon = msg.lon if hasattr(msg, 'lon') else 0.0
            if lat == 0.0 and lon == 0.0:
                return
            s.lat = lat
            s.lon = lon
            s.alt = msg.alt if hasattr(msg, 'alt') else 0.0
            s.last_update = time.time()

    def _on_local_position(self, uav_id: str, msg):
        lock = self._drone_locks[uav_id]
        with lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return
            s.ned_x = msg.x if hasattr(msg, 'x') else 0.0
            s.ned_y = msg.y if hasattr(msg, 'y') else 0.0
            s.ned_z = msg.z if hasattr(msg, 'z') else 0.0
            if hasattr(msg, 'ref_alt') and msg.ref_alt > 0:
                s.ref_alt = msg.ref_alt
                s.ref_alt_valid = True
            s.last_update = time.time()

    # ============================================================
    # Home Position Helpers
    # ============================================================

    def _save_home_position(self, uav_id: str) -> bool:
        with self._lock:
            state = self.drone_states.get(uav_id)
            if state and state.lat != 0.0:
                state.home_lat = state.lat
                state.home_lon = state.lon
                state.home_alt = state.alt
                return True
        return False

    def _get_home_position(self, uav_id: str):
        with self._lock:
            state = self.drone_states.get(uav_id)
            if state and state.home_lat != 0.0:
                return state.home_lat, state.home_lon, state.home_alt
        return None

    # ============================================================
    # Command Handling (mirrors original DDS gateway)
    # ============================================================

    def handle_command(self, uav_id: str, command_type: str, params: dict) -> dict:
        command_type = command_type.upper()
        logger.info("[Command] %s -> %s params=%s", command_type, uav_id, params)

        # Ensure we have state subscription for this drone
        self._subscribe_drone_state(uav_id)
        self._load_epoch(uav_id)

        ok = False

        if command_type == 'TAKEOFF':
            relative_alt = float(params.get('altitude', params.get('defaultAltitude', 5.0)))
            target_z = -relative_alt
            self._save_home_position(uav_id)
            self.publish_vehicle_command(uav_id, command=179, param1=1.0)
            self.start_offboard_heartbeat(uav_id, target_z=target_z)
            time.sleep(0.5)
            ok = self.publish_vehicle_command(uav_id, command=400, param1=1.0, param2=0.0)
            if ok:
                def _offboard():
                    time.sleep(1.0)
                    self.publish_vehicle_command(uav_id, command=176, param1=1.0, param2=6.0)
                threading.Thread(target=_offboard, daemon=True).start()

        elif command_type == 'LAND':
            self.stop_offboard_heartbeat(uav_id)
            lat = float(params.get('lat', 0))
            lon = float(params.get('lon', 0))
            alt = float(params.get('alt', 0))
            if lat != 0 and lon != 0:
                ok = self.publish_vehicle_command(uav_id, command=21, param5=lat, param6=lon, param7=alt)
            else:
                ok = self.publish_vehicle_command(uav_id, command=21)

        elif command_type == 'RTL':
            self.stop_offboard_heartbeat(uav_id)
            lat = float(params.get('lat', 0))
            lon = float(params.get('lon', 0))
            if lat != 0 and lon != 0:
                alt = float(params.get('alt', 0))
                self.publish_vehicle_command(uav_id, command=179, param1=0.0,
                                             param5=lat, param6=lon, param7=alt)
                time.sleep(0.3)
            ok = self.publish_vehicle_command(uav_id, command=20)

        elif command_type == 'HOLD':
            self.stop_orbit_heartbeat(uav_id)
            with self._lock:
                state = self.drone_states.get(uav_id)
            if state:
                hold_x = state.ned_x
                hold_y = state.ned_y
                hold_z = state.ned_z if state.ned_z != 0.0 else -5.0
                self.start_offboard_heartbeat(uav_id, target_z=hold_z,
                                               target_x=hold_x, target_y=hold_y)
                ok = self.publish_vehicle_command(uav_id, command=176, param1=1.0, param2=6.0)
            else:
                ok = self.publish_vehicle_command(uav_id, command=17)

        elif command_type == 'GOTO':
            self.stop_orbit_heartbeat(uav_id)
            lat = float(params.get('lat', 0))
            lon = float(params.get('lon', 0))
            alt = float(params.get('alt', 5.0))

            home = self._get_home_position(uav_id)
            if home:
                home_lat, home_lon, home_alt = home
                target_n, target_e, _ = _latlon_to_ned(lat, lon, home_alt + alt,
                                                        home_lat, home_lon, home_alt)
                target_z = -alt
                with self._lock:
                    state = self.drone_states.get(uav_id)
                cur_n = state.ned_x if state else 0.0
                cur_e = state.ned_y if state else 0.0
                delta_n = target_n - cur_n
                delta_e = target_e - cur_e
                dist = math.sqrt(delta_n ** 2 + delta_e ** 2)
                target_yaw = math.atan2(delta_e, delta_n) if dist > 0.5 else float('nan')

                self.start_offboard_heartbeat(uav_id, target_z=target_z,
                                               target_x=target_n, target_y=target_e,
                                               target_yaw=target_yaw)
                ok = self.publish_vehicle_command(uav_id, command=176, param1=1.0, param2=6.0)
            else:
                target_z = -alt
                self.start_offboard_heartbeat(uav_id, target_z=target_z)
                ok = self.publish_vehicle_command(uav_id, command=176, param1=1.0, param2=6.0)

        elif command_type == 'MARK_HOME':
            lat = float(params.get('lat', 0))
            lon = float(params.get('lon', 0))
            alt = float(params.get('alt', 0))
            if lat != 0 and lon != 0:
                ok = self.publish_vehicle_command(uav_id, command=179, param1=0.0,
                                                  param5=lat, param6=lon, param7=alt)
                if ok:
                    with self._lock:
                        state = self.drone_states.get(uav_id)
                        if state:
                            state.home_lat = lat
                            state.home_lon = lon
                            state.home_alt = alt
            else:
                ok = self.publish_vehicle_command(uav_id, command=179, param1=1.0)
                if ok:
                    self._save_home_position(uav_id)

        elif command_type == 'DISARM':
            self.stop_offboard_heartbeat(uav_id)
            ok = self.publish_vehicle_command(uav_id, command=400, param1=0.0, param2=0.0)

        elif command_type == 'OFFBOARD':
            self.start_offboard_heartbeat(uav_id)
            time.sleep(0.3)
            ok = self.publish_vehicle_command(uav_id, command=176, param1=1.0, param2=6.0)

        elif command_type == 'ORBIT':
            lat = float(params.get('lat', 0))
            lon = float(params.get('lon', 0))
            radius = max(2.5, float(params.get('radius', 5.0)))
            velocity = float(params.get('velocity', 2.0))

            with self._lock:
                state = self.drone_states.get(uav_id)
                if not state:
                    return {'success': False, 'message': f'No state for {uav_id}'}
                home_lat = state.home_lat or state.lat
                home_lon = state.home_lon or state.lon
                home_alt = state.home_alt or state.alt
                current_alt_ned = -(state.alt - home_alt) if home_alt else -5.0

            if lat != 0 and lon != 0:
                center_n, center_e, _ = _latlon_to_ned(lat, lon, home_alt,
                                                        home_lat, home_lon, home_alt)
            else:
                center_n, center_e, _ = _latlon_to_ned(state.lat, state.lon, home_alt,
                                                        home_lat, home_lon, home_alt)

            self.start_orbit_heartbeat(uav_id, center_n, center_e, current_alt_ned,
                                       radius, velocity)
            time.sleep(0.3)
            self.publish_vehicle_command(uav_id, command=176, param1=1.0, param2=6.0)
            ok = True

        elif command_type == 'SET_ROI':
            lat = float(params.get('lat', 0))
            lon = float(params.get('lon', 0))
            alt = float(params.get('alt', 0))
            if lat != 0 and lon != 0:
                ok = self.publish_vehicle_command(uav_id, command=195,
                                                  param5=lat, param6=lon, param7=alt)
            else:
                ok = self.publish_vehicle_command(uav_id, command=197)

        elif command_type == 'SET_YAW':
            yaw = float(params.get('yaw', 0))
            speed = float(params.get('speed', 30))
            relative = int(params.get('relative', 0))
            ok = self.publish_vehicle_command(uav_id, command=115,
                                              param1=yaw, param2=speed,
                                              param3=0.0, param5=float(relative))

        elif command_type == 'SET_GPS_ORIGIN':
            lat = float(params.get('lat', 0))
            lon = float(params.get('lon', 0))
            alt = float(params.get('alt', 0))
            if lat != 0 and lon != 0:
                ok = self.publish_vehicle_command(uav_id, command=100048,
                                                  param5=lat, param6=lon, param7=alt)
            else:
                return {'success': False, 'message': 'SET_GPS_ORIGIN requires lat and lon'}

        elif command_type == 'GET_HOME':
            home = self._get_home_position(uav_id)
            if home:
                return {'success': True, 'message': 'Home position',
                        'home': {'lat': home[0], 'lon': home[1], 'alt': home[2]}}
            return {'success': False, 'message': f'No home for {uav_id}'}

        elif command_type == 'EMERGENCY_STOP':
            self.stop_offboard_heartbeat(uav_id)
            ok = self.publish_vehicle_command(uav_id, command=400, param1=0.0, param2=21196.0)

        else:
            return {'success': False, 'message': f'Unknown command: {command_type}'}

        if ok:
            return {'success': True, 'message': f'{command_type} sent to {uav_id}'}
        else:
            return {'success': False, 'message': f'Failed to send {command_type}'}

    # ============================================================
    # OFFBOARD Heartbeat (4Hz)
    # ============================================================

    def start_offboard_heartbeat(self, uav_id: str, interval: float = 0.25,
                                    target_z=None, target_x=None, target_y=None,
                                    target_yaw=None):
        key = f"heartbeat_{uav_id}"
        sp = self._heartbeat_setpoints.get(uav_id, {})
        if not isinstance(sp, dict):
            sp = {'x': float('nan'), 'y': float('nan'), 'z': sp, 'yaw': float('nan')}
        if target_z is not None:
            sp['z'] = target_z
        if target_x is not None:
            sp['x'] = target_x
        if target_y is not None:
            sp['y'] = target_y
        if target_yaw is not None:
            sp['yaw'] = target_yaw
        self._heartbeat_setpoints[uav_id] = sp

        if key in self._heartbeat_threads and self._heartbeat_threads[key].is_alive():
            return

        self._heartbeat_active[uav_id] = True

        def _heartbeat_loop():
            logger.info("[Heartbeat] Started for %s at %.1fHz", uav_id, 1.0 / interval)
            _arrival_logged = False
            while self._heartbeat_active.get(uav_id, False) and self.running:
                try:
                    self.publish_offboard_control_mode(uav_id, position=True)
                    current_sp = self._heartbeat_setpoints.get(uav_id, {})
                    if isinstance(current_sp, dict):
                        x = current_sp.get('x', float('nan'))
                        y = current_sp.get('y', float('nan'))
                        z = current_sp.get('z', float('nan'))
                        yaw = current_sp.get('yaw', float('nan'))
                    else:
                        x, y, z, yaw = float('nan'), float('nan'), current_sp, float('nan')

                    # Arrival detection
                    if not (math.isnan(x) or math.isnan(y)):
                        lock = self._drone_locks[uav_id]
                        with lock:
                            state = self.drone_states.get(uav_id)
                        if state:
                            dx = state.ned_x - x
                            dy = state.ned_y - y
                            dz = state.ned_z - z if not math.isnan(z) else 0
                            dist_3d = math.sqrt(dx**2 + dy**2 + dz**2)
                            if dist_3d < 1.5:
                                if not _arrival_logged:
                                    logger.info("[Heartbeat] %s arrived (dist=%.2fm)", uav_id, dist_3d)
                                    _arrival_logged = True
                                x, y, z = state.ned_x, state.ned_y, state.ned_z
                                current_sp['x'], current_sp['y'], current_sp['z'] = x, y, z

                    self.publish_trajectory_setpoint(uav_id, x, y, z, yaw=yaw)
                except Exception as e:
                    logger.error("[Heartbeat] Error for %s: %s", uav_id, e)
                time.sleep(interval)
            logger.info("[Heartbeat] Stopped for %s", uav_id)

        t = threading.Thread(target=_heartbeat_loop, daemon=True, name=f"hb-{uav_id}")
        t.start()
        self._heartbeat_threads[key] = t

    def stop_offboard_heartbeat(self, uav_id: str):
        self._heartbeat_active[uav_id] = False
        self._heartbeat_setpoints.pop(uav_id, None)
        self.stop_orbit_heartbeat(uav_id)

    def start_orbit_heartbeat(self, uav_id: str, center_n: float, center_e: float,
                                alt_ned: float, radius: float, velocity: float,
                                interval: float = 0.1):
        self.stop_orbit_heartbeat(uav_id)
        self._orbit_active[uav_id] = True
        omega = velocity / radius

        def _orbit_loop():
            arrived = False
            t0 = 0
            initial_angle = 0
            while self._orbit_active.get(uav_id, False) and self.running:
                try:
                    lock = self._drone_locks[uav_id]
                    with lock:
                        state = self.drone_states.get(uav_id)
                    if not state:
                        time.sleep(interval)
                        continue

                    dx = state.ned_x - center_n
                    dy = state.ned_y - center_e
                    dist = math.sqrt(dx**2 + dy**2)
                    target_n, target_e, yaw = state.ned_x, state.ned_y, 0.0

                    if not arrived:
                        if dist > 0.1:
                            target_n = center_n + (dx / dist) * radius
                            target_e = center_e + (dy / dist) * radius
                        else:
                            target_n = center_n + radius
                            target_e = center_e
                        yaw = math.atan2(target_e - state.ned_y, target_n - state.ned_x)
                        if abs(dist - radius) < 2.0:
                            arrived = True
                            t0 = time.time()
                            initial_angle = math.atan2(dy, dx)

                    if arrived:
                        elapsed = time.time() - t0
                        angle = initial_angle + (omega * elapsed)
                        target_n = center_n + radius * math.cos(angle)
                        target_e = center_e + radius * math.sin(angle)
                        yaw = math.atan2(center_e - target_e, center_n - target_n)

                    self.publish_offboard_control_mode(uav_id, position=True)
                    self.publish_trajectory_setpoint(uav_id, target_n, target_e, alt_ned, yaw=yaw)
                except Exception as e:
                    logger.error("[Orbit] Error: %s", e)
                time.sleep(interval)

        t = threading.Thread(target=_orbit_loop, daemon=True, name=f"orbit-{uav_id}")
        t.start()
        self._orbit_threads[f"orbit_{uav_id}"] = t

    def stop_orbit_heartbeat(self, uav_id: str):
        self._orbit_active[uav_id] = False

    # ============================================================
    # HTTP Command Server (fallback)
    # ============================================================

    def start_command_server(self, port: int = 5050):
        from http.server import HTTPServer, BaseHTTPRequestHandler
        gw = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                if self.path == '/api/command':
                    length = int(self.headers.get('Content-Length', 0))
                    body = self.rfile.read(length)
                    try:
                        data = json.loads(body)
                        result = gw.handle_command(
                            data.get('uavId', ''),
                            data.get('commandType', ''),
                            json.loads(data.get('params', '{}')) if isinstance(data.get('params'), str) else data.get('params', {}))
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/json')
                        self.end_headers()
                        self.wfile.write(json.dumps(result).encode())
                    except Exception as e:
                        self.send_response(500)
                        self.send_header('Content-Type', 'application/json')
                        self.end_headers()
                        self.wfile.write(json.dumps({'success': False, 'message': str(e)}).encode())
                else:
                    self.send_response(404)
                    self.end_headers()

            def do_GET(self):
                if self.path == '/api/health':
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        'status': 'ok', 'type': 'dds-tx-gateway',
                        'instance_id': gw.instance_id,
                    }).encode())
                else:
                    self.send_response(404)
                    self.end_headers()

            def log_message(self, format, *args):
                logger.debug("[HTTP] %s", format % args)

        server = HTTPServer(('0.0.0.0', port), Handler)
        threading.Thread(target=server.serve_forever, daemon=True, name='cmd-server').start()
        logger.info("[HTTP] Command server on port %d", port)

    # ============================================================
    # Main Loop
    # ============================================================

    def run(self):
        self.running = True
        logger.info("=" * 60)
        logger.info("[Startup] DDS Tx Gateway (Instance %d/%d)", self.instance_id, self.total_instances)
        logger.info("[Startup] Kafka: %s", self._kafka_bootstrap)
        logger.info("[Startup] Urgent commands: %s (retry=3)", URGENT_COMMANDS)
        logger.info("=" * 60)

        if not self._rclpy_available:
            logger.error("[Startup] ROS2 not available. Exiting.")
            return
        if not self._init_ros2_node():
            return

        # Start ROS2 spin thread
        import rclpy

        def _spin():
            while self.running and rclpy.ok():
                try:
                    rclpy.spin_once(self._node, timeout_sec=0.01)
                except Exception:
                    time.sleep(0.01)
        threading.Thread(target=_spin, daemon=True, name='ros2-spin').start()

        # Start Kafka command consumer
        self._start_kafka_command_consumer()

        # Start HTTP fallback
        base_port = int(os.environ.get('DDS_TX_COMMAND_PORT', '5050'))
        self.start_command_server(port=base_port + self.instance_id)

        # Keep alive
        while self.running:
            try:
                time.sleep(1)
            except KeyboardInterrupt:
                break

        self._cleanup()

    def _cleanup(self):
        try:
            import rclpy
            if self._node:
                self._node.destroy_node()
            if rclpy.ok():
                rclpy.shutdown()
        except Exception:
            pass
        if self._kafka_producer:
            try:
                self._kafka_producer.flush(timeout=3)
                self._kafka_producer.close(timeout=3)
            except Exception:
                pass

    def stop(self):
        self.running = False


def main():
    parser = argparse.ArgumentParser(description='DDS Tx Gateway — Command Sender')
    parser.add_argument('--backend-url',
                        default=os.environ.get('UCS_BACKEND_URL', 'http://localhost:8080'))
    parser.add_argument('--api-key',
                        default=os.environ.get('DDS_GATEWAY_API_KEY', 'ucs-dds-gateway-secret-2024'))
    parser.add_argument('--instance-id', type=int,
                        default=int(os.environ.get('DDS_TX_INSTANCE_ID', '0')))
    parser.add_argument('--total-instances', type=int,
                        default=int(os.environ.get('DDS_TX_TOTAL_INSTANCES', '1')))
    parser.add_argument('--verbose', '-v', action='store_true')
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    gateway = DdsTxGateway(
        backend_url=args.backend_url,
        api_key=args.api_key,
        instance_id=args.instance_id,
        total_instances=args.total_instances,
    )

    def signal_handler(sig, frame):
        gateway.stop()

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    gateway.run()


if __name__ == '__main__':
    main()
