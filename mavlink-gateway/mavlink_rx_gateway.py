#!/usr/bin/env python3
"""
MAVLink Rx Gateway — 接收端网关（遥测采集）

通过UDP/TCP接收真实无人机的MAVLink遥测数据，解析后批量发送到Kafka telemetry.raw。
与MAVLink Tx Gateway配合工作，实现收发分离以消除GIL竞争并支持独立扩缩容。

架构升级2.1 — T-02: MAVLink网关收发拆分（Rx部分）
                T-04: Rx Gateway批量发送与降频（100ms buffer + LZ4压缩）
                T-06: 网关连接状态存入Redis
                T-10: 遥测生产者acks=1 + LZ4压缩

数据流:
    Real Drone --MAVLink(UDP/TCP)--> MAVLink Rx Gateway --Kafka(telemetry.raw)--> Backend

Usage:
    python mavlink_rx_gateway.py [--listen udp:0.0.0.0:14550]

Environment Variables:
    KAFKA_BOOTSTRAP_SERVERS  Kafka brokers (default: kafka-1:9092,kafka-2:9092,kafka-3:9092)
    REDIS_HOST               Redis host (default: redis)
    UCS_BACKEND_URL          Backend URL
    MAVLINK_LISTEN           Listen address (default: udp:0.0.0.0:14550)
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
from dataclasses import dataclass, field
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
logger = logging.getLogger('mavlink-rx-gateway')

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


@dataclass
class DroneState:
    """Telemetry state for a single MAVLink drone."""
    uav_id: str
    lat: float = 0.0
    lon: float = 0.0
    alt: float = 0.0           # AMSL altitude (meters)
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
    ref_alt: float = 0.0
    ref_alt_valid: bool = False
    home_lat: float = 0.0
    home_lon: float = 0.0
    home_alt: float = 0.0
    position_valid: bool = False
    epoch: int = 0
    system_id: int = 0
    component_id: int = 0
    connection_type: str = 'udp'
    last_update: float = 0.0
    msg_count: int = 0


def _ip_to_uav_id(addr: Tuple[str, int]) -> str:
    """Generate a deterministic uav_id from IP:port."""
    ip, port = addr
    return f"mavlink_{ip}_{port}"


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


class MavlinkRxGateway:
    """
    MAVLink Rx Gateway — 只负责接收MAVLink遥测并转发到Kafka。

    职责:
    1. UDP/TCP监听MAVLink帧
    2. 解析MAVLink消息（HEARTBEAT, GLOBAL_POSITION_INT, ATTITUDE, SYS_STATUS等）
    3. T-04: 100ms缓冲区聚合 + LZ4压缩批量发送到Kafka telemetry.raw
    4. T-06: Redis连接状态存储（gateway:mavlink:connections:{uav_id}）
    5. Epoch管理（Redis持久化）
    6. 事件发布到Kafka events.drone（上线/下线）
    """

    def __init__(self, backend_url: str, api_key: str,
                 instance_id: int = 0, total_instances: int = 1,
                 listen_protocol: str = 'udp', listen_host: str = '0.0.0.0',
                 listen_port: int = 14550):
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
        self._last_stats_time = time.time()

        # Epoch
        self._epoch_map: Dict[str, int] = {}
        self._redis_epoch_prefix = 'mavlink:epoch:'
        self._redis_ip_prefix = 'mavlink:ip_map:'

        # IP Mapping
        self._ip_map: Dict[str, Tuple[str, int]] = {}
        self._addr_to_uav: Dict[Tuple[str, int], str] = {}

        # T-04: Telemetry buffer (100ms aggregation)
        self._telemetry_buffer: Dict[str, dict] = {}
        self._buffer_lock = threading.Lock()
        self._flush_timer = None

        # UDP socket
        self._udp_socket: Optional[socket.socket] = None
        # TCP connections
        self._tcp_connections: Dict[Tuple[str, int], socket.socket] = {}

        # pymavlink
        self._pymavlink_available = False
        try:
            from pymavlink import mavutil
            self._pymavlink_available = True
        except ImportError:
            logger.error("[Init] pymavlink not available. pip install pymavlink")

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

        # Kafka Producer — T-04/T-10: batch + LZ4 + acks=1
        self._kafka_producer = None
        self._kafka_enabled = False
        self._kafka_bootstrap = os.environ.get(
            'KAFKA_BOOTSTRAP_SERVERS', 'kafka-1:9092,kafka-2:9092,kafka-3:9092')
        self._init_kafka_producer()

        # GCS Heartbeat (required for PX4 to consider link alive)
        self._gcs_heartbeat_thread = None

    # ============================================================
    # Kafka Producer — T-04: batch + LZ4 compression, T-10: acks=1
    # ============================================================

    def _init_kafka_producer(self):
        try:
            from kafka import KafkaProducer
            self._kafka_producer = KafkaProducer(
                bootstrap_servers=self._kafka_bootstrap,
                key_serializer=lambda k: k.encode('utf-8') if k else None,
                value_serializer=lambda v: json.dumps(v).encode('utf-8'),
                # T-04: 批量优化
                batch_size=16384,        # 16KB batch
                linger_ms=100,           # 100ms linger (match buffer flush)
                compression_type='lz4',  # LZ4 compression
                # T-10: 遥测生产者配置
                acks=1,                  # Leader confirmation only
                retries=3,
                retry_backoff_ms=100,
                max_block_ms=5000,
            )
            self._kafka_enabled = True
            logger.info("[Kafka] Producer initialized (batch=16KB, linger=100ms, lz4, acks=1)")
        except ImportError:
            logger.warning("[Kafka] kafka-python not installed")
        except Exception as e:
            logger.warning("[Kafka] Producer init failed: %s", e)

    # ============================================================
    # Multi-Instance Partitioning
    # ============================================================

    def _owns_drone(self, uav_id: str) -> bool:
        if self.total_instances <= 1:
            return True
        h = int(hashlib.md5(uav_id.encode('utf-8')).hexdigest(), 16)
        return (h % self.total_instances) == self.instance_id

    # ============================================================
    # Epoch Management (Redis persisted)
    # ============================================================

    def _get_or_increment_epoch(self, uav_id: str) -> int:
        if uav_id in self._epoch_map:
            return self._epoch_map[uav_id]
        epoch = 1
        if self._redis:
            try:
                redis_key = f"{self._redis_epoch_prefix}{uav_id}"
                epoch = self._redis.incr(redis_key)
                self._redis.expire(redis_key, 86400)
            except Exception as e:
                logger.debug("[Epoch] Redis INCR failed: %s", e)
        self._epoch_map[uav_id] = epoch
        return epoch

    def _start_epoch_maintenance(self):
        def _maintenance_loop():
            while self.running:
                try:
                    time.sleep(300)
                    if not self.running:
                        break
                    now = time.time()
                    evicted = 0
                    with self._lock:
                        stale = [uid for uid, s in self.drone_states.items()
                                 if now - s.last_update > 300]
                        for uid in stale:
                            del self.drone_states[uid]
                            self._epoch_map.pop(uid, None)
                            evicted += 1
                    if evicted > 0:
                        logger.info("[EpochMaint] Evicted %d stale drones", evicted)
                except Exception as e:
                    logger.error("[EpochMaint] Error: %s", e)
        t = threading.Thread(target=_maintenance_loop, daemon=True, name='epoch-maint')
        t.start()

    # ============================================================
    # T-06: Redis Connection State
    # ============================================================

    def _update_connection_state_redis(self, uav_id: str, addr: Tuple[str, int],
                                        protocol: str):
        """Store/refresh MAVLink connection state in Redis (T-06)."""
        if not self._redis:
            return
        try:
            key = f"gateway:mavlink:connections:{uav_id}"
            now_iso = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            state = self.drone_states.get(uav_id)
            mapping = {
                'ip': addr[0],
                'port': str(addr[1]),
                'system_id': str(state.system_id) if state else '0',
                'component_id': str(state.component_id) if state else '0',
                'gateway_type': 'MAVLink',
                'connection_type': protocol,
                'last_heartbeat': now_iso,
                'instance_id': str(self.instance_id),
            }
            if not self._redis.exists(key):
                mapping['connected_at'] = now_iso
            self._redis.hset(key, mapping=mapping)
            self._redis.expire(key, 60)  # TTL 60s
        except Exception as e:
            logger.debug("[Redis] Connection state update failed for %s: %s", uav_id, e)

    # ============================================================
    # IP Registration
    # ============================================================

    def _register_drone_ip(self, uav_id: str, addr: Tuple[str, int]):
        ip, port = addr
        self._ip_map[uav_id] = addr
        self._addr_to_uav[addr] = uav_id
        if self._redis:
            try:
                self._redis.set(f"{self._redis_ip_prefix}{uav_id}",
                                f"{ip}:{port}", ex=3600)
            except Exception:
                pass

    # ============================================================
    # GCS Heartbeat (1Hz — required for PX4 link alive)
    # ============================================================

    def _start_gcs_heartbeat(self):
        if not self._pymavlink_available:
            return

        from pymavlink import mavutil

        def _gcs_hb_loop():
            mav = mavutil.mavlink.MAVLink(None)
            mav.srcSystem = 255
            mav.srcComponent = 190
            logger.info("[GCSHeartbeat] Started (1Hz)")

            while self.running:
                try:
                    hb_msg = mav.heartbeat_encode(
                        mavutil.mavlink.MAV_TYPE_GCS,
                        mavutil.mavlink.MAV_AUTOPILOT_INVALID,
                        0, 0, 0)
                    packed = hb_msg.pack(mav)

                    with self._lock:
                        uav_ids = list(self.drone_states.keys())

                    for uid in uav_ids:
                        addr = self._ip_map.get(uid)
                        if not addr:
                            continue
                        state = self.drone_states.get(uid)
                        conn_type = state.connection_type if state else self.listen_protocol
                        try:
                            if conn_type == 'udp' and self._udp_socket:
                                self._udp_socket.sendto(packed, addr)
                            elif conn_type == 'tcp':
                                tcp_sock = self._tcp_connections.get(addr)
                                if tcp_sock:
                                    tcp_sock.sendall(packed)
                        except Exception:
                            pass
                except Exception as e:
                    logger.error("[GCSHeartbeat] Error: %s", e)
                time.sleep(1.0)

        t = threading.Thread(target=_gcs_hb_loop, daemon=True, name='gcs-heartbeat')
        t.start()
        self._gcs_heartbeat_thread = t

    # ============================================================
    # MAVLink Message Parsing
    # ============================================================

    def _on_heartbeat(self, uav_id: str, msg):
        lock = self._drone_locks[uav_id]
        with lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return
            s.armed = bool(msg.base_mode & 0x80)
            custom_mode = msg.custom_mode
            main_mode = (custom_mode >> 16) & 0xFF
            sub_mode = (custom_mode >> 24) & 0xFF
            s.flight_mode = _decode_px4_mode(main_mode, sub_mode)
            s.last_update = time.time()
            s.msg_count += 1
        with self._stats_lock:
            self._stats['total_messages'] += 1

    def _on_global_position_int(self, uav_id: str, msg):
        lock = self._drone_locks[uav_id]
        with lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return
            lat = msg.lat / 1e7
            lon = msg.lon / 1e7
            alt = msg.alt / 1000.0
            now = time.time()

            # (0,0) rejection
            if s.position_valid and abs(lat) < 1.0 and abs(lon) < 1.0:
                return

            # GPS jump detection
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
                        return

            # Altitude anomaly
            if s.position_valid and abs(alt - s.alt) > 500:
                return

            s.lat = lat
            s.lon = lon
            s.alt = alt

            if hasattr(msg, 'relative_alt'):
                s.ned_z = -(msg.relative_alt / 1000.0)

            if hasattr(msg, 'hdg') and msg.hdg != 65535:
                s.heading = msg.hdg / 100.0

            if hasattr(msg, 'vx'):
                s.vx = msg.vx / 100.0
            if hasattr(msg, 'vy'):
                s.vy = msg.vy / 100.0
            if hasattr(msg, 'vz'):
                s.vz = msg.vz / 100.0
                s.vertical_speed = -msg.vz / 100.0
            s.ground_speed = math.sqrt(s.vx ** 2 + s.vy ** 2)

            if not s.position_valid:
                s.position_valid = True
                logger.info("[GPS] %s position valid: lat=%.6f lon=%.6f alt=%.1f",
                            uav_id, lat, lon, alt)

            s.last_update = now
            s.msg_count += 1

    def _on_local_position_ned(self, uav_id: str, msg):
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
            s.vertical_speed = -msg.vz
            s.last_update = time.time()
            s.msg_count += 1

    def _on_attitude(self, uav_id: str, msg):
        lock = self._drone_locks[uav_id]
        with lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return
            s.heading = math.degrees(msg.yaw) % 360
            s.last_update = time.time()
            s.msg_count += 1

    def _on_sys_status(self, uav_id: str, msg):
        lock = self._drone_locks[uav_id]
        with lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return
            if hasattr(msg, 'battery_remaining') and msg.battery_remaining >= 0:
                s.battery_percent = float(msg.battery_remaining)
            s.last_update = time.time()
            s.msg_count += 1

    def _on_battery_status(self, uav_id: str, msg):
        lock = self._drone_locks[uav_id]
        with lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return
            if hasattr(msg, 'battery_remaining') and msg.battery_remaining >= 0:
                s.battery_percent = float(msg.battery_remaining)
            s.last_update = time.time()
            s.msg_count += 1

    # ============================================================
    # MAVLink Parsing & Dispatch
    # ============================================================

    def _parse_mavlink_bytes(self, data: bytes, mav) -> list:
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
        msg_type = msg.get_type()
        if msg_type == 'BAD_DATA':
            return

        # Get/create uav_id
        uav_id = self._addr_to_uav.get(addr)
        if not uav_id:
            uav_id = _ip_to_uav_id(addr)

        # Multi-instance filter
        if not self._owns_drone(uav_id):
            return

        # Initialize drone state if new
        is_new = False
        with self._lock:
            if uav_id not in self.drone_states:
                is_new = True
                epoch = self._get_or_increment_epoch(uav_id)
                self.drone_states[uav_id] = DroneState(
                    uav_id=uav_id,
                    system_id=msg.get_srcSystem() if hasattr(msg, 'get_srcSystem') else 0,
                    component_id=msg.get_srcComponent() if hasattr(msg, 'get_srcComponent') else 0,
                    connection_type=protocol,
                    epoch=epoch,
                )
                self._register_drone_ip(uav_id, addr)
                logger.info("[NewDrone] %s from %s:%d (system=%d epoch=%d)",
                            uav_id, addr[0], addr[1],
                            self.drone_states[uav_id].system_id, epoch)
            else:
                state = self.drone_states[uav_id]
                if hasattr(msg, 'get_srcSystem') and msg.get_srcSystem() > 0:
                    state.system_id = msg.get_srcSystem()
                if hasattr(msg, 'get_srcComponent') and msg.get_srcComponent() > 0:
                    state.component_id = msg.get_srcComponent()

        if is_new:
            self.send_event_to_kafka('DRONE_ONLINE', uav_id, 'INFO',
                                     f'MAVLink drone connected from {addr[0]}:{addr[1]}')
            # T-06: Update Redis connection state
            self._update_connection_state_redis(uav_id, addr, protocol)

        # Dispatch to handler
        if msg_type == 'HEARTBEAT':
            self._on_heartbeat(uav_id, msg)
            self._update_connection_state_redis(uav_id, addr, protocol)
        elif msg_type == 'GLOBAL_POSITION_INT':
            self._on_global_position_int(uav_id, msg)
        elif msg_type == 'LOCAL_POSITION_NED':
            self._on_local_position_ned(uav_id, msg)
        elif msg_type == 'ATTITUDE':
            self._on_attitude(uav_id, msg)
        elif msg_type == 'SYS_STATUS':
            self._on_sys_status(uav_id, msg)
        elif msg_type == 'BATTERY_STATUS':
            self._on_battery_status(uav_id, msg)

        # T-04: Buffer aggregation (update buffer with latest data)
        self._update_telemetry_buffer(uav_id)

    # ============================================================
    # T-04: Telemetry Buffer & Batch Flush (100ms aggregation)
    # ============================================================

    def _update_telemetry_buffer(self, uav_id: str):
        """Update telemetry buffer with latest drone state."""
        lock = self._drone_locks[uav_id]
        with lock:
            state = self.drone_states.get(uav_id)
            if not state or not state.position_valid:
                return
            if time.time() - state.last_update > 5:
                return

            # Compute relative altitude
            if state.ref_alt_valid and state.alt > 0:
                rel_alt = state.alt - state.ref_alt
            else:
                rel_alt = -state.ned_z

            data = {
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
                "gatewayType": "MAVLink",
            }

        with self._buffer_lock:
            self._telemetry_buffer[uav_id] = data

    def _start_buffer_flush_timer(self):
        """Start periodic 100ms buffer flush to Kafka."""
        def _flush_loop():
            while self.running:
                try:
                    self._flush_telemetry_buffer()
                except Exception as e:
                    logger.error("[BufferFlush] Error: %s", e)
                time.sleep(0.1)  # 100ms

        t = threading.Thread(target=_flush_loop, daemon=True, name='buffer-flush')
        t.start()

    def _flush_telemetry_buffer(self):
        """Flush aggregated telemetry buffer to Kafka (called every 100ms)."""
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
                self._kafka_producer.send('telemetry.raw', key=uav_id, value=data)
                send_count += 1
            except Exception as e:
                logger.error("[Kafka] Send failed for %s: %s", uav_id, e)

        if send_count > 0:
            with self._stats_lock:
                self._stats['kafka_sends'] += send_count

    # ============================================================
    # Kafka Event Publishing
    # ============================================================

    def send_event_to_kafka(self, event_type: str, uav_id: str,
                             level: str, detail: str):
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
        except Exception as e:
            logger.error("[Kafka] Event send failed: %s", e)

    # ============================================================
    # UDP/TCP Listeners
    # ============================================================

    def _start_udp_listener(self):
        from pymavlink import mavutil

        self._udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._udp_socket.bind((self.listen_host, self.listen_port))
        self._udp_socket.settimeout(1.0)
        logger.info("[UDP] Listening on %s:%d", self.listen_host, self.listen_port)

        mav = mavutil.mavlink.MAVLink(None)
        mav.robust_parsing = True

        def _udp_loop():
            while self.running:
                try:
                    data, addr = self._udp_socket.recvfrom(65535)
                    if not data:
                        continue
                    msgs = self._parse_mavlink_bytes(data, mav)
                    for parsed_msg in msgs:
                        self._dispatch_mavlink_message(parsed_msg, addr, 'udp')
                except socket.timeout:
                    continue
                except Exception as e:
                    if self.running:
                        logger.error("[UDP] Error: %s", e)
                        time.sleep(0.1)

        t = threading.Thread(target=_udp_loop, daemon=True, name='udp-listener')
        t.start()

    def _start_tcp_listener(self):
        server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server_socket.bind((self.listen_host, self.listen_port))
        server_socket.listen(50)
        server_socket.settimeout(1.0)
        logger.info("[TCP] Listening on %s:%d", self.listen_host, self.listen_port)

        def _accept_loop():
            while self.running:
                try:
                    client_sock, addr = server_socket.accept()
                    logger.info("[TCP] New connection from %s:%d", addr[0], addr[1])
                    self._tcp_connections[addr] = client_sock
                    t = threading.Thread(
                        target=self._tcp_client_handler,
                        args=(client_sock, addr),
                        daemon=True,
                        name=f"tcp-{addr[0]}:{addr[1]}")
                    t.start()
                except socket.timeout:
                    continue
                except Exception as e:
                    if self.running:
                        logger.error("[TCP] Accept error: %s", e)
            server_socket.close()

        t = threading.Thread(target=_accept_loop, daemon=True, name='tcp-accept')
        t.start()

    def _tcp_client_handler(self, client_sock: socket.socket, addr: Tuple[str, int]):
        from pymavlink import mavutil
        mav = mavutil.mavlink.MAVLink(None)
        mav.robust_parsing = True
        client_sock.settimeout(5.0)

        while self.running:
            try:
                data = client_sock.recv(65535)
                if not data:
                    break
                msgs = self._parse_mavlink_bytes(data, mav)
                for parsed_msg in msgs:
                    self._dispatch_mavlink_message(parsed_msg, addr, 'tcp')
            except socket.timeout:
                continue
            except ConnectionResetError:
                break
            except Exception as e:
                if self.running:
                    logger.error("[TCP] Client %s:%d error: %s", addr[0], addr[1], e)
                break

        try:
            client_sock.close()
        except Exception:
            pass
        self._tcp_connections.pop(addr, None)

        uav_id = self._addr_to_uav.get(addr)
        if uav_id:
            self.send_event_to_kafka('DRONE_OFFLINE', uav_id, 'WARN',
                                     f'TCP connection lost from {addr[0]}:{addr[1]}')

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
            total = self._stats.get('total_messages', 0)
            kafka_sends = self._stats.get('kafka_sends', 0)

        logger.info("=" * 60)
        logger.info("[Stats] %.0fs elapsed | Total msgs: %d | Drones: %d | Kafka sends: %d",
                    elapsed, total, len(self.drone_states), kafka_sends)
        with self._lock:
            for uid, s in self.drone_states.items():
                age = now - s.last_update if s.last_update > 0 else -1
                logger.info("[Stats]   %-30s msgs=%-6d lat=%.6f lon=%.6f alt=%.1f mode=%-12s age=%.1fs",
                            uid, s.msg_count, s.lat, s.lon, s.alt, s.flight_mode, age)
        logger.info("=" * 60)

    # ============================================================
    # Health Check HTTP Server
    # ============================================================

    def _start_health_server(self, port: int):
        gw = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == '/api/health':
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        'status': 'ok',
                        'type': 'mavlink-rx-gateway',
                        'instance_id': gw.instance_id,
                        'drones': len(gw.drone_states),
                        'protocol': gw.listen_protocol,
                    }).encode())
                else:
                    self.send_response(404)
                    self.end_headers()

            def log_message(self, format, *args):
                pass

        server = HTTPServer(('0.0.0.0', port), Handler)
        threading.Thread(target=server.serve_forever, daemon=True, name='health').start()
        logger.info("[Health] Server on port %d", port)

    # ============================================================
    # Main Loop
    # ============================================================

    def run(self):
        self.running = True
        logger.info("=" * 60)
        logger.info("[Startup] MAVLink Rx Gateway (Instance %d/%d)",
                    self.instance_id, self.total_instances)
        logger.info("[Startup] Listen: %s://%s:%d",
                    self.listen_protocol, self.listen_host, self.listen_port)
        logger.info("[Startup] Kafka: %s (batch=16KB, lz4, 100ms flush)",
                    self._kafka_bootstrap)
        logger.info("=" * 60)

        if not self._pymavlink_available:
            logger.error("[Startup] pymavlink not available. Exiting.")
            return

        # Start listener
        if self.listen_protocol == 'udp':
            self._start_udp_listener()
        elif self.listen_protocol == 'tcp':
            self._start_tcp_listener()
        else:
            logger.error("[Startup] Unknown protocol: %s", self.listen_protocol)
            return

        # Start GCS heartbeat
        self._start_gcs_heartbeat()

        # Start buffer flush timer (T-04: 100ms)
        self._start_buffer_flush_timer()

        # Start epoch maintenance
        self._start_epoch_maintenance()

        # Health check server
        health_port = int(os.environ.get('MAVLINK_RX_HEALTH_PORT', '5071'))
        self._start_health_server(health_port + self.instance_id)

        # Main loop
        while self.running:
            try:
                self.log_statistics()
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
    parser = argparse.ArgumentParser(description='MAVLink Rx Gateway — Telemetry Receiver')
    parser.add_argument('--listen',
                        default=os.environ.get('MAVLINK_LISTEN', 'udp:0.0.0.0:14550'))
    parser.add_argument('--backend-url',
                        default=os.environ.get('UCS_BACKEND_URL', 'http://localhost:8080'))
    parser.add_argument('--api-key',
                        default=os.environ.get('DDS_GATEWAY_API_KEY', 'ucs-dds-gateway-secret-2024'))
    parser.add_argument('--instance-id', type=int,
                        default=int(os.environ.get('MAVLINK_RX_INSTANCE_ID', '0')))
    parser.add_argument('--total-instances', type=int,
                        default=int(os.environ.get('MAVLINK_RX_TOTAL_INSTANCES', '1')))
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
        protocol, host, port = 'udp', '0.0.0.0', 14550

    gateway = MavlinkRxGateway(
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
