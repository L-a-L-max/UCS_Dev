# QGroundControl 改造指南

本文档提供了如何在 QGroundControl (QGC) 官方源代码基础上进行改造的技术方案，以实现无人机集群管控平台的队员端和队长端功能。

## 1. 环境准备

### 1.1 获取 QGC 源代码

```bash
git clone --recursive https://github.com/mavlink/qgroundcontrol.git
cd qgroundcontrol
git submodule update --init --recursive
```

### 1.2 开发环境要求

- Qt 6.6.x (推荐使用 Qt Online Installer)
- CMake 3.21+
- Visual Studio 2022 (Windows) / Xcode (macOS) / GCC 11+ (Linux)
- Git

### 1.3 构建步骤

```bash
mkdir build
cd build
cmake ..
cmake --build . --config Release
```

## 2. 地图汉化方案

### 2.1 切换地图提供商

QGC 默认使用 Mapbox 和 Bing 地图。要实现汉化，建议切换到高德地图或天地图。

修改文件: `src/QtLocationPlugin/QGCMapEngine.cpp`

```cpp
// 添加高德地图支持
QString QGCMapEngine::getMapUrl(int mapType, int x, int y, int zoom) {
    switch(mapType) {
        case AMapStreet:
            return QString("https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=%1&y=%2&z=%3")
                .arg(x).arg(y).arg(zoom);
        case AMapSatellite:
            return QString("https://webst01.is.autonavi.com/appmaptile?style=6&x=%1&y=%2&z=%3")
                .arg(x).arg(y).arg(zoom);
        // ... 其他地图类型
    }
}
```

### 2.2 坐标系转换

高德地图使用 GCJ-02 坐标系，需要进行坐标转换：

```cpp
// src/PositionManager/GeoCoordTransform.h
class GeoCoordTransform {
public:
    static void wgs84ToGcj02(double wgsLat, double wgsLng, double &gcjLat, double &gcjLng);
    static void gcj02ToWgs84(double gcjLat, double gcjLng, double &wgsLat, double &wgsLng);
private:
    static bool outOfChina(double lat, double lng);
    static double transformLat(double x, double y);
    static double transformLng(double x, double y);
};
```

## 3. 多机接入支持

### 3.1 多连接管理

QGC 原生支持多机连接，但需要处理端口冲突。修改连接管理器以支持动态端口分配：

修改文件: `src/comm/LinkManager.cc`

```cpp
void LinkManager::createConnectedLink(LinkConfiguration* config) {
    // 检查端口冲突
    if (config->type() == LinkConfiguration::TypeUdp) {
        UDPConfiguration* udpConfig = dynamic_cast<UDPConfiguration*>(config);
        int basePort = udpConfig->localPort();
        while (isPortInUse(basePort)) {
            basePort++;
        }
        udpConfig->setLocalPort(basePort);
    }
    // ... 创建连接
}
```

### 3.2 支持的连接方式

1. **USB 串口连接**: 自动检测 `/dev/ttyUSB*` 或 `COM*` 端口
2. **WiFi UDP 连接**: 默认端口 14550，支持多播
3. **自组网连接**: 通过多网融合模组接入

### 3.3 多网融合模组集成

创建新的连接类型以支持自组网：

```cpp
// src/comm/MeshNetworkLink.h
class MeshNetworkLink : public LinkInterface {
    Q_OBJECT
public:
    MeshNetworkLink(SharedLinkConfigurationPtr& config);
    
    void requestReset() override;
    bool isConnected() const override;
    void disconnect() override;
    
private slots:
    void _readBytes();
    void _writeBytes(const QByteArray& data);
    
private:
    QTcpSocket* _socket;
    QString _meshGatewayAddress;
    int _meshGatewayPort;
};
```

## 4. 后端 API 集成

### 4.1 HTTP 客户端封装

创建 HTTP 客户端用于与后端服务器通信：

```cpp
// src/api/UcsApiClient.h
class UcsApiClient : public QObject {
    Q_OBJECT
public:
    explicit UcsApiClient(QObject* parent = nullptr);
    
    void login(const QString& username, const QString& password);
    void fetchDroneList();
    void fetchTaskList();
    void sendCommand(const QString& droneId, const QString& command, const QJsonObject& payload);
    void uploadTelemetry(const QString& droneId, const QJsonObject& telemetry);
    
signals:
    void loginSuccess(const QString& token, const QJsonObject& userInfo);
    void loginFailed(const QString& error);
    void droneListReceived(const QJsonArray& drones);
    void taskListReceived(const QJsonArray& tasks);
    
private:
    QNetworkAccessManager* _networkManager;
    QString _baseUrl;
    QString _authToken;
};
```

### 4.2 实时数据上报

定时将无人机遥测数据上报到服务器：

```cpp
// src/Vehicle/VehicleTelemetryUploader.cpp
void VehicleTelemetryUploader::uploadTelemetry() {
    for (Vehicle* vehicle : _vehicleManager->vehicles()) {
        QJsonObject telemetry;
        telemetry["droneId"] = vehicle->id();
        telemetry["lat"] = vehicle->coordinate().latitude();
        telemetry["lng"] = vehicle->coordinate().longitude();
        telemetry["alt"] = vehicle->altitudeRelative()->rawValue().toDouble();
        telemetry["heading"] = vehicle->heading()->rawValue().toDouble();
        telemetry["battery"] = vehicle->battery()->percentRemaining()->rawValue().toDouble();
        telemetry["flightStatus"] = vehicle->armed() ? "FLYING" : "IDLE";
        
        _apiClient->uploadTelemetry(vehicle->id(), telemetry);
    }
}
```

## 5. 队员端改造

### 5.1 功能需求

- 只显示分配给自己的无人机
- 支持单机控制和任务执行
- 实时上报遥测数据

### 5.2 界面修改

修改主界面以隐藏队长专属功能：

```qml
// src/FlightDisplay/FlightDisplayView.qml
Item {
    property bool isLeader: UcsUserManager.currentUser.role === "leader"
    
    // 队员端隐藏批量控制按钮
    QGCButton {
        visible: isLeader
        text: qsTr("Batch Command")
        onClicked: batchCommandDialog.open()
    }
}
```

## 6. 队长端改造

### 6.1 功能需求

- 显示所有队员和无人机状态
- 支持无人机分配和任务下发
- 批量控制功能

### 6.2 队员管理界面

```qml
// src/ui/TeamMemberPanel.qml
Rectangle {
    id: teamMemberPanel
    
    ListView {
        model: UcsTeamManager.members
        delegate: TeamMemberDelegate {
            memberName: model.name
            isOnline: model.online
            assignedDrones: model.droneIds
            currentTask: model.currentTask
            
            onAssignDrone: {
                droneAssignDialog.targetUserId = model.userId
                droneAssignDialog.open()
            }
        }
    }
}
```

### 6.3 批量控制功能

```cpp
// src/Vehicle/BatchVehicleController.cpp
void BatchVehicleController::sendBatchCommand(
    const QStringList& vehicleIds, 
    const QString& command,
    const QJsonObject& payload) 
{
    for (const QString& id : vehicleIds) {
        Vehicle* vehicle = _vehicleManager->getVehicleById(id);
        if (vehicle) {
            if (command == "TAKEOFF") {
                vehicle->guidedModeTakeoff(payload["altitude"].toDouble());
            } else if (command == "LAND") {
                vehicle->guidedModeLand();
            } else if (command == "RTL") {
                vehicle->guidedModeRTL();
            } else if (command == "GOTO") {
                QGeoCoordinate coord(
                    payload["lat"].toDouble(),
                    payload["lng"].toDouble(),
                    payload["alt"].toDouble()
                );
                vehicle->guidedModeGotoLocation(coord);
            }
        }
    }
}
```

## 7. WebSocket 实时通信

### 7.1 WebSocket 客户端

```cpp
// src/api/UcsWebSocketClient.h
class UcsWebSocketClient : public QObject {
    Q_OBJECT
public:
    explicit UcsWebSocketClient(QObject* parent = nullptr);
    
    void connectToServer(const QString& url, const QString& token);
    void subscribe(const QString& topic);
    void unsubscribe(const QString& topic);
    
signals:
    void droneStatusUpdated(const QJsonObject& status);
    void eventReceived(const QJsonObject& event);
    void taskAssigned(const QJsonObject& task);
    
private slots:
    void onConnected();
    void onDisconnected();
    void onTextMessageReceived(const QString& message);
    
private:
    QWebSocket* _webSocket;
    QString _authToken;
};
```

## 8. 构建和部署

### 8.1 构建队员端

```bash
cmake -DUCS_BUILD_TYPE=PILOT ..
cmake --build . --config Release
```

### 8.2 构建队长端

```bash
cmake -DUCS_BUILD_TYPE=LEADER ..
cmake --build . --config Release
```

### 8.3 配置文件

创建 `ucs_config.ini` 配置文件：

```ini
[Server]
BaseUrl=http://your-server:8080
WebSocketUrl=ws://your-server:8080/ws

[Map]
Provider=AMap
ApiKey=your-amap-api-key

[Connection]
DefaultUdpPort=14550
AutoConnect=true
```

## 9. 注意事项

1. **MAVLink 协议**: QGC 使用 MAVLink 2.0 协议与飞控通信，确保飞控固件支持
2. **端口管理**: 多机连接时注意 UDP 端口分配，避免冲突
3. **坐标系**: 飞控使用 WGS-84 坐标系，高德地图使用 GCJ-02，需要转换
4. **网络延迟**: 自组网可能有较高延迟，需要在 UI 上做相应提示
5. **安全性**: 生产环境需要使用 HTTPS 和 WSS 加密通信

## 10. 参考资源

- [QGroundControl 开发文档](https://dev.qgroundcontrol.com/)
- [MAVLink 协议文档](https://mavlink.io/)
- [Qt 6 文档](https://doc.qt.io/qt-6/)
- [高德地图 API](https://lbs.amap.com/)
