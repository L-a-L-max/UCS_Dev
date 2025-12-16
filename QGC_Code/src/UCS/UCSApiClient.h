/****************************************************************************
 *
 * (c) 2024 UCS Development Team. All rights reserved.
 *
 * UCS API Client - Connects QGC to the UCS Backend Server
 *
 ****************************************************************************/

#pragma once

#include <QObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QString>
#include <QTimer>

/**
 * @brief Client role enumeration for UCS system
 */
enum class UCSClientRole {
    Pilot,      // Team member - basic drone control
    Leader,     // Team leader - team management + drone control
    Commander   // Commander - full system access
};

/**
 * @brief Drone status data structure
 */
struct DroneStatus {
    QString uavId;
    QString droneSn;
    double lat;
    double lng;
    double altitude;
    double battery;
    QString hardwareStatus;
    QString flightStatus;
    QString taskStatus;
    QString model;
    QString owner;
};

/**
 * @brief Task data structure
 */
struct TaskInfo {
    QString taskId;
    QString taskName;
    QString taskType;
    QString status;
    QString assignedTeam;
    QDateTime startTime;
    QDateTime endTime;
};

/**
 * @brief Team data structure
 */
struct TeamInfo {
    QString teamId;
    QString teamName;
    QString leader;
    int memberCount;
};

/**
 * @brief UCS API Client class for backend communication
 */
class UCSApiClient : public QObject
{
    Q_OBJECT

public:
    explicit UCSApiClient(QObject *parent = nullptr);
    ~UCSApiClient();

    // Configuration
    void setServerUrl(const QString &url);
    QString serverUrl() const { return _serverUrl; }
    
    void setClientRole(UCSClientRole role);
    UCSClientRole clientRole() const { return _clientRole; }

    // Authentication
    Q_INVOKABLE void login(const QString &username, const QString &password);
    Q_INVOKABLE void logout();
    bool isAuthenticated() const { return !_token.isEmpty(); }
    QString currentUsername() const { return _username; }

    // Data retrieval
    Q_INVOKABLE void fetchDroneList();
    Q_INVOKABLE void fetchTaskList();
    Q_INVOKABLE void fetchTeamList();
    Q_INVOKABLE void fetchWeather();

    // Pilot operations
    Q_INVOKABLE void updateDroneStatus(const QString &uavId, const DroneStatus &status);
    Q_INVOKABLE void reportDronePosition(const QString &uavId, double lat, double lng, double alt);

    // Leader operations
    Q_INVOKABLE void assignTask(const QString &taskId, const QString &uavId);
    Q_INVOKABLE void createTask(const TaskInfo &task);
    Q_INVOKABLE void updateTaskStatus(const QString &taskId, const QString &status);

    // Auto-refresh
    void startAutoRefresh(int intervalMs = 5000);
    void stopAutoRefresh();

signals:
    // Authentication signals
    void loginSuccess(const QString &username, const QStringList &roles);
    void loginFailed(const QString &error);
    void logoutComplete();

    // Data signals
    void droneListReceived(const QList<DroneStatus> &drones);
    void taskListReceived(const QList<TaskInfo> &tasks);
    void teamListReceived(const QList<TeamInfo> &teams);
    void weatherReceived(double temperature, double humidity, double windSpeed, const QString &riskLevel);

    // Operation signals
    void operationSuccess(const QString &operation);
    void operationFailed(const QString &operation, const QString &error);

    // Connection signals
    void connectionStatusChanged(bool connected);
    void serverError(const QString &error);

private slots:
    void onLoginReply();
    void onDroneListReply();
    void onTaskListReply();
    void onTeamListReply();
    void onWeatherReply();
    void onOperationReply();
    void onAutoRefreshTimeout();

private:
    void sendRequest(const QString &endpoint, const QString &method = "GET", 
                     const QJsonObject &body = QJsonObject());
    QNetworkRequest createRequest(const QString &endpoint);
    void handleNetworkError(QNetworkReply *reply);

    QNetworkAccessManager *_networkManager;
    QTimer *_autoRefreshTimer;
    
    QString _serverUrl;
    QString _token;
    QString _username;
    QStringList _roles;
    UCSClientRole _clientRole;
    
    static const int DEFAULT_TIMEOUT_MS = 30000;
};
