#!/usr/bin/env python3
"""
MAVLink Routing Gateway - Real Drone Telemetry Receiver & Command Forwarder

Listens on UDP/TCP for MAVLink messages from real drones, parses telemetry,
and forwards to the UCS backend via Kafka (same format as DDS Gateway).
Also consumes control commands from Kafka and translates them to MAVLink
COMMAND_LONG messages sent back to the drones.

Architecture:
    Real Drone --MAVLink(UDP/TCP)--> MAVLink Gateway --Kafka--> Backend
    Backend --Kafka(commands.down)--> MAVLink Gateway --MAVLink--> Real Drone

The gateway produces identical Kafka messages to the DDS Gateway, so the
backend and frontend require ZERO changes.

Requirements:
    pip install pymavlink kafka-python redis requests pyyaml

Usage:
    python mavlink_gateway.py --listen udp:0.0.0.0:14550
    python mavlink_gateway.py --listen tcp:0.0.0.0:5760
    python mavlink_gateway.py --config drones.yaml

Environment Variables:
    KAFKA_BOOTSTRAP_SERVERS  Kafka brokers (default: localhost:9092)
    REDIS_HOST               Redis host (default: localhost)
    REDIS_PORT               Redis port (default: 6379)
    REDIS_DB                 Redis DB index (default: 0)
    REDIS_PASSWORD           Redis password (default: None)
    UCS_BACKEND_URL          Backend URL for HTTP fallback (default: http://localhost:8080)
    DDS_GATEWAY_API_KEY      API key for backend auth
    MAVLINK_INSTANCE_ID      Instance ID for multi-instance partitioning (default: 0)
    MAVLINK_TOTAL_INSTANCES  Total gateway instances (default: 1)
"""

import argparse
import hashlib
import json
import logging
import math
import os
import signal
import socket
import struct
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Tuple

import redis
import requests

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('mavlink-gateway')

# ============================================================
# MAVLink Message IDs
# ============================================================
MAVLINK_MSG_HEARTBEAT = 0
MAVLINK_MSG_SYS_STATUS = 1
MAVLINK_MSG_GPS_RAW_INT = 24
MAVLINK_MSG_ATTITUDE = 30
MAVLINK_MSG_LOCAL_POSITION_NED = 32
MAVLINK_MSG_GLOBAL_POSITION_INT = 33
MAVLINK_MSG_COMMAND_LONG = 76
MAVLINK_MSG_COMMAND_ACK = 77
MAVLINK_MSG_BATTERY_STATUS = 147

# MAVLink Command IDs (MAV_CMD)
MAV_CMD_NAV_WAYPOINT = 16
MAV_CMD_NAV_LOITER_UNLIM = 17
MAV_CMD_NAV_RETURN_TO_LAUNCH = 20
MAV_CMD_NAV_LAND = 21
MAV_CMD_NAV_TAKEOFF = 22
MAV_CMD_DO_ORBIT = 34
MAV_CMD_DO_SET_MODE = 176
MAV_CMD_DO_SET_HOME = 179
MAV_CMD_DO_SET_ROI_LOCATION = 195
MAV_CMD_DO_SET_ROI_NONE = 197
MAV_CMD_COMPONENT_ARM_DISARM = 400
MAV_CMD_CONDITION_YAW = 115
MAV_CMD_SET_MESSAGE_INTERVAL = 511

# PX4 Custom Mode mappings for MAVLink
# PX4 uses custom_mode field in HEARTBEAT for flight mode identification
PX4_CUSTOM_MAIN_MODE_MANUAL = 1
PX4_CUSTOM_MAIN_MODE_ALTCTL = 2
PX4_CUSTOM_MAIN_MODE_POSCTL = 3
PX4_CUSTOM_MAIN_MODE_AUTO = 4
PX4_CUSTOM_MAIN_MODE_OFFBOARD = 6

PX4_CUSTOM_SUB_MODE_AUTO_LOITER = 3
PX4_CUSTOM_SUB_MODE_AUTO_MISSION = 4
PX4_CUSTOM_SUB_MODE_AUTO_RTL = 5
PX4_CUSTOM_SUB_MODE_AUTO_TAKEOFF = 2
PX4_CUSTOM_SUB_MODE_AUTO_LAND = 6


EARTH_RADIUS = 6371000.0  # meters


@dataclass
class DroneState:
    """Aggregated state for a single drone (mirrors DDS gateway DroneState)."""
    uav_id: str
    lat: float = 0.0
    lon: float = 0.0
    alt: float = 0.0          # AMSL altitude (meters)
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
    # Home position
    home_lat: float = 0.0
    home_lon: float = 0.0
    home_alt: float = 0.0
    # Reference altitude from LOCAL_POSITION_NED (home AMSL)
    ref_alt: float = 0.0
    ref_alt_valid: bool = False
    # Epoch (generation ID) - persisted in Redis
    epoch: int = 0
    # Position validity
    position_valid: bool = False
    # MAVLink connection info
    system_id: int = 0
    component_id: int = 0
    remote_addr: Optional[Tuple[str, int]] = None  # (ip, port) of the drone
    # Connection type: 'udp' or 'tcp'
    connection_type: str = 'udp'


def _latlon_to_ned(lat: float, lon: float, alt: float,
                   home_lat: float, home_lon: float, home_alt: float):
    """Convert WGS84 lat/lon/alt to NED coordinates relative to home."""
    dlat = math.radians(lat - home_lat)
    dlon = math.radians(lon - home_lon)
    north = dlat * EARTH_RADIUS
    east = dlon * EARTH_RADIUS * math.cos(math.radians(home_lat))
    down = -(alt - home_alt)
    return north, east, down


def _ip_to_uav_id(addr: Tuple[str, int]) -> str:
    """Generate a deterministic uav_id from IP:port.

    Format: mavlink_{ip}_{port}
    Examples: mavlink_192.168.1.101_14550
              mavlink_10.0.0.5_5760

    This ensures global uniqueness since source IP + port is unique per drone.
    """
    ip, port = addr
    return f"mavlink_{ip}_{port}"


class MavlinkGateway:
    """
    MAVLink Routing Gateway.

    Mirrors the DDS Gateway architecture:
    - Receives MAVLink telemetry from real drones via UDP/TCP
    - Sends telemetry to Kafka (telemetry.raw) in identical format
    - Consumes commands from Kafka (commands.down)
    - Translates commands to MAVLink COMMAND_LONG and sends to drones
    - Epoch validation, GPS jump detection, per-drone locks - all preserved
    """

    def __init__(self, backend_url: str, api_key: str, poll_interval: float = 0.1,
                 instance_id: int = 0, total_instances: int = 1,
                 listen_protocol: str = 'udp', listen_host: str = '0.0.0.0',
                 listen_port: int = 14550):
        self.backend_url = backend_url.rstrip('/')
        self.api_key = api_key
        self.poll_interval = poll_interval

        # Multi-instance partitioning
        self.instance_id = instance_id
        self.total_instances = total_instances

        # Listen configuration
        self.listen_protocol = listen_protocol
        self.listen_host = listen_host
        self.listen_port = listen_port

        # Drone states
        self.drone_states: Dict[str, DroneState] = {}
        self.running = False

        # Locks
        self._lock = threading.Lock()
        self._drone_locks: Dict[str, threading.Lock] = defaultdict(threading.Lock)
        self._stats = defaultdict(int)
        self._stats_lock = threading.Lock()
        self._last_stats_time = time.time()

        # Thread pool for command dispatch
        self._command_executor = ThreadPoolExecutor(max_workers=10, thread_name_prefix='cmd-dispatch')

        # Epoch map (persisted in Redis)
        self._epoch_map: Dict[str, int] = {}
        self._redis_epoch_prefix = 'mavlink:epoch:'
        self._redis = None
        # Redis key prefix for IP mapping
        self._redis_ip_prefix = 'mavlink:ip_map:'
        try:
            redis_host = os.environ.get('REDIS_HOST', 'localhost')
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
            logger.warning("[Redis] Connection failed (%s), epoch/IP mapping will use memory-only", e)
            self._redis = None

        # Local cache: uav_id -> (ip, port)
        self._ip_map: Dict[str, Tuple[str, int]] = {}
        # Reverse map: (ip, port) -> uav_id
        self._addr_to_uav: Dict[Tuple[str, int], str] = {}

        # Kafka producer
        self._kafka_producer = None
        self._kafka_enabled = False
        self._kafka_bootstrap = os.environ.get('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092')
        self._init_kafka()

        # HTTP session for ack forwarding
        self._ack_session = requests.Session()
        self._ack_session.headers.update({
            'X-Gateway-Key': api_key,
            'Content-Type': 'application/json',
        })
        self._ack_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix='ack-fwd')
        self._recent_acks: Dict[str, float] = {}

        # MAVLink connections: uav_id -> socket/connection
        self._mavlink_connections: Dict[str, object] = {}
        # UDP socket (shared for all UDP drones)
        self._udp_socket: Optional[socket.socket] = None
        # TCP connections: addr -> socket
        self._tcp_connections: Dict[Tuple[str, int], socket.socket] = {}

        # pymavlink import
        self._pymavlink_available = False
        try:
            from pymavlink import mavutil
            self._pymavlink_available = True
            logger.info("[Init] pymavlink available")
        except ImportError:
            logger.error("[Init] pymavlink not available. pip install pymavlink")

        # Heartbeat threads for OFFBOARD mode
        self._heartbeat_threads: Dict[str, threading.Thread] = {}
        self._heartbeat_active: Dict[str, bool] = {}
        self._heartbeat_setpoints: Dict[str, dict] = {}

        # Orbit threads
        self._orbit_threads: Dict[str, threading.Thread] = {}
        self._orbit_active: Dict[str, bool] = {}

        # GCS heartbeat thread (sends HEARTBEAT to all connected drones at 1Hz)
        self._gcs_heartbeat_thread: Optional[threading.Thread] = None

    # ============================================================
    # GCS Heartbeat (required by PX4 to consider link alive)
    # ============================================================

    def _start_gcs_heartbeat(self):
        """Start sending GCS HEARTBEAT messages to all connected drones at 1Hz.

        PX4 requires receiving HEARTBEAT from a GCS (system type MAV_TYPE_GCS)
        to clear the 'No Connection to GCS' preflight check. Without this,
        the drone will deny arming with 'Resolve system health failures first'.

        The heartbeat identifies us as:
        - type = MAV_TYPE_GCS (6)
        - autopilot = MAV_AUTOPILOT_INVALID (8) — we are not an autopilot
        - system_status = MAV_STATE_ACTIVE (4)
        - base_mode = 0 (no special modes)
        - custom_mode = 0
        """
        from pymavlink import mavutil

        def _gcs_hb_loop():
            logger.info("[GCS-HB] GCS heartbeat thread started (1Hz)")
            # MAVLink constants
            MAV_TYPE_GCS = 6
            MAV_AUTOPILOT_INVALID = 8
            MAV_STATE_ACTIVE = 4
            MAVLINK_VERSION = 3  # MAVLink 2.0

            while self.running:
                try:
                    # Build heartbeat message
                    mav = mavutil.mavlink.MAVLink(None)
                    mav.srcSystem = 255  # GCS system ID (matches QGC convention)
                    mav.srcComponent = 190  # GCS component ID

                    hb_msg = mav.heartbeat_encode(
                        MAV_TYPE_GCS,        # type
                        MAV_AUTOPILOT_INVALID,  # autopilot
                        0,                   # base_mode
                        0,                   # custom_mode
                        MAV_STATE_ACTIVE,    # system_status
                    )
                    packed = hb_msg.pack(mav)

                    # Send to all known drone addresses
                    sent_count = 0
                    for uav_id, addr in list(self._ip_map.items()):
                        try:
                            state = self.drone_states.get(uav_id)
                            if not state:
                                continue
                            conn_type = state.connection_type
                            if conn_type == 'udp' and self._udp_socket:
                                self._udp_socket.sendto(packed, addr)
                                sent_count += 1
                            elif conn_type == 'tcp':
                                tcp_sock = self._tcp_connections.get(addr)
                                if tcp_sock:
                                    tcp_sock.sendall(packed)
                                    sent_count += 1
                        except Exception as e:
                            logger.debug("[GCS-HB] Failed to send to %s: %s", uav_id, e)

                    if sent_count > 0:
                        logger.debug("[GCS-HB] Sent heartbeat to %d drones", sent_count)
                except Exception as e:
                    logger.error("[GCS-HB] Heartbeat loop error: %s", e)

                time.sleep(1.0)  # 1Hz
            logger.info("[GCS-HB] GCS heartbeat thread stopped")

        self._gcs_heartbeat_thread = threading.Thread(
            target=_gcs_hb_loop, daemon=True, name='gcs-heartbeat')
        self._gcs_heartbeat_thread.start()

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
    # IP <-> UAV ID Mapping (三级缓存: 本地 -> Redis -> PG)
    # ============================================================

    def _register_drone_ip(self, uav_id: str, addr: Tuple[str, int]):
        """Register the IP mapping for a drone.

        Write order: Redis first, then local cache, then Kafka for async PG persistence.
        Read order (in _resolve_uav_addr): local cache -> Redis -> PG (via backend API).
        """
        ip, port = addr
        addr_str = f"{ip}:{port}"

        # 1. Update Redis
        if self._redis:
            try:
                # uav_id -> ip:port
                self._redis.set(f"{self._redis_ip_prefix}{uav_id}", addr_str, ex=3600)
                # Reverse: ip:port -> uav_id
                self._redis.set(f"{self._redis_ip_prefix}rev:{addr_str}", uav_id, ex=3600)
                logger.debug("[IPMap] Redis SET %s <-> %s", uav_id, addr_str)
            except Exception as e:
                logger.warning("[IPMap] Redis SET failed: %s", e)

        # 2. Update local cache
        self._ip_map[uav_id] = addr
        self._addr_to_uav[addr] = uav_id

        # 3. Send to Kafka for backend to persist to PG
        if self._kafka_enabled and self._kafka_producer:
            try:
                event = {
                    'eventType': 'DRONE_IP_REGISTERED',
                    'uavId': uav_id,
                    'level': 'INFO',
                    'detail': json.dumps({
                        'ip': ip,
                        'port': port,
                        'protocol': self.listen_protocol,
                    }),
                    'timestamp': datetime.now(timezone.utc).isoformat(),
                }
                self._kafka_producer.send('events.drone', key=uav_id, value=event)
            except Exception as e:
                logger.warning("[IPMap] Kafka event send failed: %s", e)

    def _resolve_uav_addr(self, uav_id: str) -> Optional[Tuple[str, int]]:
        """Resolve uav_id to (ip, port). Three-level lookup: local -> Redis -> backend API."""
        # 1. Local cache
        if uav_id in self._ip_map:
            return self._ip_map[uav_id]

        # 2. Redis
        if self._redis:
            try:
                addr_str = self._redis.get(f"{self._redis_ip_prefix}{uav_id}")
                if addr_str:
                    parts = addr_str.split(':')
                    if len(parts) == 2:
                        addr = (parts[0], int(parts[1]))
                        # Backfill local cache
                        self._ip_map[uav_id] = addr
                        self._addr_to_uav[addr] = uav_id
                        logger.info("[IPMap] Resolved %s from Redis: %s", uav_id, addr_str)
                        return addr
            except Exception as e:
                logger.warning("[IPMap] Redis GET failed: %s", e)

        # 3. Backend API (PG lookup)
        try:
            resp = requests.get(
                f"{self.backend_url}/api/v1/drones/by-uav-id/{uav_id}",
                headers={'X-Gateway-Key': self.api_key},
                timeout=3,
            )
            if resp.status_code == 200:
                data = resp.json()
                ip = data.get('mavlinkIp', '')
                port = data.get('mavlinkPort', 0)
                if ip and port:
                    addr = (ip, int(port))
                    self._ip_map[uav_id] = addr
                    self._addr_to_uav[addr] = uav_id
                    # Backfill Redis
                    if self._redis:
                        try:
                            self._redis.set(
                                f"{self._redis_ip_prefix}{uav_id}",
                                f"{ip}:{port}", ex=3600)
                        except Exception:
                            pass
                    logger.info("[IPMap] Resolved %s from PG: %s:%d", uav_id, ip, port)
                    return addr
        except Exception as e:
            logger.debug("[IPMap] Backend lookup failed for %s: %s", uav_id, e)

        return None

    # ============================================================
    # Kafka
    # ============================================================

    def _init_kafka(self):
        """Initialize Kafka producer."""
        try:
            from kafka import KafkaProducer
            self._kafka_producer = KafkaProducer(
                bootstrap_servers=self._kafka_bootstrap,
                key_serializer=lambda k: k.encode('utf-8') if k else None,
                value_serializer=lambda v: json.dumps(v).encode('utf-8'),
                acks=1,
                retries=3,
                max_block_ms=5000,
                linger_ms=0,
                batch_size=16384,
            )
            self._kafka_enabled = True
            logger.info("[Kafka] Producer initialized: %s", self._kafka_bootstrap)
        except ImportError:
            logger.warning("[Kafka] kafka-python not installed. pip install kafka-python")
        except Exception as e:
            logger.warning("[Kafka] Producer init failed: %s", e)

    def _start_kafka_command_consumer(self):
        """Start background thread consuming commands from Kafka commands.down topic.

        Message format is identical to DDS gateway:
        {
            "uavId": "mavlink_192.168.1.101_14550",
            "commandType": "TAKEOFF",
            "params": "{}",
            "timestamp": "2024-01-01T00:00:00Z",
            "userId": 1,
            "commandLogId": 123,
            "epoch": 3
        }
        """
        if not self._kafka_enabled:
            logger.info("[KafkaCmd] Kafka not enabled, skipping command consumer")
            return
        try:
            from kafka import KafkaConsumer as _KafkaConsumer
            consumer = _KafkaConsumer(
                'commands.down',
                bootstrap_servers=self._kafka_bootstrap,
                group_id=f'mavlink-gateway-command-consumer-{self.instance_id}',
                value_deserializer=lambda v: json.loads(v.decode('utf-8')),
                auto_offset_reset='latest',
                enable_auto_commit=True,
                consumer_timeout_ms=1000,
            )
            logger.info("[KafkaCmd] Consumer initialized for commands.down")
        except Exception as e:
            logger.warning("[KafkaCmd] Failed to create consumer: %s", e)
            return

        def _consume_loop():
            logger.info("[KafkaCmd] Consumer thread started")
            while self.running:
                try:
                    records = consumer.poll(timeout_ms=1000)
                    for tp, messages in records.items():
                        for msg in messages:
                            try:
                                data = msg.value
                                uav_id = data.get('uavId', '')
                                command_type = data.get('commandType', '')
                                params_raw = data.get('params', '{}')
                                if isinstance(params_raw, str):
                                    params = json.loads(params_raw) if params_raw else {}
                                else:
                                    params = params_raw

                                # Only process MAVLink drones (uav_id starts with 'mavlink_')
                                if not uav_id.startswith('mavlink_'):
                                    continue

                                # Multi-instance: skip drones not owned by this instance
                                if not self._owns_drone(uav_id):
                                    continue

                                # Epoch validation
                                msg_epoch = data.get('epoch', 0)
                                current_epoch = self._epoch_map.get(uav_id, 0)
                                if msg_epoch > 0 and current_epoch > 0 and msg_epoch < current_epoch:
                                    logger.warning(
                                        "[KafkaCmd] Stale command for %s: msg_epoch=%d < current=%d, discarding",
                                        uav_id, msg_epoch, current_epoch)
                                    continue

                                # Timestamp validation (60s window)
                                ts_str = data.get('timestamp', '')
                                if ts_str:
                                    try:
                                        cmd_time = datetime.fromisoformat(
                                            ts_str.replace('Z', '+00:00'))
                                        age = (datetime.now(timezone.utc) - cmd_time).total_seconds()
                                        if age > 60:
                                            logger.warning(
                                                "[KafkaCmd] Expired command for %s: age=%.1fs",
                                                uav_id, age)
                                            continue
                                    except (ValueError, TypeError):
                                        pass

                                logger.info("[KafkaCmd] Received: %s -> %s params=%s",
                                            command_type, uav_id, params)

                                command_log_id = data.get('commandLogId', 0)
                                epoch = data.get('epoch', 0)

                                # Dispatch command
                                result = self.handle_command(uav_id, command_type, params)

                                # Send ACK
                                self._send_command_ack(
                                    uav_id, command_type, result,
                                    epoch, command_log_id)

                            except Exception as e:
                                logger.error("[KafkaCmd] Error processing message: %s", e)
                except Exception as e:
                    if self.running:
                        logger.error("[KafkaCmd] Poll error: %s", e)
                        time.sleep(1)
            logger.info("[KafkaCmd] Consumer thread stopped")

        t = threading.Thread(target=_consume_loop, daemon=True, name='kafka-cmd-consumer')
        t.start()

    def _send_command_ack(self, uav_id: str, command_type: str, result: dict,
                          epoch: int, command_log_id: int):
        """Send command acknowledgment to Kafka commands.ack topic."""
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
            logger.info("[KafkaCmd] ACK sent: %s -> %s success=%s", command_type, uav_id, success)
        except Exception as e:
            logger.error("[KafkaCmd] ACK send failed: %s", e)

    def send_to_kafka(self, payload: dict) -> bool:
        """Send telemetry to Kafka (identical format to DDS gateway)."""
        if not self._kafka_enabled or not self._kafka_producer:
            return False
        try:
            timestamp_ms = int(time.time() * 1000)
            drones = payload.get('drones', [])
            for drone_data in drones:
                uav_id = drone_data.get('uavId', '')
                if not uav_id:
                    continue
                msg = dict(drone_data)
                msg['timestamp'] = timestamp_ms
                msg['epoch'] = self._epoch_map.get(uav_id, 0)
                self._kafka_producer.send('telemetry.raw', key=uav_id, value=msg)
            with self._stats_lock:
                self._stats['kafka_success'] += 1
            return True
        except Exception as e:
            logger.error("[Kafka] Send failed: %s", e)
            with self._stats_lock:
                self._stats['kafka_errors'] += 1
            return False

    def send_event_to_kafka(self, event_type: str, uav_id: str, level: str, detail: str):
        """Send a drone event to events.drone Kafka topic."""
        if not self._kafka_enabled or not self._kafka_producer:
            return
        try:
            event = {
                'eventType': event_type,
                'uavId': uav_id,
                'level': level,
                'detail': detail,
                'timestamp': datetime.now(timezone.utc).isoformat(),
            }
            self._kafka_producer.send('events.drone', key=uav_id, value=event)
            logger.info("[Kafka] Event sent: %s %s %s", event_type, uav_id, detail)
        except Exception as e:
            logger.error("[Kafka] Event send failed: %s", e)

    def send_to_backend(self, payload: dict) -> bool:
        """Send telemetry batch to backend REST API (HTTP fallback)."""
        try:
            resp = requests.post(
                f"{self.backend_url}/api/v1/dds-gateway/telemetry",
                json=payload,
                headers={
                    "X-Gateway-Key": self.api_key,
                    "Content-Type": "application/json"
                },
                timeout=5
            )
            if resp.status_code == 200:
                with self._stats_lock:
                    self._stats['backend_success'] += 1
                return True
            else:
                logger.error("[Forward] Backend HTTP %d: %s",
                             resp.status_code, resp.text[:200])
                with self._stats_lock:
                    self._stats['backend_errors'] += 1
                return False
        except Exception as e:
            logger.error("[Forward] Send failed: %s", e)
            with self._stats_lock:
                self._stats['backend_errors'] += 1
            return False

    # ============================================================
    # Epoch Management (identical to DDS gateway)
    # ============================================================

    def _get_or_increment_epoch(self, uav_id: str, is_new: bool = False) -> int:
        """Get or increment epoch for a drone, persisted in Redis."""
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
            logger.info("[Epoch] New drone %s, epoch=1", uav_id)
        elif is_new:
            self._epoch_map[uav_id] += 1
            logger.info("[Epoch] Drone %s reconnected, epoch=%d",
                        uav_id, self._epoch_map[uav_id])

        if self._redis:
            try:
                self._redis.set(redis_key, self._epoch_map[uav_id])
            except Exception as e:
                logger.warning("[Epoch] Redis SET failed for %s: %s", uav_id, e)

        return self._epoch_map[uav_id]

    def _start_epoch_maintenance(self):
        """Start periodic epoch maintenance (identical to DDS gateway)."""
        EPOCH_SOFT_LIMIT = 10000
        MAX_IDLE_SECONDS = 24 * 3600
        MAINTENANCE_INTERVAL = 6 * 3600

        def _maintenance_loop():
            logger.info("[EpochMaint] Maintenance thread started")
            while self.running:
                time.sleep(MAINTENANCE_INTERVAL)
                if not self.running:
                    break
                now = time.time()
                normalized = 0
                evicted = 0
                uav_ids = list(self._epoch_map.keys())
                for uav_id in uav_ids:
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
            logger.info("[EpochMaint] Maintenance thread stopped")

        t = threading.Thread(target=_maintenance_loop, daemon=True, name='epoch-maintenance')
        t.start()

    # ============================================================
    # MAVLink Message Parsing
    # ============================================================

    def _on_heartbeat(self, uav_id: str, msg):
        """Process MAVLink HEARTBEAT (#0) message.

        Extracts armed state and flight mode from base_mode and custom_mode.
        """
        lock = self._drone_locks[uav_id]
        with lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return
            # Armed: bit 7 of base_mode
            s.armed = bool(msg.base_mode & 0x80)

            # Flight mode from custom_mode (PX4 encoding)
            custom_mode = msg.custom_mode
            main_mode = (custom_mode >> 16) & 0xFF
            sub_mode = (custom_mode >> 24) & 0xFF
            s.flight_mode = self._decode_px4_mode(main_mode, sub_mode)

            s.last_update = time.time()
            s.msg_count += 1
        with self._stats_lock:
            self._stats[f'{uav_id}/heartbeat'] += 1
            self._stats['total_messages'] += 1

    def _on_global_position_int(self, uav_id: str, msg):
        """Process MAVLink GLOBAL_POSITION_INT (#33) message.

        Fields: lat (degE7), lon (degE7), alt (mm AMSL), relative_alt (mm AGL),
                vx/vy/vz (cm/s), hdg (cdeg)
        """
        lock = self._drone_locks[uav_id]
        with lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return

            lat = msg.lat / 1e7
            lon = msg.lon / 1e7
            alt = msg.alt / 1000.0  # mm -> m (AMSL)
            now = time.time()

            # Protection 1: (0,0) coordinate rejection
            if s.position_valid and abs(lat) < 1.0 and abs(lon) < 1.0:
                logger.debug("[GPS] %s rejected (0,0) rollback", uav_id)
                s.last_update = now
                s.msg_count += 1
                with self._stats_lock:
                    self._stats[f'{uav_id}/global_position'] += 1
                    self._stats['total_messages'] += 1
                return

            # Protection 2: GPS jump detection
            if s.position_valid and s.ground_speed is not None:
                dt = now - s.last_update
                if 0 < dt < 5:
                    dlat_m = (lat - s.lat) * 111320
                    dlon_m = (lon - s.lon) * 111320 * math.cos(math.radians(s.lat))
                    distance = math.sqrt(dlat_m ** 2 + dlon_m ** 2)
                    max_possible = (s.ground_speed + 10) * dt
                    if distance > max(max_possible, 100):
                        logger.warning("[GPS] %s rejected jump: %.0fm in %.1fs",
                                       uav_id, distance, dt)
                        with self._stats_lock:
                            self._stats[f'{uav_id}/gps_jump_rejected'] += 1
                        return

            # Protection 3: Altitude anomaly (>500m jump)
            if s.position_valid and abs(alt - s.alt) > 500:
                logger.warning("[GPS] %s rejected altitude jump: %.1f -> %.1f",
                               uav_id, s.alt, alt)
                with self._stats_lock:
                    self._stats[f'{uav_id}/alt_jump_rejected'] += 1
                return

            s.lat = lat
            s.lon = lon
            s.alt = alt

            # relative_alt from MAVLink (mm AGL -> m)
            if hasattr(msg, 'relative_alt'):
                # This is the altitude relative to home, exactly what we need
                rel_alt_m = msg.relative_alt / 1000.0
                # Use this as our primary relative altitude source
                # It's more reliable than computing alt - ref_alt ourselves
                s.ned_z = -rel_alt_m  # NED: z negative = up

            # Heading from hdg field (centidegrees)
            if hasattr(msg, 'hdg') and msg.hdg != 65535:  # 65535 = unknown
                s.heading = msg.hdg / 100.0

            # Velocities (cm/s -> m/s)
            if hasattr(msg, 'vx'):
                s.vx = msg.vx / 100.0
            if hasattr(msg, 'vy'):
                s.vy = msg.vy / 100.0
            if hasattr(msg, 'vz'):
                s.vz = msg.vz / 100.0
                s.vertical_speed = -msg.vz / 100.0  # NED: positive vz = down
            s.ground_speed = math.sqrt(s.vx ** 2 + s.vy ** 2)

            if not s.position_valid:
                s.position_valid = True
                logger.info("[GPS] %s position valid: lat=%.6f lon=%.6f alt=%.1f",
                            uav_id, lat, lon, alt)

            s.last_update = now
            s.msg_count += 1
        with self._stats_lock:
            self._stats[f'{uav_id}/global_position'] += 1
            self._stats['total_messages'] += 1

    def _on_local_position_ned(self, uav_id: str, msg):
        """Process MAVLink LOCAL_POSITION_NED (#32) message.

        Fields: x/y/z (m, NED), vx/vy/vz (m/s)
        """
        lock = self._drone_locks[uav_id]
        with lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return
            s.ned_x = msg.x
            s.ned_y = msg.y
            s.ned_z = msg.z
            s.vx = msg.vx
            s.vy = msg.vy
            s.vz = msg.vz
            s.ground_speed = math.sqrt(msg.vx ** 2 + msg.vy ** 2)
            s.vertical_speed = -msg.vz  # NED: positive vz = down
            s.last_update = time.time()
            s.msg_count += 1
        with self._stats_lock:
            self._stats[f'{uav_id}/local_position'] += 1
            self._stats['total_messages'] += 1

    def _on_attitude(self, uav_id: str, msg):
        """Process MAVLink ATTITUDE (#30) message.

        Fields: roll, pitch, yaw (rad), rollspeed, pitchspeed, yawspeed (rad/s)
        """
        lock = self._drone_locks[uav_id]
        with lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return
            s.heading = math.degrees(msg.yaw) % 360
            s.last_update = time.time()
            s.msg_count += 1
        with self._stats_lock:
            self._stats[f'{uav_id}/attitude'] += 1
            self._stats['total_messages'] += 1

    def _on_sys_status(self, uav_id: str, msg):
        """Process MAVLink SYS_STATUS (#1) message.

        Fields: battery_remaining (%), voltage_battery (mV), current_battery (cA)
        """
        lock = self._drone_locks[uav_id]
        with lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return
            if hasattr(msg, 'battery_remaining') and msg.battery_remaining >= 0:
                s.battery_percent = float(msg.battery_remaining)
            s.last_update = time.time()
            s.msg_count += 1
        with self._stats_lock:
            self._stats[f'{uav_id}/sys_status'] += 1
            self._stats['total_messages'] += 1

    def _on_command_ack(self, uav_id: str, msg):
        """Process MAVLink COMMAND_ACK (#77) message.

        Forwards to backend via Kafka commands.ack topic.
        """
        command = msg.command
        result = msg.result
        logger.info("[CommandAck] %s: command=%d result=%d", uav_id, command, result)
        with self._stats_lock:
            self._stats[f'{uav_id}/command_ack'] += 1
            self._stats['total_messages'] += 1

        # Deduplicate
        ack_key = f"{uav_id}:{command}:{result}"
        now = time.time()
        last_forwarded = self._recent_acks.get(ack_key, 0)
        if now - last_forwarded < 2.0:
            return
        self._recent_acks[ack_key] = now

        if len(self._recent_acks) > 100:
            cutoff = now - 5.0
            self._recent_acks = {k: v for k, v in self._recent_acks.items() if v > cutoff}

        # Forward via Kafka
        try:
            ack_payload = {
                'uavId': uav_id,
                'command': int(command),
                'result': int(result),
                'timestamp': now,
                'epoch': self._epoch_map.get(uav_id, 0),
            }
            self._ack_executor.submit(self._forward_command_ack, ack_payload)
        except Exception as e:
            logger.error("[CommandAck] Failed to forward: %s", e)

    def _forward_command_ack(self, ack_payload: dict):
        """Forward command ack to Kafka (primary) and HTTP (fallback)."""
        kafka_ok = False
        if self._kafka_enabled and self._kafka_producer:
            try:
                uav_id = ack_payload.get('uavId', '')
                self._kafka_producer.send('commands.ack', key=uav_id, value=ack_payload)
                self._kafka_producer.flush(timeout=2)
                kafka_ok = True
            except Exception as e:
                logger.warning("[CommandAck] Kafka failed, falling back to HTTP: %s", e)

        if not kafka_ok:
            try:
                resp = self._ack_session.post(
                    f"{self.backend_url}/api/v1/dds-gateway/command-ack",
                    json=ack_payload, timeout=3)
                if resp.status_code != 200:
                    logger.warning("[CommandAck] Backend returned %d", resp.status_code)
            except Exception as e:
                logger.error("[CommandAck] HTTP forward failed: %s", e)

    @staticmethod
    def _decode_px4_mode(main_mode: int, sub_mode: int) -> str:
        """Decode PX4 custom_mode to human-readable flight mode string."""
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

    # ============================================================
    # MAVLink Listener (UDP/TCP)
    # ============================================================

    def _start_udp_listener(self):
        """Start UDP listener for MAVLink messages."""
        from pymavlink import mavutil

        self._udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._udp_socket.bind((self.listen_host, self.listen_port))
        self._udp_socket.settimeout(1.0)
        logger.info("[UDP] Listening on %s:%d", self.listen_host, self.listen_port)

        # Create a mavutil connection for parsing
        mav = mavutil.mavlink.MAVLink(None)
        mav.robust_parsing = True

        def _udp_loop():
            logger.info("[UDP] Listener thread started")
            while self.running:
                try:
                    data, addr = self._udp_socket.recvfrom(65535)
                    if not data:
                        continue

                    # Parse MAVLink messages from the raw bytes
                    msgs = self._parse_mavlink_bytes(data, mav)
                    for parsed_msg in msgs:
                        self._dispatch_mavlink_message(parsed_msg, addr, 'udp')

                except socket.timeout:
                    continue
                except Exception as e:
                    if self.running:
                        logger.error("[UDP] Error: %s", e)
                        time.sleep(0.1)
            logger.info("[UDP] Listener thread stopped")

        t = threading.Thread(target=_udp_loop, daemon=True, name='udp-listener')
        t.start()

    def _start_tcp_listener(self):
        """Start TCP listener for MAVLink connections."""
        server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server_socket.bind((self.listen_host, self.listen_port))
        server_socket.listen(50)
        server_socket.settimeout(1.0)
        logger.info("[TCP] Listening on %s:%d", self.listen_host, self.listen_port)

        def _accept_loop():
            logger.info("[TCP] Accept thread started")
            while self.running:
                try:
                    client_sock, addr = server_socket.accept()
                    logger.info("[TCP] New connection from %s:%d", addr[0], addr[1])
                    self._tcp_connections[addr] = client_sock
                    # Spawn a reader thread for this connection
                    t = threading.Thread(
                        target=self._tcp_client_handler,
                        args=(client_sock, addr),
                        daemon=True,
                        name=f"tcp-client-{addr[0]}:{addr[1]}")
                    t.start()
                except socket.timeout:
                    continue
                except Exception as e:
                    if self.running:
                        logger.error("[TCP] Accept error: %s", e)
            server_socket.close()
            logger.info("[TCP] Accept thread stopped")

        t = threading.Thread(target=_accept_loop, daemon=True, name='tcp-accept')
        t.start()

    def _tcp_client_handler(self, client_sock: socket.socket, addr: Tuple[str, int]):
        """Handle a single TCP client connection."""
        from pymavlink import mavutil
        mav = mavutil.mavlink.MAVLink(None)
        mav.robust_parsing = True

        client_sock.settimeout(5.0)
        logger.info("[TCP] Handler started for %s:%d", addr[0], addr[1])

        while self.running:
            try:
                data = client_sock.recv(65535)
                if not data:
                    logger.info("[TCP] Connection closed by %s:%d", addr[0], addr[1])
                    break
                msgs = self._parse_mavlink_bytes(data, mav)
                for parsed_msg in msgs:
                    self._dispatch_mavlink_message(parsed_msg, addr, 'tcp')
            except socket.timeout:
                continue
            except ConnectionResetError:
                logger.warning("[TCP] Connection reset by %s:%d", addr[0], addr[1])
                break
            except Exception as e:
                if self.running:
                    logger.error("[TCP] Client %s:%d error: %s", addr[0], addr[1], e)
                break

        # Cleanup
        try:
            client_sock.close()
        except Exception:
            pass
        self._tcp_connections.pop(addr, None)

        # Mark drone offline if we know it
        uav_id = self._addr_to_uav.get(addr)
        if uav_id:
            self.send_event_to_kafka('DRONE_OFFLINE', uav_id, 'WARN',
                                     f'TCP connection lost from {addr[0]}:{addr[1]}')
        logger.info("[TCP] Handler stopped for %s:%d", addr[0], addr[1])

    def _parse_mavlink_bytes(self, data: bytes, mav) -> list:
        """Parse raw bytes into MAVLink message objects."""
        messages = []
        try:
            for byte in data:
                parsed = mav.parse_char(bytes([byte]))
                if parsed:
                    messages.append(parsed)
        except Exception as e:
            logger.debug("[Parse] MAVLink parse error: %s", e)
        return messages

    def _dispatch_mavlink_message(self, msg, addr: Tuple[str, int], protocol: str):
        """Route a parsed MAVLink message to the appropriate handler."""
        msg_type = msg.get_type()
        sys_id = msg.get_srcSystem()
        comp_id = msg.get_srcComponent()

        # Determine uav_id from address
        uav_id = self._addr_to_uav.get(addr)

        if uav_id is None:
            # First message from this address - register the drone
            uav_id = _ip_to_uav_id(addr)

            if not self._owns_drone(uav_id):
                return  # Not our drone in multi-instance mode

            is_new = uav_id not in self.drone_states
            with self._lock:
                if uav_id not in self.drone_states:
                    self.drone_states[uav_id] = DroneState(
                        uav_id=uav_id,
                        system_id=sys_id,
                        component_id=comp_id,
                        remote_addr=addr,
                        connection_type=protocol,
                    )
                    logger.info("[Discovery] New MAVLink drone: %s from %s:%d (sys_id=%d)",
                                uav_id, addr[0], addr[1], sys_id)

            # Register IP mapping
            self._register_drone_ip(uav_id, addr)

            # Epoch management
            epoch = self._get_or_increment_epoch(uav_id, is_new=is_new)
            with self._lock:
                state = self.drone_states.get(uav_id)
                if state:
                    state.epoch = epoch

            if is_new:
                self.send_event_to_kafka('DRONE_ONLINE', uav_id, 'INFO',
                                         f'MAVLink drone connected from {addr[0]}:{addr[1]} (epoch={epoch})')

        # Dispatch to handler based on message type
        if msg_type == 'HEARTBEAT':
            self._on_heartbeat(uav_id, msg)
        elif msg_type == 'GLOBAL_POSITION_INT':
            self._on_global_position_int(uav_id, msg)
        elif msg_type == 'LOCAL_POSITION_NED':
            self._on_local_position_ned(uav_id, msg)
        elif msg_type == 'ATTITUDE':
            self._on_attitude(uav_id, msg)
        elif msg_type == 'SYS_STATUS':
            self._on_sys_status(uav_id, msg)
        elif msg_type == 'COMMAND_ACK':
            self._on_command_ack(uav_id, msg)
        elif msg_type == 'BATTERY_STATUS':
            self._on_battery_status_msg(uav_id, msg)

    def _on_battery_status_msg(self, uav_id: str, msg):
        """Process MAVLink BATTERY_STATUS (#147)."""
        lock = self._drone_locks[uav_id]
        with lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return
            if hasattr(msg, 'battery_remaining') and msg.battery_remaining >= 0:
                s.battery_percent = float(msg.battery_remaining)
            s.last_update = time.time()
            s.msg_count += 1
        with self._stats_lock:
            self._stats[f'{uav_id}/battery_status'] += 1
            self._stats['total_messages'] += 1

    # ============================================================
    # MAVLink Command Sending
    # ============================================================

    def _send_mavlink_command_long(self, uav_id: str, command: int,
                                   param1: float = 0, param2: float = 0,
                                   param3: float = 0, param4: float = 0,
                                   param5: float = 0, param6: float = 0,
                                   param7: float = 0) -> bool:
        """Send MAVLink COMMAND_LONG to a drone.

        Resolves uav_id to (ip, port) and sends via the appropriate connection.
        """
        from pymavlink import mavutil

        addr = self._resolve_uav_addr(uav_id)
        if not addr:
            logger.error("[Command] Cannot resolve address for %s", uav_id)
            return False

        state = self.drone_states.get(uav_id)
        target_sys = state.system_id if state else 1
        target_comp = state.component_id if (state and state.component_id) else 1

        try:
            # Build COMMAND_LONG message
            mav = mavutil.mavlink.MAVLink(None)
            mav.srcSystem = 255  # GCS system ID
            mav.srcComponent = 190  # Match QGC convention

            cmd_msg = mav.command_long_encode(
                target_sys, target_comp,
                command, 0,  # confirmation
                param1, param2, param3, param4, param5, param6, param7
            )
            packed = cmd_msg.pack(mav)

            # Send via appropriate protocol
            conn_type = state.connection_type if state else self.listen_protocol
            if conn_type == 'udp' and self._udp_socket:
                self._udp_socket.sendto(packed, addr)
            elif conn_type == 'tcp':
                tcp_sock = self._tcp_connections.get(addr)
                if tcp_sock:
                    tcp_sock.sendall(packed)
                else:
                    logger.error("[Command] No TCP connection for %s (%s:%d)",
                                 uav_id, addr[0], addr[1])
                    return False

            logger.info("[Command] Sent COMMAND_LONG cmd=%d p1=%.1f p2=%.1f p5=%.6f p6=%.6f p7=%.1f -> %s (sys=%d)",
                        command, param1, param2, param5, param6, param7, uav_id, target_sys)
            return True
        except Exception as e:
            logger.error("[Command] Failed to send COMMAND_LONG: %s", e)
            return False

    def _send_mavlink_set_position_target(self, uav_id: str,
                                           x: float, y: float, z: float,
                                           yaw: float = float('nan')) -> bool:
        """Send SET_POSITION_TARGET_LOCAL_NED for OFFBOARD position control.

        This is the MAVLink equivalent of the DDS TrajectorySetpoint.
        """
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

            # type_mask: ignore velocity and acceleration, use position + yaw
            # Bits: 0=x, 1=y, 2=z, 3=vx, 4=vy, 5=vz, 6=ax, 7=ay, 8=az, 10=yaw, 11=yaw_rate
            type_mask = 0b0000101111111000  # Use position (0-2) + yaw (10)
            if math.isnan(yaw):
                type_mask |= (1 << 10)  # Ignore yaw if NaN

            msg = mav.set_position_target_local_ned_encode(
                0,  # time_boot_ms (not used)
                target_sys, target_comp,
                mavutil.mavlink.MAV_FRAME_LOCAL_NED,
                type_mask,
                x, y, z,  # position (NED)
                0, 0, 0,  # velocity
                0, 0, 0,  # acceleration
                yaw if not math.isnan(yaw) else 0,  # yaw
                0   # yaw_rate
            )
            packed = msg.pack(mav)

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
            logger.error("[Command] Failed to send SET_POSITION_TARGET: %s", e)
            return False

    # ============================================================
    # Command Handling (mirrors DDS gateway handle_command)
    # ============================================================

    def handle_command(self, uav_id: str, command_type: str, params: dict) -> dict:
        """Handle a command from the backend, translate to MAVLink."""
        command_type = command_type.upper()
        logger.info("[Command] Handling %s for %s params=%s", command_type, uav_id, params)

        ok = False

        if command_type == 'TAKEOFF':
            relative_alt = float(params.get('altitude', params.get('defaultAltitude', 5.0)))
            target_z = -relative_alt  # NED (up is negative)

            # Save home position
            self._save_home_position(uav_id)

            # MAVLink takeoff differs from DDS:
            # - DDS uses OFFBOARD mode with TrajectorySetpoint (external control)
            # - MAVLink uses PX4's native AUTO.TAKEOFF mode (internal control)
            #
            # Critical: set AUTO.TAKEOFF mode BEFORE arming!
            # If we ARM first without a valid flight mode, PX4's "auto preflight
            # disarming" triggers after ~10s because no takeoff activity is detected.
            # By switching to AUTO.TAKEOFF while still disarmed, PX4 knows to
            # start climbing immediately upon ARM.
            #
            # Sequence: AUTO.TAKEOFF mode → NAV_TAKEOFF (altitude) → ARM
            # After reaching altitude, PX4 transitions to AUTO.LOITER.

            # Step 1: Switch to AUTO.TAKEOFF mode while still disarmed
            # PX4 custom mode encoding: main_mode in bits 16-23, sub_mode in bits 24-31
            auto_takeoff_mode = (PX4_CUSTOM_MAIN_MODE_AUTO << 16) | \
                                (PX4_CUSTOM_SUB_MODE_AUTO_TAKEOFF << 24)
            self._send_mavlink_command_long(
                uav_id, MAV_CMD_DO_SET_MODE,
                param1=1.0,  # MAV_MODE_FLAG_CUSTOM_MODE_ENABLED (not armed yet)
                param2=float(auto_takeoff_mode))
            logger.info("[Command] AUTO.TAKEOFF mode set for %s", uav_id)

            time.sleep(0.5)

            # Step 2: Send NAV_TAKEOFF to set target altitude
            # param4=NaN (yaw unchanged), param7=altitude (relative, meters)
            self._send_mavlink_command_long(
                uav_id, MAV_CMD_NAV_TAKEOFF,
                param4=float('nan'),
                param7=relative_alt)

            time.sleep(0.3)

            # Step 3: ARM - PX4 is already in AUTO.TAKEOFF, will climb immediately
            ok = self._send_mavlink_command_long(
                uav_id, MAV_CMD_COMPONENT_ARM_DISARM, param1=1.0)

            logger.info("[Command] MAVLink TAKEOFF for %s: mode→ARM (%.1fm AGL) ok=%s",
                        uav_id, relative_alt, ok)

        elif command_type == 'LAND':
            self.stop_offboard_heartbeat(uav_id)
            lat = float(params.get('lat', 0))
            lon = float(params.get('lon', 0))
            alt = float(params.get('alt', 0))
            if lat != 0 and lon != 0:
                ok = self._send_mavlink_command_long(
                    uav_id, MAV_CMD_NAV_LAND,
                    param5=lat, param6=lon, param7=alt)
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
            ok = self._send_mavlink_command_long(
                uav_id, MAV_CMD_NAV_RETURN_TO_LAUNCH)

        elif command_type == 'HOLD':
            self.stop_orbit_heartbeat(uav_id)
            with self._lock:
                state = self.drone_states.get(uav_id)
            if state:
                hold_x = state.ned_x
                hold_y = state.ned_y
                hold_z = state.ned_z if state.ned_z != 0.0 else -5.0
                self.start_offboard_heartbeat(
                    uav_id, target_z=hold_z,
                    target_x=hold_x, target_y=hold_y)
                custom_mode = PX4_CUSTOM_MAIN_MODE_OFFBOARD << 16
                ok = self._send_mavlink_command_long(
                    uav_id, MAV_CMD_DO_SET_MODE,
                    param1=209.0, param2=float(custom_mode))
            else:
                ok = self._send_mavlink_command_long(
                    uav_id, MAV_CMD_NAV_LOITER_UNLIM)

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
                if dist > 0.5:
                    target_yaw = math.atan2(delta_e, delta_n)
                else:
                    target_yaw = float('nan')

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
                ok = self._send_mavlink_command_long(
                    uav_id, MAV_CMD_DO_SET_ROI_NONE)

        elif command_type == 'SET_YAW':
            yaw = float(params.get('yaw', 0))
            speed = float(params.get('speed', 30))
            relative = int(params.get('relative', 0))
            ok = self._send_mavlink_command_long(
                uav_id, MAV_CMD_CONDITION_YAW,
                param1=yaw, param2=speed,
                param3=0.0, param4=float(relative))

        elif command_type == 'SET_GPS_ORIGIN':
            lat = float(params.get('lat', 0))
            lon = float(params.get('lon', 0))
            alt = float(params.get('alt', 0))
            if lat != 0 and lon != 0:
                ok = self._send_mavlink_command_long(
                    uav_id, 100048,
                    param5=lat, param6=lon, param7=alt)
            else:
                return {'success': False, 'message': 'SET_GPS_ORIGIN requires lat and lon'}

        elif command_type == 'GET_HOME':
            home = self._get_home_position(uav_id)
            if home:
                return {'success': True, 'message': 'Home position retrieved',
                        'home': {'lat': home[0], 'lon': home[1], 'alt': home[2]}}
            return {'success': False, 'message': f'No home position for {uav_id}'}

        else:
            return {'success': False, 'message': f'Unknown command: {command_type}'}

        if ok:
            return {'success': True, 'message': f'{command_type} sent to {uav_id}'}
        else:
            return {'success': False, 'message': f'Failed to send {command_type} via MAVLink'}

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
                logger.info("[Home] Saved for %s: lat=%.6f lon=%.6f alt=%.2f",
                            uav_id, state.home_lat, state.home_lon, state.home_alt)
                return True
        return False

    def _get_home_position(self, uav_id: str):
        with self._lock:
            state = self.drone_states.get(uav_id)
            if state and state.home_lat != 0.0:
                return state.home_lat, state.home_lon, state.home_alt
        return None

    # ============================================================
    # Offboard Heartbeat (mirrors DDS gateway)
    # ============================================================

    def start_offboard_heartbeat(self, uav_id: str, interval: float = 0.25,
                                 target_z: float = None,
                                 target_x: float = None,
                                 target_y: float = None,
                                 target_yaw: float = None):
        """Start sending SET_POSITION_TARGET_LOCAL_NED at 4Hz for OFFBOARD mode."""
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
            logger.info("[Heartbeat] Updated setpoint for %s", uav_id)
            return

        self._heartbeat_active[uav_id] = True

        def _heartbeat_loop():
            logger.info("[Heartbeat] Started for %s at %.1f Hz", uav_id, 1.0 / interval)
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
                        hb_lock = self._drone_locks[uav_id]
                        with hb_lock:
                            state = self.drone_states.get(uav_id)
                        if state:
                            dx = state.ned_x - x
                            dy = state.ned_y - y
                            dz = state.ned_z - z if not math.isnan(z) else 0
                            dist_3d = math.sqrt(dx ** 2 + dy ** 2 + dz ** 2)
                            if dist_3d < 1.5:
                                if not _arrival_logged:
                                    logger.info("[Heartbeat] %s arrived (dist=%.2fm), switching to hover",
                                                uav_id, dist_3d)
                                    _arrival_logged = True
                                x = state.ned_x
                                y = state.ned_y
                                z = state.ned_z
                                current_sp['x'] = x
                                current_sp['y'] = y
                                current_sp['z'] = z

                    self._send_mavlink_set_position_target(uav_id, x, y, z, yaw=yaw)
                except Exception as e:
                    logger.error("[Heartbeat] Error for %s: %s", uav_id, e)
                time.sleep(interval)
            logger.info("[Heartbeat] Stopped for %s", uav_id)

        t = threading.Thread(target=_heartbeat_loop, daemon=True, name=f"heartbeat-{uav_id}")
        t.start()
        self._heartbeat_threads[key] = t

    def stop_offboard_heartbeat(self, uav_id: str):
        self._heartbeat_active[uav_id] = False
        self._heartbeat_setpoints.pop(uav_id, None)
        self.stop_orbit_heartbeat(uav_id)

    def start_orbit_heartbeat(self, uav_id: str, center_n: float, center_e: float,
                              alt_ned: float, radius: float, velocity: float,
                              interval: float = 0.1):
        """Start OFFBOARD circular orbit (mirrors DDS gateway)."""
        orbit_key = f"orbit_{uav_id}"
        self.stop_orbit_heartbeat(uav_id)
        self._orbit_active[uav_id] = True
        omega = velocity / radius

        def _orbit_loop():
            logger.info("[Orbit] Started for %s: center=(%.1f,%.1f) r=%.1fm v=%.1fm/s",
                        uav_id, center_n, center_e, radius, velocity)
            arrived = False
            t0 = 0
            initial_angle = 0

            while self._orbit_active.get(uav_id, False) and self.running:
                try:
                    orbit_lock = self._drone_locks[uav_id]
                    with orbit_lock:
                        state = self.drone_states.get(uav_id)
                    if not state:
                        time.sleep(interval)
                        continue

                    dx = state.ned_x - center_n
                    dy = state.ned_y - center_e
                    dist = math.sqrt(dx ** 2 + dy ** 2)

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
                    logger.error("[Orbit] Error for %s: %s", uav_id, e)
                time.sleep(interval)
            logger.info("[Orbit] Stopped for %s", uav_id)

        t = threading.Thread(target=_orbit_loop, daemon=True, name=f"orbit-{uav_id}")
        t.start()
        self._orbit_threads[orbit_key] = t

    def stop_orbit_heartbeat(self, uav_id: str):
        self._orbit_active[uav_id] = False

    # ============================================================
    # Command HTTP Server (fallback, same as DDS gateway)
    # ============================================================

    def start_command_server(self, port: int = 5060):
        """Start HTTP server for receiving commands (fallback to Kafka)."""
        from http.server import HTTPServer, BaseHTTPRequestHandler

        gateway = self

        class CommandHandler(BaseHTTPRequestHandler):
            def do_POST(self):
                if self.path == '/api/command':
                    content_length = int(self.headers.get('Content-Length', 0))
                    body = self.rfile.read(content_length)
                    try:
                        data = json.loads(body)
                        uav_id = data.get('uavId', '')
                        command_type = data.get('commandType', '')
                        params = data.get('params', {})
                        if isinstance(params, str):
                            params = json.loads(params) if params else {}
                        result = gateway.handle_command(uav_id, command_type, params)
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
                        'type': 'mavlink-gateway',
                        'drones': list(gateway.drone_states.keys()),
                        'protocol': gateway.listen_protocol,
                    }).encode())
                else:
                    self.send_response(404)
                    self.end_headers()

            def log_message(self, format, *args):
                logger.debug("[CommandServer] %s", format % args)

        server = HTTPServer(('0.0.0.0', port), CommandHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True, name='command-server')
        thread.start()
        logger.info("[CommandServer] Listening on port %d", port)
        return server

    # ============================================================
    # Statistics
    # ============================================================

    def log_statistics(self):
        """Log periodic statistics."""
        now = time.time()
        if now - self._last_stats_time < 10:
            return
        elapsed = now - self._last_stats_time
        self._last_stats_time = now
        with self._stats_lock:
            total = self._stats.get('total_messages', 0)
            stats_snapshot = dict(self._stats)

        logger.info("=" * 60)
        logger.info("[Stats] %.0fs elapsed | Total msgs: %d | Drones: %d",
                    elapsed, total, len(self.drone_states))
        logger.info("[Stats] Kafka: success=%d errors=%d | Backend: success=%d errors=%d",
                    stats_snapshot.get('kafka_success', 0),
                    stats_snapshot.get('kafka_errors', 0),
                    stats_snapshot.get('backend_success', 0),
                    stats_snapshot.get('backend_errors', 0))

        with self._lock:
            uav_ids = list(self.drone_states.keys())
        for uid in uav_ids:
            lock = self._drone_locks[uid]
            with lock:
                s = self.drone_states.get(uid)
                if not s:
                    continue
                age = now - s.last_update if s.last_update > 0 else -1
                logger.info(
                    "[Stats]   %-30s msgs=%-6d lat=%.6f lon=%.6f alt=%.1f "
                    "hdg=%.1f armed=%-5s mode=%-12s age=%.1fs",
                    uid, s.msg_count, s.lat, s.lon, s.alt,
                    s.heading, s.armed, s.flight_mode, age
                )

        topic_stats = {k: v for k, v in stats_snapshot.items() if '/' in k}
        if topic_stats:
            logger.info("[Stats] Per-topic:")
            for t, c in sorted(topic_stats.items()):
                logger.info("[Stats]   %-50s %d", t, c)
        logger.info("=" * 60)

    # ============================================================
    # Backend Health Check
    # ============================================================

    def check_backend_health(self) -> bool:
        endpoints = ["/api/v1/dds-gateway/health", "/actuator/health"]
        for endpoint in endpoints:
            try:
                resp = requests.get(f"{self.backend_url}{endpoint}", timeout=5)
                if resp.status_code == 200:
                    logger.info("[Backend] Health check passed via %s", endpoint)
                    return True
            except Exception:
                pass
        logger.error("[Backend] All health check endpoints failed")
        return False

    # ============================================================
    # Main Loop
    # ============================================================

    def run(self):
        """Main loop: listen for MAVLink, forward telemetry."""
        self.running = True
        logger.info("=" * 60)
        logger.info("[Startup] MAVLink Routing Gateway (Instance %d/%d)",
                    self.instance_id, self.total_instances)
        logger.info("[Startup] Listen: %s://%s:%d",
                    self.listen_protocol, self.listen_host, self.listen_port)
        logger.info("[Startup] Backend: %s", self.backend_url)
        logger.info("[Startup] pymavlink: %s", self._pymavlink_available)
        logger.info("=" * 60)

        if not self._pymavlink_available:
            logger.error("[Startup] pymavlink not available. Exiting.")
            return

        # Start MAVLink listener
        if self.listen_protocol == 'udp':
            self._start_udp_listener()
        elif self.listen_protocol == 'tcp':
            self._start_tcp_listener()
        else:
            logger.error("[Startup] Unknown protocol: %s", self.listen_protocol)
            return

        # Start command HTTP server (fallback)
        base_port = int(os.environ.get('MAVLINK_COMMAND_PORT', '5060'))
        cmd_port = base_port + self.instance_id
        self.start_command_server(port=cmd_port)

        # Start Kafka command consumer
        self._start_kafka_command_consumer()

        # Start GCS heartbeat (required for PX4 to accept arming)
        self._start_gcs_heartbeat()

        # Start epoch maintenance
        self._start_epoch_maintenance()

        # Backend health check
        logger.info("[Startup] Checking backend...")
        for attempt in range(3):
            if self.check_backend_health():
                break
            logger.info("[Startup] Retry %d/3 in 5s...", attempt + 1)
            time.sleep(5)
        else:
            logger.warning("[Startup] Backend unreachable. Continuing anyway...")

        # Telemetry forwarding loop
        _last_sent: Dict[str, float] = {}
        SEND_INTERVAL = 0.1  # 10Hz per drone

        while self.running:
            try:
                now = time.time()

                # Batch telemetry forwarding
                with self._lock:
                    uav_ids_snapshot = list(self.drone_states.keys())
                batch_drones = []
                for uid in uav_ids_snapshot:
                    lock = self._drone_locks[uid]
                    with lock:
                        state = self.drone_states.get(uid)
                        if not state:
                            continue
                        if now - state.last_update > 5:
                            continue
                        if not state.position_valid:
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

                        batch_drones.append({
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
                        })

                if batch_drones:
                    batch_payload = {
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "drones": batch_drones
                    }
                    kafka_ok = self.send_to_kafka(batch_payload)
                    if not kafka_ok:
                        self.send_to_backend(batch_payload)

                self.log_statistics()
                time.sleep(0.05)

            except KeyboardInterrupt:
                break
            except Exception as e:
                logger.error("[MainLoop] %s", e, exc_info=True)
                time.sleep(1)

        self._cleanup()
        logger.info("[Shutdown] MAVLink Gateway stopped")

    def _cleanup(self):
        """Clean up resources."""
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
                self._kafka_producer.close(timeout=3)
            except Exception:
                pass
        logger.info("[Shutdown] Cleanup complete")

    def stop(self):
        self.running = False


def main():
    parser = argparse.ArgumentParser(
        description='MAVLink Routing Gateway - Real Drone Telemetry Forwarder'
    )
    parser.add_argument(
        '--listen',
        default=os.environ.get('MAVLINK_LISTEN', 'udp:0.0.0.0:14550'),
        help='Listen address (format: protocol:host:port, e.g. udp:0.0.0.0:14550 or tcp:0.0.0.0:5760)'
    )
    parser.add_argument(
        '--backend-url',
        default=os.environ.get('UCS_BACKEND_URL', 'http://localhost:8080'),
        help='UCS backend URL (default: http://localhost:8080)'
    )
    parser.add_argument(
        '--api-key',
        default=os.environ.get('DDS_GATEWAY_API_KEY', 'ucs-dds-gateway-secret-2024'),
        help='API key for gateway authentication'
    )
    parser.add_argument(
        '--interval',
        type=float,
        default=float(os.environ.get('MAVLINK_POLL_INTERVAL', '0.1')),
        help='Telemetry forward interval in seconds (default: 0.1 = 10Hz)'
    )
    parser.add_argument(
        '--instance-id',
        type=int,
        default=int(os.environ.get('MAVLINK_INSTANCE_ID', '0')),
        help='Instance ID for multi-instance partitioning (default: 0)'
    )
    parser.add_argument(
        '--total-instances',
        type=int,
        default=int(os.environ.get('MAVLINK_TOTAL_INSTANCES', '1')),
        help='Total number of gateway instances (default: 1)'
    )
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Enable verbose/debug logging'
    )
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Parse listen address
    listen_parts = args.listen.split(':')
    if len(listen_parts) == 3:
        protocol = listen_parts[0].lower()
        host = listen_parts[1]
        port = int(listen_parts[2])
    elif len(listen_parts) == 2:
        protocol = listen_parts[0].lower()
        host = '0.0.0.0'
        port = int(listen_parts[1])
    else:
        protocol = 'udp'
        host = '0.0.0.0'
        port = 14550

    gateway = MavlinkGateway(
        backend_url=args.backend_url,
        api_key=args.api_key,
        poll_interval=args.interval,
        instance_id=args.instance_id,
        total_instances=args.total_instances,
        listen_protocol=protocol,
        listen_host=host,
        listen_port=port,
    )

    if args.total_instances > 1:
        logger.info("[Config] Multi-instance mode: instance %d of %d",
                    args.instance_id, args.total_instances)

    def signal_handler(sig, frame):
        logger.info("[Signal] %s received, stopping...", sig)
        gateway.stop()

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    gateway.run()


if __name__ == '__main__':
    main()
