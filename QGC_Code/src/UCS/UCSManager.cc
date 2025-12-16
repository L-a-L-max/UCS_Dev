/****************************************************************************
 *
 * (c) 2024 UCS Development Team. All rights reserved.
 *
 * UCS Manager Implementation
 *
 ****************************************************************************/

#include "UCSManager.h"
#include <QCoreApplication>

UCSManager* UCSManager::_instance = nullptr;

UCSManager::UCSManager(QObject *parent)
    : QObject(parent)
    , _apiClient(new UCSApiClient(this))
    , _settings(new QSettings(QCoreApplication::organizationName(), 
                              QCoreApplication::applicationName(), this))
    , _connected(false)
{
    connect(_apiClient, &UCSApiClient::loginSuccess, this, &UCSManager::onLoginSuccess);
    connect(_apiClient, &UCSApiClient::loginFailed, this, &UCSManager::onLoginFailed);
    connect(_apiClient, &UCSApiClient::connectionStatusChanged, this, &UCSManager::onConnectionStatusChanged);
    connect(_apiClient, &UCSApiClient::serverError, this, &UCSManager::onServerError);
    connect(_apiClient, &UCSApiClient::droneListReceived, this, &UCSManager::droneListUpdated);
    connect(_apiClient, &UCSApiClient::taskListReceived, this, &UCSManager::taskListUpdated);
    connect(_apiClient, &UCSApiClient::teamListReceived, this, &UCSManager::teamListUpdated);
    connect(_apiClient, &UCSApiClient::weatherReceived, this, &UCSManager::weatherUpdated);
    loadSettings();
}

UCSManager::~UCSManager() { saveSettings(); }

UCSManager* UCSManager::instance() {
    if (!_instance) _instance = new UCSManager();
    return _instance;
}

void UCSManager::registerQmlTypes() {
    qmlRegisterSingletonType<UCSManager>("UCS", 1, 0, "UCSManager", 
        [](QQmlEngine*, QJSEngine*) -> QObject* { return UCSManager::instance(); });
}

bool UCSManager::isConnected() const { return _connected; }
QString UCSManager::username() const { return _username; }
QString UCSManager::serverUrl() const { return _apiClient->serverUrl(); }
void UCSManager::setServerUrl(const QString &url) {
    if (_apiClient->serverUrl() != url) { _apiClient->setServerUrl(url); emit serverUrlChanged(); }
}
int UCSManager::clientRoleInt() const { return static_cast<int>(_apiClient->clientRole()); }
void UCSManager::setClientRoleInt(int role) {
    UCSClientRole newRole = static_cast<UCSClientRole>(role);
    if (_apiClient->clientRole() != newRole) { _apiClient->setClientRole(newRole); emit clientRoleChanged(); }
}
QStringList UCSManager::roles() const { return _roles; }

void UCSManager::login(const QString &username, const QString &password) { _apiClient->login(username, password); }
void UCSManager::logout() {
    _apiClient->logout();
    _username.clear(); _roles.clear(); _connected = false;
    emit usernameChanged(); emit rolesChanged(); emit connectionChanged(); emit logoutComplete();
}
void UCSManager::refreshData() {
    if (_connected) { _apiClient->fetchDroneList(); _apiClient->fetchTaskList(); _apiClient->fetchTeamList(); _apiClient->fetchWeather(); }
}
void UCSManager::saveSettings() {
    _settings->beginGroup("UCS");
    _settings->setValue("serverUrl", _apiClient->serverUrl());
    _settings->setValue("clientRole", static_cast<int>(_apiClient->clientRole()));
    _settings->endGroup();
}
void UCSManager::loadSettings() {
    _settings->beginGroup("UCS");
    _apiClient->setServerUrl(_settings->value("serverUrl", "http://localhost:8080").toString());
    _apiClient->setClientRole(static_cast<UCSClientRole>(_settings->value("clientRole", 0).toInt()));
    _settings->endGroup();
}

bool UCSManager::isPilot() const { return _apiClient->clientRole() == UCSClientRole::Pilot; }
bool UCSManager::isLeader() const { return _apiClient->clientRole() == UCSClientRole::Leader; }
bool UCSManager::isCommander() const { return _apiClient->clientRole() == UCSClientRole::Commander; }
bool UCSManager::canAssignTasks() const { return isLeader() || isCommander(); }
bool UCSManager::canCreateTasks() const { return isLeader() || isCommander(); }
bool UCSManager::canViewAllDrones() const { return isCommander(); }

void UCSManager::onLoginSuccess(const QString &username, const QStringList &roles) {
    _username = username; _roles = roles; _connected = true;
    emit usernameChanged(); emit rolesChanged(); emit connectionChanged(); emit loginSuccess();
    _apiClient->startAutoRefresh(5000); refreshData();
}
void UCSManager::onLoginFailed(const QString &error) { _connected = false; emit connectionChanged(); emit loginFailed(error); }
void UCSManager::onConnectionStatusChanged(bool connected) {
    if (_connected != connected) { _connected = connected; emit connectionChanged(); if (!connected) _apiClient->stopAutoRefresh(); }
}
void UCSManager::onServerError(const QString &error) { emit errorOccurred(error); }
