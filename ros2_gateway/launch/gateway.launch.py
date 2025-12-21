#!/usr/bin/env python3
"""
Launch file for UAV Telemetry Gateway
"""

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    # Declare launch arguments
    backend_url_arg = DeclareLaunchArgument(
        'backend_url',
        default_value='http://localhost:8080',
        description='URL of the Java backend server'
    )
    
    topic_name_arg = DeclareLaunchArgument(
        'topic_name',
        default_value='/all_uavs_gps',
        description='ROS 2 topic name to subscribe to'
    )
    
    message_type_arg = DeclareLaunchArgument(
        'message_type',
        default_value='uav_msgs/msg/UavGpsArray',
        description='ROS 2 message type'
    )
    
    # Gateway node
    gateway_node = Node(
        package='uav_telemetry_gateway',
        executable='gateway_node',
        name='uav_telemetry_gateway',
        output='screen',
        parameters=[{
            'backend_url': LaunchConfiguration('backend_url'),
            'topic_name': LaunchConfiguration('topic_name'),
            'message_type': LaunchConfiguration('message_type'),
            'batch_size': 1,
            'batch_timeout_ms': 100,
            'retry_count': 3,
            'retry_delay_ms': 100,
        }]
    )
    
    return LaunchDescription([
        backend_url_arg,
        topic_name_arg,
        message_type_arg,
        gateway_node,
    ])
