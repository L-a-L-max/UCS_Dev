#!/usr/bin/env python3
"""
DDS Gateway - PX4 Telemetry Subscriber & Forwarder

Subscribes to PX4 DDS topics (vehicle_global_position, vehicle_attitude, etc.)
and forwards telemetry data to the UCS backend via REST API.

The backend handles:
- Partition routing (drone → user partition mapping)
- WebSocket broadcasting (partition-specific topics)
- Data persistence (telemetry history for path replay)

Requirements:
    pip install cyclonedds requests

Usage:
    python dds_gateway.py [--backend-url URL] [--api-key KEY] [--interval SECONDS]

Environment Variables:
    UCS_BACKEND_URL     Backend URL (default: http://localhost:8080)
    DDS_GATEWAY_API_KEY API key for authentication (default: ucs-dds-gateway-secret-2024)
    DDS_POLL_INTERVAL   Poll interval in seconds (default: 1.0)
"""

import argparse
import json
import logging
import math
import os
import signal
import sys
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set

import requests

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger('dds-gateway')

# ============================================================
# DDS Topic Discovery & Subscription
# ============================================================

# PX4 output topics we're interested in (telemetry data)
TELEMETRY_TOPICS = {
    'vehicle_global_position',   # GPS position (lat, lon, alt)
    'vehicle_local_position_v1', # Local NED position
    'vehicle_attitude',          # Attitude (quaternion → heading)
    'vehicle_status_v1',         # Flight status (armed, mode)
    'battery_status_v1',         # Battery info
}


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


class DDSGateway:
    """
    DDS Gateway that subscribes to PX4 topics and forwards to UCS backend.
    
    Architecture:
    1. Discovers PX4 drone instances on the DDS network by topic prefix
    2. Subscribes to telemetry topics for each discovered drone
    3. Aggregates data into per-drone state
    4. Periodically sends batch telemetry to backend REST API
    """

    def __init__(self, backend_url: str, api_key: str, poll_interval: float = 1.0):
        self.backend_url = backend_url.rstrip('/')
        self.api_key = api_key
        self.poll_interval = poll_interval
        self.drone_states: Dict[str, DroneState] = {}
        self.running = False
        self._dds_available = False
        self._participants = {}
        self._readers = {}

        # Try to import cyclonedds
        try:
            from cyclonedds.core import DomainParticipant, Qos
            from cyclonedds.topic import Topic
            from cyclonedds.sub import DataReader
            from cyclonedds.builtin import DcpsParticipant
            self._dds_available = True
            logger.info("CycloneDDS library available - real DDS mode")
        except ImportError:
            self._dds_available = False
            logger.warning(
                "CycloneDDS library not available. "
                "Install with: pip install cyclonedds\n"
                "Running in discovery-only mode (no actual DDS subscription)."
            )

    def check_backend_health(self) -> bool:
        """Verify backend is reachable."""
        try:
            resp = requests.get(
                f"{self.backend_url}/api/v1/dds-gateway/health",
                timeout=5
            )
            if resp.status_code == 200:
                logger.info("Backend health check passed: %s", resp.json())
                return True
            logger.error("Backend health check failed: %d", resp.status_code)
            return False
        except requests.exceptions.ConnectionError:
            logger.error("Cannot connect to backend at %s", self.backend_url)
            return False

    def discover_drones_from_topics(self) -> Set[str]:
        """
        Discover PX4 drone instances by scanning DDS topics.
        
        PX4 publishes topics like:
            /px4_1/fmu/out/vehicle_global_position
            /px4_2/fmu/out/vehicle_attitude
        
        We extract the prefix (px4_1, px4_2) as the drone identifier.
        """
        if not self._dds_available:
            logger.debug("DDS not available, skipping topic discovery")
            return set()

        discovered = set()
        try:
            from cyclonedds.core import DomainParticipant
            from cyclonedds.builtin import DcpsTopic

            dp = DomainParticipant()
            # Read discovered topics from DDS builtin topics
            # This requires cyclonedds to be on the same DDS domain
            reader = dp.create_reader(DcpsTopic)
            
            for sample in reader.take(timeout=2.0):
                topic_name = sample.name if hasattr(sample, 'name') else str(sample)
                # Match pattern: /{prefix}/fmu/out/{topic_suffix}
                if '/fmu/out/' in topic_name:
                    parts = topic_name.strip('/').split('/')
                    if len(parts) >= 4:
                        drone_prefix = parts[0]  # e.g., "px4_1"
                        topic_suffix = parts[3]   # e.g., "vehicle_global_position"
                        if topic_suffix in TELEMETRY_TOPICS:
                            discovered.add(drone_prefix)
                            
        except Exception as e:
            logger.debug("Topic discovery failed (may be normal if no DDS network): %s", e)

        return discovered

    def subscribe_to_drone(self, uav_id: str):
        """
        Subscribe to all telemetry topics for a specific drone.
        
        Topics subscribed:
        - /{uav_id}/fmu/out/vehicle_global_position
        - /{uav_id}/fmu/out/vehicle_attitude
        - /{uav_id}/fmu/out/vehicle_local_position_v1
        - /{uav_id}/fmu/out/vehicle_status_v1
        - /{uav_id}/fmu/out/battery_status_v1
        """
        if uav_id not in self.drone_states:
            self.drone_states[uav_id] = DroneState(uav_id=uav_id)
            logger.info("Subscribing to drone: %s", uav_id)

        if not self._dds_available:
            return

        try:
            from cyclonedds.core import DomainParticipant, Qos
            from cyclonedds.topic import Topic
            from cyclonedds.sub import DataReader
            from cyclonedds.idl import IdlStruct

            # Create participant if not exists
            if uav_id not in self._participants:
                dp = DomainParticipant()
                self._participants[uav_id] = dp

            dp = self._participants[uav_id]

            for topic_suffix in TELEMETRY_TOPICS:
                topic_name = f"/{uav_id}/fmu/out/{topic_suffix}"
                # Note: Actual IDL types would be needed for proper deserialization
                # This is a framework that needs PX4 IDL type definitions
                logger.info("Would subscribe to: %s", topic_name)

        except Exception as e:
            logger.error("Failed to subscribe to drone %s: %s", uav_id, e)

    def poll_dds_data(self):
        """
        Poll DDS readers for new data and update drone states.
        
        This method reads from all active DDS subscriptions and
        updates the aggregated DroneState for each drone.
        """
        if not self._dds_available:
            return

        for uav_id, readers in self._readers.items():
            state = self.drone_states.get(uav_id)
            if state is None:
                continue

            for topic_suffix, reader in readers.items():
                try:
                    for sample in reader.take():
                        self._update_state_from_sample(state, topic_suffix, sample)
                        state.last_update = time.time()
                except Exception as e:
                    logger.debug("Error reading %s/%s: %s", uav_id, topic_suffix, e)

    def _update_state_from_sample(self, state: DroneState, topic_suffix: str, sample):
        """Update drone state from a DDS sample based on topic type."""
        if topic_suffix == 'vehicle_global_position':
            state.lat = getattr(sample, 'lat', state.lat)
            state.lon = getattr(sample, 'lon', state.lon)
            state.alt = getattr(sample, 'alt', state.alt)
        elif topic_suffix == 'vehicle_local_position_v1':
            state.ned_x = getattr(sample, 'x', state.ned_x)
            state.ned_y = getattr(sample, 'y', state.ned_y)
            state.ned_z = getattr(sample, 'z', state.ned_z)
            state.vx = getattr(sample, 'vx', state.vx)
            state.vy = getattr(sample, 'vy', state.vy)
            state.vz = getattr(sample, 'vz', state.vz)
            # Compute ground speed from velocity components
            state.ground_speed = math.sqrt(state.vx ** 2 + state.vy ** 2)
            state.vertical_speed = -state.vz  # NED: positive Z is down
        elif topic_suffix == 'vehicle_attitude':
            # Extract heading from quaternion
            q = [
                getattr(sample, 'q', [1, 0, 0, 0])[i]
                for i in range(4)
            ]
            # Quaternion to yaw (heading)
            siny_cosp = 2 * (q[0] * q[3] + q[1] * q[2])
            cosy_cosp = 1 - 2 * (q[2] ** 2 + q[3] ** 2)
            yaw_rad = math.atan2(siny_cosp, cosy_cosp)
            state.heading = math.degrees(yaw_rad) % 360
        elif topic_suffix == 'vehicle_status_v1':
            state.armed = getattr(sample, 'arming_state', 0) == 2  # ARMED=2
            nav_state = getattr(sample, 'nav_state', 0)
            state.flight_mode = self._nav_state_to_mode(nav_state)
        elif topic_suffix == 'battery_status_v1':
            state.battery_percent = getattr(sample, 'remaining', -1.0) * 100

    @staticmethod
    def _nav_state_to_mode(nav_state: int) -> str:
        """Convert PX4 nav_state enum to human-readable mode string."""
        modes = {
            0: "MANUAL",
            1: "ALTCTL",
            2: "POSCTL",
            3: "AUTO_MISSION",
            4: "AUTO_LOITER",
            5: "AUTO_RTL",
            14: "OFFBOARD",
            17: "AUTO_TAKEOFF",
            18: "AUTO_LAND",
        }
        return modes.get(nav_state, f"MODE_{nav_state}")

    def build_telemetry_payload(self) -> dict:
        """Build the telemetry batch payload for the backend API."""
        from datetime import datetime, timezone
        
        drones = []
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
                logger.debug("Sent %d drones, partitions: %s",
                             result.get('processed', 0),
                             result.get('partitions', []))
                return True
            else:
                logger.error("Backend returned %d: %s", resp.status_code, resp.text)
                return False
        except requests.exceptions.ConnectionError:
            logger.error("Lost connection to backend at %s", self.backend_url)
            return False
        except Exception as e:
            logger.error("Failed to send telemetry: %s", e)
            return False

    def run(self):
        """Main loop: discover drones, poll DDS, send to backend."""
        self.running = True
        logger.info("=" * 60)
        logger.info("DDS Gateway starting")
        logger.info("Backend URL: %s", self.backend_url)
        logger.info("Poll interval: %.1fs", self.poll_interval)
        logger.info("DDS available: %s", self._dds_available)
        logger.info("=" * 60)

        # Check backend health
        if not self.check_backend_health():
            logger.error("Backend not reachable. Please start the backend first.")
            logger.info("Retrying in 5 seconds...")
            time.sleep(5)
            if not self.check_backend_health():
                logger.error("Backend still not reachable. Exiting.")
                return

        cycle = 0
        while self.running:
            try:
                # Periodically re-discover drones (every 10 cycles)
                if cycle % 10 == 0:
                    new_drones = self.discover_drones_from_topics()
                    for uav_id in new_drones:
                        if uav_id not in self.drone_states:
                            self.subscribe_to_drone(uav_id)
                            logger.info("Discovered new drone: %s", uav_id)

                # Poll DDS data
                self.poll_dds_data()

                # Only send if we have drone data
                if self.drone_states:
                    payload = self.build_telemetry_payload()
                    self.send_to_backend(payload)

                cycle += 1
                time.sleep(self.poll_interval)

            except KeyboardInterrupt:
                break
            except Exception as e:
                logger.error("Error in main loop: %s", e)
                time.sleep(1)

        logger.info("DDS Gateway stopped")

    def stop(self):
        """Stop the gateway gracefully."""
        self.running = False


def main():
    parser = argparse.ArgumentParser(description='DDS Gateway for UCS')
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
        help='Manually specify drone IDs to subscribe to (e.g., px4_1 px4_2)'
    )
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Enable verbose logging'
    )
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    gateway = DDSGateway(
        backend_url=args.backend_url,
        api_key=args.api_key,
        poll_interval=args.interval
    )

    # Register signal handlers for graceful shutdown
    def signal_handler(sig, frame):
        logger.info("Received signal %s, shutting down...", sig)
        gateway.stop()

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Manually subscribe to specified drones
    if args.drones:
        for drone_id in args.drones:
            gateway.subscribe_to_drone(drone_id)
        logger.info("Manually subscribed to drones: %s", args.drones)

    gateway.run()


if __name__ == '__main__':
    main()
