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
    realName: string;
    teamId: number | null;
    teamName: string | null;
    partitions: string[];
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
  teamLeader?: string;
  controlOwnerName?: string;
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

// ==================== Commander Team API ====================

/**
 * Transfer drone control to a team (assigns to team leader).
 * Issue #4: Permission transfer should target teams, not just users.
 */
export async function transferPermissionToTeam(
  token: string,
  uavIds: string[],
  toTeamId: number
): Promise<ApiResponse<{ transferred: string[]; failed: string[]; total: number }>> {
  const response = await fetch(`${API_BASE}/api/v1/commander/permission/transfer-to-team`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ uavIds, toTeamId }),
  });
  return response.json();
}

/**
 * Get all teams with status info (for commander team management).
 * Fixes Issue #2: Commander sees "暂无团队数据".
 */
export async function getCommanderTeams(
  token: string
): Promise<ApiResponse<Array<{
  teamId: string;
  teamName: string;
  leader: string;
  memberCount: number;
  droneCount: number;
  description: string;
}>>> {
  const response = await fetch(`${API_BASE}/api/v1/commander/teams`, {
    headers: authHeaders(token),
  });
  return response.json();
}

// ==================== Leader Team API ====================

/**
 * Get team-scoped operation logs (only team members' logs).
 * Issue #7: Leader needs team-filtered logs.
 */
export async function getLeaderTeamLogs(
  token: string,
  page: number = 0,
  size: number = 10
): Promise<ApiResponse<{
  content: OperationLog[];
  totalElements: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
}>> {
  const response = await fetch(
    `${API_BASE}/api/v1/leader/team/logs?page=${page}&size=${size}`,
    { headers: authHeaders(token) }
  );
  return response.json();
}

/**
 * Transfer drone control within team (leader → team member).
 * Issue #7: Leader needs intra-team drone control transfer.
 */
export async function leaderTransferDrone(
  token: string,
  uavIds: string[],
  toUserId: number,
  reason?: string
): Promise<ApiResponse<{ transferred: string[]; failed: string[]; total: number }>> {
  const response = await fetch(`${API_BASE}/api/v1/leader/uav/transfer`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ uavIds, toUserId, reason }),
  });
  return response.json();
}

/**
 * Get leader's team drones.
 */
export async function getLeaderTeamDrones(
  token: string
): Promise<ApiResponse<Array<{
  uavId: string;
  droneSn: string;
  model: string;
  owner: string;
  flightStatus: string;
  lat: number;
  lng: number;
  altitude: number;
  battery: number;
}>>> {
  const response = await fetch(`${API_BASE}/api/v1/leader/uav/list`, {
    headers: authHeaders(token),
  });
  return response.json();
}

/**
 * Get leader's team members.
 */
export async function getLeaderTeamMembers(
  token: string
): Promise<ApiResponse<Array<{
  userId: string;
  name: string;
  online: boolean;
  role: string;
  uavIds: string[];
  currentTask: string;
}>>> {
  const response = await fetch(`${API_BASE}/api/v1/leader/member/list`, {
    headers: authHeaders(token),
  });
  return response.json();
}

/**
 * Get leader's team info.
 */
export async function getLeaderTeamInfo(
  token: string
): Promise<ApiResponse<{
  teamId: string;
  teamName: string;
  memberCount: number;
  droneCount: number;
  leader: string;
}>> {
  const response = await fetch(`${API_BASE}/api/v1/leader/team/info`, {
    headers: authHeaders(token),
  });
  return response.json();
}

// ==================== Commander Users API ====================

/**
 * Get all registered users for permission transfer dropdown.
 */
export async function getCommanderUsers(
  token: string
): Promise<ApiResponse<Array<{
  userId: number;
  username: string;
  realName: string;
  role: string;
}>>> {
  const response = await fetch(`${API_BASE}/api/v1/commander/users`, {
    headers: authHeaders(token),
  });
  return response.json();
}

// ==================== Rally Point API ====================

export interface RallyPoint {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  city: string | null;
  address: string | null;
  capacity: number;
  currentOccupancy: number;
  status: number; // 0=disabled, 1=enabled, 2=maintenance
  scope: number; // 0=global, 1=team-specific
  teamId: string | null;
  radius: number;
  serviceType: number; // 0=parking, 1=charging, 2=maintenance, 3=supply
  description: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function getRallyPoints(token: string): Promise<ApiResponse<RallyPoint[]>> {
  const response = await fetch(`${API_BASE}/api/v1/rally-points`, {
    headers: authHeaders(token),
  });
  return response.json();
}

export async function getEnabledRallyPoints(token: string): Promise<ApiResponse<RallyPoint[]>> {
  const response = await fetch(`${API_BASE}/api/v1/rally-points/enabled`, {
    headers: authHeaders(token),
  });
  return response.json();
}

export async function getAvailableRallyPoints(token: string): Promise<ApiResponse<RallyPoint[]>> {
  const response = await fetch(`${API_BASE}/api/v1/rally-points/available`, {
    headers: authHeaders(token),
  });
  return response.json();
}

export async function searchRallyPoints(token: string, keyword: string): Promise<ApiResponse<RallyPoint[]>> {
  const response = await fetch(`${API_BASE}/api/v1/rally-points/search?keyword=${encodeURIComponent(keyword)}`, {
    headers: authHeaders(token),
  });
  return response.json();
}

export async function createRallyPoint(token: string, data: Partial<RallyPoint>): Promise<ApiResponse<RallyPoint>> {
  const response = await fetch(`${API_BASE}/api/v1/rally-points`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  return response.json();
}

export async function updateRallyPoint(token: string, id: number, data: Partial<RallyPoint>): Promise<ApiResponse<RallyPoint>> {
  const response = await fetch(`${API_BASE}/api/v1/rally-points/${id}`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  return response.json();
}

export async function deleteRallyPoint(token: string, id: number): Promise<ApiResponse<{ id: number; deleted: boolean }>> {
  const response = await fetch(`${API_BASE}/api/v1/rally-points/${id}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  return response.json();
}

// ==================== Drone Home Position API ====================

/**
 * Get cached Home position for a drone from Redis.
 * Used to sync Home position across PilotView and LeaderView.
 */
export async function getDroneHomePosition(
  token: string,
  uavId: string
): Promise<ApiResponse<{ uavId: string; lat: number; lon: number; alt: number }>> {
  const response = await fetch(`${API_BASE}/api/v1/control/home/${uavId}`, {
    headers: authHeaders(token),
  });
  return response.json();
}

// ==================== Geocoding API ====================

/**
 * Geocode an address string to lat/lon coordinates.
 * Uses AMap (Gaode) Web Service API for reliable geocoding in China.
 * Falls back to Nominatim (OpenStreetMap) if AMap fails.
 */
export async function geocodeAddress(address: string): Promise<{ lat: number; lon: number; displayName: string } | null> {
  // Try AMap geocoding first (more reliable in China)
  try {
    const amapKey = '4ef7e3b945e30d1df3b3bef9c97f4583'; // AMap Web Service key
    const response = await fetch(
      `https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(address)}&output=json&key=${amapKey}`
    );
    const data = await response.json();
    if (data.status === '1' && data.geocodes && data.geocodes.length > 0) {
      const loc = data.geocodes[0].location;
      if (loc && loc.includes(',')) {
        const parts = loc.split(',');
        const lon = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        if (!isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
          return {
            lat,
            lon,
            displayName: data.geocodes[0].formatted_address || address,
          };
        }
      }
    }
  } catch {
    // Fall through to Nominatim
  }
  // Fallback: Nominatim (OpenStreetMap) - works better for international addresses
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&accept-language=zh-CN`,
      { headers: { 'User-Agent': 'UCS-Dashboard/1.0 (drone-management)' } }
    );
    if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
    const results = await response.json();
    if (results && results.length > 0) {
      const lat = parseFloat(results[0].lat);
      const lon = parseFloat(results[0].lon);
      if (!isNaN(lat) && !isNaN(lon)) {
        return {
          lat,
          lon,
          displayName: results[0].display_name,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Reverse geocode lat/lon to address string using AMap.
 */
export async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  try {
    const amapKey = '4ef7e3b945e30d1df3b3bef9c97f4583';
    const response = await fetch(
      `https://restapi.amap.com/v3/geocode/regeo?location=${lon},${lat}&output=json&key=${amapKey}`
    );
    const data = await response.json();
    if (data.status === '1' && data.regeocode && data.regeocode.formatted_address) {
      return data.regeocode.formatted_address;
    }
    return null;
  } catch {
    return null;
  }
}

// ==================== Pilot API ====================

/**
 * Get pilot's authorized drones only.
 * Issue #8: Pilot should only see authorized drones, not all 8.
 */
export async function getPilotDrones(
  token: string
): Promise<ApiResponse<Array<{
  uavId: string;
  droneSn: string;
  model: string;
  owner: string;
  flightStatus: string;
  lat: number;
  lng: number;
  altitude: number;
  battery: number;
}>>> {
  const response = await fetch(`${API_BASE}/api/v1/pilot/uav/list`, {
    headers: authHeaders(token),
  });
  return response.json();
}
