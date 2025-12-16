/****************************************************************************
 *
 * (c) 2024 UCS Development Team. All rights reserved.
 *
 * UCS API Client Implementation
 *
 ****************************************************************************/

#include "UCSApiClient.h"
#include <QNetworkRequest>
#include <QUrlQuery>

UCSApiClient::UCSApiClient(QObject *parent)
    : QObject(parent)
    , _networkManager(new QNetworkAccessManager(this))
    , _autoRefreshTimer(new QTimer(this))
    , _serverUrl("http://localhost:8080")
    , _clientRole(UCSClientRole::Pilot)
{
    connect(_autoRefreshTimer, &QTimer::timeout, this, &UCSApiClient::onAutoRefreshTimeout);
}

UCSApiClient::~UCSApiClient()
{
    stopAutoRefresh();
}

void UCSApiClient::setServerUrl(const QString &url)
{
    _serverUrl = url;
}

void UCSApiClient::setClientRole(UCSClientRole role)
{
    _clientRole = role;
}

QNetworkRequest UCSApiClient::createRequest(const QString &endpoint)
{
    QUrl url(_serverUrl + endpoint);
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    
    if (!_token.isEmpty()) {
        request.setRawHeader("Authorization", ("Bearer " + _token).toUtf8());
    }
    
    return request;
}

void UCSApiClient::login(const QString &username, const QString &password)
{
    QJsonObject body;
    body["username"] = username;
    body["password"] = password;
    
    QNetworkRequest request = createRequest("/api/v1/auth/login");
    QNetworkReply *reply = _networkManager->post(request, QJsonDocument(body).toJson());
    
    connect(reply, &QNetworkReply::finished, this, &UCSApiClient::onLoginReply);
}

void UCSApiClient::onLoginReply()
{
    QNetworkReply *reply = qobject_cast<QNetworkReply*>(sender());
    if (!reply) return;
    
    reply->deleteLater();
    
    if (reply->error() != QNetworkReply::NoError) {
        emit loginFailed(reply->errorString());
        return;
    }
    
    QJsonDocument doc = QJsonDocument::fromJson(reply->readAll());
    QJsonObject response = doc.object();
    
    if (response["code"].toInt() == 0) {
        QJsonObject data = response["data"].toObject();
        _token = data["token"].toString();
        _username = data["username"].toString();
        
        QJsonArray rolesArray = data["roles"].toArray();
        _roles.clear();
        for (const QJsonValue &role : rolesArray) {
            _roles.append(role.toString());
        }
        
        emit loginSuccess(_username, _roles);
        emit connectionStatusChanged(true);
    } else {
        emit loginFailed(response["msg"].toString());
    }
}

void UCSApiClient::logout()
{
    _token.clear();
    _username.clear();
    _roles.clear();
    stopAutoRefresh();
    emit logoutComplete();
    emit connectionStatusChanged(false);
}

void UCSApiClient::fetchDroneList()
{
    if (_token.isEmpty()) {
        emit operationFailed("fetchDroneList", "Not authenticated");
        return;
    }
    
    QString endpoint;
    switch (_clientRole) {
        case UCSClientRole::Pilot:
            endpoint = "/api/v1/pilot/uav/list";
            break;
        case UCSClientRole::Leader:
            endpoint = "/api/v1/leader/uav/list";
            break;
        case UCSClientRole::Commander:
            endpoint = "/api/v1/screen/uav/list";
            break;
    }
    
    QNetworkRequest request = createRequest(endpoint);
    QNetworkReply *reply = _networkManager->get(request);
    connect(reply, &QNetworkReply::finished, this, &UCSApiClient::onDroneListReply);
}

void UCSApiClient::onDroneListReply()
{
    QNetworkReply *reply = qobject_cast<QNetworkReply*>(sender());
    if (!reply) return;
    
    reply->deleteLater();
    
    if (reply->error() != QNetworkReply::NoError) {
        handleNetworkError(reply);
        return;
    }
    
    QJsonDocument doc = QJsonDocument::fromJson(reply->readAll());
    QJsonObject response = doc.object();
    
    if (response["code"].toInt() == 0) {
        QList<DroneStatus> drones;
        QJsonArray dataArray = response["data"].toArray();
        
        for (const QJsonValue &value : dataArray) {
            QJsonObject obj = value.toObject();
            DroneStatus drone;
            drone.uavId = obj["uavId"].toString();
            drone.droneSn = obj["droneSn"].toString();
            drone.lat = obj["lat"].toDouble();
            drone.lng = obj["lng"].toDouble();
            drone.altitude = obj["altitude"].toDouble();
            drone.battery = obj["battery"].toDouble();
            drone.hardwareStatus = obj["hardwareStatus"].toString();
            drone.flightStatus = obj["flightStatus"].toString();
            drone.taskStatus = obj["taskStatus"].toString();
            drone.model = obj["model"].toString();
            drone.owner = obj["owner"].toString();
            drones.append(drone);
        }
        
        emit droneListReceived(drones);
    } else {
        emit operationFailed("fetchDroneList", response["msg"].toString());
    }
}

void UCSApiClient::fetchTaskList()
{
    if (_token.isEmpty()) {
        emit operationFailed("fetchTaskList", "Not authenticated");
        return;
    }
    
    QString endpoint;
    switch (_clientRole) {
        case UCSClientRole::Pilot:
            endpoint = "/api/v1/pilot/task/list";
            break;
        case UCSClientRole::Leader:
            endpoint = "/api/v1/leader/task/list";
            break;
        case UCSClientRole::Commander:
            endpoint = "/api/v1/screen/task/list";
            break;
    }
    
    QNetworkRequest request = createRequest(endpoint);
    QNetworkReply *reply = _networkManager->get(request);
    connect(reply, &QNetworkReply::finished, this, &UCSApiClient::onTaskListReply);
}

void UCSApiClient::onTaskListReply()
{
    QNetworkReply *reply = qobject_cast<QNetworkReply*>(sender());
    if (!reply) return;
    
    reply->deleteLater();
    
    if (reply->error() != QNetworkReply::NoError) {
        handleNetworkError(reply);
        return;
    }
    
    QJsonDocument doc = QJsonDocument::fromJson(reply->readAll());
    QJsonObject response = doc.object();
    
    if (response["code"].toInt() == 0) {
        QList<TaskInfo> tasks;
        QJsonArray dataArray = response["data"].toArray();
        
        for (const QJsonValue &value : dataArray) {
            QJsonObject obj = value.toObject();
            TaskInfo task;
            task.taskId = obj["taskId"].toString();
            task.taskName = obj["taskName"].toString();
            task.taskType = obj["taskType"].toString();
            task.status = obj["status"].toString();
            task.assignedTeam = obj["assignedTeam"].toString();
            tasks.append(task);
        }
        
        emit taskListReceived(tasks);
    } else {
        emit operationFailed("fetchTaskList", response["msg"].toString());
    }
}

void UCSApiClient::fetchTeamList()
{
    if (_token.isEmpty()) {
        emit operationFailed("fetchTeamList", "Not authenticated");
        return;
    }
    
    QNetworkRequest request = createRequest("/api/v1/screen/team/status");
    QNetworkReply *reply = _networkManager->get(request);
    connect(reply, &QNetworkReply::finished, this, &UCSApiClient::onTeamListReply);
}

void UCSApiClient::onTeamListReply()
{
    QNetworkReply *reply = qobject_cast<QNetworkReply*>(sender());
    if (!reply) return;
    
    reply->deleteLater();
    
    if (reply->error() != QNetworkReply::NoError) {
        handleNetworkError(reply);
        return;
    }
    
    QJsonDocument doc = QJsonDocument::fromJson(reply->readAll());
    QJsonObject response = doc.object();
    
    if (response["code"].toInt() == 0) {
        QList<TeamInfo> teams;
        QJsonArray dataArray = response["data"].toArray();
        
        for (const QJsonValue &value : dataArray) {
            QJsonObject obj = value.toObject();
            TeamInfo team;
            team.teamId = obj["teamId"].toString();
            team.teamName = obj["teamName"].toString();
            team.leader = obj["leader"].toString();
            team.memberCount = obj["memberCount"].toInt();
            teams.append(team);
        }
        
        emit teamListReceived(teams);
    } else {
        emit operationFailed("fetchTeamList", response["msg"].toString());
    }
}

void UCSApiClient::fetchWeather()
{
    if (_token.isEmpty()) {
        emit operationFailed("fetchWeather", "Not authenticated");
        return;
    }
    
    QNetworkRequest request = createRequest("/api/v1/screen/weather");
    QNetworkReply *reply = _networkManager->get(request);
    connect(reply, &QNetworkReply::finished, this, &UCSApiClient::onWeatherReply);
}

void UCSApiClient::onWeatherReply()
{
    QNetworkReply *reply = qobject_cast<QNetworkReply*>(sender());
    if (!reply) return;
    
    reply->deleteLater();
    
    if (reply->error() != QNetworkReply::NoError) {
        handleNetworkError(reply);
        return;
    }
    
    QJsonDocument doc = QJsonDocument::fromJson(reply->readAll());
    QJsonObject response = doc.object();
    
    if (response["code"].toInt() == 0) {
        QJsonObject data = response["data"].toObject();
        double temperature = data["temperature"].toDouble();
        double humidity = data["humidity"].toDouble();
        double windSpeed = data["windSpeed"].toDouble();
        QString riskLevel = data["riskLevel"].toString();
        
        emit weatherReceived(temperature, humidity, windSpeed, riskLevel);
    } else {
        emit operationFailed("fetchWeather", response["msg"].toString());
    }
}

void UCSApiClient::updateDroneStatus(const QString &uavId, const DroneStatus &status)
{
    if (_token.isEmpty()) {
        emit operationFailed("updateDroneStatus", "Not authenticated");
        return;
    }
    
    QJsonObject body;
    body["uavId"] = uavId;
    body["lat"] = status.lat;
    body["lng"] = status.lng;
    body["altitude"] = status.altitude;
    body["battery"] = status.battery;
    body["hardwareStatus"] = status.hardwareStatus;
    body["flightStatus"] = status.flightStatus;
    body["taskStatus"] = status.taskStatus;
    
    QNetworkRequest request = createRequest("/api/v1/pilot/uav/status");
    QNetworkReply *reply = _networkManager->post(request, QJsonDocument(body).toJson());
    connect(reply, &QNetworkReply::finished, this, &UCSApiClient::onOperationReply);
}

void UCSApiClient::reportDronePosition(const QString &uavId, double lat, double lng, double alt)
{
    if (_token.isEmpty()) {
        emit operationFailed("reportDronePosition", "Not authenticated");
        return;
    }
    
    QJsonObject body;
    body["uavId"] = uavId;
    body["lat"] = lat;
    body["lng"] = lng;
    body["altitude"] = alt;
    body["timestamp"] = QDateTime::currentDateTime().toString(Qt::ISODate);
    
    QNetworkRequest request = createRequest("/api/v1/pilot/uav/position");
    QNetworkReply *reply = _networkManager->post(request, QJsonDocument(body).toJson());
    connect(reply, &QNetworkReply::finished, this, &UCSApiClient::onOperationReply);
}

void UCSApiClient::assignTask(const QString &taskId, const QString &uavId)
{
    if (_token.isEmpty()) {
        emit operationFailed("assignTask", "Not authenticated");
        return;
    }
    
    if (_clientRole == UCSClientRole::Pilot) {
        emit operationFailed("assignTask", "Insufficient permissions");
        return;
    }
    
    QJsonObject body;
    body["taskId"] = taskId;
    body["uavId"] = uavId;
    
    QNetworkRequest request = createRequest("/api/v1/leader/task/assign");
    QNetworkReply *reply = _networkManager->post(request, QJsonDocument(body).toJson());
    connect(reply, &QNetworkReply::finished, this, &UCSApiClient::onOperationReply);
}

void UCSApiClient::createTask(const TaskInfo &task)
{
    if (_token.isEmpty()) {
        emit operationFailed("createTask", "Not authenticated");
        return;
    }
    
    if (_clientRole == UCSClientRole::Pilot) {
        emit operationFailed("createTask", "Insufficient permissions");
        return;
    }
    
    QJsonObject body;
    body["taskName"] = task.taskName;
    body["taskType"] = task.taskType;
    body["assignedTeam"] = task.assignedTeam;
    
    QNetworkRequest request = createRequest("/api/v1/leader/task/create");
    QNetworkReply *reply = _networkManager->post(request, QJsonDocument(body).toJson());
    connect(reply, &QNetworkReply::finished, this, &UCSApiClient::onOperationReply);
}

void UCSApiClient::updateTaskStatus(const QString &taskId, const QString &status)
{
    if (_token.isEmpty()) {
        emit operationFailed("updateTaskStatus", "Not authenticated");
        return;
    }
    
    QJsonObject body;
    body["taskId"] = taskId;
    body["status"] = status;
    
    QString endpoint = (_clientRole == UCSClientRole::Pilot) 
        ? "/api/v1/pilot/task/status" 
        : "/api/v1/leader/task/status";
    
    QNetworkRequest request = createRequest(endpoint);
    QNetworkReply *reply = _networkManager->post(request, QJsonDocument(body).toJson());
    connect(reply, &QNetworkReply::finished, this, &UCSApiClient::onOperationReply);
}

void UCSApiClient::onOperationReply()
{
    QNetworkReply *reply = qobject_cast<QNetworkReply*>(sender());
    if (!reply) return;
    
    reply->deleteLater();
    
    if (reply->error() != QNetworkReply::NoError) {
        handleNetworkError(reply);
        return;
    }
    
    QJsonDocument doc = QJsonDocument::fromJson(reply->readAll());
    QJsonObject response = doc.object();
    
    if (response["code"].toInt() == 0) {
        emit operationSuccess("Operation completed successfully");
    } else {
        emit operationFailed("operation", response["msg"].toString());
    }
}

void UCSApiClient::startAutoRefresh(int intervalMs)
{
    _autoRefreshTimer->start(intervalMs);
}

void UCSApiClient::stopAutoRefresh()
{
    _autoRefreshTimer->stop();
}

void UCSApiClient::onAutoRefreshTimeout()
{
    if (isAuthenticated()) {
        fetchDroneList();
        fetchTaskList();
    }
}

void UCSApiClient::handleNetworkError(QNetworkReply *reply)
{
    QString errorMsg = reply->errorString();
    int statusCode = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    
    if (statusCode == 401) {
        _token.clear();
        emit connectionStatusChanged(false);
        emit serverError("Authentication expired. Please login again.");
    } else if (statusCode == 403) {
        emit serverError("Access denied. Insufficient permissions.");
    } else {
        emit serverError(QString("Network error: %1").arg(errorMsg));
    }
}
