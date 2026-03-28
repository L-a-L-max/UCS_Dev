# Zenoh Gateway Services

This directory contains the Zenoh gateway services for the UAV cluster management platform.

## Components

### 1. Persistence Gateway (`persistence_gateway.py`)
- Subscribes to `*/fmu/out/*` Zenoh topics
- Parses PX4 DDS messages into structured UAV business data
- Batch POSTs to backend `/api/v1/telemetry/batch`

### 2. WebSocket Gateway (`ws_gateway.py`)
- JWT authentication for client connections
- Dynamic partition subscription per user
- Push data to connected frontends via WebSocket

### 3. Partition Router Service (`partition_router.py`)
- Subscribes to `*/fmu/out/*` Zenoh topics
- Queries Redis for drone partition mapping
- Copies data to partition-specific Zenoh keys

## Requirements

```
pip install eclipse-zenoh paho-mqtt websockets redis requests PyJWT
```

## Configuration

See `config.yaml` for Zenoh router connection and service configuration.
