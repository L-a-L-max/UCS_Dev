#!/usr/bin/env python3
"""
PX4 Simulation Script for Zenoh Network

Simulates N PX4 drones sending telemetry data to Zenoh network.
Each drone publishes PX4 standard DDS topics with its unique uavId.

Published topics per drone:
  {uavId}/fmu/out/vehicle_global_position  - GPS position (lat, lon, alt)
  {uavId}/fmu/out/vehicle_local_position   - NED position (x, y, z, vx, vy, vz)
  {uavId}/fmu/out/battery_status           - Battery (remaining, voltage, current)
  {uavId}/fmu/out/vehicle_status           - Flight status (arming_state, nav_state)

The uavId matches the test data in DataInitService:
  UAV_001 through UAV_008 (8 PX4-SITL simulated drones)

Usage:
  python px4_sim_zenoh.py --num-drones 8 --zenoh-endpoint tcp/localhost:7447
  python px4_sim_zenoh.py --mode standalone  # No Zenoh, prints to console
"""

import argparse
import json
import logging
import math
import random
import time
import threading
from datetime import datetime, timezone

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger("PX4Sim")

try:
    import zenoh
    ZENOH_AVAILABLE = True
except ImportError:
    ZENOH_AVAILABLE = False
    logger.warning("Zenoh SDK not available - running in STANDALONE mode (console output)")


class SimulatedDrone:
    """
    Simulates a single PX4 drone with realistic flight dynamics.
    
    States: IDLE -> ARMED -> TAKEOFF -> FLYING -> LANDING -> IDLE
    """
    
    # PX4 arming states
    ARMING_STATE_INIT = 0
    ARMING_STATE_STANDBY = 1
    ARMING_STATE_ARMED = 2
    
    # PX4 navigation states
    NAV_STATE_MANUAL = 0
    NAV_STATE_POSCTL = 2
    NAV_STATE_AUTO_MISSION = 3
    NAV_STATE_AUTO_LOITER = 4
    NAV_STATE_AUTO_RTL = 5
    NAV_STATE_OFFBOARD = 14
    NAV_STATE_AUTO_TAKEOFF = 17
    NAV_STATE_AUTO_LAND = 18
    
    def __init__(self, uav_id, mavlink_sys_id, home_lat, home_lon, home_alt=0.0):
        self.uav_id = uav_id
        self.mavlink_sys_id = mavlink_sys_id
        
        # Home position
        self.home_lat = home_lat
        self.home_lon = home_lon
        self.home_alt = home_alt
        
        # Current position (GPS)
        self.lat = home_lat
        self.lon = home_lon
        self.alt = home_alt
        
        # Local NED position (relative to home)
        self.ned_x = 0.0  # North
        self.ned_y = 0.0  # East
        self.ned_z = 0.0  # Down (negative = up)
        
        # Velocity
        self.vx = 0.0
        self.vy = 0.0
        self.vz = 0.0
        
        # Heading (degrees, 0=North, clockwise)
        self.heading = random.uniform(0, 360)
        
        # Battery
        self.battery_remaining = 1.0  # 0-1
        self.battery_voltage = 16.8  # 4S LiPo full
        self.battery_current = 0.0
        
        # State
        self.arming_state = self.ARMING_STATE_STANDBY
        self.nav_state = self.NAV_STATE_MANUAL
        self.flight_phase = "IDLE"  # IDLE, ARMED, TAKEOFF, FLYING, LANDING
        
        # Flight parameters
        self.target_alt = 50.0
        self.cruise_speed = 5.0  # m/s
        self.flight_time = 0.0
        
        # Timestamp counter (microseconds, PX4 convention)
        self.timestamp_us = int(time.time() * 1e6)
    
    def update(self, dt):
        """Update drone state by dt seconds."""
        self.timestamp_us += int(dt * 1e6)
        self.flight_time += dt
        
        if self.flight_phase == "IDLE":
            self._update_idle(dt)
        elif self.flight_phase == "ARMED":
            self._update_armed(dt)
        elif self.flight_phase == "TAKEOFF":
            self._update_takeoff(dt)
        elif self.flight_phase == "FLYING":
            self._update_flying(dt)
        elif self.flight_phase == "LANDING":
            self._update_landing(dt)
        
        # Update battery
        if self.arming_state == self.ARMING_STATE_ARMED:
            self.battery_remaining -= 0.0001 * dt  # ~6min for 100%
            self.battery_remaining = max(0.0, self.battery_remaining)
            self.battery_voltage = 13.2 + 3.6 * self.battery_remaining  # 13.2V empty to 16.8V full
            self.battery_current = 5.0 + abs(self.vx + self.vy) * 2.0
        else:
            self.battery_current = 0.1
        
        # Update GPS from NED
        self.lat = self.home_lat + (self.ned_x / 111319.0)  # meters to degrees
        self.lon = self.home_lon + (self.ned_y / (111319.0 * math.cos(math.radians(self.home_lat))))
        self.alt = self.home_alt - self.ned_z  # NED: z down
    
    def _update_idle(self, dt):
        """Idle on ground. Auto-arm after random delay."""
        self.vx = self.vy = self.vz = 0.0
        if self.flight_time > random.uniform(3, 10):
            self.arming_state = self.ARMING_STATE_ARMED
            self.flight_phase = "ARMED"
            self.flight_time = 0
            logger.info(f"{self.uav_id}: ARMED")
    
    def _update_armed(self, dt):
        """Armed on ground, preparing for takeoff."""
        if self.flight_time > 2.0:
            self.nav_state = self.NAV_STATE_AUTO_TAKEOFF
            self.flight_phase = "TAKEOFF"
            self.flight_time = 0
            logger.info(f"{self.uav_id}: TAKEOFF to {self.target_alt}m")
    
    def _update_takeoff(self, dt):
        """Climbing to target altitude."""
        climb_rate = 2.0  # m/s
        self.vz = -climb_rate  # NED: negative = up
        self.ned_z -= climb_rate * dt
        
        if -self.ned_z >= self.target_alt:
            self.ned_z = -self.target_alt
            self.vz = 0.0
            self.nav_state = self.NAV_STATE_AUTO_LOITER
            self.flight_phase = "FLYING"
            self.flight_time = 0
            logger.info(f"{self.uav_id}: FLYING at {self.target_alt}m")
    
    def _update_flying(self, dt):
        """Fly in a circular pattern."""
        # Circular flight pattern
        radius = 100.0  # meters
        angular_speed = self.cruise_speed / radius  # rad/s
        angle = self.flight_time * angular_speed
        
        # Target position on circle
        target_x = radius * math.cos(angle)
        target_y = radius * math.sin(angle)
        
        # Move towards target
        dx = target_x - self.ned_x
        dy = target_y - self.ned_y
        dist = math.sqrt(dx * dx + dy * dy)
        
        if dist > 0.1:
            speed = min(self.cruise_speed, dist)
            self.vx = (dx / dist) * speed
            self.vy = (dy / dist) * speed
        else:
            self.vx = self.vy = 0.0
        
        self.ned_x += self.vx * dt
        self.ned_y += self.vy * dt
        
        # Update heading
        if abs(self.vx) > 0.1 or abs(self.vy) > 0.1:
            self.heading = math.degrees(math.atan2(self.vy, self.vx))
            if self.heading < 0:
                self.heading += 360
        
        # Add small altitude variation
        self.ned_z = -self.target_alt + math.sin(self.flight_time * 0.5) * 0.5
        self.vz = -math.cos(self.flight_time * 0.5) * 0.25
        
        # Add noise
        self.vx += random.gauss(0, 0.1)
        self.vy += random.gauss(0, 0.1)
        
        # Land after ~5 minutes of flying
        if self.flight_time > 300:
            self.nav_state = self.NAV_STATE_AUTO_LAND
            self.flight_phase = "LANDING"
            self.flight_time = 0
            logger.info(f"{self.uav_id}: LANDING")
    
    def _update_landing(self, dt):
        """Descending to ground."""
        descent_rate = 1.5  # m/s
        self.vx *= 0.95  # Slow horizontal
        self.vy *= 0.95
        self.vz = descent_rate  # NED: positive = down
        self.ned_z += descent_rate * dt
        
        if self.ned_z >= 0:
            self.ned_z = 0.0
            self.vx = self.vy = self.vz = 0.0
            self.arming_state = self.ARMING_STATE_STANDBY
            self.nav_state = self.NAV_STATE_MANUAL
            self.flight_phase = "IDLE"
            self.flight_time = 0
            # Reset battery for next cycle
            self.battery_remaining = min(1.0, self.battery_remaining + 0.3)
            logger.info(f"{self.uav_id}: LANDED, battery={self.battery_remaining:.0%}")
    
    def get_vehicle_global_position(self):
        """Generate PX4 vehicle_global_position message."""
        return {
            "timestamp": self.timestamp_us,
            "lat": self.lat,
            "lon": self.lon,
            "alt": self.alt,
            "alt_ellipsoid": self.alt,
            "delta_alt": self.alt - self.home_alt,
            "lat_lon_reset_counter": 0,
            "alt_reset_counter": 0,
            "eph": 0.5,
            "epv": 0.8,
            "terrain_alt": self.home_alt,
            "terrain_alt_valid": True,
            "dead_reckoning": False,
            "heading": math.radians(self.heading),
            "uav_id": self.uav_id
        }
    
    def get_vehicle_local_position(self):
        """Generate PX4 vehicle_local_position message."""
        return {
            "timestamp": self.timestamp_us,
            "xy_valid": True,
            "z_valid": True,
            "v_xy_valid": True,
            "v_z_valid": True,
            "x": self.ned_x,
            "y": self.ned_y,
            "z": self.ned_z,
            "vx": self.vx,
            "vy": self.vy,
            "vz": self.vz,
            "z_deriv": self.vz,
            "ax": 0.0, "ay": 0.0, "az": -9.81,
            "heading": math.radians(self.heading),
            "heading_good_for_control": True,
            "xy_global": True,
            "z_global": True,
            "ref_lat": self.home_lat,
            "ref_lon": self.home_lon,
            "ref_alt": self.home_alt,
            "ref_timestamp": self.timestamp_us,
            "uav_id": self.uav_id
        }
    
    def get_battery_status(self):
        """Generate PX4 battery_status message."""
        return {
            "timestamp": self.timestamp_us,
            "connected": True,
            "voltage_v": self.battery_voltage,
            "voltage_filtered_v": self.battery_voltage,
            "current_a": self.battery_current,
            "current_filtered_a": self.battery_current,
            "discharged_mah": (1.0 - self.battery_remaining) * 5000,
            "remaining": self.battery_remaining,
            "scale": 1.0,
            "temperature": 25.0 + self.battery_current * 0.5,
            "cell_count": 4,
            "source": 0,
            "priority": 0,
            "capacity": 5000,
            "cycle_count": 50,
            "average_time_to_empty": int(self.battery_remaining * 600),
            "serial_number": self.mavlink_sys_id,
            "id": 0,
            "warning": 0 if self.battery_remaining > 0.2 else (1 if self.battery_remaining > 0.1 else 2),
            "uav_id": self.uav_id
        }
    
    def get_vehicle_status(self):
        """Generate PX4 vehicle_status message."""
        return {
            "timestamp": self.timestamp_us,
            "armed_time": int(self.flight_time * 1e6) if self.arming_state == self.ARMING_STATE_ARMED else 0,
            "takeoff_time": self.timestamp_us if self.flight_phase in ("FLYING", "LANDING") else 0,
            "arming_state": self.arming_state,
            "latest_arming_reason": 0,
            "latest_disarming_reason": 0,
            "nav_state_timestamp": self.timestamp_us,
            "nav_state_user_intention": self.nav_state,
            "nav_state": self.nav_state,
            "failure_detector_status": 0,
            "hil_state": 0,
            "vehicle_type": 2,  # 2 = FIXED_WING, 22 = MULTIROTOR (VTOL)
            "failsafe": False,
            "failsafe_and_user_took_over": False,
            "gcs_connection_lost": False,
            "gcs_connection_lost_counter": 0,
            "high_latency_data_link_lost": False,
            "is_vtol": False,
            "is_vtol_tailsitter": False,
            "in_transition_mode": False,
            "in_transition_to_fw": False,
            "system_type": 2,
            "system_id": self.mavlink_sys_id,
            "component_id": 1,
            "safety_button_available": False,
            "safety_off": True,
            "power_input_valid": True,
            "usb_connected": False,
            "open_drone_id_system_present": False,
            "open_drone_id_system_healthy": False,
            "parachute_system_present": False,
            "parachute_system_healthy": False,
            "avoidance_system_required": False,
            "avoidance_system_valid": False,
            "rc_calibration_in_progress": False,
            "calibration_enabled": False,
            "pre_flight_checks_pass": True,
            "uav_id": self.uav_id
        }


class PX4Simulator:
    """
    Manages multiple simulated drones and publishes their data to Zenoh.
    """
    
    # Default home positions (Beijing area, spread out)
    DEFAULT_HOMES = [
        (39.9042, 116.4074),   # UAV_001 - Central
        (39.9052, 116.4084),   # UAV_002
        (39.9032, 116.4064),   # UAV_003
        (39.9062, 116.4054),   # UAV_004
        (39.9022, 116.4094),   # UAV_005
        (39.9072, 116.4044),   # UAV_006
        (39.9012, 116.4104),   # UAV_007
        (39.9082, 116.4034),   # UAV_008
    ]
    
    def __init__(self, num_drones=8, zenoh_endpoint="tcp/localhost:7447",
                 update_interval=0.1, publish_interval=1.0, mode="zenoh"):
        self.num_drones = min(num_drones, 8)  # Max 8 to match test data
        self.zenoh_endpoint = zenoh_endpoint
        self.update_interval = update_interval
        self.publish_interval = publish_interval
        self.mode = mode
        self.drones = []
        self.zenoh_session = None
        self.running = False
        
        # Create drones
        for i in range(self.num_drones):
            uav_id = f"UAV_{i+1:03d}"
            mavlink_sys_id = i + 1
            home_lat, home_lon = self.DEFAULT_HOMES[i]
            drone = SimulatedDrone(uav_id, mavlink_sys_id, home_lat, home_lon)
            # Stagger target altitudes
            drone.target_alt = 30.0 + i * 10.0
            self.drones.append(drone)
            logger.info(f"Created drone {uav_id} (sys_id={mavlink_sys_id}) at ({home_lat}, {home_lon})")
    
    def start(self):
        """Start the simulator."""
        self.running = True
        
        # Connect to Zenoh if available and not in standalone mode
        if self.mode == "zenoh" and ZENOH_AVAILABLE:
            try:
                config = zenoh.Config()
                config.insert_json5("connect/endpoints", json.dumps([self.zenoh_endpoint]))
                self.zenoh_session = zenoh.open(config)
                logger.info(f"Zenoh session opened: {self.zenoh_endpoint}")
            except Exception as e:
                logger.error(f"Zenoh connection failed: {e}, falling back to standalone mode")
                self.mode = "standalone"
        elif self.mode == "zenoh":
            logger.warning("Zenoh SDK not available, falling back to standalone mode")
            self.mode = "standalone"
        
        # Start update thread
        update_thread = threading.Thread(target=self._update_loop, daemon=True)
        update_thread.start()
        
        # Start publish thread
        publish_thread = threading.Thread(target=self._publish_loop, daemon=True)
        publish_thread.start()
        
        logger.info(f"PX4 Simulator started: {self.num_drones} drones, mode={self.mode}")
        
        try:
            while self.running:
                time.sleep(1)
                # Print status summary every 10 seconds
                if int(time.time()) % 10 == 0:
                    self._print_status()
        except KeyboardInterrupt:
            logger.info("Shutting down simulator...")
            self.running = False
            if self.zenoh_session:
                self.zenoh_session.close()
    
    def _update_loop(self):
        """Update all drones at high frequency."""
        while self.running:
            for drone in self.drones:
                drone.update(self.update_interval)
            time.sleep(self.update_interval)
    
    def _publish_loop(self):
        """Publish drone data at configured interval."""
        while self.running:
            for drone in self.drones:
                self._publish_drone_data(drone)
            time.sleep(self.publish_interval)
    
    def _publish_drone_data(self, drone):
        """Publish all topics for a single drone."""
        topics = {
            f"{drone.uav_id}/fmu/out/vehicle_global_position": drone.get_vehicle_global_position(),
            f"{drone.uav_id}/fmu/out/vehicle_local_position": drone.get_vehicle_local_position(),
            f"{drone.uav_id}/fmu/out/battery_status": drone.get_battery_status(),
            f"{drone.uav_id}/fmu/out/vehicle_status": drone.get_vehicle_status(),
        }
        
        for key, data in topics.items():
            payload = json.dumps(data)
            
            if self.mode == "zenoh" and self.zenoh_session:
                try:
                    self.zenoh_session.put(key, payload)
                except Exception as e:
                    logger.error(f"Zenoh publish failed for {key}: {e}")
            elif self.mode == "standalone":
                # Print to console for debugging
                logger.debug(f"[{key}] {payload[:120]}...")
    
    def _print_status(self):
        """Print status summary of all drones."""
        status_lines = []
        for drone in self.drones:
            status_lines.append(
                f"  {drone.uav_id}: {drone.flight_phase:8s} "
                f"lat={drone.lat:.6f} lon={drone.lon:.6f} alt={drone.alt:.1f}m "
                f"batt={drone.battery_remaining:.0%} "
                f"armed={drone.arming_state == SimulatedDrone.ARMING_STATE_ARMED}"
            )
        logger.info("Drone Status:\n" + "\n".join(status_lines))


def main():
    parser = argparse.ArgumentParser(description="PX4 Drone Simulator for Zenoh Network")
    parser.add_argument("--num-drones", type=int, default=8,
                        help="Number of simulated drones (max 8, default: 8)")
    parser.add_argument("--zenoh-endpoint", default="tcp/localhost:7447",
                        help="Zenoh router endpoint (default: tcp/localhost:7447)")
    parser.add_argument("--update-interval", type=float, default=0.1,
                        help="Physics update interval in seconds (default: 0.1)")
    parser.add_argument("--publish-interval", type=float, default=1.0,
                        help="Data publish interval in seconds (default: 1.0)")
    parser.add_argument("--mode", choices=["zenoh", "standalone"], default="zenoh",
                        help="Mode: 'zenoh' (publish to Zenoh) or 'standalone' (console only)")
    args = parser.parse_args()
    
    sim = PX4Simulator(
        num_drones=args.num_drones,
        zenoh_endpoint=args.zenoh_endpoint,
        update_interval=args.update_interval,
        publish_interval=args.publish_interval,
        mode=args.mode
    )
    sim.start()


if __name__ == "__main__":
    main()
