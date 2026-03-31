#!/usr/bin/env python3
"""
DDS Routing Gateway (Gateway 1) - PX4 Telemetry Subscriber & Forwarder

Uses rclpy (ROS2 Python client) to subscribe to PX4 DDS topics and forward
telemetry data to the UCS backend via REST API.

Requirements:
    - ROS2 environment sourced (e.g., source /opt/ros/humble/setup.bash)
    - px4_msgs package available
    - pip install requests

Usage:
    python dds_gateway.py [--backend-url URL] [--api-key KEY] [--interval SECONDS]
    python dds_gateway.py --verbose   # Enable debug logging

Environment Variables:
    UCS_BACKEND_URL     Backend URL (default: http://localhost:8080)
    DDS_GATEWAY_API_KEY API key for authentication
    DDS_POLL_INTERVAL   Poll interval in seconds (default: 1.0)
    ROS_DOMAIN_ID       ROS2 domain ID (must match PX4 simulator)
"""

import argparse
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

import requests

# rclpy QoS imports - needed for PX4-compatible subscription profiles
try:
    from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy, DurabilityPolicy
except ImportError:
    pass  # Will be handled by _rclpy_available check at runtime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('dds-gateway')

# ============================================================
# PX4 Topic Configuration
# ============================================================

# Topic suffix variants (PX4 may use _v1 suffix)
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
    # Home position (set on ARM, used for coordinate conversion)
    home_lat: float = 0.0
    home_lon: float = 0.0
    home_alt: float = 0.0
    # Epoch (generation ID) - incremented on each reconnection
    epoch: int = 0
    # Position validity: True only after first valid VehicleGlobalPosition received
    # Prevents sending default (0,0) coords before real GPS data arrives
    position_valid: bool = False
    # Timestamp of last VehicleGlobalPosition message (separate from last_update
    # which is set by ANY topic callback)
    last_global_position_time: float = 0.0


def _latlon_to_ned(lat: float, lon: float, alt: float,
                   home_lat: float, home_lon: float, home_alt: float):
    """Convert WGS84 lat/lon/alt to NED coordinates relative to home.

    Uses simplified flat-earth approximation, accurate within ~10km of home.
    Returns (north, east, down) in meters.
    """
    EARTH_RADIUS = 6371000.0  # meters
    dlat = math.radians(lat - home_lat)
    dlon = math.radians(lon - home_lon)
    north = dlat * EARTH_RADIUS
    east = dlon * EARTH_RADIUS * math.cos(math.radians(home_lat))
    down = -(alt - home_alt)  # NED: down is positive
    return north, east, down


class DDSGateway:
    """
    DDS Routing Gateway using rclpy (ROS2).
    Creates a ROS2 node visible via `ros2 node list`.
    """

    def __init__(self, backend_url: str, api_key: str, poll_interval: float = 1.0,
                 instance_id: int = 0, total_instances: int = 1):
        self.backend_url = backend_url.rstrip('/')
        self.api_key = api_key
        self.poll_interval = poll_interval
        self.drone_states: Dict[str, DroneState] = {}
        self.running = False
        self._rclpy_available = False
        self._node = None
        self._subscriptions = {}
        # Per-drone subscription tracking: uav_id -> set of subscribed base_suffixes
        # Used to detect incomplete subscriptions and retry missing topics
        self._drone_subscribed_topics: Dict[str, Set[str]] = {}
        self._lock = threading.Lock()
        self._stats = defaultdict(int)
        self._last_stats_time = time.time()

        # Multi-instance partitioning
        self.instance_id = instance_id
        self.total_instances = total_instances

        # Epoch map: uav_id -> epoch (generation ID)
        self._epoch_map: Dict[str, int] = {}

        # Kafka producer (optional, for dual-write mode)
        self._kafka_producer = None
        self._kafka_enabled = False
        self._kafka_bootstrap = os.environ.get('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092')
        self._init_kafka()

        # Persistent HTTP session for ack forwarding (reuses TCP connections)
        self._ack_session = requests.Session()
        self._ack_session.headers.update({
            'X-Gateway-Key': api_key,
            'Content-Type': 'application/json',
        })
        # Thread pool for ack forwarding (avoids per-ack thread creation overhead)
        from concurrent.futures import ThreadPoolExecutor
        self._ack_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix='ack-fwd')
        # Ack deduplication cache
        self._recent_acks: Dict[str, float] = {}

        try:
            import rclpy
            self._rclpy_available = True
            logger.info("[Init] rclpy (ROS2 Python) available - real DDS mode")
        except ImportError:
            logger.warning(
                "[Init] rclpy not available. Make sure ROS2 is sourced:\n"
                "  source /opt/ros/humble/setup.bash"
            )

        self._px4_msgs_available = False
        try:
            import px4_msgs.msg
            self._px4_msgs_available = True
            logger.info("[Init] px4_msgs package available")
        except ImportError:
            logger.warning("[Init] px4_msgs not available")

    def _init_ros2_node(self):
        """Initialize the ROS2 node.

        For multi-instance mode, each instance gets a unique node name
        (e.g. ucs_dds_gateway_0, ucs_dds_gateway_1) so they can coexist
        on the same ROS2 network without name collisions.
        """
        if not self._rclpy_available:
            return False
        try:
            import rclpy
            if not rclpy.ok():
                rclpy.init()
                logger.info("[ROS2] rclpy initialized")
            node_name = f'ucs_dds_gateway_{self.instance_id}'
            self._node = rclpy.create_node(node_name)
            logger.info("[ROS2] Node '%s' created (instance %d/%d)",
                        node_name, self.instance_id, self.total_instances)
            return True
        except Exception as e:
            logger.error("[ROS2] Failed to create node: %s", e)
            return False

    def _owns_drone(self, uav_id: str) -> bool:
        """Check if this instance owns a drone (for multi-instance partitioning).

        Partitioning strategy: extract numeric ID from uav_id (e.g. px4_5 -> 5)
        and assign to instance via modulo: drone_num % total_instances == instance_id.

        In single-instance mode (total_instances=1), all drones are owned.
        """
        if self.total_instances <= 1:
            return True
        drone_num = self._extract_system_id(uav_id)
        owner = drone_num % self.total_instances
        return owner == self.instance_id

    def check_backend_health(self) -> bool:
        """Verify backend is reachable.

        Tries multiple health check endpoints for compatibility with both
        the legacy monolithic backend and the new microservice architecture:
          1. /api/v1/dds-gateway/health  (API Gateway local endpoint or legacy backend)
          2. /actuator/health            (Spring Boot Actuator, available on all services)
        """
        endpoints = [
            "/api/v1/dds-gateway/health",
            "/actuator/health",
        ]
        for endpoint in endpoints:
            try:
                resp = requests.get(
                    f"{self.backend_url}{endpoint}", timeout=5
                )
                if resp.status_code == 200:
                    logger.info("[Backend] Health check passed via %s: %s",
                                endpoint, resp.json())
                    return True
                logger.debug("[Backend] %s returned HTTP %d", endpoint, resp.status_code)
            except requests.exceptions.ConnectionError:
                logger.debug("[Backend] Cannot connect to %s%s",
                             self.backend_url, endpoint)
            except Exception as e:
                logger.debug("[Backend] Health check %s failed: %s", endpoint, e)

        logger.error("[Backend] All health check endpoints failed on %s", self.backend_url)
        return False

    def discover_drones_from_topics(self) -> Set[str]:
        """
        Discover PX4 drones by scanning the ROS2 topic list.
        Extracts prefix (px4_1, px4_2) from topics like /px4_1/fmu/out/vehicle_attitude.

        In multi-instance mode, only returns drones owned by this instance
        (determined by _owns_drone partitioning).
        """
        if not self._rclpy_available or self._node is None:
            return set()

        discovered = set()
        all_discovered = set()
        matched_topics = []

        try:
            topic_list = self._node.get_topic_names_and_types()
            all_topics = [name for name, _ in topic_list]

            for topic_name, _ in topic_list:
                if '/fmu/out/' in topic_name:
                    parts = topic_name.strip('/').split('/')
                    if len(parts) >= 4:
                        drone_prefix = parts[0]
                        topic_suffix = parts[3]
                        matched_topics.append(topic_name)
                        if topic_suffix in ALL_KNOWN_SUFFIXES:
                            all_discovered.add(drone_prefix)
                            # Multi-instance filter: only own drones
                            if self._owns_drone(drone_prefix):
                                discovered.add(drone_prefix)

            logger.info(
                "[Discovery] Scanned %d topics, %d matched /fmu/out/, "
                "%d total drones, %d owned by instance %d/%d",
                len(all_topics), len(matched_topics),
                len(all_discovered), len(discovered),
                self.instance_id, self.total_instances
            )

            if discovered:
                logger.info(
                    "[Discovery] Owned drone(s): %s",
                    sorted(discovered)
                )
            elif all_discovered:
                logger.info(
                    "[Discovery] Found %d drone(s) on network but none owned by instance %d: %s",
                    len(all_discovered), self.instance_id, sorted(all_discovered)
                )
            else:
                logger.warning(
                    "[Discovery] No PX4 drones found. Topics: %s",
                    all_topics[:10] if all_topics else "none"
                )

        except Exception as e:
            logger.error("[Discovery] Topic scan failed: %s", e)

        return discovered

    def subscribe_to_drone(self, uav_id: str):
        """Subscribe to all telemetry topics for a specific drone."""
        with self._lock:
            if uav_id not in self.drone_states:
                self.drone_states[uav_id] = DroneState(uav_id=uav_id)

        if not self._rclpy_available or self._node is None:
            logger.warning("[Subscribe] ROS2 not available for %s", uav_id)
            return

        if self._px4_msgs_available:
            self._subscribe_with_px4_msgs(uav_id)
        else:
            logger.warning(
                "[Subscribe] px4_msgs not available, cannot subscribe for %s", uav_id
            )

    def _subscribe_with_px4_msgs(self, uav_id: str):
        """Subscribe using typed px4_msgs message types.

        PX4 publishes with BEST_EFFORT reliability. We must match this QoS
        profile, otherwise DDS will reject the connection with:
        'incompatible QoS - Last incompatible policy: RELIABILITY'

        Dynamic subscription strategy:
        ─────────────────────────────
        1. First try topics that exist in the ROS2 topic list (fastest).
        2. If a topic is not yet advertised but the msg type is available,
           subscribe proactively anyway — ROS2/DDS will auto-connect when
           the PX4 publisher appears later.
        3. Track which base_suffixes are subscribed per drone so we can
           skip already-subscribed topics on retry cycles.

        This ensures drones that start AFTER the gateway are still picked up
        without waiting for the next full discovery + subscribe cycle.
        """
        import px4_msgs.msg as px4

        # PX4 QoS profile: BEST_EFFORT reliability, VOLATILE durability
        # This MUST match PX4's publisher QoS, otherwise no data will be received
        px4_qos = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            durability=DurabilityPolicy.VOLATILE,
            history=HistoryPolicy.KEEP_LAST,
            depth=10
        )

        subscriptions_created = 0
        topic_handlers = {}

        if hasattr(px4, 'VehicleGlobalPosition'):
            topic_handlers['vehicle_global_position'] = (
                px4.VehicleGlobalPosition,
                lambda msg, uid=uav_id: self._on_global_position(uid, msg)
            )
        if hasattr(px4, 'VehicleAttitude'):
            topic_handlers['vehicle_attitude'] = (
                px4.VehicleAttitude,
                lambda msg, uid=uav_id: self._on_attitude(uid, msg)
            )
        if hasattr(px4, 'VehicleLocalPosition'):
            topic_handlers['vehicle_local_position'] = (
                px4.VehicleLocalPosition,
                lambda msg, uid=uav_id: self._on_local_position(uid, msg)
            )
        if hasattr(px4, 'VehicleStatus'):
            topic_handlers['vehicle_status'] = (
                px4.VehicleStatus,
                lambda msg, uid=uav_id: self._on_vehicle_status(uid, msg)
            )
        if hasattr(px4, 'BatteryStatus'):
            topic_handlers['battery_status'] = (
                px4.BatteryStatus,
                lambda msg, uid=uav_id: self._on_battery_status(uid, msg)
            )
        if hasattr(px4, 'VehicleCommandAck'):
            topic_handlers['vehicle_command_ack'] = (
                px4.VehicleCommandAck,
                lambda msg, uid=uav_id: self._on_vehicle_command_ack(uid, msg)
            )

        # Initialize per-drone tracking if not exists
        if uav_id not in self._drone_subscribed_topics:
            self._drone_subscribed_topics[uav_id] = set()

        already_subscribed = self._drone_subscribed_topics[uav_id]
        available_topics = dict(self._node.get_topic_names_and_types())

        for base_suffix, (msg_type, callback) in topic_handlers.items():
            # Skip if this base_suffix is already subscribed for this drone
            if base_suffix in already_subscribed:
                continue

            variants = TOPIC_SUFFIX_VARIANTS.get(base_suffix, [base_suffix])
            subscribed = False

            for variant in variants:
                topic_name = f"/{uav_id}/fmu/out/{variant}"
                sub_key = f"{uav_id}/{variant}"

                if sub_key in self._subscriptions:
                    # Already subscribed via a previous call
                    already_subscribed.add(base_suffix)
                    subscribed = True
                    break

                # Subscribe proactively: even if topic is not yet advertised,
                # ROS2/DDS will auto-connect when the publisher appears.
                # Prefer topics that already exist for immediate data flow.
                topic_exists = topic_name in available_topics
                try:
                    sub = self._node.create_subscription(
                        msg_type, topic_name, callback, px4_qos
                    )
                    self._subscriptions[sub_key] = sub
                    already_subscribed.add(base_suffix)
                    subscriptions_created += 1
                    if topic_exists:
                        logger.info(
                            "[Subscribe] OK: %s -> %s (type: %s, topic active)",
                            uav_id, topic_name, msg_type.__name__
                        )
                    else:
                        logger.info(
                            "[Subscribe] OK: %s -> %s (type: %s, proactive - waiting for publisher)",
                            uav_id, topic_name, msg_type.__name__
                        )
                    subscribed = True
                    break
                except Exception as e:
                    logger.error(
                        "[Subscribe] FAILED: %s -> %s: %s",
                        uav_id, topic_name, e
                    )

            if not subscribed:
                logger.debug(
                    "[Subscribe] Could not subscribe %s/%s (tried: %s)",
                    uav_id, base_suffix, variants
                )

        expected_count = len(topic_handlers)
        actual_count = len(already_subscribed)
        if subscriptions_created > 0:
            logger.info(
                "[Subscribe] Drone %s: %d new, %d/%d topics subscribed, %d total subs",
                uav_id, subscriptions_created, actual_count, expected_count,
                len(self._subscriptions)
            )

    # ============================================================
    # Message Callbacks
    # ============================================================

    def _on_global_position(self, uav_id, msg):
        with self._lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return

            new_lat = msg.lat
            new_lon = msg.lon
            new_alt = msg.alt

            # --- Position validity check ---
            # Reject (0,0) or near-zero coords when we already have a valid
            # position far from the equator/prime-meridian intersection.
            # This prevents DDS callback ordering issues from overwriting
            # good position data with uninitialized EKF values.
            if abs(new_lat) < 0.1 and abs(new_lon) < 0.1:
                # If we already have a valid position far from (0,0), reject
                if s.position_valid and (abs(s.lat) > 1.0 or abs(s.lon) > 1.0):
                    self._stats['position_rejected'] = \
                        self._stats.get('position_rejected', 0) + 1
                    if self._stats['position_rejected'] % 100 == 1:
                        logger.warning(
                            "[Position] Rejected (%.6f,%.6f) for %s "
                            "(current valid: %.6f,%.6f) - likely uninitialized EKF",
                            new_lat, new_lon, uav_id, s.lat, s.lon)
                    return
                # If this is the first position and it's (0,0), also skip
                if not s.position_valid:
                    self._stats['position_rejected'] = \
                        self._stats.get('position_rejected', 0) + 1
                    return

            s.lat = new_lat
            s.lon = new_lon
            s.alt = new_alt
            s.position_valid = True
            now = time.time()
            s.last_update = now
            s.last_global_position_time = now
            s.msg_count += 1
            self._stats[f'{uav_id}/global_position'] += 1
            self._stats['total_messages'] += 1

    def _on_local_position(self, uav_id, msg):
        with self._lock:
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
            self._stats[f'{uav_id}/local_position'] += 1
            self._stats['total_messages'] += 1

    def _on_attitude(self, uav_id, msg):
        with self._lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return
            q = msg.q
            siny_cosp = 2 * (q[0] * q[3] + q[1] * q[2])
            cosy_cosp = 1 - 2 * (q[2] ** 2 + q[3] ** 2)
            s.heading = math.degrees(math.atan2(siny_cosp, cosy_cosp)) % 360
            s.last_update = time.time()
            s.msg_count += 1
            self._stats[f'{uav_id}/attitude'] += 1
            self._stats['total_messages'] += 1

    def _on_vehicle_status(self, uav_id, msg):
        with self._lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return
            s.armed = getattr(msg, 'arming_state', 0) == 2
            s.flight_mode = self._nav_state_to_mode(getattr(msg, 'nav_state', 0))
            s.last_update = time.time()
            s.msg_count += 1
            self._stats[f'{uav_id}/vehicle_status'] += 1
            self._stats['total_messages'] += 1

    def _on_battery_status(self, uav_id, msg):
        with self._lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return
            s.battery_percent = getattr(msg, 'remaining', -1.0) * 100
            s.last_update = time.time()
            s.msg_count += 1
            self._stats[f'{uav_id}/battery_status'] += 1
            self._stats['total_messages'] += 1

    def _on_vehicle_command_ack(self, uav_id, msg):
        """Handle VehicleCommandAck from PX4.

        Forwards the acknowledgment to the backend so it can update command status
        and notify the frontend via WebSocket for two-stage feedback.

        PX4 result codes: 0=ACCEPTED, 1=TEMPORARILY_REJECTED, 2=DENIED,
        3=UNSUPPORTED, 4=FAILED, 5=IN_PROGRESS, 6=CANCELLED

        Includes deduplication to prevent rejection loops: if the same
        (uavId, command, result) was forwarded within the last 2 seconds,
        the duplicate ack is suppressed.

        Latency optimization:
        - Uses persistent HTTP session (avoids TCP handshake per ack)
        - Uses ThreadPoolExecutor (avoids thread creation overhead per ack)
        - Dedup window reduced from 5s to 2s for faster feedback
        """
        command = getattr(msg, 'command', 0)
        result = getattr(msg, 'result', -1)
        logger.info("[CommandAck] %s: command=%d result=%d", uav_id, command, result)
        self._stats[f'{uav_id}/command_ack'] += 1
        self._stats['total_messages'] += 1

        # Deduplicate acks to prevent rejection loops (2s window)
        ack_key = f"{uav_id}:{command}:{result}"
        now = time.time()
        last_forwarded = self._recent_acks.get(ack_key, 0)
        if now - last_forwarded < 2.0:
            logger.debug("[CommandAck] Suppressing duplicate ack %s (%.1fs ago)", ack_key, now - last_forwarded)
            return
        self._recent_acks[ack_key] = now

        # Clean up old entries periodically
        if len(self._recent_acks) > 100:
            cutoff = now - 5.0
            self._recent_acks = {k: v for k, v in self._recent_acks.items() if v > cutoff}

        # Forward ack to backend via thread pool (low-latency)
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
            logger.error("[CommandAck] Failed to forward ack: %s", e)

    def _forward_command_ack(self, ack_payload: dict):
        """Forward a command ack to Kafka commands.ack topic (primary) and HTTP (fallback).

        [Phase 1] Dual-write: Kafka + HTTP for backward compatibility.
        The backend's CommandKafkaConsumer processes acks from Kafka,
        while DDSGatewayController handles HTTP acks as fallback.
        """
        # Primary: send to Kafka commands.ack topic
        kafka_ok = False
        if self._kafka_enabled and self._kafka_producer:
            try:
                uav_id = ack_payload.get('uavId', '')
                self._kafka_producer.send('commands.ack', key=uav_id, value=ack_payload)
                self._kafka_producer.flush(timeout=2)
                kafka_ok = True
                logger.info("[CommandAck] Sent to Kafka commands.ack: %s", ack_payload)
            except Exception as e:
                logger.warning("[CommandAck] Kafka send failed, falling back to HTTP: %s", e)

        # Fallback: forward via HTTP if Kafka failed
        if not kafka_ok:
            try:
                resp = self._ack_session.post(
                    f"{self.backend_url}/api/v1/dds-gateway/command-ack",
                    json=ack_payload,
                    timeout=3,
                )
                if resp.status_code == 200:
                    logger.info("[CommandAck] Forwarded ack to backend via HTTP: %s", ack_payload)
                else:
                    logger.warning("[CommandAck] Backend returned %d: %s", resp.status_code, resp.text[:200])
            except Exception as e:
                logger.error("[CommandAck] HTTP forward failed: %s", e)

    @staticmethod
    def _nav_state_to_mode(nav_state: int) -> str:
        """Convert PX4 nav_state enum to human-readable mode string."""
        modes = {
            0: "MANUAL", 1: "ALTCTL", 2: "POSCTL",
            3: "AUTO_MISSION", 4: "AUTO_LOITER", 5: "AUTO_RTL",
            14: "OFFBOARD", 17: "AUTO_TAKEOFF", 18: "AUTO_LAND",
        }
        return modes.get(nav_state, f"MODE_{nav_state}")

    # ============================================================
    # Data Forwarding
    # ============================================================

    def _init_kafka(self):
        """Initialize Kafka producer and consumer for dual-write mode."""
        try:
            from kafka import KafkaProducer
            self._kafka_producer = KafkaProducer(
                bootstrap_servers=self._kafka_bootstrap,
                key_serializer=lambda k: k.encode('utf-8') if k else None,
                value_serializer=lambda v: json.dumps(v).encode('utf-8'),
                acks=1,
                retries=3,
                max_block_ms=5000,
                linger_ms=0,      # Send immediately — no batching delay
                batch_size=16384, # Small batch to avoid accumulation
            )
            self._kafka_enabled = True
            logger.info("[Kafka] Producer initialized: %s (linger_ms=0 for real-time)", self._kafka_bootstrap)
        except ImportError:
            logger.warning("[Kafka] kafka-python not installed. pip install kafka-python")
        except Exception as e:
            logger.warning("[Kafka] Producer init failed (will use HTTP only): %s", e)

    def _start_kafka_command_consumer(self):
        """Start a background thread that consumes commands from Kafka commands.down topic.

        This replaces the HTTP-only command path. The backend publishes commands
        to commands.down via CommandKafkaProducer; the Gateway consumes them here
        and forwards to PX4 via DDS.

        Message format (JSON):
        {
            "uavId": "px4_1",
            "commandType": "TAKEOFF",
            "params": "{}",
            "timestamp": "2024-01-01T00:00:00Z",
            "userId": 1,
            "commandLogId": 123,
            "epoch": 3
        }

        Epoch validation: commands with epoch < current drone epoch are
        discarded as stale (e.g. sent before drone restart but arriving after).
        Timestamp validation: commands older than 60s are discarded.
        """
        if not self._kafka_enabled:
            logger.info("[KafkaCmd] Kafka not enabled, skipping command consumer")
            return
        try:
            from kafka import KafkaConsumer as _KafkaConsumer
            # Multi-instance: each instance uses a unique consumer group so
            # ALL instances receive ALL commands (each filters by ownership).
            # Using a shared group would split messages, but drones can only
            # be commanded by the instance that subscribed to them.
            group_id = f'dds-gateway-cmd-{self.instance_id}'
            consumer = _KafkaConsumer(
                'commands.down',
                bootstrap_servers=self._kafka_bootstrap,
                group_id=group_id,
                value_deserializer=lambda v: json.loads(v.decode('utf-8')),
                auto_offset_reset='latest',
                enable_auto_commit=True,
                consumer_timeout_ms=1000,  # poll returns after 1s if no messages
            )
            logger.info("[KafkaCmd] Consumer initialized for commands.down (group=%s)", group_id)
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

                                # --- Epoch validation: discard stale commands ---
                                msg_epoch = data.get('epoch', 0)
                                current_epoch = self._epoch_map.get(uav_id, 0)
                                if current_epoch > 0 and msg_epoch < current_epoch:
                                    logger.warn(
                                        "[KafkaCmd] Stale command discarded: %s -> %s "
                                        "msgEpoch=%d < currentEpoch=%d",
                                        command_type, uav_id, msg_epoch, current_epoch)
                                    self._stats['kafka_commands_stale'] = \
                                        self._stats.get('kafka_commands_stale', 0) + 1
                                    continue

                                # --- Timestamp validation: discard commands older than 60s ---
                                ts_str = data.get('timestamp', '')
                                if ts_str:
                                    from datetime import datetime, timezone
                                    try:
                                        msg_time = datetime.fromisoformat(
                                            ts_str.replace('Z', '+00:00'))
                                        age_s = (datetime.now(timezone.utc)
                                                 - msg_time).total_seconds()
                                        if age_s > 60:
                                            logger.warn(
                                                "[KafkaCmd] Expired command discarded: "
                                                "%s -> %s age=%.1fs",
                                                command_type, uav_id, age_s)
                                            self._stats['kafka_commands_expired'] = \
                                                self._stats.get('kafka_commands_expired', 0) + 1
                                            continue
                                    except Exception:
                                        pass  # If timestamp parsing fails, proceed anyway

                                # Multi-instance: skip commands for drones not owned by us
                                if not self._owns_drone(uav_id):
                                    continue

                                logger.info("[KafkaCmd] Received: %s -> %s epoch=%d params=%s",
                                            command_type, uav_id, msg_epoch, params)
                                result = self.handle_command(uav_id, command_type, params)
                                logger.info("[KafkaCmd] Result: %s -> %s: %s",
                                            command_type, uav_id, result)
                                self._stats['kafka_commands_consumed'] = \
                                    self._stats.get('kafka_commands_consumed', 0) + 1

                                # Send ACK to commands.ack topic
                                self._send_command_ack(
                                    uav_id, command_type, msg_epoch,
                                    data.get('commandLogId'),
                                    result)
                            except Exception as e:
                                logger.error("[KafkaCmd] Failed to process command: %s", e)
                except Exception as e:
                    if self.running:
                        logger.error("[KafkaCmd] Poll error: %s", e)
                        time.sleep(1)
            try:
                consumer.close()
            except Exception:
                pass
            logger.info("[KafkaCmd] Consumer thread stopped")

        t = threading.Thread(target=_consume_loop, daemon=True, name='kafka-cmd-consumer')
        t.start()
        logger.info("[KafkaCmd] Consumer thread launched")

    def _send_command_ack(self, uav_id: str, command_type: str, epoch: int,
                          command_log_id, result: dict):
        """Send command execution ACK to commands.ack Kafka topic.

        This ensures the commands.ack topic is created and downstream services
        (e.g., ucs-command CommandAckConsumer) can track command outcomes.
        """
        if not self._kafka_enabled or not self._kafka_producer:
            return
        try:
            from datetime import datetime, timezone
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

    def _get_or_increment_epoch(self, uav_id: str, is_new: bool = False) -> int:
        """Get current epoch for a drone, incrementing on reconnection."""
        if uav_id not in self._epoch_map:
            self._epoch_map[uav_id] = 1
            logger.info("[Epoch] New drone %s, epoch=1", uav_id)
        elif is_new:
            self._epoch_map[uav_id] += 1
            logger.info("[Epoch] Drone %s reconnected, epoch=%d", uav_id, self._epoch_map[uav_id])
        return self._epoch_map[uav_id]

    def _start_epoch_maintenance(self):
        """Start a background thread for periodic epoch maintenance.

        Every 6 hours, scan the epoch map:
          - Normalize: epoch > 10000 → reset to 1
          - Evict: drones not seen for > 24 hours → remove from map

        This prevents epoch values from growing unbounded over long runtimes.
        """
        EPOCH_SOFT_LIMIT = 10000
        MAX_IDLE_SECONDS = 24 * 3600  # 24 hours
        MAINTENANCE_INTERVAL = 6 * 3600  # 6 hours

        def _maintenance_loop():
            logger.info("[EpochMaint] Maintenance thread started (interval=%ds)", MAINTENANCE_INTERVAL)
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

                    # Evict stale drones
                    if idle_s > MAX_IDLE_SECONDS:
                        self._epoch_map.pop(uav_id, None)
                        evicted += 1
                        continue

                    # Normalize large epochs
                    epoch = self._epoch_map.get(uav_id, 0)
                    if epoch > EPOCH_SOFT_LIMIT:
                        self._epoch_map[uav_id] = 1
                        normalized += 1
                        logger.info("[EpochMaint] Normalized drone %s epoch: %d -> 1", uav_id, epoch)

                if normalized > 0 or evicted > 0:
                    logger.info("[EpochMaint] Maintenance: normalized=%d, evicted=%d, remaining=%d",
                                normalized, evicted, len(self._epoch_map))

            logger.info("[EpochMaint] Maintenance thread stopped")

        t = threading.Thread(target=_maintenance_loop, daemon=True, name='epoch-maintenance')
        t.start()
        logger.info("[EpochMaint] Maintenance thread launched")

    def send_to_kafka(self, payload: dict) -> bool:
        """Send telemetry to Kafka (per-drone messages with uav_id as key).

        Timestamps are sent as epoch milliseconds (long) to match the
        TelemetryMessage DTO expected by all downstream Java microservices.

        NOTE: No flush() call here — messages are sent asynchronously for
        minimum latency. The KafkaProducer's internal linger.ms/batch.size
        controls actual network sends (default linger.ms=0 → immediate).
        """
        if not self._kafka_enabled or not self._kafka_producer:
            return False
        try:
            # Use epoch millis — matches TelemetryMessage.timestamp (long) in Java services
            timestamp_ms = int(time.time() * 1000)
            drones = payload.get('drones', [])
            for drone_data in drones:
                uav_id = drone_data.get('uavId', '')
                if not uav_id:
                    continue
                msg = dict(drone_data)
                msg['timestamp'] = timestamp_ms
                msg['epoch'] = self._epoch_map.get(uav_id, 0)
                # Key = uav_id -> same partition -> ordered
                # No flush — async send for lowest latency
                self._kafka_producer.send('telemetry.raw', key=uav_id, value=msg)
            self._stats['kafka_success'] += 1
            return True
        except Exception as e:
            logger.error("[Kafka] Send failed: %s", e)
            self._stats['kafka_errors'] += 1
            return False

    def send_event_to_kafka(self, event_type: str, uav_id: str, level: str, detail: str):
        """Send a drone event to the events.drone Kafka topic."""
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
            logger.info("[Kafka] Event sent: %s %s %s", event_type, uav_id, detail)
        except Exception as e:
            logger.error("[Kafka] Event send failed: %s", e)

    def build_telemetry_payload(self) -> dict:
        """Build the telemetry batch payload for the backend API."""
        from datetime import datetime, timezone

        drones = []
        with self._lock:
            for uav_id, state in self.drone_states.items():
                drones.append({
                    "uavId": state.uav_id,
                    "lat": state.lat,
                    "lon": state.lon,
                    "alt": state.alt,
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
                    "positionValid": state.position_valid,
                })

        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "drones": drones
        }

    def build_telemetry_payload_single(self, uav_id: str) -> Optional[dict]:
        """Build telemetry payload for a single drone (real-time per-drone send).

        Always includes all available data. The 'positionValid' flag tells
        downstream consumers whether lat/lon/alt are trustworthy.
        """
        from datetime import datetime, timezone

        with self._lock:
            state = self.drone_states.get(uav_id)
            if not state:
                return None
            drone_data = {
                "uavId": state.uav_id,
                "lat": state.lat,
                "lon": state.lon,
                "alt": state.alt,
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
                "positionValid": state.position_valid,
            }

        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "drones": [drone_data]
        }

    def send_to_backend(self, payload: dict) -> bool:
        """Send telemetry batch to the backend REST API."""
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
                result = resp.json()
                partitions = result.get('partitions', [])
                processed = result.get('processed', 0)
                logger.info(
                    "[Forward] Sent %d drone(s) -> routed to %d partition(s): %s",
                    processed, len(partitions), list(partitions)
                )
                self._stats['backend_success'] += 1
                return True
            else:
                logger.error(
                    "[Forward] Backend HTTP %d: %s",
                    resp.status_code, resp.text[:200]
                )
                self._stats['backend_errors'] += 1
                return False
        except requests.exceptions.ConnectionError:
            logger.error("[Forward] Connection lost to %s", self.backend_url)
            self._stats['backend_errors'] += 1
            return False
        except Exception as e:
            logger.error("[Forward] Send failed: %s", e)
            self._stats['backend_errors'] += 1
            return False

    def log_statistics(self):
        """Log periodic statistics every 10 seconds."""
        now = time.time()
        if now - self._last_stats_time < 10:
            return
        elapsed = now - self._last_stats_time
        self._last_stats_time = now
        total = self._stats.get('total_messages', 0)

        logger.info("=" * 60)
        logger.info(
            "[Stats] %.0fs elapsed | Total msgs: %d | Drones: %d | Subs: %d",
            elapsed, total, len(self.drone_states), len(self._subscriptions)
        )
        logger.info(
            "[Stats] Backend: success=%d errors=%d",
            self._stats.get('backend_success', 0),
            self._stats.get('backend_errors', 0)
        )

        with self._lock:
            for uid, s in self.drone_states.items():
                age = now - s.last_update if s.last_update > 0 else -1
                gps_age = now - s.last_global_position_time if s.last_global_position_time > 0 else -1
                logger.info(
                    "[Stats]   %-10s msgs=%-6d lat=%.6f lon=%.6f alt=%.1f "
                    "hdg=%.1f armed=%-5s mode=%-12s age=%.1fs gps_age=%.1fs valid=%s",
                    uid, s.msg_count, s.lat, s.lon, s.alt,
                    s.heading, s.armed, s.flight_mode, age,
                    gps_age, s.position_valid
                )

        topic_stats = {k: v for k, v in self._stats.items() if '/' in k}
        if topic_stats:
            logger.info("[Stats] Per-topic:")
            for t, c in sorted(topic_stats.items()):
                logger.info("[Stats]   %-40s %d", t, c)
        logger.info("=" * 60)

    # ============================================================
    # Main Loop
    # ============================================================

    def _start_spin_thread(self):
        """Start a dedicated thread for ROS2 spinning.

        ROOT CAUSE FIX for Issue 1 (position data reverting to 0,0):
        ─────────────────────────────────────────────────────────────
        The old design called rclpy.spin_once() in the main loop, processing
        only ONE DDS callback per iteration.  With 30 drones × 5+ topics ×
        10-50 Hz ≈ thousands of messages per second, only ~20 were processed
        per second.  BEST_EFFORT QoS (depth=10) drops messages when the buffer
        overflows.  If VehicleGlobalPosition callbacks were dropped while other
        topic callbacks (attitude, local_position) kept arriving, last_update
        stayed fresh but lat/lon remained at 0.0 defaults.

        The fix: a dedicated thread calls rclpy.spin() which continuously
        processes ALL pending callbacks as fast as they arrive, completely
        decoupling DDS callback processing from the telemetry forwarding loop.
        """
        import rclpy

        def _spin():
            logger.info("[SpinThread] Dedicated ROS2 spin thread started")
            try:
                while self.running and rclpy.ok():
                    rclpy.spin_once(self._node, timeout_sec=0.01)
            except Exception as e:
                logger.error("[SpinThread] Error: %s", e)
            logger.info("[SpinThread] Spin thread stopped")

        t = threading.Thread(target=_spin, daemon=True, name='ros2-spin')
        t.start()
        self._spin_thread = t
        logger.info("[SpinThread] ROS2 spin thread launched")

    def run(self):
        """Main loop: discover drones, forward telemetry to Kafka/backend.

        Architecture (after Issue 1 fix):
          - Dedicated spin thread handles ALL DDS callbacks continuously
          - Main loop ONLY handles discovery + telemetry forwarding at 10Hz
          - No spin_once in main loop → no callback starvation
        """
        self.running = True
        logger.info("=" * 60)
        logger.info("[Startup] DDS Routing Gateway (Gateway 1)")
        logger.info("[Startup] Backend: %s", self.backend_url)
        logger.info("[Startup] Interval: %.1fs", self.poll_interval)
        logger.info(
            "[Startup] rclpy: %s | px4_msgs: %s",
            self._rclpy_available, self._px4_msgs_available
        )
        logger.info(
            "[Startup] ROS_DOMAIN_ID: %s",
            os.environ.get('ROS_DOMAIN_ID', 'default(0)')
        )
        if self.total_instances > 1:
            logger.info(
                "[Startup] Multi-instance mode: instance %d / %d",
                self.instance_id, self.total_instances
            )
        logger.info("=" * 60)

        if not self._rclpy_available:
            logger.error("[Startup] ROS2 not available. Exiting.")
            return
        if not self._init_ros2_node():
            logger.error("[Startup] Failed to init ROS2 node. Exiting.")
            return

        # Start dedicated ROS2 spin thread (Issue 1 fix)
        self._start_spin_thread()

        # Proactive subscription: if --drone-count is set, subscribe to expected
        # drone IDs (px4_1..px4_N) immediately without waiting for topic discovery.
        # This ensures all drones are subscribed even if they haven't started yet.
        expected_count = getattr(self, '_expected_drone_count', 0)
        if expected_count > 0:
            logger.info(
                "[Proactive] Subscribing to %d expected drones (px4_1..px4_%d), "
                "instance %d/%d...",
                expected_count, expected_count,
                self.instance_id, self.total_instances
            )
            proactive_count = 0
            for i in range(1, expected_count + 1):
                uid = f"px4_{i}"
                if self._owns_drone(uid):
                    self.subscribe_to_drone(uid)
                    epoch = self._get_or_increment_epoch(uid, is_new=True)
                    with self._lock:
                        if uid in self.drone_states:
                            self.drone_states[uid].epoch = epoch
                    proactive_count += 1
            logger.info(
                "[Proactive] Subscribed to %d/%d drones (owned by this instance)",
                proactive_count, expected_count
            )

        # Start command HTTP server for receiving commands from backend (fallback)
        # Multi-instance: each instance uses a different port
        cmd_port = int(os.environ.get('DDS_COMMAND_PORT', '5050'))
        if self.total_instances > 1:
            cmd_port = cmd_port + self.instance_id
        self.start_command_server(port=cmd_port)

        # Start Kafka command consumer (primary command path)
        self._start_kafka_command_consumer()

        # Start epoch periodic maintenance (prevents unbounded epoch growth)
        self._start_epoch_maintenance()

        logger.info("[Startup] Checking backend...")
        for attempt in range(3):
            if self.check_backend_health():
                break
            logger.info("[Startup] Retry %d/3 in 5s...", attempt + 1)
            time.sleep(5)
        else:
            logger.warning("[Startup] Backend unreachable. Continuing anyway...")

        cycle = 0
        import rclpy

        # Track per-drone last-sent timestamps for 10Hz throttle
        _last_sent: Dict[str, float] = {}
        SEND_INTERVAL = 0.1  # 10Hz per drone

        # Discovery interval: every 5s (50 cycles at 0.1s)
        DISCOVERY_INTERVAL = 50

        while self.running and rclpy.ok():
            try:
                if cycle % DISCOVERY_INTERVAL == 0:
                    logger.info("[Discovery] Scanning topics (cycle %d)...", cycle)
                    new_drones = self.discover_drones_from_topics()

                    # Phase 1: Register and subscribe NEW drones
                    for uid in new_drones:
                        is_new = uid not in self.drone_states
                        if is_new:
                            logger.info("[Discovery] NEW drone: %s", uid)
                            self.subscribe_to_drone(uid)
                            # Increment epoch for new/reconnected drone
                            epoch = self._get_or_increment_epoch(uid, is_new=True)
                            with self._lock:
                                self.drone_states[uid].epoch = epoch
                            # Publish online event to Kafka
                            self.send_event_to_kafka('DRONE_ONLINE', uid, 'INFO',
                                                     f'Drone {uid} connected (epoch={epoch})')

                    # Phase 2: Retry incomplete subscriptions for EXISTING drones
                    # This handles drones whose topics weren't all available on
                    # the first subscription attempt (e.g. PX4 hadn't started yet).
                    for uid in list(self.drone_states.keys()):
                        subs = self._drone_subscribed_topics.get(uid, set())
                        # 6 expected: global_pos, local_pos, attitude, status, battery, cmd_ack
                        if len(subs) < 6:
                            logger.info(
                                "[Discovery] Drone %s has %d/6 subscriptions, retrying...",
                                uid, len(subs)
                            )
                            self.subscribe_to_drone(uid)

                    if not new_drones and cycle == 0:
                        logger.warning(
                            "[Discovery] No drones found. "
                            "Check PX4 simulator and ROS_DOMAIN_ID."
                        )

                    # Log summary of all tracked drones
                    if self.drone_states:
                        total = len(self.drone_states)
                        valid = sum(1 for s in self.drone_states.values() if s.position_valid)
                        logger.info(
                            "[Discovery] Tracking %d drones (%d with valid position), "
                            "%d total subscriptions",
                            total, valid, len(self._subscriptions)
                        )

                # Real-time per-drone forwarding at 10Hz (no batch accumulation)
                # Forward ALL drones that have received any data, not just those
                # with valid GPS. This ensures the frontend shows drones as "online"
                # even before GPS initialization completes.
                if self.drone_states:
                    now = time.time()
                    with self._lock:
                        snapshot = list(self.drone_states.items())
                    for uid, state in snapshot:
                        # Skip drones that have never received ANY callback
                        if state.last_update <= 0 and not state.position_valid:
                            continue
                        if state.last_update > 0 and now - state.last_update > 5:
                            continue  # Skip stale drones (no data for 5s)
                        last = _last_sent.get(uid, 0)
                        if now - last < SEND_INTERVAL:
                            continue  # Throttle: 10Hz per drone
                        _last_sent[uid] = now
                        # Build single-drone payload and send immediately
                        single_payload = self.build_telemetry_payload_single(uid)
                        if single_payload:
                            kafka_ok = self.send_to_kafka(single_payload)
                            if not kafka_ok:
                                self.send_to_backend(single_payload)

                self.log_statistics()
                cycle += 1
                # Sleep to maintain ~10Hz forwarding rate
                time.sleep(0.05)

            except KeyboardInterrupt:
                break
            except Exception as e:
                logger.error("[MainLoop] %s", e, exc_info=True)
                time.sleep(1)

        self._cleanup()
        logger.info("[Shutdown] Gateway stopped")

    def _cleanup(self):
        """Clean up ROS2 resources."""
        try:
            import rclpy
            if self._node:
                self._node.destroy_node()
            if rclpy.ok():
                rclpy.shutdown()
            logger.info("[Shutdown] Cleanup complete")
        except Exception as e:
            logger.debug("[Shutdown] %s", e)

    def stop(self):
        """Stop the gateway gracefully."""
        self.running = False

    # ============================================================
    # Command Publishing (Backend -> DDS)
    # ============================================================

    def _extract_system_id(self, uav_id: str) -> int:
        """Extract PX4 system ID from uav_id.

        In multi-SITL, each drone has a unique system ID:
          px4_1 -> 1, px4_2 -> 2, px4_3 -> 3, etc.
        This ensures commands are routed to the correct drone.
        """
        try:
            # Extract numeric suffix: px4_1 -> 1, px4_2 -> 2
            parts = uav_id.split('_')
            if len(parts) >= 2 and parts[-1].isdigit():
                return int(parts[-1])
        except (ValueError, IndexError):
            pass
        return 1  # Default to system 1

    def _get_or_create_publisher(self, topic: str, msg_type):
        """Get a cached publisher or create a new one.

        Avoids creating a new publisher for every command, which can cause
        DDS resource leaks and delayed message delivery.
        """
        if not hasattr(self, '_command_publishers'):
            self._command_publishers = {}
        if topic not in self._command_publishers:
            self._command_publishers[topic] = self._node.create_publisher(msg_type, topic, 10)
        return self._command_publishers[topic]

    def publish_vehicle_command(self, uav_id: str, command: int, param1: float = 0.0,
                                 param2: float = 0.0, param3: float = 0.0,
                                 param5: float = 0.0, param6: float = 0.0,
                                 param7: float = 0.0) -> bool:
        """Publish a VehicleCommand to /{uav_id}/fmu/in/vehicle_command.

        Args:
            uav_id: Target drone ID (e.g., 'px4_1')
            command: PX4 command code (e.g., 400=ARM, 176=DO_SET_MODE, 22=TAKEOFF)
            param1-param7: Command-specific parameters
                For DO_SET_MODE (176): param1=base_mode, param2=main_mode, param3=sub_mode
                For ARM (400): param1=1(arm)/0(disarm), param2=0(normal)/21196(force)
                For NAV_TAKEOFF (22): param7=altitude(AMSL)
                For DO_SET_HOME (179): param1=use_current, param5=lat, param6=lon, param7=alt

        Notes:
            - target_system is derived from uav_id (px4_N -> N) to ensure
              commands are routed to the correct drone in multi-SITL.
            - source_system=255, source_component=190 matches QGC convention.
            - Commands are published to drone-specific topics: /{uav_id}/fmu/in/...
        """
        if not self._rclpy_available or not self._px4_msgs_available or not self._node:
            logger.error("[Command] ROS2/px4_msgs not available for command publishing")
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
            msg.source_component = 190  # Match QGC convention
            msg.from_external = True
            msg.timestamp = int(time.time() * 1e6)

            pub.publish(msg)
            logger.info("[Command] Published VehicleCommand cmd=%d p1=%.1f p2=%.1f p3=%.1f p5=%.6f p6=%.6f p7=%.1f -> %s (target_sys=%d)",
                        command, param1, param2, param3, param5, param6, param7, topic, target_sys)
            return True
        except Exception as e:
            logger.error("[Command] Failed to publish VehicleCommand: %s", e)
            return False

    def publish_offboard_control_mode(self, uav_id: str, position: bool = True) -> bool:
        """Publish OffboardControlMode to enable offboard position control."""
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
            logger.error("[Command] Failed to publish OffboardControlMode: %s", e)
            return False

    def publish_trajectory_setpoint(self, uav_id: str, x: float, y: float, z: float,
                                      yaw: float = float('nan'),
                                      log: bool = True) -> bool:
        """Publish TrajectorySetpoint for position control (NED frame).

        NaN values mean "hold current" for that axis. For takeoff from ground:
          x=NaN, y=NaN (hold position), z=-5.0 (climb to 5m above home)

        Args:
            yaw: Target yaw angle in radians (NED frame, 0=North, pi/2=East).
                 NaN means don't control yaw (drone keeps current heading).
        """
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
                logger.info("[Command] Published TrajectorySetpoint [%.2f, %.2f, %.2f] yaw=%.2f -> %s",
                            x, y, z, yaw, topic)
            return True
        except Exception as e:
            logger.error("[Command] Failed to publish TrajectorySetpoint: %s", e)
            return False

    def _get_takeoff_amsl(self, uav_id: str, relative_alt: float) -> float:
        """Convert a relative takeoff altitude to AMSL (absolute) altitude.

        PX4's VehicleCommand param7 for MAV_CMD_NAV_TAKEOFF (22) expects AMSL altitude.
        If we send a small number like 5.0, PX4 compares it against the drone's current
        AMSL altitude (e.g., ~488m in SITL) and rejects with "Already higher than takeoff
        altitude". We must add the drone's current AMSL altitude to get the correct target.
        """
        with self._lock:
            state = self.drone_states.get(uav_id)
            if state and state.alt > 0:
                amsl = state.alt + relative_alt
                logger.info("[Altitude] %s: current AMSL=%.2fm + relative=%.1fm = target AMSL=%.2fm",
                            uav_id, state.alt, relative_alt, amsl)
                return amsl
        # Fallback: if no altitude data available, use relative alt directly
        # This may still fail but is better than nothing
        logger.warning("[Altitude] %s: no AMSL data available, using relative alt %.1fm as fallback",
                       uav_id, relative_alt)
        return relative_alt

    def _save_home_position(self, uav_id: str):
        """Save the drone's current position as home (for NED coordinate conversion)."""
        with self._lock:
            state = self.drone_states.get(uav_id)
            if state and state.lat != 0.0:
                state.home_lat = state.lat
                state.home_lon = state.lon
                state.home_alt = state.alt
                logger.info("[Home] Saved home for %s: lat=%.6f lon=%.6f alt=%.2f",
                            uav_id, state.home_lat, state.home_lon, state.home_alt)
                return True
        logger.warning("[Home] Cannot save home for %s: no position data", uav_id)
        return False

    def _get_home_position(self, uav_id: str):
        """Get the home position for a drone. Returns (lat, lon, alt) or None."""
        with self._lock:
            state = self.drone_states.get(uav_id)
            if state and state.home_lat != 0.0:
                return state.home_lat, state.home_lon, state.home_alt
        return None

    def handle_command(self, uav_id: str, command_type: str, params: dict) -> dict:
        """Handle a command request from the backend.

        Translates high-level command types to PX4 DDS messages.

        Returns:
            dict with 'success' (bool) and 'message' (str)
        """
        command_type = command_type.upper()
        logger.info("[Command] Handling %s for %s params=%s", command_type, uav_id, params)

        if command_type == 'TAKEOFF':
            # TAKEOFF: ARM + OFFBOARD mode auto-takeoff (replaces old ARM button)
            #
            # PX4 auto-disarms if no takeoff within ~10s. NAV_TAKEOFF is a mission
            # waypoint command. OFFBOARD mode with TrajectorySetpoint is the correct
            # approach for our DDS architecture.
            #
            # Sequence:
            #   1. Save current position as home
            #   2. Start heartbeat (OffboardControlMode + TrajectorySetpoint) BEFORE arming
            #   3. ARM the drone
            #   4. Switch to OFFBOARD mode (DO_SET_MODE, param2=6)
            #   5. PX4 will climb to target altitude under OFFBOARD control
            relative_alt = float(params.get('altitude', params.get('defaultAltitude', 5.0)))
            target_z = -relative_alt  # NED frame: negative z = up
            logger.info("[Command] TAKEOFF (ARM+OFFBOARD): relative=%.1fm, NED_z=%.1f for %s",
                        relative_alt, target_z, uav_id)

            # Step 0: Save home position + set home on flight controller
            self._save_home_position(uav_id)
            self.publish_vehicle_command(uav_id, command=179, param1=1.0)  # use current pos

            # Step 1: Start heartbeat with target altitude BEFORE arming
            self.start_offboard_heartbeat(uav_id, target_z=target_z)
            time.sleep(0.5)  # ~2 heartbeat messages at 4Hz

            # Step 2: ARM
            ok = self.publish_vehicle_command(uav_id, command=400, param1=1.0, param2=0.0)
            if ok:
                # Step 3: Switch to OFFBOARD mode in background thread
                def _offboard_takeoff():
                    time.sleep(1.0)
                    self.publish_vehicle_command(uav_id, command=176,
                                                param1=1.0, param2=6.0)
                    logger.info("[Command] OFFBOARD takeoff initiated for %s (%.1fm AGL)",
                                uav_id, relative_alt)
                t = threading.Thread(target=_offboard_takeoff, daemon=True,
                                     name=f"offboard-takeoff-{uav_id}")
                t.start()

        elif command_type == 'LAND':
            # NAV_LAND (cmd 21): stop heartbeat and land
            self.stop_offboard_heartbeat(uav_id)
            lat = float(params.get('lat', 0))
            lon = float(params.get('lon', 0))
            alt = float(params.get('alt', 0))
            if lat != 0 and lon != 0:
                # Land at specified coordinates
                ok = self.publish_vehicle_command(
                    uav_id, command=21, param5=lat, param6=lon, param7=alt)
            else:
                ok = self.publish_vehicle_command(uav_id, command=21)

        elif command_type == 'RTL':
            # Return to launch: stop heartbeat and RTL
            self.stop_offboard_heartbeat(uav_id)
            lat = float(params.get('lat', 0))
            lon = float(params.get('lon', 0))
            if lat != 0 and lon != 0:
                # Set custom home before RTL so it returns to specified location
                alt = float(params.get('alt', 0))
                self.publish_vehicle_command(
                    uav_id, command=179, param1=0.0,
                    param5=lat, param6=lon, param7=alt)
                time.sleep(0.3)
            ok = self.publish_vehicle_command(uav_id, command=20)

        elif command_type == 'HOLD':
            # Stop any running orbit before holding position
            self.stop_orbit_heartbeat(uav_id)
            # HOLD: capture real-time position and continuously send it as setpoint.
            #
            # Previous bug: used cached NED position which could be stale if
            # the drone had moved since last VehicleLocalPosition update.
            # Fix: spin the ROS2 node briefly to process any pending messages,
            # then read the freshest position data.
            try:
                import rclpy
                # Process pending DDS messages to get the freshest position
                for _ in range(5):
                    rclpy.spin_once(self._node, timeout_sec=0.02)
            except Exception:
                pass  # Best effort - position may still be slightly stale

            with self._lock:
                state = self.drone_states.get(uav_id)
            if state:
                # Use the freshest NED local position as hold setpoint
                hold_x = state.ned_x
                hold_y = state.ned_y
                hold_z = state.ned_z if state.ned_z != 0.0 else -5.0
                pos_age = time.time() - state.last_update
                logger.info("[Command] HOLD: freezing at NED [%.2f, %.2f, %.2f] for %s (pos age: %.2fs)",
                            hold_x, hold_y, hold_z, uav_id, pos_age)
                if pos_age > 2.0:
                    logger.warning("[Command] HOLD: position data is %.1fs old for %s, may be inaccurate",
                                   pos_age, uav_id)
                self.start_offboard_heartbeat(
                    uav_id, target_z=hold_z,
                    target_x=hold_x, target_y=hold_y)
                ok = self.publish_vehicle_command(
                    uav_id, command=176, param1=1.0, param2=6.0)
            else:
                ok = self.publish_vehicle_command(uav_id, command=17)

        elif command_type == 'GOTO':
            # Stop any running orbit before going to target
            self.stop_orbit_heartbeat(uav_id)
            # Fly to target position: convert lat/lon to NED relative to home
            lat = float(params.get('lat', 0))
            lon = float(params.get('lon', 0))
            alt = float(params.get('alt', 5.0))  # relative altitude in meters

            home = self._get_home_position(uav_id)
            if home:
                home_lat, home_lon, home_alt = home
                # Target position in NED (relative to home)
                target_n, target_e, _ = _latlon_to_ned(
                    lat, lon, home_alt + alt,
                    home_lat, home_lon, home_alt)
                target_z = -alt  # NED: negative = up from home

                # Calculate yaw: bearing from drone's CURRENT position to target
                # Use current NED position (updated by _on_local_position callback)
                with self._lock:
                    state = self.drone_states.get(uav_id)
                cur_n = state.ned_x if state else 0.0
                cur_e = state.ned_y if state else 0.0
                delta_n = target_n - cur_n  # north difference (meters)
                delta_e = target_e - cur_e  # east difference (meters)
                dist = math.sqrt(delta_n ** 2 + delta_e ** 2)
                if dist > 0.5:  # Only set yaw if target is >0.5m away
                    # atan2(east, north) → 0=North, pi/2=East (NED yaw convention)
                    target_yaw = math.atan2(delta_e, delta_n)
                else:
                    target_yaw = float('nan')  # Too close, keep current heading

                logger.info(
                    "[Command] GOTO: target=(%.6f,%.6f) alt=%.1f -> NED [%.1f,%.1f,%.1f] "
                    "cur_NED=[%.1f,%.1f] dist=%.1fm yaw=%.2frad(%.1f°) for %s",
                    lat, lon, alt, target_n, target_e, target_z,
                    cur_n, cur_e, dist,
                    target_yaw, math.degrees(target_yaw) if not math.isnan(target_yaw) else 0,
                    uav_id)
                # Update heartbeat setpoint with new target + yaw
                self.start_offboard_heartbeat(
                    uav_id, target_z=target_z,
                    target_x=target_n, target_y=target_e,
                    target_yaw=target_yaw)
                # Ensure OFFBOARD mode
                ok = self.publish_vehicle_command(
                    uav_id, command=176, param1=1.0, param2=6.0)
            else:
                logger.warning("[Command] GOTO: no home position for %s, using raw coords", uav_id)
                target_z = -alt
                self.start_offboard_heartbeat(uav_id, target_z=target_z)
                ok = self.publish_vehicle_command(
                    uav_id, command=176, param1=1.0, param2=6.0)

        elif command_type == 'MARK_HOME':
            # Set home position: cmd 179 (DO_SET_HOME)
            lat = float(params.get('lat', 0))
            lon = float(params.get('lon', 0))
            alt = float(params.get('alt', 0))
            if lat != 0 and lon != 0:
                # Use specified coordinates
                ok = self.publish_vehicle_command(
                    uav_id, command=179, param1=0.0,
                    param5=lat, param6=lon, param7=alt)
                if ok:
                    with self._lock:
                        state = self.drone_states.get(uav_id)
                        if state:
                            state.home_lat = lat
                            state.home_lon = lon
                            state.home_alt = alt
            else:
                # Use current position
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
            # OFFBOARD circular orbit: continuously update TrajectorySetpoint
            # positions around a circle. DO_ORBIT (cmd 34) is unreliable in
            # PX4 SITL, so we use OFFBOARD mode with position setpoints.
            lat = float(params.get('lat', 0))
            lon = float(params.get('lon', 0))
            radius = max(2.5, float(params.get('radius', 5.0)))
            velocity = float(params.get('velocity', 2.0))  # m/s tangential

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
                # Orbit around current position
                center_n, center_e, _ = _latlon_to_ned(
                    state.lat, state.lon, home_alt, home_lat, home_lon, home_alt)

            logger.info("[Command] ORBIT (OFFBOARD): center NED=(%.1f,%.1f) radius=%.1fm vel=%.1fm/s for %s",
                        center_n, center_e, radius, velocity, uav_id)

            # Start OFFBOARD orbit heartbeat
            self.start_orbit_heartbeat(
                uav_id, center_n, center_e, current_alt_ned, radius, velocity)

            # Ensure OFFBOARD mode is active
            time.sleep(0.3)
            self.publish_vehicle_command(uav_id, command=176, param1=1.0, param2=6.0)
            ok = True

        elif command_type == 'SET_ROI':
            # DO_SET_ROI_LOCATION (cmd 195): set region of interest
            # param5 = lat, param6 = lon, param7 = alt
            lat = float(params.get('lat', 0))
            lon = float(params.get('lon', 0))
            alt = float(params.get('alt', 0))
            if lat != 0 and lon != 0:
                logger.info("[Command] SET_ROI: %.6f,%.6f for %s", lat, lon, uav_id)
                ok = self.publish_vehicle_command(
                    uav_id, command=195,
                    param5=lat, param6=lon, param7=alt)
            else:
                # Cancel ROI (cmd 197)
                ok = self.publish_vehicle_command(uav_id, command=197)

        elif command_type == 'SET_YAW':
            # CONDITION_YAW (cmd 115): set yaw angle
            # param1 = target angle (degrees)
            # param2 = angular speed (deg/s)
            # param3 = direction (-1=ccw, 0=shortest, 1=cw)
            # param4 = 0=absolute, 1=relative
            yaw = float(params.get('yaw', 0))
            speed = float(params.get('speed', 30))
            relative = int(params.get('relative', 0))
            logger.info("[Command] SET_YAW: %.1f deg, speed=%.1f for %s", yaw, speed, uav_id)
            ok = self.publish_vehicle_command(
                uav_id, command=115,
                param1=yaw, param2=speed,
                param3=0.0, param4=float(relative))

        elif command_type == 'SET_GPS_ORIGIN':
            # SET_GPS_GLOBAL_ORIGIN (cmd 100048): set EKF origin
            # param5 = lat, param6 = lon, param7 = alt
            lat = float(params.get('lat', 0))
            lon = float(params.get('lon', 0))
            alt = float(params.get('alt', 0))
            if lat != 0 and lon != 0:
                logger.info("[Command] SET_GPS_ORIGIN: %.6f,%.6f for %s", lat, lon, uav_id)
                ok = self.publish_vehicle_command(
                    uav_id, command=100048,
                    param5=lat, param6=lon, param7=alt)
            else:
                return {'success': False, 'message': 'SET_GPS_ORIGIN requires lat and lon'}

        elif command_type == 'GET_HOME':
            # Return current home position (for frontend display)
            home = self._get_home_position(uav_id)
            if home:
                return {'success': True, 'message': 'Home position retrieved',
                        'home': {'lat': home[0], 'lon': home[1], 'alt': home[2]}}
            return {'success': False, 'message': f'No home position for {uav_id}'}

        else:
            return {'success': False, 'message': f'Unknown command type: {command_type}'}

        if ok:
            return {'success': True, 'message': f'{command_type} command sent to {uav_id}'}
        else:
            return {'success': False, 'message': f'Failed to publish {command_type} to DDS'}

    # ============================================================
    # Offboard Heartbeat (>2Hz for OFFBOARD mode)
    # ============================================================

    def start_offboard_heartbeat(self, uav_id: str, interval: float = 0.25,
                                    target_z: float = None,
                                    target_x: float = None,
                                    target_y: float = None,
                                    target_yaw: float = None):
        """Start publishing OffboardControlMode + TrajectorySetpoint at 4Hz.

        PX4 requires continuous OffboardControlMode at >2Hz to stay in OFFBOARD mode.
        We publish at 4Hz (0.25s) for sufficient margin.

        The heartbeat also publishes TrajectorySetpoint to maintain position hold
        or fly to target. In NED frame, z is negative-up:
          target_z = -5.0 means 5m above home/takeoff point.
          target_x = north offset in meters (NaN = hold current)
          target_y = east offset in meters (NaN = hold current)
          target_yaw = yaw in radians (0=North, pi/2=East, NaN = hold current)

        Args:
            uav_id: Target drone ID
            interval: Publish interval in seconds (default 0.25s = 4Hz)
            target_z: NED z position target (negative = up). If None, holds current.
            target_x: NED x (north) position target. If None, NaN (hold current).
            target_y: NED y (east) position target. If None, NaN (hold current).
            target_yaw: Yaw angle in radians. If None, NaN (hold current heading).
        """
        key = f"heartbeat_{uav_id}"

        if not hasattr(self, '_heartbeat_threads'):
            self._heartbeat_threads = {}
            self._heartbeat_active = {}
            self._heartbeat_setpoints = {}

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

        # Update target setpoint if heartbeat already running
        if key in self._heartbeat_threads and self._heartbeat_threads[key].is_alive():
            logger.info("[Heartbeat] Updated setpoint for %s: x=%.1f y=%.1f z=%.1f yaw=%.2f",
                        uav_id, sp.get('x', float('nan')),
                        sp.get('y', float('nan')), sp.get('z', float('nan')),
                        sp.get('yaw', float('nan')))
            return

        self._heartbeat_active[uav_id] = True

        def _heartbeat_loop():
            logger.info("[Heartbeat] Started for %s at %.1f Hz", uav_id, 1.0 / interval)
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
                    self.publish_trajectory_setpoint(uav_id, x, y, z, yaw=yaw, log=False)
                except Exception as e:
                    logger.error("[Heartbeat] Error for %s: %s", uav_id, e)
                time.sleep(interval)
            logger.info("[Heartbeat] Stopped for %s", uav_id)

        t = threading.Thread(target=_heartbeat_loop, daemon=True, name=f"heartbeat-{uav_id}")
        t.start()
        self._heartbeat_threads[key] = t

    def stop_offboard_heartbeat(self, uav_id: str):
        """Stop the offboard heartbeat for a drone."""
        if hasattr(self, '_heartbeat_active'):
            self._heartbeat_active[uav_id] = False
        if hasattr(self, '_heartbeat_setpoints') and uav_id in self._heartbeat_setpoints:
            del self._heartbeat_setpoints[uav_id]
        # Also stop orbit heartbeat if running
        self.stop_orbit_heartbeat(uav_id)

    def start_orbit_heartbeat(self, uav_id: str, center_n: float, center_e: float,
                                alt_ned: float, radius: float, velocity: float,
                                interval: float = 0.1):
        """Start OFFBOARD circular orbit by continuously updating TrajectorySetpoint.

        Traces a circle around (center_n, center_e) in NED frame at the given
        altitude, radius, and tangential velocity. The yaw is always pointed
        towards the center of the orbit.

        Args:
            center_n: NED north position of orbit center (meters)
            center_e: NED east position of orbit center (meters)
            alt_ned: NED altitude (negative = up, e.g. -5.0 = 5m above home)
            radius: Orbit radius in meters (min 2.5m)
            velocity: Tangential velocity in m/s
            interval: Update interval in seconds (default 0.1s = 10Hz)
        """
        orbit_key = f"orbit_{uav_id}"

        if not hasattr(self, '_orbit_threads'):
            self._orbit_threads = {}
            self._orbit_active = {}

        # Stop any existing orbit for this drone
        self.stop_orbit_heartbeat(uav_id)

        self._orbit_active[uav_id] = True

        # Angular velocity: omega = v / r (rad/s)
        omega = velocity / radius

        def _orbit_loop():
            logger.info("[Orbit] Started for %s: center=(%.1f,%.1f) r=%.1fm v=%.1fm/s",
                        uav_id, center_n, center_e, radius, velocity)
            
            arrived = False
            t0 = 0
            initial_angle = 0
            
            while self._orbit_active.get(uav_id, False) and self.running:
                try:
                    with self._lock:
                        state = self.drone_states.get(uav_id)
                    
                    if not state:
                        time.sleep(interval)
                        continue

                    # 1. 计算当前相对于圆心的偏差（必须在这里定义，确保全流程可用）
                    dx = state.ned_x - center_n
                    dy = state.ned_y - center_e
                    dist = math.sqrt(dx**2 + dy**2)
                    
                    # 默认目标点和偏航角（防止逻辑未覆盖）
                    target_n, target_e, yaw = state.ned_x, state.ned_y, 0.0

                    if not arrived:
                        # 阶段 1: 飞向圆周切入点
                        if dist > 0.1:
                            target_n = center_n + (dx / dist) * radius
                            target_e = center_e + (dy / dist) * radius
                        else:
                            target_n = center_n + radius
                            target_e = center_e
                            
                        # 机头指向目标点
                        yaw = math.atan2(target_e - state.ned_y, target_n - state.ned_x)
                        
                        # 判断是否到达圆周（2米范围内视为到达）
                        if abs(dist - radius) < 2.0:
                            arrived = True
                            t0 = time.time()
                            initial_angle = math.atan2(dy, dx)
                            logger.info("[Orbit] Drone %s arrived at orbit circle, switching to rotation phase", uav_id)
                    
                    if arrived:
                        # 阶段 2: 绕圈飞行
                        elapsed = time.time() - t0
                        angle = initial_angle + (omega * elapsed)
                        
                        target_n = center_n + radius * math.cos(angle)
                        target_e = center_e + radius * math.sin(angle)
                        
                        # 机头指向圆心
                        yaw = math.atan2(center_e - target_e, center_n - target_n)

                    # 发送指令
                    self.publish_offboard_control_mode(uav_id, position=True)
                    self.publish_trajectory_setpoint(
                        uav_id, target_n, target_e, alt_ned, yaw=yaw, log=False)
                        
                except Exception as e:
                    logger.error("[Orbit] Error for %s: %s", uav_id, e)
                time.sleep(interval)
            logger.info("[Orbit] Stopped for %s", uav_id)

        t = threading.Thread(target=_orbit_loop, daemon=True, name=f"orbit-{uav_id}")
        t.start()
        self._orbit_threads[orbit_key] = t

    def stop_orbit_heartbeat(self, uav_id: str):
        """Stop the orbit heartbeat for a drone."""
        if hasattr(self, '_orbit_active'):
            self._orbit_active[uav_id] = False

    # ============================================================
    # Command HTTP Server (receives commands from backend)
    # ============================================================

    def start_command_server(self, port: int = 5050):
        """Start a lightweight HTTP server to receive commands from the backend."""
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
                elif self.path == '/api/heartbeat/start':
                    content_length = int(self.headers.get('Content-Length', 0))
                    body = self.rfile.read(content_length)
                    data = json.loads(body)
                    gateway.start_offboard_heartbeat(data.get('uavId', ''))
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({'success': True}).encode())
                elif self.path == '/api/heartbeat/stop':
                    content_length = int(self.headers.get('Content-Length', 0))
                    body = self.rfile.read(content_length)
                    data = json.loads(body)
                    gateway.stop_offboard_heartbeat(data.get('uavId', ''))
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({'success': True}).encode())
                else:
                    self.send_response(404)
                    self.end_headers()

            def do_GET(self):
                if self.path == '/api/health':
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    with gateway._lock:
                        valid_drones = [uid for uid, s in gateway.drone_states.items()
                                        if s.position_valid]
                    self.wfile.write(json.dumps({
                        'status': 'ok',
                        'instanceId': gateway.instance_id,
                        'totalInstances': gateway.total_instances,
                        'drones': list(gateway.drone_states.keys()),
                        'validPositionDrones': valid_drones,
                        'subscriptions': len(gateway._subscriptions),
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


def main():
    parser = argparse.ArgumentParser(
        description='DDS Routing Gateway (Gateway 1) - PX4 Telemetry Forwarder'
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
        default=float(os.environ.get('DDS_POLL_INTERVAL', '1.0')),
        help='Poll interval in seconds (default: 1.0)'
    )
    parser.add_argument(
        '--drones',
        nargs='*',
        help='Manually specify drone IDs (e.g., px4_1 px4_2)'
    )
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Enable verbose/debug logging'
    )
    # --- Multi-instance arguments ---
    parser.add_argument(
        '--instance-id',
        type=int,
        default=int(os.environ.get('DDS_INSTANCE_ID', '0')),
        help='Instance ID for multi-instance mode (0-based, default: 0)'
    )
    parser.add_argument(
        '--total-instances',
        type=int,
        default=int(os.environ.get('DDS_TOTAL_INSTANCES', '1')),
        help='Total number of gateway instances (default: 1 = single instance)'
    )
    parser.add_argument(
        '--drone-count',
        type=int,
        default=int(os.environ.get('DDS_DRONE_COUNT', '0')),
        help='Expected total number of drones. When set, the gateway proactively '
             'subscribes to px4_1..px4_N (filtered by instance partitioning) '
             'without waiting for topic discovery. Set to 0 to rely solely on '
             'dynamic topic discovery (default: 0)'
    )
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Validate multi-instance config
    if args.instance_id < 0:
        parser.error("--instance-id must be >= 0")
    if args.total_instances < 1:
        parser.error("--total-instances must be >= 1")
    if args.instance_id >= args.total_instances:
        parser.error(
            f"--instance-id ({args.instance_id}) must be < "
            f"--total-instances ({args.total_instances})"
        )

    gateway = DDSGateway(
        backend_url=args.backend_url,
        api_key=args.api_key,
        poll_interval=args.interval,
        instance_id=args.instance_id,
        total_instances=args.total_instances
    )

    # Store drone_count for proactive subscription in run()
    gateway._expected_drone_count = args.drone_count

    def signal_handler(sig, frame):
        logger.info("[Signal] %s received, stopping...", sig)
        gateway.stop()

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    if args.drones:
        logger.info("[Config] Manual drones: %s", args.drones)
        if gateway._rclpy_available:
            gateway._init_ros2_node()
            for d in args.drones:
                # In multi-instance mode, only subscribe to owned drones
                if gateway._owns_drone(d):
                    gateway.subscribe_to_drone(d)
                else:
                    logger.info("[Config] Skipping %s (owned by instance %d)",
                                d, gateway._extract_system_id(d) % gateway.total_instances)

    gateway.run()


if __name__ == '__main__':
    main()
