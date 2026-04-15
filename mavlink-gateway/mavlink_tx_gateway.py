#!/usr/bin/env python3
"""
MAVLink Tx Gateway — 发送端网关（命令下发）

从Kafka commands.mavlink.down消费控制命令，通过MAVLink发送到真实无人机。
与MAVLink Rx Gateway配合工作，实现收发分离以消除GIL竞争并支持独立扩缩容。

架构升级2.1 — T-02: MAVLink网关收发拆分（Tx部分）
                T-05: Tx Gateway命令优先级队列与重试
                T-06: 网关连接状态刷新（命令侧）
                T-10: 命令生产者acks=all + 幂等

数据流:
    Backend --Kafka(commands.mavlink.down)--> MAVLink Tx Gateway --MAVLink(UDP/TCP)--> Real Drone

T-05 命令优先级与重试:
    紧急命令 (RTL, LAND, EMERGENCY_STOP, HOLD): 最多重试3次, 100ms退避
    普通命令 (TAKEOFF, GOTO, ORBIT等): 发送一次, 不重试

OFFBOARD Heartbeat:
    维持4Hz SET_POSITION_TARGET_LOCAL_NED 以保持PX4在OFFBOARD模式

Usage:
    python mavlink_tx_gateway.py [--listen udp:0.0.0.0:14550]

Environment Variables:
    KAFKA_BOOTSTRAP_SERVERS  Kafka brokers (default: kafka-1:9092,kafka-2:9092,kafka-3:9092)
    REDIS_HOST               Redis host (default: redis)
    UCS_BACKEND_URL          Backend URL
"""

import argparse
import hashlib
import json
import logging
import math
import os
import signal
import socket
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Dict, Optional, Tuple

import redis
import requests

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('mavlink-tx-gateway')

EARTH_RADIUS = 6371000.0

# PX4 custom mode constants
PX4_CUSTOM_MAIN_MODE_MANUAL = 1
PX4_CUSTOM_MAIN_MODE_ALTCTL = 2
PX4_CUSTOM_MAIN_MODE_POSCTL = 3
PX4_CUSTOM_MAIN_MODE_AUTO = 4
PX4_CUSTOM_MAIN_MODE_OFFBOARD = 6
PX4_CUSTOM_SUB_MODE_AUTO_TAKEOFF = 2
PX4_CUSTOM_SUB_MODE_AUTO_LOITER = 3
PX4_CUSTOM_SUB_MODE_AUTO_MISSION = 4
PX4_CUSTOM_SUB_MODE_AUTO_RTL = 5
PX4_CUSTOM_SUB_MODE_AUTO_LAND = 6

# MAVLink command IDs
MAV_CMD_NAV_RETURN_TO_LAUNCH = 20
MAV_CMD_NAV_LAND = 21
MAV_CMD_NAV_LOITER_UNLIM = 17
MAV_CMD_CONDITION_YAW = 115
MAV_CMD_DO_SET_MODE = 176
MAV_CMD_DO_SET_HOME = 179
MAV_CMD_DO_SET_ROI_LOCATION = 195
MAV_CMD_DO_SET_ROI_NONE = 197
MAV_CMD_COMPONENT_ARM_DISARM = 400

# T-05: 紧急命令列表
URGENT_COMMANDS = {'RTL', 'LAND', 'EMERGENCY_STOP', 'HOLD', 'DISARM'}


def _latlon_to_ned(lat, lon, alt, home_lat, home_lon, home_alt):
    dlat = math.radians(lat - home_lat)
    dlon = math.radians(lon - home_lon)
    north = dlat * EARTH_RADIUS
    east = dlon * EARTH_RADIUS * math.cos(math.radians(home_lat))
    down = -(alt - home_alt)
    return north, east, down


def _decode_px4_mode(main_mode: int, sub_mode: int) -> str:
    if main_mode == PX4_CUSTOM_MAIN_MODE_MANUAL:
        return "MANUAL"
    elif main_mode == PX4_CUSTOM_MAIN_MODE_ALTCTL:
        return "ALTCTL"
    elif main_mode == PX4_CUSTOM_MAIN_MODE_POSCTL:
        return "POSCTL"
    elif main_mode == PX4_CUSTOM_MAIN_MODE_AUTO:
        sub_modes = {
            PX4_CUSTOM_SUB_MODE_AUTO_TAKEOFF: "AUTO_TAKEOFF",
            PX4_CUSTOM_SUB_MODE_AUTO_LOITER: "AUTO_LOITER",
            PX4_CUSTOM_SUB_MODE_AUTO_MISSION: "AUTO_MISSION",
            PX4_CUSTOM_SUB_MODE_AUTO_RTL: "AUTO_RTL",
            PX4_CUSTOM_SUB_MODE_AUTO_LAND: "AUTO_LAND",
        }
        return sub_modes.get(sub_mode, f"AUTO_{sub_mode}")
    elif main_mode == PX4_CUSTOM_MAIN_MODE_OFFBOARD:
        return "OFFBOARD"
    else:
        return f"MODE_{main_mode}_{sub_mode}"


@dataclass
class DroneState:
    """Minimal drone state for Tx Gateway."""
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
    system_id: int = 1
    component_id: int = 1
    connection_type: str = 'udp'
    epoch: int = 0
    last_update: float = 0.0
    ground_speed: float = 0.0
    position_valid: bool = False


class MavlinkTxGateway:
    """
    MAVLink Tx Gateway — 只负责消费Kafka命令并通过MAVLink发送给真实无人机。

    职责:
    1. 从Kafka commands.mavlink.down / commands.down 消费控制命令
    2. Epoch验证: 丢弃过期命令
    3. T-05 紧急命令优先级: RTL/LAND/EMERGENCY_STOP/HOLD 最多重试3次
    4. 通过MAVLink COMMAND_LONG / SET_POSITION_TARGET 发送给无人机
    5. 发送ACK到Kafka commands.ack
    6. OFFBOARD心跳: 4Hz SET_POSITION_TARGET_LOCAL_NED
    7. GCS心跳: 1Hz HEARTBEAT（保持PX4链路存活）
    """

    def __init__(self, backend_url: str, api_key: str,
                 instance_id: int = 0, total_instances: int = 1,
                 listen_protocol: str = 'udp', listen_host: str = '0.0.0.0',
                 listen_port: int = 14551):
        self.backend_url = backend_url.rstrip('/')
        self.api_key = api_key
        self.instance_id = instance_id
        self.total_instances = total_instances
        self.listen_protocol = listen_protocol
        self.listen_host = listen_host
        self.listen_port = listen_port

        self.drone_states: Dict[str, DroneState] = {}
        self.running = False
        self._lock = threading.Lock()
        self._drone_locks: Dict[str, threading.Lock] = defaultdict(threading.Lock)
        self._stats = defaultdict(int)
        self._stats_lock = threading.Lock()

        # Epoch
        self._epoch_map: Dict[str, int] = {}
        self._redis_epoch_prefix = 'mavlink:epoch:'
        self._redis_ip_prefix = 'mavlink:ip_map:'

        # IP Mapping
        self._ip_map: Dict[str, Tuple[str, int]] = {}
        self._addr_to_uav: Dict[Tuple[str, int], str] = {}

        # UDP socket for sending commands
        self._udp_socket: Optional[socket.socket] = None
        # TCP connections
        self._tcp_connections: Dict[Tuple[str, int], socket.socket] = {}

        # pymavlink
        self._pymavlink_available = False
        try:
            from pymavlink import mavutil
            self._pymavlink_available = True
        except ImportError:
            logger.error("[Init] pymavlink not available")

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

        # Kafka ACK Producer — T-10: acks=all, idempotent
        self._kafka_producer = None
        self._kafka_enabled = False
        self._kafka_bootstrap = os.environ.get(
            'KAFKA_BOOTSTRAP_SERVERS', 'kafka-1:9092,kafka-2:9092,kafka-3:9092')
        self._init_kafka_producer()

        # Heartbeat / Orbit state
        self._heartbeat_threads: Dict[str, threading.Thread] = {}
        self._heartbeat_active: Dict[str, bool] = {}
        self._heartbeat_setpoints: Dict[str, dict] = {}
        self._orbit_threads: Dict[str, threading.Thread] = {}
        self._orbit_active: Dict[str, bool] = {}

        # Command ACK waiting mechanism
        self._pending_ack_events: Dict[Tuple[str, int], threading.Event] = {}
        self._pending_ack_results: Dict[Tuple[str, int], int] = {}
        self._mode_change_events: Dict[str, threading.Event] = {}

        # ACK dedup
        self._recent_acks: Dict[str, float] = {}

    # ============================================================
    # Kafka Producer (for ACK — T-10: acks=all, idempotent)
    # ============================================================

    def _init_kafka_producer(self):
        try:
            from kafka import KafkaProducer
            self._kafka_producer = KafkaProducer(
                bootstrap_servers=self._kafka_bootstrap,
                key_serializer=lambda k: k.encode('utf-8') if k else None,
                value_serializer=lambda v: json.dumps(v).encode('utf-8'),
                acks='all',
                retries=5,
                retry_backoff_ms=200,
                enable_idempotence=True,
                max_block_ms=5000,
            )
            self._kafka_enabled = True
            logger.info("[Kafka] ACK Producer initialized (acks=all, idempotent)")
        except ImportError:
            logger.warning("[Kafka] kafka-python not installed")
        except Exception as e:
            logger.warning("[Kafka] Producer init failed: %s", e)

    # ============================================================
    # Multi-Instance & Epoch
    # ============================================================

    def _owns_drone(self, uav_id: str) -> bool:
        if self.total_instances <= 1:
            return True
        h = int(hashlib.md5(uav_id.encode('utf-8')).hexdigest(), 16)
        return (h % self.total_instances) == self.instance_id

    def _load_epoch(self, uav_id: str):
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
    # IP Resolution (from Redis or backend)
    # ============================================================

    def _resolve_uav_addr(self, uav_id: str) -> Optional[Tuple[str, int]]:
        """Resolve uav_id to (ip, port)."""
        # Local cache
        if uav_id in self._ip_map:
            return self._ip_map[uav_id]

        # Redis
        if self._redis:
            try:
                val = self._redis.get(f"{self._redis_ip_prefix}{uav_id}")
                if val:
                    parts = val.rsplit(':', 1)
                    if len(parts) == 2:
                        addr = (parts[0], int(parts[1]))
                        self._ip_map[uav_id] = addr
                        self._addr_to_uav[addr] = uav_id
                        return addr
            except Exception:
                pass

        # Parse from uav_id (mavlink_{ip}_{port})
        parts = uav_id.split('_')
        if len(parts) >= 3 and parts[0] == 'mavlink':
            try:
                ip = parts[1]
                port = int(parts[2])
                addr = (ip, port)
                self._ip_map[uav_id] = addr
                self._addr_to_uav[addr] = uav_id
                return addr
            except (ValueError, IndexError):
                pass

        # Backend lookup
        try:
            resp = requests.get(
                f"{self.backend_url}/api/v1/drones/by-uav-id/{uav_id}",
                headers={'X-Gateway-Key': self.api_key},
                timeout=3)
            if resp.status_code == 200:
                data = resp.json()
                ip = data.get('mavlinkIp', '')
                port = data.get('mavlinkPort', 0)
                if ip and port:
                    addr = (ip, int(port))
                    self._ip_map[uav_id] = addr
                    self._addr_to_uav[addr] = uav_id
                    if self._redis:
                        try:
                            self._redis.set(f"{self._redis_ip_prefix}{uav_id}",
                                            f"{ip}:{port}", ex=3600)
                        except Exception:
                            pass
                    return addr
        except Exception:
            pass

        return None

    # ============================================================
    # UDP Socket for Sending
    # ============================================================

    def _init_udp_socket(self):
        """Create UDP socket for sending commands to drones."""
        self._udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        logger.info("[UDP] Send socket created")

    # ============================================================
    # UDP Listener for drone responses (COMMAND_ACK, HEARTBEAT, position)
    # ============================================================

    def _start_udp_listener(self):
        """Listen for MAVLink responses (ACKs, heartbeats) from drones."""
        from pymavlink import mavutil

        listen_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        listen_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listen_sock.bind((self.listen_host, self.listen_port))
        listen_sock.settimeout(1.0)
        logger.info("[UDP] Listening for responses on %s:%d",
                    self.listen_host, self.listen_port)

        # Also use this socket for sending if no separate send socket
        if not self._udp_socket:
            self._udp_socket = listen_sock

        mav = mavutil.mavlink.MAVLink(None)
        mav.robust_parsing = True

        def _listen_loop():
            while self.running:
                try:
                    data, addr = listen_sock.recvfrom(65535)
                    if not data:
                        continue
                    msgs = []
                    try:
                        for byte in data:
                            parsed = mav.parse_char(bytes([byte]))
                            if parsed:
                                msgs.append(parsed)
                    except Exception:
                        pass

                    for parsed_msg in msgs:
                        self._on_mavlink_response(parsed_msg, addr)
                except socket.timeout:
                    continue
                except Exception as e:
                    if self.running:
                        logger.error("[UDP] Listen error: %s", e)
                        time.sleep(0.1)

        t = threading.Thread(target=_listen_loop, daemon=True, name='udp-response')
        t.start()

    def _on_mavlink_response(self, msg, addr: Tuple[str, int]):
        """Handle MAVLink response messages (ACK, HEARTBEAT, position)."""
        msg_type = msg.get_type()
        if msg_type == 'BAD_DATA':
            return

        uav_id = self._addr_to_uav.get(addr)
        if not uav_id:
            # Try to find by IP prefix
            for uid, a in self._ip_map.items():
                if a[0] == addr[0]:
                    uav_id = uid
                    break
        if not uav_id:
            return

        if msg_type == 'COMMAND_ACK':
            self._on_command_ack(uav_id, msg)
        elif msg_type == 'HEARTBEAT':
            self._on_heartbeat(uav_id, msg)
        elif msg_type == 'GLOBAL_POSITION_INT':
            self._on_global_position(uav_id, msg)
        elif msg_type == 'LOCAL_POSITION_NED':
            self._on_local_position(uav_id, msg)

    def _on_command_ack(self, uav_id: str, msg):
        command = msg.command
        result = msg.result
        result_names = {0: 'ACCEPTED', 1: 'TEMPORARILY_REJECTED', 2: 'DENIED',
                        3: 'UNSUPPORTED', 4: 'FAILED', 5: 'IN_PROGRESS'}
        result_str = result_names.get(result, f'UNKNOWN({result})')
        logger.info("[CommandAck] %s: cmd=%d result=%s(%d)", uav_id, command, result_str, result)

        ack_key = (uav_id, command)
        if ack_key in self._pending_ack_events:
            self._pending_ack_results[ack_key] = result
            self._pending_ack_events[ack_key].set()

        # Forward ACK to Kafka
        self._forward_command_ack_kafka(uav_id, int(command), int(result))

    def _forward_command_ack_kafka(self, uav_id: str, command: int, result: int):
        if not self._kafka_enabled or not self._kafka_producer:
            return
        ack_key = f"{uav_id}:{command}:{result}"
        now = time.time()
        last = self._recent_acks.get(ack_key, 0)
        if now - last < 2.0:
            return
        self._recent_acks[ack_key] = now
        try:
            ack = {
                'uavId': uav_id,
                'command': command,
                'result': result,
                'timestamp': now,
                'epoch': self._epoch_map.get(uav_id, 0),
            }
            self._kafka_producer.send('commands.ack', key=uav_id, value=ack)
        except Exception as e:
            logger.error("[ACK] Kafka send failed: %s", e)

    def _on_heartbeat(self, uav_id: str, msg):
        lock = self._drone_locks[uav_id]
        with lock:
            if uav_id not in self.drone_states:
                self.drone_states[uav_id] = DroneState(uav_id=uav_id)
            s = self.drone_states[uav_id]
            s.armed = bool(msg.base_mode & 0x80)
            custom_mode = msg.custom_mode
            main_mode = (custom_mode >> 16) & 0xFF
            sub_mode = (custom_mode >> 24) & 0xFF
            old_mode = s.flight_mode
            s.flight_mode = _decode_px4_mode(main_mode, sub_mode)
            if hasattr(msg, 'get_srcSystem') and msg.get_srcSystem() > 0:
                s.system_id = msg.get_srcSystem()
            if hasattr(msg, 'get_srcComponent') and msg.get_srcComponent() > 0:
                s.component_id = msg.get_srcComponent()
            s.last_update = time.time()

            if old_mode != s.flight_mode:
                logger.info("[ModeChange] %s: %s -> %s", uav_id, old_mode, s.flight_mode)

        mode_event = self._mode_change_events.get(uav_id)
        if mode_event:
            mode_event.set()

    def _on_global_position(self, uav_id: str, msg):
        lock = self._drone_locks[uav_id]
        with lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return
            s.lat = msg.lat / 1e7
            s.lon = msg.lon / 1e7
            s.alt = msg.alt / 1000.0
            if hasattr(msg, 'relative_alt'):
                s.ned_z = -(msg.relative_alt / 1000.0)
            s.position_valid = True
            s.last_update = time.time()

    def _on_local_position(self, uav_id: str, msg):
        lock = self._drone_locks[uav_id]
        with lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return
            s.ned_x = msg.x
            s.ned_y = msg.y
            s.ned_z = msg.z
            s.last_update = time.time()

    # ============================================================
    # GCS Heartbeat (1Hz to all known drones)
    # ============================================================

    def _start_gcs_heartbeat(self):
        if not self._pymavlink_available:
            return
        from pymavlink import mavutil

        def _gcs_hb_loop():
            mav = mavutil.mavlink.MAVLink(None)
            mav.srcSystem = 255
            mav.srcComponent = 190
            while self.running:
                try:
                    hb_msg = mav.heartbeat_encode(
                        mavutil.mavlink.MAV_TYPE_GCS,
                        mavutil.mavlink.MAV_AUTOPILOT_INVALID,
                        0, 0, 0)
                    packed = hb_msg.pack(mav)
                    for uid, addr in list(self._ip_map.items()):
                        try:
                            if self._udp_socket:
                                self._udp_socket.sendto(packed, addr)
                        except Exception:
                            pass
                except Exception as e:
                    logger.error("[GCSHeartbeat] Error: %s", e)
                time.sleep(1.0)

        t = threading.Thread(target=_gcs_hb_loop, daemon=True, name='gcs-heartbeat')
        t.start()

    # ============================================================
    # Kafka Command Consumer
    # ============================================================

    def _start_kafka_command_consumer(self):
        """Consume from commands.mavlink.down and commands.down (filter mavlink_ only)."""
        if not self._kafka_enabled:
            return

        try:
            from kafka import KafkaConsumer as _KafkaConsumer
            consumer = _KafkaConsumer(
                'commands.mavlink.down', 'commands.down',
                bootstrap_servers=self._kafka_bootstrap,
                group_id=f'mavlink-tx-gateway-{self.instance_id}',
                value_deserializer=lambda v: json.loads(v.decode('utf-8')),
                auto_offset_reset='latest',
                max_poll_records=1,
                enable_auto_commit=True,
                consumer_timeout_ms=1000,
            )
            logger.info("[KafkaCmd] Consumer initialized")
        except Exception as e:
            logger.warning("[KafkaCmd] Consumer creation failed: %s", e)
            return

        def _consume_loop():
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

        t = threading.Thread(target=_consume_loop, daemon=True, name='kafka-cmd')
        t.start()

    def _process_command_message(self, data: dict):
        uav_id = data.get('uavId', '')
        command_type = data.get('commandType', '').upper()
        params_raw = data.get('params', '{}')
        if isinstance(params_raw, str):
            params = json.loads(params_raw) if params_raw else {}
        else:
            params = params_raw

        # Only MAVLink drones
        if not uav_id.startswith('mavlink_'):
            return
        if not self._owns_drone(uav_id):
            return

        # Epoch validation
        msg_epoch = data.get('epoch', 0)
        self._load_epoch(uav_id)
        current_epoch = self._epoch_map.get(uav_id, 0)
        if current_epoch > 0 and msg_epoch > 0 and msg_epoch < current_epoch:
            logger.warning("[KafkaCmd] Stale: %s -> %s epoch=%d < %d",
                           command_type, uav_id, msg_epoch, current_epoch)
            return

        # Timestamp validation
        ts_str = data.get('timestamp', '')
        if ts_str:
            try:
                msg_time = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
                age = (datetime.now(timezone.utc) - msg_time).total_seconds()
                if age > 60:
                    return
            except (ValueError, TypeError):
                pass

        logger.info("[KafkaCmd] Processing: %s -> %s", command_type, uav_id)

        # T-05: Urgent command retry
        max_retries = 3 if command_type in URGENT_COMMANDS else 1
        result = None

        for attempt in range(max_retries):
            result = self.handle_command(uav_id, command_type, params)
            success = result.get('success', False) if isinstance(result, dict) else False
            if success:
                break
            if attempt < max_retries - 1:
                logger.warning("[KafkaCmd] Retry %d/%d: %s -> %s",
                               attempt + 1, max_retries, command_type, uav_id)
                time.sleep(0.1 * (attempt + 1))

        # Send ACK
        command_log_id = data.get('commandLogId', 0)
        epoch = data.get('epoch', 0)
        self._send_command_ack(uav_id, command_type, epoch, command_log_id, result)

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
        except Exception as e:
            logger.error("[ACK] Send failed: %s", e)

    # ============================================================
    # MAVLink Command Sending
    # ============================================================

    def _send_mavlink_command_long(self, uav_id: str, command: int,
                                   param1=0.0, param2=0.0, param3=0.0, param4=0.0,
                                   param5=0.0, param6=0.0, param7=0.0) -> bool:
        from pymavlink import mavutil

        addr = self._resolve_uav_addr(uav_id)
        if not addr:
            logger.error("[Command] Cannot resolve address for %s", uav_id)
            return False

        state = self.drone_states.get(uav_id)
        target_sys = state.system_id if state else 1
        target_comp = state.component_id if (state and state.component_id) else 1

        try:
            mav = mavutil.mavlink.MAVLink(None)
            mav.srcSystem = 255
            mav.srcComponent = 190
            cmd_msg = mav.command_long_encode(
                target_sys, target_comp,
                command, 0,
                param1, param2, param3, param4, param5, param6, param7)
            packed = cmd_msg.pack(mav)

            conn_type = state.connection_type if state else self.listen_protocol
            if conn_type == 'udp' and self._udp_socket:
                self._udp_socket.sendto(packed, addr)
            elif conn_type == 'tcp':
                tcp_sock = self._tcp_connections.get(addr)
                if tcp_sock:
                    tcp_sock.sendall(packed)
                else:
                    return False

            logger.info("[Command] COMMAND_LONG cmd=%d -> %s (sys=%d)",
                        command, uav_id, target_sys)
            return True
        except Exception as e:
            logger.error("[Command] Failed: %s", e)
            return False

    def _send_mavlink_set_position_target(self, uav_id: str,
                                           x: float, y: float, z: float,
                                           yaw: float = float('nan'),
                                           log: bool = False) -> bool:
        from pymavlink import mavutil

        addr = self._resolve_uav_addr(uav_id)
        if not addr:
            return False

        state = self.drone_states.get(uav_id)
        target_sys = state.system_id if state else 1
        target_comp = state.component_id if (state and state.component_id) else 1

        try:
            mav = mavutil.mavlink.MAVLink(None)
            mav.srcSystem = 255
            mav.srcComponent = 190
            type_mask = 0b0000111111111000

            msg = mav.set_position_target_local_ned_encode(
                0, target_sys, target_comp,
                mavutil.mavlink.MAV_FRAME_LOCAL_NED,
                type_mask,
                x, y, z,
                0, 0, 0,
                0, 0, 0,
                0, 0)
            packed = msg.pack(mav)

            if log:
                logger.info("[Setpoint] %s: x=%.2f y=%.2f z=%.2f -> %s:%d",
                            uav_id, x, y, z, addr[0], addr[1])

            conn_type = state.connection_type if state else self.listen_protocol
            if conn_type == 'udp' and self._udp_socket:
                self._udp_socket.sendto(packed, addr)
            elif conn_type == 'tcp':
                tcp_sock = self._tcp_connections.get(addr)
                if tcp_sock:
                    tcp_sock.sendall(packed)
                else:
                    return False
            return True
        except Exception as e:
            logger.error("[Setpoint] Failed: %s", e)
            return False

    def _send_command_and_wait_ack(self, uav_id: str, command: int,
                                    param1=0.0, param2=0.0, param3=0.0,
                                    param4=0.0, param5=0.0, param6=0.0,
                                    param7=0.0, timeout=3.0) -> Optional[int]:
        ack_key = (uav_id, command)
        event = threading.Event()
        self._pending_ack_events[ack_key] = event
        self._pending_ack_results.pop(ack_key, None)

        sent = self._send_mavlink_command_long(
            uav_id, command,
            param1=param1, param2=param2, param3=param3,
            param4=param4, param5=param5, param6=param6, param7=param7)
        if not sent:
            self._pending_ack_events.pop(ack_key, None)
            return None

        got_ack = event.wait(timeout=timeout)
        self._pending_ack_events.pop(ack_key, None)
        if got_ack:
            return self._pending_ack_results.pop(ack_key, None)
        else:
            self._pending_ack_results.pop(ack_key, None)
            logger.warning("[ACK] Timeout cmd=%d from %s", command, uav_id)
            return None

    # ============================================================
    # Command Handling (mirrors original mavlink_gateway.py)
    # ============================================================

    def handle_command(self, uav_id: str, command_type: str, params: dict) -> dict:
        command_type = command_type.upper()
        logger.info("[Command] %s -> %s params=%s", command_type, uav_id, params)

        self._load_epoch(uav_id)
        ok = False

        if command_type == 'TAKEOFF':
            relative_alt = float(params.get('altitude', params.get('defaultAltitude', 5.0)))
            target_z = -relative_alt
            self._save_home_position(uav_id)

            cur_x, cur_y = 0.0, 0.0
            with self._lock:
                state = self.drone_states.get(uav_id)
            if state:
                cur_x = state.ned_x
                cur_y = state.ned_y

            # Start OFFBOARD heartbeat at 10Hz
            self.start_offboard_heartbeat(
                uav_id, target_z=target_z, target_x=cur_x, target_y=cur_y,
                interval=0.1)

            # Pre-mode-switch setpoints
            for i in range(30):
                self._send_mavlink_set_position_target(uav_id, cur_x, cur_y, target_z)
                time.sleep(0.1)

            # Switch to OFFBOARD
            mode_event = threading.Event()
            self._mode_change_events[uav_id] = mode_event
            custom_mode = PX4_CUSTOM_MAIN_MODE_OFFBOARD << 16
            offboard_ok = False

            for attempt in range(3):
                for _ in range(5):
                    self._send_mavlink_set_position_target(uav_id, cur_x, cur_y, target_z)
                    time.sleep(0.02)

                ack_result = self._send_command_and_wait_ack(
                    uav_id, MAV_CMD_DO_SET_MODE,
                    param1=1.0, param2=float(custom_mode), timeout=2.0)

                if ack_result == 0:
                    for _ in range(10):
                        self._send_mavlink_set_position_target(uav_id, cur_x, cur_y, target_z)
                        time.sleep(0.05)

                    for poll in range(20):
                        with self._lock:
                            st = self.drone_states.get(uav_id)
                        if st and st.flight_mode == 'OFFBOARD':
                            offboard_ok = True
                            break
                        self._send_mavlink_set_position_target(uav_id, cur_x, cur_y, target_z)
                        time.sleep(0.1)

                    if offboard_ok:
                        break
                time.sleep(0.5)

            self._mode_change_events.pop(uav_id, None)

            if not offboard_ok:
                self.stop_offboard_heartbeat(uav_id)
                ok = False
            else:
                # ARM
                for _ in range(5):
                    self._send_mavlink_set_position_target(uav_id, cur_x, cur_y, target_z)
                    time.sleep(0.02)

                arm_result = self._send_command_and_wait_ack(
                    uav_id, MAV_CMD_COMPONENT_ARM_DISARM,
                    param1=1.0, timeout=3.0)

                for _ in range(10):
                    self._send_mavlink_set_position_target(uav_id, cur_x, cur_y, target_z)
                    time.sleep(0.05)

                ok = arm_result == 0 or arm_result is None

        elif command_type == 'LAND':
            self.stop_offboard_heartbeat(uav_id)
            lat = float(params.get('lat', 0))
            lon = float(params.get('lon', 0))
            alt = float(params.get('alt', 0))
            if lat != 0 and lon != 0:
                ok = self._send_mavlink_command_long(
                    uav_id, MAV_CMD_NAV_LAND, param5=lat, param6=lon, param7=alt)
            else:
                ok = self._send_mavlink_command_long(uav_id, MAV_CMD_NAV_LAND)

        elif command_type == 'RTL':
            self.stop_offboard_heartbeat(uav_id)
            lat = float(params.get('lat', 0))
            lon = float(params.get('lon', 0))
            if lat != 0 and lon != 0:
                alt = float(params.get('alt', 0))
                self._send_mavlink_command_long(
                    uav_id, MAV_CMD_DO_SET_HOME, param1=0.0,
                    param5=lat, param6=lon, param7=alt)
                time.sleep(0.3)
            ok = self._send_mavlink_command_long(uav_id, MAV_CMD_NAV_RETURN_TO_LAUNCH)

        elif command_type == 'HOLD':
            self.stop_orbit_heartbeat(uav_id)
            with self._lock:
                state = self.drone_states.get(uav_id)
            if state:
                hold_x = state.ned_x
                hold_y = state.ned_y
                hold_z = state.ned_z if state.ned_z != 0.0 else -5.0
                self.start_offboard_heartbeat(
                    uav_id, target_z=hold_z, target_x=hold_x, target_y=hold_y)
                custom_mode = PX4_CUSTOM_MAIN_MODE_OFFBOARD << 16
                ok = self._send_mavlink_command_long(
                    uav_id, MAV_CMD_DO_SET_MODE,
                    param1=209.0, param2=float(custom_mode))
            else:
                ok = self._send_mavlink_command_long(uav_id, MAV_CMD_NAV_LOITER_UNLIM)

        elif command_type == 'GOTO':
            self.stop_orbit_heartbeat(uav_id)
            lat = float(params.get('lat', 0))
            lon = float(params.get('lon', 0))
            alt = float(params.get('alt', 5.0))

            home = self._get_home_position(uav_id)
            if home:
                home_lat, home_lon, home_alt = home
                target_n, target_e, _ = _latlon_to_ned(
                    lat, lon, home_alt + alt, home_lat, home_lon, home_alt)
                target_z = -alt
                with self._lock:
                    state = self.drone_states.get(uav_id)
                cur_n = state.ned_x if state else 0.0
                cur_e = state.ned_y if state else 0.0
                delta_n = target_n - cur_n
                delta_e = target_e - cur_e
                dist = math.sqrt(delta_n ** 2 + delta_e ** 2)
                target_yaw = math.atan2(delta_e, delta_n) if dist > 0.5 else float('nan')

                self.start_offboard_heartbeat(
                    uav_id, target_z=target_z,
                    target_x=target_n, target_y=target_e,
                    target_yaw=target_yaw)
                custom_mode = PX4_CUSTOM_MAIN_MODE_OFFBOARD << 16
                ok = self._send_mavlink_command_long(
                    uav_id, MAV_CMD_DO_SET_MODE,
                    param1=209.0, param2=float(custom_mode))
            else:
                target_z = -alt
                self.start_offboard_heartbeat(uav_id, target_z=target_z)
                custom_mode = PX4_CUSTOM_MAIN_MODE_OFFBOARD << 16
                ok = self._send_mavlink_command_long(
                    uav_id, MAV_CMD_DO_SET_MODE,
                    param1=209.0, param2=float(custom_mode))

        elif command_type == 'MARK_HOME':
            lat = float(params.get('lat', 0))
            lon = float(params.get('lon', 0))
            alt = float(params.get('alt', 0))
            if lat != 0 and lon != 0:
                ok = self._send_mavlink_command_long(
                    uav_id, MAV_CMD_DO_SET_HOME, param1=0.0,
                    param5=lat, param6=lon, param7=alt)
                if ok:
                    with self._lock:
                        state = self.drone_states.get(uav_id)
                        if state:
                            state.home_lat = lat
                            state.home_lon = lon
                            state.home_alt = alt
            else:
                ok = self._send_mavlink_command_long(
                    uav_id, MAV_CMD_DO_SET_HOME, param1=1.0)
                if ok:
                    self._save_home_position(uav_id)

        elif command_type == 'DISARM':
            self.stop_offboard_heartbeat(uav_id)
            ok = self._send_mavlink_command_long(
                uav_id, MAV_CMD_COMPONENT_ARM_DISARM, param1=0.0)

        elif command_type == 'OFFBOARD':
            self.start_offboard_heartbeat(uav_id)
            time.sleep(0.3)
            custom_mode = PX4_CUSTOM_MAIN_MODE_OFFBOARD << 16
            ok = self._send_mavlink_command_long(
                uav_id, MAV_CMD_DO_SET_MODE,
                param1=209.0, param2=float(custom_mode))

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
                center_n, center_e, _ = _latlon_to_ned(
                    lat, lon, home_alt, home_lat, home_lon, home_alt)
            else:
                center_n, center_e, _ = _latlon_to_ned(
                    state.lat, state.lon, home_alt, home_lat, home_lon, home_alt)

            self.start_orbit_heartbeat(
                uav_id, center_n, center_e, current_alt_ned, radius, velocity)
            time.sleep(0.3)
            custom_mode = PX4_CUSTOM_MAIN_MODE_OFFBOARD << 16
            self._send_mavlink_command_long(
                uav_id, MAV_CMD_DO_SET_MODE,
                param1=209.0, param2=float(custom_mode))
            ok = True

        elif command_type == 'SET_ROI':
            lat = float(params.get('lat', 0))
            lon = float(params.get('lon', 0))
            alt = float(params.get('alt', 0))
            if lat != 0 and lon != 0:
                ok = self._send_mavlink_command_long(
                    uav_id, MAV_CMD_DO_SET_ROI_LOCATION,
                    param5=lat, param6=lon, param7=alt)
            else:
                ok = self._send_mavlink_command_long(uav_id, MAV_CMD_DO_SET_ROI_NONE)

        elif command_type == 'SET_YAW':
            yaw = float(params.get('yaw', 0))
            speed = float(params.get('speed', 30))
            relative = int(params.get('relative', 0))
            ok = self._send_mavlink_command_long(
                uav_id, MAV_CMD_CONDITION_YAW,
                param1=yaw, param2=speed, param3=0.0, param4=float(relative))

        elif command_type == 'SET_GPS_ORIGIN':
            lat = float(params.get('lat', 0))
            lon = float(params.get('lon', 0))
            alt = float(params.get('alt', 0))
            if lat != 0 and lon != 0:
                ok = self._send_mavlink_command_long(
                    uav_id, 100048, param5=lat, param6=lon, param7=alt)
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
            ok = self._send_mavlink_command_long(
                uav_id, MAV_CMD_COMPONENT_ARM_DISARM,
                param1=0.0, param2=21196.0)

        else:
            return {'success': False, 'message': f'Unknown command: {command_type}'}

        if ok:
            return {'success': True, 'message': f'{command_type} sent to {uav_id}'}
        else:
            return {'success': False, 'message': f'Failed to send {command_type}'}

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
    # OFFBOARD Heartbeat (4Hz / 10Hz for takeoff)
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
                            dist = math.sqrt(dx**2 + dy**2 + dz**2)
                            if dist < 1.5:
                                if not _arrival_logged:
                                    logger.info("[Heartbeat] %s arrived (%.2fm)", uav_id, dist)
                                    _arrival_logged = True
                                x, y, z = state.ned_x, state.ned_y, state.ned_z
                                current_sp['x'], current_sp['y'], current_sp['z'] = x, y, z

                    self._send_mavlink_set_position_target(uav_id, x, y, z, yaw=yaw)
                except Exception as e:
                    logger.error("[Heartbeat] Error: %s", e)
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

                    self._send_mavlink_set_position_target(
                        uav_id, target_n, target_e, alt_ned, yaw=yaw)
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

    def start_command_server(self, port: int = 5061):
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
                        'status': 'ok',
                        'type': 'mavlink-tx-gateway',
                        'instance_id': gw.instance_id,
                        'drones': list(gw.drone_states.keys()),
                    }).encode())
                else:
                    self.send_response(404)
                    self.end_headers()

            def log_message(self, format, *args):
                pass

        server = HTTPServer(('0.0.0.0', port), Handler)
        threading.Thread(target=server.serve_forever, daemon=True, name='cmd-server').start()
        logger.info("[HTTP] Command server on port %d", port)

    # ============================================================
    # Main Loop
    # ============================================================

    def run(self):
        self.running = True
        logger.info("=" * 60)
        logger.info("[Startup] MAVLink Tx Gateway (Instance %d/%d)",
                    self.instance_id, self.total_instances)
        logger.info("[Startup] Kafka: %s", self._kafka_bootstrap)
        logger.info("[Startup] Urgent commands: %s (retry=3)", URGENT_COMMANDS)
        logger.info("=" * 60)

        if not self._pymavlink_available:
            logger.error("[Startup] pymavlink not available. Exiting.")
            return

        # Init UDP socket for sending
        self._init_udp_socket()

        # Start UDP listener for responses
        self._start_udp_listener()

        # Start GCS heartbeat
        self._start_gcs_heartbeat()

        # Start Kafka command consumer
        self._start_kafka_command_consumer()

        # Start HTTP fallback
        base_port = int(os.environ.get('MAVLINK_TX_COMMAND_PORT', '5061'))
        self.start_command_server(port=base_port + self.instance_id)

        # Keep alive
        while self.running:
            try:
                time.sleep(1)
            except KeyboardInterrupt:
                break

        self._cleanup()

    def _cleanup(self):
        if self._udp_socket:
            try:
                self._udp_socket.close()
            except Exception:
                pass
        for addr, sock in self._tcp_connections.items():
            try:
                sock.close()
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
    parser = argparse.ArgumentParser(description='MAVLink Tx Gateway — Command Sender')
    parser.add_argument('--listen',
                        default=os.environ.get('MAVLINK_TX_LISTEN', 'udp:0.0.0.0:14551'))
    parser.add_argument('--backend-url',
                        default=os.environ.get('UCS_BACKEND_URL', 'http://localhost:8080'))
    parser.add_argument('--api-key',
                        default=os.environ.get('DDS_GATEWAY_API_KEY', 'ucs-dds-gateway-secret-2024'))
    parser.add_argument('--instance-id', type=int,
                        default=int(os.environ.get('MAVLINK_TX_INSTANCE_ID', '0')))
    parser.add_argument('--total-instances', type=int,
                        default=int(os.environ.get('MAVLINK_TX_TOTAL_INSTANCES', '1')))
    parser.add_argument('--verbose', '-v', action='store_true')
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    listen_parts = args.listen.split(':')
    if len(listen_parts) == 3:
        protocol, host, port = listen_parts[0].lower(), listen_parts[1], int(listen_parts[2])
    elif len(listen_parts) == 2:
        protocol, host, port = listen_parts[0].lower(), '0.0.0.0', int(listen_parts[1])
    else:
        protocol, host, port = 'udp', '0.0.0.0', 14551

    gateway = MavlinkTxGateway(
        backend_url=args.backend_url,
        api_key=args.api_key,
        instance_id=args.instance_id,
        total_instances=args.total_instances,
        listen_protocol=protocol,
        listen_host=host,
        listen_port=port,
    )

    def signal_handler(sig, frame):
        gateway.stop()

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    gateway.run()


if __name__ == '__main__':
    main()
