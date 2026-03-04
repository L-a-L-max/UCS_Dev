#!/usr/bin/env python3
"""
Zenoh Persistence Gateway

Subscribes to UAV telemetry data from Zenoh network (PX4 DDS topics),
parses structured UAV business data, and batch POSTs to backend API.

This is a NEW component in the Zenoh network - completely separate from
the existing DDS/simulation gateway.

Zenoh key subscriptions:
  - */fmu/out/vehicle_global_position  (GPS: lat, lon, alt)
  - */fmu/out/vehicle_local_position   (NED: x, y, z, vx, vy, vz)
  - */fmu/out/battery_status           (battery percentage, voltage)
  - */fmu/out/vehicle_status           (armed state, flight mode)

Data flow:
  Zenoh → Parse PX4 DDS JSON → Structured DTO → Batch POST → Backend DB

Usage:
  python persistence_gateway.py --zenoh-endpoint tcp/localhost:7447 --backend-url http://localhost:8080
"""

import argparse
import json
import logging
import time
import threading
import requests
from datetime import datetime, timezone
from collections import defaultdict

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger("PersistenceGateway")

# Try to import zenoh - fall back to stub mode if not available
try:
    import zenoh
    ZENOH_AVAILABLE = True
    logger.info("Zenoh SDK available - running in LIVE mode")
except ImportError:
    ZENOH_AVAILABLE = False
    logger.warning("Zenoh SDK not available - running in STUB mode")


class UavDataAggregator:
    """
    Aggregates UAV data from multiple PX4 topics into a single telemetry record.
    Each UAV's data is collected from different topics and merged before sending.
    """
    
    def __init__(self):
        self.lock = threading.Lock()
        # uav_id -> {field: value}
        self.uav_data = defaultdict(lambda: {
            "uavId": None,
            "timestamp": None,
            "lat": 0.0, "lon": 0.0, "alt": 0.0,
            "heading": 0.0, "groundSpeed": 0.0, "verticalSpeed": 0.0,
            "nedX": 0.0, "nedY": 0.0, "nedZ": 0.0,
            "vx": 0.0, "vy": 0.0, "vz": 0.0,
            "dataAge": 0.0, "msgCount": 0, "isActive": True,
            "battery": 100.0, "armed": False, "flightMode": "UNKNOWN"
        })
        self.msg_counts = defaultdict(int)
    
    def update_global_position(self, uav_id, data):
        """Update from vehicle_global_position topic."""
        with self.lock:
            d = self.uav_data[uav_id]
            d["uavId"] = uav_id
            d["lat"] = data.get("lat", 0.0)
            d["lon"] = data.get("lon", 0.0)
            d["alt"] = data.get("alt", 0.0)
            if "heading" in data:
                d["heading"] = data["heading"]
            d["timestamp"] = datetime.now(timezone.utc).isoformat()
            self.msg_counts[uav_id] += 1
            d["msgCount"] = self.msg_counts[uav_id]
    
    def update_local_position(self, uav_id, data):
        """Update from vehicle_local_position topic."""
        with self.lock:
            d = self.uav_data[uav_id]
            d["uavId"] = uav_id
            d["nedX"] = data.get("x", 0.0)
            d["nedY"] = data.get("y", 0.0)
            d["nedZ"] = data.get("z", 0.0)
            d["vx"] = data.get("vx", 0.0)
            d["vy"] = data.get("vy", 0.0)
            d["vz"] = data.get("vz", 0.0)
            # Calculate ground speed from vx, vy
            d["groundSpeed"] = (data.get("vx", 0.0)**2 + data.get("vy", 0.0)**2) ** 0.5
            d["verticalSpeed"] = -data.get("vz", 0.0)  # NED: z is down
    
    def update_battery_status(self, uav_id, data):
        """Update from battery_status topic."""
        with self.lock:
            d = self.uav_data[uav_id]
            d["uavId"] = uav_id
            if "remaining" in data:
                d["battery"] = data["remaining"] * 100.0  # 0-1 → 0-100
    
    def update_vehicle_status(self, uav_id, data):
        """Update from vehicle_status topic."""
        with self.lock:
            d = self.uav_data[uav_id]
            d["uavId"] = uav_id
            d["armed"] = data.get("arming_state", 0) == 2  # 2 = ARMED
            d["isActive"] = d["armed"]
            nav_state = data.get("nav_state", 0)
            d["flightMode"] = self._nav_state_to_mode(nav_state)
    
    @staticmethod
    def _nav_state_to_mode(nav_state):
        """Map PX4 nav_state to human-readable flight mode."""
        modes = {
            0: "MANUAL", 1: "ALTCTL", 2: "POSCTL",
            3: "AUTO_MISSION", 4: "AUTO_LOITER", 5: "AUTO_RTL",
            14: "OFFBOARD", 17: "AUTO_TAKEOFF", 18: "AUTO_LAND"
        }
        return modes.get(nav_state, f"UNKNOWN_{nav_state}")
    
    def get_batch_and_clear(self):
        """Get current aggregated data and reset counters."""
        with self.lock:
            uavs = []
            for uav_id, data in self.uav_data.items():
                if data["uavId"] is not None:
                    # Convert to telemetry DTO format (Integer uavId for backend)
                    uav_num = int(uav_id.replace("UAV_", "")) if uav_id.startswith("UAV_") else 0
                    uavs.append({
                        "uavId": uav_num,
                        "timestamp": data["timestamp"],
                        "lat": data["lat"],
                        "lon": data["lon"],
                        "alt": data["alt"],
                        "heading": data["heading"],
                        "groundSpeed": data["groundSpeed"],
                        "verticalSpeed": data["verticalSpeed"],
                        "nedX": data["nedX"],
                        "nedY": data["nedY"],
                        "nedZ": data["nedZ"],
                        "vx": data["vx"],
                        "vy": data["vy"],
                        "vz": data["vz"],
                        "dataAge": 0.0,
                        "msgCount": data["msgCount"],
                        "isActive": data["isActive"]
                    })
            return uavs


class PersistenceGateway:
    """
    Main gateway service that subscribes to Zenoh and pushes to backend.
    """
    
    def __init__(self, zenoh_endpoint, backend_url, batch_interval=1.0):
        self.zenoh_endpoint = zenoh_endpoint
        self.backend_url = backend_url.rstrip("/")
        self.batch_interval = batch_interval
        self.aggregator = UavDataAggregator()
        self.running = False
        self.session = None
        self.msg_seq = 0
    
    def start(self):
        """Start the gateway service."""
        self.running = True
        
        if ZENOH_AVAILABLE:
            self._start_zenoh()
        else:
            logger.info("Running in STUB mode - no Zenoh subscriptions")
        
        # Start batch sender thread
        sender_thread = threading.Thread(target=self._batch_sender_loop, daemon=True)
        sender_thread.start()
        
        logger.info(f"Persistence Gateway started. Backend: {self.backend_url}")
        
        try:
            while self.running:
                time.sleep(1)
        except KeyboardInterrupt:
            logger.info("Shutting down...")
            self.running = False
    
    def _start_zenoh(self):
        """Initialize Zenoh session and subscriptions."""
        config = zenoh.Config()
        config.insert_json5("connect/endpoints", json.dumps([self.zenoh_endpoint]))
        
        self.session = zenoh.open(config)
        logger.info(f"Zenoh session opened, connected to {self.zenoh_endpoint}")
        
        # Subscribe to PX4 DDS topics for all UAVs
        # Key pattern: */fmu/out/vehicle_global_position
        topics = [
            "*/fmu/out/vehicle_global_position",
            "*/fmu/out/vehicle_local_position",
            "*/fmu/out/battery_status",
            "*/fmu/out/vehicle_status"
        ]
        
        for topic in topics:
            self.session.declare_subscriber(topic, self._on_zenoh_message)
            logger.info(f"Subscribed to: {topic}")
    
    def _on_zenoh_message(self, sample):
        """Handle incoming Zenoh message."""
        try:
            key = str(sample.key_expr)
            payload = sample.payload.to_string()
            data = json.loads(payload)
            
            # Extract uav_id from key: {uav_id}/fmu/out/{topic_name}
            parts = key.split("/")
            if len(parts) >= 4:
                uav_id = parts[0]
                topic_name = parts[-1]
                
                if topic_name == "vehicle_global_position":
                    self.aggregator.update_global_position(uav_id, data)
                elif topic_name == "vehicle_local_position":
                    self.aggregator.update_local_position(uav_id, data)
                elif topic_name == "battery_status":
                    self.aggregator.update_battery_status(uav_id, data)
                elif topic_name == "vehicle_status":
                    self.aggregator.update_vehicle_status(uav_id, data)
        except Exception as e:
            logger.error(f"Error processing Zenoh message: {e}")
    
    def _batch_sender_loop(self):
        """Periodically send batched telemetry to backend."""
        while self.running:
            time.sleep(self.batch_interval)
            
            uavs = self.aggregator.get_batch_and_clear()
            if not uavs:
                continue
            
            self.msg_seq += 1
            batch = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "msgSeqNumber": self.msg_seq,
                "homeLat": 39.9042,
                "homeLon": 116.4074,
                "homeAlt": 0.0,
                "numUavsTotal": len(uavs),
                "numUavsActive": sum(1 for u in uavs if u["isActive"]),
                "uavs": uavs
            }
            
            try:
                url = f"{self.backend_url}/api/v1/telemetry/batch"
                response = requests.post(url, json=batch, timeout=5)
                if response.status_code == 200:
                    logger.debug(f"Batch sent: {len(uavs)} UAVs, seq={self.msg_seq}")
                else:
                    logger.warning(f"Backend returned {response.status_code}: {response.text}")
            except requests.exceptions.RequestException as e:
                logger.error(f"Failed to send batch to backend: {e}")


def main():
    parser = argparse.ArgumentParser(description="Zenoh Persistence Gateway")
    parser.add_argument("--zenoh-endpoint", default="tcp/localhost:7447",
                        help="Zenoh router endpoint (default: tcp/localhost:7447)")
    parser.add_argument("--backend-url", default="http://localhost:8080",
                        help="Backend API URL (default: http://localhost:8080)")
    parser.add_argument("--batch-interval", type=float, default=1.0,
                        help="Batch send interval in seconds (default: 1.0)")
    args = parser.parse_args()
    
    gateway = PersistenceGateway(
        zenoh_endpoint=args.zenoh_endpoint,
        backend_url=args.backend_url,
        batch_interval=args.batch_interval
    )
    gateway.start()


if __name__ == "__main__":
    main()
