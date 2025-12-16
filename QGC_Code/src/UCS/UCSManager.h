/****************************************************************************
 *
 * (c) 2024 UCS Development Team. All rights reserved.
 *
 * UCS Manager - Manages UCS integration and provides QML interface
 *
 ****************************************************************************/

#pragma once

#include "UCSApiClient.h"
#include <QObject>
#include <QQmlEngine>
#include <QSettings>

/**
 * @brief UCS Manager class - Singleton for managing UCS integration
 */
class UCSManager : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(bool connected READ isConnected NOTIFY connectionChanged)
    Q_PROPERTY(QString username READ username NOTIFY usernameChanged)
    Q_PROPERTY(QString serverUrl READ serverUrl WRITE setServerUrl NOTIFY serverUrlChanged)
    Q_PROPERTY(int clientRole READ clientRoleInt WRITE setClientRoleInt NOTIFY clientRoleChanged)
    Q_PROPERTY(QStringList roles READ roles NOTIFY rolesChanged)

public:
    explicit UCSManager(QObject *parent = nullptr);
    ~UCSManager();

    static UCSManager* instance();
    static void registerQmlTypes();

    bool isConnected() const;
    QString username() const;
    QString serverUrl() const;
    void setServerUrl(const QString &url);
    int clientRoleInt() const;
    void setClientRoleInt(int role);
    QStringList roles() const;

    UCSApiClient* apiClient() { return _apiClient; }

    Q_INVOKABLE void login(const QString &username, const QString &password);
    Q_INVOKABLE void logout();
    Q_INVOKABLE void refreshData();
    Q_INVOKABLE void saveSettings();
    Q_INVOKABLE void loadSettings();

    Q_INVOKABLE bool isPilot() const;
    Q_INVOKABLE bool isLeader() const;
    Q_INVOKABLE bool isCommander() const;
    Q_INVOKABLE bool canAssignTasks() const;
    Q_INVOKABLE bool canCreateTasks() const;
    Q_INVOKABLE bool canViewAllDrones() const;

signals:
    void connectionChanged();
    void usernameChanged();
    void serverUrlChanged();
    void clientRoleChanged();
    void rolesChanged();
    void loginSuccess();
    void loginFailed(const QString &error);
    void logoutComplete();
    void droneListUpdated();
    void taskListUpdated();
    void teamListUpdated();
    void weatherUpdated();
    void errorOccurred(const QString &error);

private slots:
    void onLoginSuccess(const QString &username, const QStringList &roles);
    void onLoginFailed(const QString &error);
    void onConnectionStatusChanged(bool connected);
    void onServerError(const QString &error);

private:
    static UCSManager* _instance;
    UCSApiClient* _apiClient;
    QSettings* _settings;
    bool _connected;
    QString _username;
    QStringList _roles;
};
