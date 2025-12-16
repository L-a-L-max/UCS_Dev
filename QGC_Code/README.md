# UCS QGC Integration Module

This folder contains the UCS (UAV Swarm Control System) integration module for QGroundControl.

## Overview

The UCS integration module adds backend connectivity to QGC, enabling:
- **Backend API Integration** - Connect to the UCS backend server
- **Role-Based Access Control** - Support for Pilot, Leader, and Commander roles
- **Real-time Data Sync** - Automatic synchronization of drone status, tasks, and team information

## Module Structure

```
QGC_Code/
└── src/
    └── UCS/
        ├── UCSApiClient.h      # API client header
        ├── UCSApiClient.cc     # API client implementation
        ├── UCSManager.h        # Manager header (QML singleton)
        ├── UCSManager.cc       # Manager implementation
        └── CMakeLists.txt      # Build configuration
```

## Client Roles

| Role | Description | Permissions |
|------|-------------|-------------|
| Pilot | Team member | View assigned drones, report status, execute tasks |
| Leader | Team leader | All Pilot permissions + assign tasks, manage team |
| Commander | System commander | Full access to all drones, tasks, and teams |

## Build Instructions

### Prerequisites

- Qt 6.6 or later
- CMake 3.21 or later
- C++17 compatible compiler

### Setup

1. Clone the official QGC repository:
```bash
git clone --recursive https://github.com/mavlink/qgroundcontrol.git
```

2. Copy the UCS module to the QGC source:
```bash
cp -r QGC_Code/src/UCS qgroundcontrol/src/
```

3. Add UCS to QGC's CMakeLists.txt (in src/CMakeLists.txt):
```cmake
add_subdirectory(UCS)
target_link_libraries(QGroundControl PRIVATE UCS)
```

4. Register QML types in main.cc:
```cpp
#include "UCS/UCSManager.h"
// Before QML engine creation:
UCSManager::registerQmlTypes();
```

### Windows Build

```powershell
cd qgroundcontrol
mkdir build && cd build
cmake .. -G "Visual Studio 17 2022" -A x64 -DCMAKE_PREFIX_PATH="C:/Qt/6.6.0/msvc2019_64"
cmake --build . --config Release
```

### Linux Build

```bash
cd qgroundcontrol
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
make -j$(nproc)
```

## Configuration

Default server URL: `http://localhost:8080`

### Test Accounts

Test accounts are created automatically when the backend starts in development mode.
See the backend's `DataInitService.java` for available test users.
Default test password for all accounts is configured in the backend.

## API Endpoints

### Authentication
- `POST /api/v1/auth/login` - User login

### Pilot Endpoints
- `GET /api/v1/pilot/uav/list` - Get assigned drones
- `POST /api/v1/pilot/uav/status` - Update drone status

### Leader Endpoints
- `GET /api/v1/leader/uav/list` - Get team drones
- `POST /api/v1/leader/task/assign` - Assign task to drone

### Screen Endpoints
- `GET /api/v1/screen/uav/list` - Get all drones
- `GET /api/v1/screen/weather` - Get weather information

## License

Apache 2.0 / GPLv3 (same as QGroundControl)
