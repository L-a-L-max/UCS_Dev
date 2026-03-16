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
from concurrent.futures import ThreadPoolExecutor
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


class DDSGateway:
    """
    DDS Routing Gateway using rclpy (ROS2).
    Creates a ROS2 node visible via `ros2 node list`.
    """

    def __init__(self, backend_url: str, api_key: str, poll_interval: float = 1.0):
        self.backend_url = backend_url.rstrip('/')
        self.api_key = api_key
        self.poll_interval = poll_interval
        self.drone_states: Dict[str, DroneState] = {}
        self.running = False
        self._rclpy_available = False
        self._node = None
        self._subscriptions = {}
        self._lock = threading.Lock()
        self._stats = defaultdict(int)
        self._last_stats_time = time.time()

        # Persistent HTTP session for connection reuse (avoids TCP handshake per request)
        self._http_session = requests.Session()
        self._http_session.headers.update({
            "X-Gateway-Key": api_key,
            "Content-Type": "application/json"
        })

        # Thread pool for async ack forwarding (avoids creating a thread per ack)
        self._ack_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix='ack-fwd')

        # Ack deduplication state
        self._recent_acks: Dict[str, float] = {}
        self._ack_dedup_window = 2.0  # seconds

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
        """Initialize the ROS2 node."""
        if not self._rclpy_available:
            return False
        try:
            import rclpy
            if not rclpy.ok():
                rclpy.init()
                logger.info("[ROS2] rclpy initialized")
            self._node = rclpy.create_node('ucs_dds_gateway')
            logger.info("[ROS2] Node 'ucs_dds_gateway' created (visible via `ros2 node list`)")
            return True
        except Exception as e:
            logger.error("[ROS2] Failed to create node: %s", e)
            return False

    def check_backend_health(self) -> bool:
        """Verify backend is reachable."""
        try:
            resp = self._http_session.get(
                f"{self.backend_url}/api/v1/dds-gateway/health", timeout=5
            )
            if resp.status_code == 200:
                logger.info("[Backend] Health check passed: %s", resp.json())
                return True
            logger.error("[Backend] Health check failed: HTTP %d", resp.status_code)
            return False
        except requests.exceptions.ConnectionError:
            logger.error("[Backend] Cannot connect to %s", self.backend_url)
            return False

    def discover_drones_from_topics(self) -> Set[str]:
        """
        Discover PX4 drones by scanning the ROS2 topic list.
        Extracts prefix (px4_1, px4_2) from topics like /px4_1/fmu/out/vehicle_attitude.
        """
        if not self._rclpy_available or self._node is None:
            return set()

        discovered = set()
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
                            discovered.add(drone_prefix)

            logger.info(
                "[Discovery] Scanned %d topics, %d matched /fmu/out/",
                len(all_topics), len(matched_topics)
            )

            if matched_topics:
                logger.info("[Discovery] Matched topics:")
                for t in sorted(matched_topics):
                    logger.info("  - %s", t)

            if discovered:
                logger.info(
                    "[Discovery] Found %d drone(s): %s",
                    len(discovered), sorted(discovered)
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
        logger.info("[Subscribe] Using PX4-compatible QoS: BEST_EFFORT reliability, VOLATILE durability")

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

        available_topics = dict(self._node.get_topic_names_and_types())

        for base_suffix, (msg_type, callback) in topic_handlers.items():
            variants = TOPIC_SUFFIX_VARIANTS.get(base_suffix, [base_suffix])
            subscribed = False

            for variant in variants:
                topic_name = f"/{uav_id}/fmu/out/{variant}"
                sub_key = f"{uav_id}/{variant}"

                if sub_key in self._subscriptions:
                    subscribed = True
                    break

                if topic_name in available_topics:
                    try:
                        sub = self._node.create_subscription(
                            msg_type, topic_name, callback, px4_qos
                        )
                        self._subscriptions[sub_key] = sub
                        subscriptions_created += 1
                        logger.info(
                            "[Subscribe] OK: %s -> %s (type: %s)",
                            uav_id, topic_name, msg_type.__name__
                        )
                        subscribed = True
                        break
                    except Exception as e:
                        logger.error(
                            "[Subscribe] FAILED: %s -> %s: %s",
                            uav_id, topic_name, e
                        )
                else:
                    logger.debug("[Subscribe] Topic not available: %s", topic_name)

            if not subscribed:
                logger.warning(
                    "[Subscribe] No topic for %s/%s (tried: %s)",
                    uav_id, base_suffix, variants
                )

        logger.info(
            "[Subscribe] Drone %s: %d new, %d total subscriptions",
            uav_id, subscriptions_created, len(self._subscriptions)
        )

    # ============================================================
    # Message Callbacks
    # ============================================================

    def _on_global_position(self, uav_id, msg):
        with self._lock:
            s = self.drone_states.get(uav_id)
            if not s:
                return
            s.lat = msg.lat
            s.lon = msg.lon
            s.alt = msg.alt
            s.last_update = time.time()
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

        Latency optimization:
        - Uses persistent HTTP session (connection reuse, no TCP handshake per ack)
        - Uses ThreadPoolExecutor instead of spawning a thread per ack
        - Dedup window reduced to 2s (from 5s) for faster feedback
        """
        command = getattr(msg, 'command', 0)
        result = getattr(msg, 'result', -1)
        logger.info("[CommandAck] %s: command=%d result=%d", uav_id, command, result)
        self._stats[f'{uav_id}/command_ack'] += 1
        self._stats['total_messages'] += 1

        # Deduplicate acks to prevent rejection loops
        ack_key = f"{uav_id}:{command}:{result}"
        now = time.time()
        last_forwarded = self._recent_acks.get(ack_key, 0)
        if now - last_forwarded < self._ack_dedup_window:
            logger.debug("[CommandAck] Suppressing duplicate ack %s (%.1fs ago)", ack_key, now - last_forwarded)
            return
        self._recent_acks[ack_key] = now

        # Clean up old entries periodically
        if len(self._recent_acks) > 100:
            cutoff = now - 10.0
            self._recent_acks = {k: v for k, v in self._recent_acks.items() if v > cutoff}

        # Forward ack to backend via thread pool (much faster than spawning threads)
        try:
            ack_payload = {
                'uavId': uav_id,
                'command': int(command),
                'result': int(result),
                'timestamp': now,
            }
            self._ack_executor.submit(self._forward_command_ack, ack_payload)
        except Exception as e:
            logger.error("[CommandAck] Failed to forward ack: %s", e)

    def _forward_command_ack(self, ack_payload: dict):
        """Forward a command ack to the backend REST API.

        Uses persistent HTTP session for connection reuse (keep-alive),
        avoiding TCP handshake overhead on each ack.
        Timeout reduced to 3s for faster failure detection.
        """
        try:
            resp = self._http_session.post(
                f"{self.backend_url}/api/v1/dds-gateway/command-ack",
                json=ack_payload,
                timeout=3
            )
            if resp.status_code == 200:
                logger.info("[CommandAck] Forwarded ack to backend: %s", ack_payload)
            else:
                logger.warning("[CommandAck] Backend returned %d: %s", resp.status_code, resp.text[:200])
        except Exception as e:
            logger.error("[CommandAck] Forward failed: %s", e)

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
                })

        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "drones": drones
        }

    def send_to_backend(self, payload: dict) -> bool:
        """Send telemetry batch to the backend REST API.

        Uses persistent HTTP session for connection reuse.
        """
        try:
            resp = self._http_session.post(
                f"{self.backend_url}/api/v1/dds-gateway/telemetry",
                json=payload,
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
                logger.info(
                    "[Stats]   %-10s msgs=%-6d lat=%.6f lon=%.6f alt=%.1f "
                    "hdg=%.1f armed=%-5s mode=%-12s age=%.1fs",
                    uid, s.msg_count, s.lat, s.lon, s.alt,
                    s.heading, s.armed, s.flight_mode, age
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

    def run(self):
        """Main loop: discover drones, process DDS messages, send to backend."""
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
        logger.info("=" * 60)

        if not self._rclpy_available:
            logger.error("[Startup] ROS2 not available. Exiting.")
            return
        if not self._init_ros2_node():
            logger.error("[Startup] Failed to init ROS2 node. Exiting.")
            return

        # Start command HTTP server for receiving commands from backend
        cmd_port = int(os.environ.get('DDS_COMMAND_PORT', '5050'))
        self.start_command_server(port=cmd_port)

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

        while self.running and rclpy.ok():
            try:
                rclpy.spin_once(self._node, timeout_sec=0.1)

                if cycle % 10 == 0:
                    logger.info("[Discovery] Scanning topics (cycle %d)...", cycle)
                    new_drones = self.discover_drones_from_topics()
                    for uid in new_drones:
                        if uid not in self.drone_states:
                            logger.info("[Discovery] NEW drone: %s", uid)
                            self.subscribe_to_drone(uid)
                    if not new_drones and cycle == 0:
                        logger.warning(
                            "[Discovery] No drones found. "
                            "Check PX4 simulator and ROS_DOMAIN_ID."
                        )

                if self.drone_states:
                    now = time.time()
                    active = sum(
                        1 for s in self.drone_states.values()
                        if now - s.last_update < 5
                    )
                    if active > 0:
                        self.send_to_backend(self.build_telemetry_payload())
                    elif cycle % 10 == 0:
                        logger.warning(
                            "[Forward] %d drone(s) tracked but none active",
                            len(self.drone_states)
                        )

                self.log_statistics()
                cycle += 1
                time.sleep(self.poll_interval)

            except KeyboardInterrupt:
                break
            except Exception as e:
                logger.error("[MainLoop] %s", e, exc_info=True)
                time.sleep(1)

        self._cleanup()
        logger.info("[Shutdown] Gateway stopped")

    def _cleanup(self):
        """Clean up ROS2 resources, thread pool, and HTTP session."""
        # Stop all heartbeat threads
        if hasattr(self, '_heartbeat_active'):
            for uav_id in list(self._heartbeat_active.keys()):
                self._heartbeat_active[uav_id] = False

        # Shut down ack forwarding thread pool
        try:
            self._ack_executor.shutdown(wait=False)
            logger.info("[Shutdown] Ack executor shut down")
        except Exception as e:
            logger.debug("[Shutdown] Ack executor: %s", e)

        # Close persistent HTTP session
        try:
            self._http_session.close()
            logger.info("[Shutdown] HTTP session closed")
        except Exception as e:
            logger.debug("[Shutdown] HTTP session: %s", e)

        # Clean up ROS2
        try:
            import rclpy
            if self._node:
                self._node.destroy_node()
            if rclpy.ok():
                rclpy.shutdown()
            logger.info("[Shutdown] ROS2 cleanup complete")
        except Exception as e:
            logger.debug("[Shutdown] ROS2: %s", e)

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
                                 param2: float = 0.0, param7: float = 0.0) -> bool:
        """Publish a VehicleCommand to /{uav_id}/fmu/in/vehicle_command.

        Args:
            uav_id: Target drone ID (e.g., 'px4_1')
            command: PX4 command code (e.g., 400=ARM, 176=DO_SET_MODE, 22=TAKEOFF)
            param1-param7: Command-specific parameters

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
            msg.param7 = param7
            msg.target_system = target_sys
            msg.target_component = 1
            msg.source_system = 255
            msg.source_component = 190  # Match QGC convention
            msg.from_external = True
            msg.timestamp = int(time.time() * 1e6)

            pub.publish(msg)
            logger.info("[Command] Published VehicleCommand cmd=%d p1=%.1f p2=%.1f p7=%.1f -> %s (target_sys=%d)",
                        command, param1, param2, param7, topic, target_sys)
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

    def publish_trajectory_setpoint(self, uav_id: str, x: float, y: float, z: float) -> bool:
        """Publish TrajectorySetpoint for position control (NED frame)."""
        if not self._rclpy_available or not self._px4_msgs_available or not self._node:
            return False
        try:
            import px4_msgs.msg as px4
            topic = f"/{uav_id}/fmu/in/trajectory_setpoint"
            pub = self._get_or_create_publisher(topic, px4.TrajectorySetpoint)

            msg = px4.TrajectorySetpoint()
            msg.position = [x, y, z]
            msg.yaw = float('nan')  # Don't control yaw
            msg.timestamp = int(time.time() * 1e6)

            pub.publish(msg)
            logger.info("[Command] Published TrajectorySetpoint [%.2f, %.2f, %.2f] -> %s",
                        x, y, z, topic)
            return True
        except Exception as e:
            logger.error("[Command] Failed to publish TrajectorySetpoint: %s", e)
            return False

    def handle_command(self, uav_id: str, command_type: str, params: dict) -> dict:
        """Handle a command request from the backend.

        Translates high-level command types to PX4 DDS messages.

        Returns:
            dict with 'success' (bool) and 'message' (str)
        """
        command_type = command_type.upper()
        logger.info("[Command] Handling %s for %s params=%s", command_type, uav_id, params)

        if command_type == 'ARM':
            # ARM: command=400 (COMPONENT_ARM_DISARM), param1=1.0 (arm)
            # param2=0 for normal arm (NOT 21196 which is force-arm and gets rejected)
            ok = self.publish_vehicle_command(uav_id, command=400, param1=1.0, param2=0.0)
        elif command_type == 'DISARM':
            # DISARM: param1=0.0 (disarm), param2=0 for normal disarm
            ok = self.publish_vehicle_command(uav_id, command=400, param1=0.0, param2=0.0)
        elif command_type == 'TAKEOFF':
            alt = params.get('altitude', 5.0)
            ok = self.publish_vehicle_command(uav_id, command=22, param7=float(alt))
        elif command_type == 'LAND':
            ok = self.publish_vehicle_command(uav_id, command=21)
        elif command_type == 'RTL':
            ok = self.publish_vehicle_command(uav_id, command=20)
        elif command_type == 'HOLD':
            ok = self.publish_vehicle_command(uav_id, command=17)
        elif command_type == 'OFFBOARD':
            # Switch to OFFBOARD mode: publish OffboardControlMode first, then mode switch
            self.publish_offboard_control_mode(uav_id, position=True)
            ok = self.publish_vehicle_command(uav_id, command=176, param1=1.0, param2=6.0)
        elif command_type == 'GOTO':
            x = params.get('x', params.get('lat', 0.0))
            y = params.get('y', params.get('lon', 0.0))
            z = params.get('z', -(params.get('alt', 5.0)))  # NED: z is negative altitude
            self.publish_offboard_control_mode(uav_id, position=True)
            ok = self.publish_trajectory_setpoint(uav_id, float(x), float(y), float(z))
        else:
            return {'success': False, 'message': f'Unknown command type: {command_type}'}

        if ok:
            return {'success': True, 'message': f'{command_type} command sent to {uav_id}'}
        else:
            return {'success': False, 'message': f'Failed to publish {command_type} to DDS'}

    # ============================================================
    # Offboard Heartbeat (>2Hz for OFFBOARD mode)
    # ============================================================

    def start_offboard_heartbeat(self, uav_id: str, interval: float = 0.25):
        """Start publishing OffboardControlMode + TrajectorySetpoint at 4Hz for a drone.

        PX4 requires continuous OffboardControlMode messages at >2Hz to stay in
        OFFBOARD mode. We publish at 4Hz (0.25s interval) to provide sufficient
        margin over the 2Hz minimum requirement.

        Previous frequency was 2.5Hz (0.4s interval) which left very little margin
        and could cause mode fallback on timing jitter.

        The heartbeat is ONLY stopped by explicit exit commands (LAND, RTL, DISARM)
        via the command server. It is NOT stopped on transient command rejections,
        because rejections during flight (e.g., sensor not ready) should not cause
        a mode switch that could destabilize the drone.

        Scalability: Each drone gets one lightweight daemon thread that sleeps most
        of the time. For 100+ drones this is acceptable; for 1000+ consider an
        async event loop or a single scheduling thread with a priority queue.
        """
        key = f"heartbeat_{uav_id}"
        if hasattr(self, '_heartbeat_threads') and key in self._heartbeat_threads:
            # Check if the existing thread is still alive
            if self._heartbeat_threads[key].is_alive():
                logger.info("[Heartbeat] Already running for %s", uav_id)
                return
            else:
                # Thread died, clean up and restart
                del self._heartbeat_threads[key]

        if not hasattr(self, '_heartbeat_threads'):
            self._heartbeat_threads = {}
            self._heartbeat_active = {}

        self._heartbeat_active[uav_id] = True

        def _heartbeat_loop():
            logger.info("[Heartbeat] Started for %s at %.1f Hz (interval=%.3fs)",
                        uav_id, 1.0 / interval, interval)
            while self._heartbeat_active.get(uav_id, False) and self.running:
                try:
                    self.publish_offboard_control_mode(uav_id, position=True)
                    self.publish_trajectory_setpoint(uav_id)
                except Exception as e:
                    logger.error("[Heartbeat] Publish error for %s: %s", uav_id, e)
                time.sleep(interval)
            logger.info("[Heartbeat] Stopped for %s", uav_id)

        t = threading.Thread(target=_heartbeat_loop, daemon=True, name=f"heartbeat-{uav_id}")
        t.start()
        self._heartbeat_threads[key] = t

    def stop_offboard_heartbeat(self, uav_id: str):
        """Stop the offboard heartbeat for a drone.

        Called only by explicit exit commands (LAND, RTL, DISARM) from the
        command server, never by transient command rejections.
        """
        if hasattr(self, '_heartbeat_active'):
            if self._heartbeat_active.get(uav_id, False):
                logger.info("[Heartbeat] Stopping heartbeat for %s (explicit command)", uav_id)
            self._heartbeat_active[uav_id] = False

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

                        # Start/stop heartbeat for OFFBOARD mode
                        if command_type.upper() == 'OFFBOARD' and result['success']:
                            gateway.start_offboard_heartbeat(uav_id)
                        elif command_type.upper() in ('LAND', 'RTL', 'DISARM'):
                            gateway.stop_offboard_heartbeat(uav_id)

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
                    self.wfile.write(json.dumps({
                        'status': 'ok',
                        'drones': list(gateway.drone_states.keys()),
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
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    gateway = DDSGateway(
        backend_url=args.backend_url,
        api_key=args.api_key,
        poll_interval=args.interval
    )

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
                gateway.subscribe_to_drone(d)

    gateway.run()


if __name__ == '__main__':
    main()
