/**
 * API service for Zenoh control system endpoints.
 * Centralizes all backend API calls for control, permission, and operation log features.
 */

const getApiBase = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return `${window.location.protocol}//${window.location.hostname}:8080`;
  }
  return 'http://localhost:8080';
};

export const API_BASE = getApiBase();

// ==================== Auth ====================

export interface LoginResponse {
  code: number;
  msg: string;
  data: {
    token: string;
    roles: string[];
    userId: number;
    username: string;
  };
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return response.json();
}

// ==================== Types ====================

export interface DroneInfo {
  id: number;
  uavId: string;
  model: string;
  status: string;
  flightStatus: string;
  lat: number;
  lng: number;
  altitude: number;
  battery: number;
  owner: string;
  teamName: string;
  onlineStatus: boolean;
  lastHeartbeat: string;
}

export interface ControlCommandRequest {
  uavId: string;
  commandType: string;
  params: string;
  confirmed: boolean;
}

export interface ControlCommandResponse {
  success: boolean;
  message: string;
  uavId: string;
  commandType: string;
  timestamp: string;
}

export interface BatchControlCommandRequest {
  uavIds: string[];
  commandType: string;
  params: string;
  confirmed: boolean;
}

export interface PermissionTransferRequest {
  uavIds: string[];
  toUserId: number;
  reason: string;
}

export interface OperationLog {
  id: number;
  userId: number;
  username: string;
  operationType: string;
  targetDroneId: number;
  targetUavId: string;
  targetUserId: number;
  detail: string;
  result: string;
  errorMessage: string;
  ipAddress: string;
  createdAt: string;
}

export interface ApiResponse<T> {
  code: number;
  msg: string;
  data: T;
}

export interface PageData<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
}

// ==================== Helper ====================

function authHeaders(token: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

// ==================== Control API ====================

export async function sendControlCommand(
  token: string,
  request: ControlCommandRequest
): Promise<ApiResponse<ControlCommandResponse>> {
  const response = await fetch(`${API_BASE}/api/v1/control/command`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(request),
  });
  return response.json();
}

export async function sendBatchControlCommand(
  token: string,
  request: BatchControlCommandRequest
): Promise<ApiResponse<ControlCommandResponse[]>> {
  const response = await fetch(`${API_BASE}/api/v1/control/batch-command`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(request),
  });
  return response.json();
}

export async function getDroneStatus(
  token: string,
  uavId: string
): Promise<ApiResponse<DroneInfo>> {
  const response = await fetch(`${API_BASE}/api/v1/control/status/${uavId}`, {
    headers: authHeaders(token),
  });
  return response.json();
}

// ==================== Commander API ====================

export async function transferPermission(
  token: string,
  request: PermissionTransferRequest
): Promise<ApiResponse<string>> {
  const response = await fetch(`${API_BASE}/api/v1/commander/permission/transfer`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(request),
  });
  return response.json();
}

export async function getCurrentController(
  token: string,
  uavId: string
): Promise<ApiResponse<string>> {
  const response = await fetch(`${API_BASE}/api/v1/commander/permission/${uavId}`, {
    headers: authHeaders(token),
  });
  return response.json();
}

export async function getFleetOverview(
  token: string
): Promise<ApiResponse<DroneInfo[]>> {
  const response = await fetch(`${API_BASE}/api/v1/commander/fleet/overview`, {
    headers: authHeaders(token),
  });
  return response.json();
}

// ==================== Operation Log API ====================

export async function getOperationLogs(
  token: string,
  page: number = 0,
  size: number = 20
): Promise<ApiResponse<PageData<OperationLog>>> {
  const response = await fetch(
    `${API_BASE}/api/v1/operations/logs?page=${page}&size=${size}`,
    { headers: authHeaders(token) }
  );
  return response.json();
}

export async function getLogsByType(
  token: string,
  type: string,
  page: number = 0,
  size: number = 20
): Promise<ApiResponse<PageData<OperationLog>>> {
  const response = await fetch(
    `${API_BASE}/api/v1/operations/logs/type/${type}?page=${page}&size=${size}`,
    { headers: authHeaders(token) }
  );
  return response.json();
}

export async function getLogsByDrone(
  token: string,
  droneId: number,
  page: number = 0,
  size: number = 20
): Promise<ApiResponse<PageData<OperationLog>>> {
  const response = await fetch(
    `${API_BASE}/api/v1/operations/logs/drone/${droneId}?page=${page}&size=${size}`,
    { headers: authHeaders(token) }
  );
  return response.json();
}

// ==================== Screen/Dashboard API ====================

export async function getDroneList(token: string): Promise<ApiResponse<DroneInfo[]>> {
  const response = await fetch(`${API_BASE}/api/v1/screen/uav/list`, {
    headers: authHeaders(token),
  });
  return response.json();
}

export async function getTeamList(token: string): Promise<ApiResponse<Array<{
  teamId: string;
  teamName: string;
  leader: string;
  memberCount: number;
}>>> {
  const response = await fetch(`${API_BASE}/api/v1/screen/team/list`, {
    headers: authHeaders(token),
  });
  return response.json();
}

export async function getTeamMembers(token: string, teamId: string): Promise<ApiResponse<Array<{
  userId: string;
  username: string;
  realName: string;
  role: string;
  teamId: string;
}>>> {
  const response = await fetch(`${API_BASE}/api/v1/screen/team/${teamId}/members`, {
    headers: authHeaders(token),
  });
  return response.json();
}
