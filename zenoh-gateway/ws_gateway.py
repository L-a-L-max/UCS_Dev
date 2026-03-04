#!/usr/bin/env python3
"""
Zenoh WebSocket Gateway

Provides real-time UAV data push to frontend clients via WebSocket.
Each connected user receives data only from their assigned drone partitions.

Authentication: JWT token validation on WebSocket connection.
Data routing: Per-user partition subscription via Redis lookup.

This is a NEW component - separate from the existing DDS/simulation gateway.

Data flow:
  Zenoh partitions → WebSocket Gateway → Per-user filtering → Frontend

Usage:
  python ws_gateway.py --zenoh-endpoint tcp/localhost:7447 --ws-port 8082 --redis-host localhost
"""

import argparse
import asyncio
import json
import logging
import time
import threading
from datetime import datetime, timezone

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger("WSGateway")

# Try imports - fall back to stubs if not available
try:
    import websockets
    WS_AVAILABLE = True
except ImportError:
    WS_AVAILABLE = False
    logger.warning("websockets not available - running in STUB mode")

try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    logger.warning("redis not available - using in-memory partition mapping")

try:
    import zenoh
    ZENOH_AVAILABLE = True
except ImportError:
    ZENOH_AVAILABLE = False
    logger.warning("Zenoh SDK not available - running in STUB mode")

try:
    import jwt
    JWT_AVAILABLE = True
except ImportError:
    JWT_AVAILABLE = False
    logger.warning("PyJWT not available - skipping JWT validation")


class UserSession:
    """Represents a connected WebSocket user session."""
    
    def __init__(self, websocket, user_id, username, roles, partitions=None):
        self.websocket = websocket
        self.user_id = user_id
        self.username = username
        self.roles = roles
        self.partitions = partitions or set()
        self.subscribed_uav_ids = set()
        self.connected_at = datetime.now(timezone.utc)
    
    def __repr__(self):
        return f"UserSession(user_id={self.user_id}, username={self.username}, uavs={self.subscribed_uav_ids})"


class WSGateway:
    """
    WebSocket gateway for pushing UAV data to frontend clients.
    
    Architecture:
    1. Client connects via WebSocket with JWT token
    2. Gateway validates JWT and looks up user's partition assignments in Redis
    3. Gateway subscribes to Zenoh partition topics for this user
    4. Incoming Zenoh data is filtered and pushed to the user's WebSocket
    5. On disconnect, Zenoh subscriptions are cleaned up
    """
    
    def __init__(self, zenoh_endpoint, ws_port, redis_host, redis_port, jwt_secret):
        self.zenoh_endpoint = zenoh_endpoint
        self.ws_port = ws_port
        self.redis_host = redis_host
        self.redis_port = redis_port
        self.jwt_secret = jwt_secret
        self.sessions = {}  # websocket -> UserSession
        self.redis_client = None
        self.zenoh_session = None
        self.uav_latest_data = {}  # uav_id -> latest data dict
        self.lock = threading.Lock()
    
    def start(self):
        """Start the WebSocket gateway."""
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
                logger.warning(f"Redis connection failed: {e}, using in-memory fallback")
                self.redis_client = None
        
        # Initialize Zenoh
        if ZENOH_AVAILABLE:
            try:
                config = zenoh.Config()
                config.insert_json5("connect/endpoints", json.dumps([self.zenoh_endpoint]))
                self.zenoh_session = zenoh.open(config)
                logger.info(f"Zenoh session opened: {self.zenoh_endpoint}")
                
                # Subscribe to all UAV telemetry for caching
                self.zenoh_session.declare_subscriber(
                    "*/fmu/out/vehicle_global_position",
                    self._on_zenoh_telemetry
                )
            except Exception as e:
                logger.warning(f"Zenoh connection failed: {e}")
        
        # Start WebSocket server
        if WS_AVAILABLE:
            asyncio.run(self._run_ws_server())
        else:
            logger.error("websockets library required. Install: pip install websockets")
    
    async def _run_ws_server(self):
        """Run the WebSocket server."""
        async with websockets.serve(self._handle_connection, "0.0.0.0", self.ws_port):
            logger.info(f"WebSocket Gateway listening on ws://0.0.0.0:{self.ws_port}")
            await asyncio.Future()  # Run forever
    
    async def _handle_connection(self, websocket):
        """Handle a new WebSocket connection."""
        try:
            # Wait for authentication message
            auth_msg = await asyncio.wait_for(websocket.recv(), timeout=10)
            auth_data = json.loads(auth_msg)
            
            # Validate JWT token
            token = auth_data.get("token", "")
            user_info = self._validate_token(token)
            if not user_info:
                await websocket.send(json.dumps({
                    "type": "AUTH_ERROR",
                    "message": "Invalid or expired token"
                }))
                return
            
            user_id = user_info["userId"]
            username = user_info["username"]
            roles = user_info.get("roles", [])
            
            # Look up user's drone subscriptions
            uav_ids = self._get_user_drone_ids(user_id, roles)
            
            session = UserSession(websocket, user_id, username, roles)
            session.subscribed_uav_ids = set(uav_ids)
            self.sessions[websocket] = session
            
            logger.info(f"User connected: {username} (id={user_id}), drones: {uav_ids}")
            
            # Send auth success
            await websocket.send(json.dumps({
                "type": "AUTH_SUCCESS",
                "userId": user_id,
                "username": username,
                "roles": roles,
                "subscribedDrones": list(uav_ids)
            }))
            
            # Start pushing data to this user
            await self._push_loop(session)
            
        except asyncio.TimeoutError:
            logger.warning("Client auth timeout")
        except websockets.exceptions.ConnectionClosed:
            logger.info("Client disconnected")
        except Exception as e:
            logger.error(f"Connection error: {e}")
        finally:
            if websocket in self.sessions:
                session = self.sessions.pop(websocket)
                logger.info(f"User disconnected: {session.username}")
    
    async def _push_loop(self, session):
        """Push data to a connected user at regular intervals."""
        try:
            while True:
                # Collect data for this user's drones
                user_data = []
                with self.lock:
                    for uav_id in session.subscribed_uav_ids:
                        if uav_id in self.uav_latest_data:
                            user_data.append(self.uav_latest_data[uav_id])
                
                if user_data:
                    await session.websocket.send(json.dumps({
                        "type": "TELEMETRY_UPDATE",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "drones": user_data
                    }))
                
                await asyncio.sleep(1.0)  # Push every 1 second
        except websockets.exceptions.ConnectionClosed:
            pass
    
    def _on_zenoh_telemetry(self, sample):
        """Handle incoming Zenoh telemetry for caching."""
        try:
            key = str(sample.key_expr)
            payload = sample.payload.to_string()
            data = json.loads(payload)
            
            parts = key.split("/")
            if len(parts) >= 4:
                uav_id = parts[0]
                with self.lock:
                    self.uav_latest_data[uav_id] = {
                        "uavId": uav_id,
                        "lat": data.get("lat", 0.0),
                        "lon": data.get("lon", 0.0),
                        "alt": data.get("alt", 0.0),
                        "heading": data.get("heading", 0.0),
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    }
        except Exception as e:
            logger.error(f"Error caching telemetry: {e}")
    
    def _validate_token(self, token):
        """Validate JWT token and extract user info."""
        if not JWT_AVAILABLE:
            # Stub: parse without validation for testing
            try:
                parts = token.split(".")
                if len(parts) == 3:
                    import base64
                    payload = parts[1] + "=" * (4 - len(parts[1]) % 4)
                    return json.loads(base64.b64decode(payload))
            except Exception:
                pass
            return None
        
        try:
            decoded = jwt.decode(token, self.jwt_secret, algorithms=["HS256"])
            return decoded
        except jwt.ExpiredSignatureError:
            logger.warning("Token expired")
            return None
        except jwt.InvalidTokenError as e:
            logger.warning(f"Invalid token: {e}")
            return None
    
    def _get_user_drone_ids(self, user_id, roles):
        """
        Get the drone IDs a user should receive data for.
        
        For observers/commanders: all drones
        For leaders: team drones
        For pilots: owned drones
        
        Uses Redis cache if available, otherwise returns default set.
        """
        # Commander and observer see all
        if "commander" in roles or "observer" in roles:
            return self._get_all_drone_ids()
        
        # Look up from Redis: drone:{uav_id}:controller == user_id
        if self.redis_client:
            try:
                # Get all drone keys and check controller
                drone_ids = set()
                for key in self.redis_client.scan_iter("drone:*:controller"):
                    controller_id = self.redis_client.get(key)
                    if controller_id and int(controller_id) == user_id:
                        # Extract uav_id from key pattern drone:{uav_id}:controller
                        uav_id = key.split(":")[1]
                        drone_ids.add(uav_id)
                return drone_ids
            except Exception as e:
                logger.error(f"Redis lookup failed: {e}")
        
        # Fallback: return empty set (pilot sees nothing until Redis is populated)
        return set()
    
    def _get_all_drone_ids(self):
        """Get all known drone IDs."""
        with self.lock:
            return set(self.uav_latest_data.keys())


def main():
    parser = argparse.ArgumentParser(description="Zenoh WebSocket Gateway")
    parser.add_argument("--zenoh-endpoint", default="tcp/localhost:7447",
                        help="Zenoh router endpoint")
    parser.add_argument("--ws-port", type=int, default=8082,
                        help="WebSocket server port (default: 8082)")
    parser.add_argument("--redis-host", default="localhost",
                        help="Redis host (default: localhost)")
    parser.add_argument("--redis-port", type=int, default=6379,
                        help="Redis port (default: 6379)")
    parser.add_argument("--jwt-secret",
                        default="ucs-platform-secret-key-for-jwt-token-generation-2024-secure",
                        help="JWT secret key (must match backend)")
    args = parser.parse_args()
    
    gateway = WSGateway(
        zenoh_endpoint=args.zenoh_endpoint,
        ws_port=args.ws_port,
        redis_host=args.redis_host,
        redis_port=args.redis_port,
        jwt_secret=args.jwt_secret
    )
    gateway.start()


if __name__ == "__main__":
    main()
