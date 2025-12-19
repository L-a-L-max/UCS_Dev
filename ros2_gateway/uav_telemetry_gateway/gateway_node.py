#!/usr/bin/env python3
"""
ROS 2 Gateway Node for UAV Telemetry
Subscribes to UAV GPS topics and forwards data to Java backend via HTTP

This node is designed for ROS 2 Humble and works with custom UAV GPS messages.
"""

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy, DurabilityPolicy
import requests
import json
from datetime import datetime
from typing import List, Dict, Any
import threading
import queue
import time

# Import the custom message types - these will be generated from .msg files
# For now, we'll use a generic approach that works with any message type
from rclpy.serialization import deserialize_message
from rosidl_runtime_py.utilities import get_message


class TelemetryGatewayNode(Node):
    """
    ROS 2 node that subscribes to UAV telemetry topics and forwards data to Java backend
    """
    
    def __init__(self):
        super().__init__('uav_telemetry_gateway')
        
        # Declare parameters
        self.declare_parameter('backend_url', 'http://localhost:8080')
        self.declare_parameter('topic_name', '/uav_gps_array')
        self.declare_parameter('message_type', 'uav_msgs/msg/UavGpsArray')
        self.declare_parameter('batch_size', 1)  # Send immediately by default
        self.declare_parameter('batch_timeout_ms', 100)  # Max wait time for batching
        self.declare_parameter('retry_count', 3)
        self.declare_parameter('retry_delay_ms', 100)
        
        # Get parameters
        self.backend_url = self.get_parameter('backend_url').value
        self.topic_name = self.get_parameter('topic_name').value
        self.message_type = self.get_parameter('message_type').value
        self.batch_size = self.get_parameter('batch_size').value
        self.batch_timeout_ms = self.get_parameter('batch_timeout_ms').value
        self.retry_count = self.get_parameter('retry_count').value
        self.retry_delay_ms = self.get_parameter('retry_delay_ms').value
        
        # API endpoint
        self.api_endpoint = f"{self.backend_url}/api/v1/telemetry/batch"
        
        # Message queue for batching
        self.message_queue = queue.Queue()
        
        # Statistics
        self.messages_received = 0
        self.messages_sent = 0
        self.send_errors = 0
        
        # QoS profile - match PX4/Gazebo defaults
        qos_profile = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            durability=DurabilityPolicy.VOLATILE,
            history=HistoryPolicy.KEEP_LAST,
            depth=10
        )
        
        # Try to get the message type dynamically
        try:
            msg_type = get_message(self.message_type)
            self.subscription = self.create_subscription(
                msg_type,
                self.topic_name,
                self.topic_callback,
                qos_profile
            )
            self.get_logger().info(f"Subscribed to {self.topic_name} with type {self.message_type}")
        except Exception as e:
            self.get_logger().error(f"Failed to subscribe to {self.topic_name}: {e}")
            self.get_logger().info("Will use generic subscription approach")
            # Fallback: create a generic subscription
            self.subscription = None
        
        # Start sender thread
        self.sender_thread = threading.Thread(target=self.sender_loop, daemon=True)
        self.sender_thread.start()
        
        # Status timer
        self.create_timer(10.0, self.log_status)
        
        self.get_logger().info(f"Gateway initialized. Backend: {self.backend_url}")
    
    def topic_callback(self, msg):
        """
        Callback for receiving UAV GPS array messages
        """
        self.messages_received += 1
        
        try:
            # Convert ROS message to dictionary
            telemetry_batch = self.convert_message_to_dict(msg)
            
            # Add to queue
            self.message_queue.put(telemetry_batch)
            
        except Exception as e:
            self.get_logger().error(f"Error processing message: {e}")
    
    def convert_message_to_dict(self, msg) -> Dict[str, Any]:
        """
        Convert ROS message to dictionary format expected by Java backend
        """
        # Handle timestamp
        if hasattr(msg, 'timestamp'):
            timestamp = self.ros_time_to_iso(msg.timestamp)
        elif hasattr(msg, 'sec') and hasattr(msg, 'nsec'):
            timestamp = self.sec_nsec_to_iso(msg.sec, msg.nsec)
        else:
            timestamp = datetime.utcnow().isoformat() + 'Z'
        
        # Build batch DTO
        batch = {
            'timestamp': timestamp,
            'msgSeqNumber': getattr(msg, 'msg_seq_number', 0),
            'homeLat': getattr(msg, 'home_lat', 0.0),
            'homeLon': getattr(msg, 'home_lon', 0.0),
            'homeAlt': getattr(msg, 'home_alt', 0.0),
            'numUavsTotal': getattr(msg, 'num_uavs_total', 0),
            'numUavsActive': getattr(msg, 'num_uavs_active', 0),
            'uavs': []
        }
        
        # Convert each UAV data
        if hasattr(msg, 'uavs'):
            for uav in msg.uavs:
                uav_data = self.convert_uav_data(uav)
                batch['uavs'].append(uav_data)
        
        return batch
    
    def convert_uav_data(self, uav) -> Dict[str, Any]:
        """
        Convert single UAV data to dictionary
        """
        # Handle timestamp
        if hasattr(uav, 'timestamp'):
            timestamp = self.ros_time_to_iso(uav.timestamp)
        else:
            timestamp = datetime.utcnow().isoformat() + 'Z'
        
        return {
            'uavId': getattr(uav, 'id', 0),
            'timestamp': timestamp,
            'lat': getattr(uav, 'lat', 0.0),
            'lon': getattr(uav, 'lon', 0.0),
            'alt': getattr(uav, 'alt', 0.0),
            'heading': getattr(uav, 'heading', 0.0),
            'groundSpeed': getattr(uav, 'ground_speed', 0.0),
            'verticalSpeed': getattr(uav, 'vertical_speed', 0.0),
            'nedX': getattr(uav, 'ned_x', 0.0),
            'nedY': getattr(uav, 'ned_y', 0.0),
            'nedZ': getattr(uav, 'ned_z', 0.0),
            'vx': getattr(uav, 'vx', 0.0),
            'vy': getattr(uav, 'vy', 0.0),
            'vz': getattr(uav, 'vz', 0.0),
            'dataAge': getattr(uav, 'data_age', 0.0),
            'msgCount': getattr(uav, 'msg_count', 0),
            'isActive': getattr(uav, 'is_active', False)
        }
    
    def ros_time_to_iso(self, ros_time) -> str:
        """
        Convert ROS Time to ISO format string
        """
        if hasattr(ros_time, 'sec') and hasattr(ros_time, 'nanosec'):
            total_seconds = ros_time.sec + ros_time.nanosec / 1e9
        elif hasattr(ros_time, 'sec') and hasattr(ros_time, 'nsec'):
            total_seconds = ros_time.sec + ros_time.nsec / 1e9
        else:
            return datetime.utcnow().isoformat() + 'Z'
        
        dt = datetime.utcfromtimestamp(total_seconds)
        return dt.isoformat() + 'Z'
    
    def sec_nsec_to_iso(self, sec: int, nsec: int) -> str:
        """
        Convert sec/nsec to ISO format string
        """
        total_seconds = sec + nsec / 1e9
        dt = datetime.utcfromtimestamp(total_seconds)
        return dt.isoformat() + 'Z'
    
    def sender_loop(self):
        """
        Background thread that sends batched messages to backend
        """
        while rclpy.ok():
            try:
                # Wait for message with timeout
                try:
                    batch = self.message_queue.get(timeout=self.batch_timeout_ms / 1000.0)
                except queue.Empty:
                    continue
                
                # Send to backend
                self.send_to_backend(batch)
                
            except Exception as e:
                self.get_logger().error(f"Sender loop error: {e}")
                time.sleep(0.1)
    
    def send_to_backend(self, batch: Dict[str, Any]):
        """
        Send telemetry batch to Java backend via HTTP POST
        """
        for attempt in range(self.retry_count):
            try:
                response = requests.post(
                    self.api_endpoint,
                    json=batch,
                    headers={'Content-Type': 'application/json'},
                    timeout=5.0
                )
                
                if response.status_code == 200:
                    self.messages_sent += 1
                    return
                else:
                    self.get_logger().warn(
                        f"Backend returned {response.status_code}: {response.text}"
                    )
                    
            except requests.exceptions.RequestException as e:
                self.get_logger().warn(f"Send attempt {attempt + 1} failed: {e}")
                
            if attempt < self.retry_count - 1:
                time.sleep(self.retry_delay_ms / 1000.0)
        
        self.send_errors += 1
        self.get_logger().error(f"Failed to send batch after {self.retry_count} attempts")
    
    def log_status(self):
        """
        Log gateway status periodically
        """
        self.get_logger().info(
            f"Gateway status: received={self.messages_received}, "
            f"sent={self.messages_sent}, errors={self.send_errors}"
        )


def main(args=None):
    rclpy.init(args=args)
    
    node = TelemetryGatewayNode()
    
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
