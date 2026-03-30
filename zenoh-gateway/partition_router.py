#!/usr/bin/env python3
"""
Zenoh Partition Router Service

Subscribes to raw UAV telemetry topics (*/fmu/out/*) and copies data
to partition-specific Zenoh keys based on Redis partition mapping.

This enables per-user data isolation: each user's partition only contains
data from drones they are authorized to see.

Partition naming: partition_{team_name}_{phone} or partition_{user_id}

Data flow:
  UAV → Zenoh (uav/{uav_id}/fmu/out/*) → Partition Router → 
    → Zenoh (partition/{name}/{uav_id}/fmu/out/*)

Redis keys used:
  drone:{uav_id}:partitions  → Set of partition names
  partition:{name}:drones    → Set of uav_ids

Usage:
  python partition_router.py --zenoh-endpoint tcp/localhost:7447 --redis-host localhost
"""

import argparse
import json
import logging
import time
import threading

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger("PartitionRouter")

try:
    import zenoh
    ZENOH_AVAILABLE = True
except ImportError:
    ZENOH_AVAILABLE = False
    logger.warning("Zenoh SDK not available - running in STUB mode")

try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    logger.warning("redis not available - using default partition mapping")


class PartitionRouter:
    """
    Routes UAV data to Zenoh partitions based on Redis mapping.
    
    For each incoming message on {uav_id}/fmu/out/{topic}:
    1. Look up drone:{uav_id}:partitions in Redis
    2. For each partition, publish to partition/{name}/{uav_id}/fmu/out/{topic}
    3. Also update drone:{uav_id}:online heartbeat in Redis
    """
    
    def __init__(self, zenoh_endpoint, redis_host, redis_port):
        self.zenoh_endpoint = zenoh_endpoint
        self.redis_host = redis_host
        self.redis_port = redis_port
        self.redis_client = None
        self.zenoh_session = None
        self.running = False
        # Local cache of partition mapping to reduce Redis queries
        self.partition_cache = {}  # uav_id -> set of partition names
        self.cache_ttl = 30  # seconds
        self.cache_timestamps = {}  # uav_id -> last refresh time
    
    def start(self):
        """Start the partition router service."""
        self.running = True
        
        # Initialize Redis
        if REDIS_AVAILABLE:
            try:
                self.redis_client = redis.Redis(
                    host=self.redis_host, port=self.redis_port,
                    decode_responses=True
                )
                self.redis_client.ping()
                logger.info(f"Redis connected: {self.redis_host}:{self.redis_port}")
            except Exception as e:
                logger.warning(f"Redis connection failed: {e}")
                self.redis_client = None
        
        # Initialize Zenoh
        if ZENOH_AVAILABLE:
            config = zenoh.Config()
            config.insert_json5("connect/endpoints", json.dumps([self.zenoh_endpoint]))
            self.zenoh_session = zenoh.open(config)
            logger.info(f"Zenoh session opened: {self.zenoh_endpoint}")
            
            # Subscribe to all UAV telemetry
            self.zenoh_session.declare_subscriber(
                "*/fmu/out/*",
                self._on_uav_message
            )
            logger.info("Subscribed to: */fmu/out/*")
        else:
            logger.info("Running in STUB mode - no Zenoh subscriptions")
        
        logger.info("Partition Router started")
        
        try:
            while self.running:
                time.sleep(1)
        except KeyboardInterrupt:
            logger.info("Shutting down...")
            self.running = False
    
    def _on_uav_message(self, sample):
        """Handle incoming UAV message and route to partitions."""
        try:
            key = str(sample.key_expr)
            payload_bytes = sample.payload
            
            # Parse uav_id from key: {uav_id}/fmu/out/{topic}
            parts = key.split("/")
            if len(parts) < 4:
                return
            
            uav_id = parts[0]
            rest_of_key = "/".join(parts[1:])  # fmu/out/{topic}
            
            # Update drone heartbeat in Redis
            self._update_heartbeat(uav_id)
            
            # Get partitions for this drone
            partitions = self._get_partitions(uav_id)
            
            # Copy data to each partition
            for partition_name in partitions:
                partition_key = f"partition/{partition_name}/{uav_id}/{rest_of_key}"
                try:
                    self.zenoh_session.put(partition_key, payload_bytes)
                except Exception as e:
                    logger.error(f"Failed to publish to partition {partition_key}: {e}")
            
        except Exception as e:
            logger.error(f"Error routing message: {e}")
    
    def _get_partitions(self, uav_id):
        """Get partition names for a drone, using cache with TTL."""
        now = time.time()
        
        # Check cache
        if uav_id in self.partition_cache:
            if now - self.cache_timestamps.get(uav_id, 0) < self.cache_ttl:
                return self.partition_cache[uav_id]
        
        # Query Redis
        partitions = set()
        if self.redis_client:
            try:
                redis_key = f"drone:{uav_id}:partitions"
                members = self.redis_client.smembers(redis_key)
                if members:
                    partitions = members
            except Exception as e:
                logger.error(f"Redis query failed for {uav_id}: {e}")
        
        # Default partition if none configured
        if not partitions:
            partitions = {f"partition_default"}
        
        # Update cache
        self.partition_cache[uav_id] = partitions
        self.cache_timestamps[uav_id] = now
        
        return partitions
    
    def _update_heartbeat(self, uav_id):
        """Update drone online heartbeat in Redis."""
        if self.redis_client:
            try:
                redis_key = f"drone:{uav_id}:online"
                self.redis_client.setex(redis_key, 30, "true")  # 30s TTL
            except Exception as e:
                logger.error(f"Failed to update heartbeat for {uav_id}: {e}")


def main():
    parser = argparse.ArgumentParser(description="Zenoh Partition Router")
    parser.add_argument("--zenoh-endpoint", default="tcp/localhost:7447",
                        help="Zenoh router endpoint")
    parser.add_argument("--redis-host", default="localhost",
                        help="Redis host (default: localhost)")
    parser.add_argument("--redis-port", type=int, default=6379,
                        help="Redis port (default: 6379)")
    args = parser.parse_args()
    
    router = PartitionRouter(
        zenoh_endpoint=args.zenoh_endpoint,
        redis_host=args.redis_host,
        redis_port=args.redis_port
    )
    router.start()


if __name__ == "__main__":
    main()
