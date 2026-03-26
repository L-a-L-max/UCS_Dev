/** Shared types for the observer dashboard and related views */

export interface DroneStatus {
  uavId: string;
  droneSn: string;
  lat: number;
  lng: number;
  altitude: number;
  battery: number;
  hardwareStatus: string;
  flightStatus: string;
  taskStatus: string;
  color: string;
  model: string;
  owner: string;
  currentTask?: string;
  teamName?: string;
}

export interface TaskSummary {
  total: number;
  executing: number;
  completed: number;
  abnormal: number;
  pending: number;
}

export interface TeamInfo {
  teamId: string;
  teamName: string;
  leader: string;
  memberCount: number;
}

export interface TeamMember {
  userId: string;
  username: string;
  realName: string;
  role: string;
  teamId: string;
  lat?: number;
  lng?: number;
}

export interface Weather {
  temperature: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  riskLevel: string;
  location: string;
}

export interface Event {
  eventType: string;
  uavId: string;
  level: string;
  time: string;
  message: string;
}

/** Heatmap layer types for multi-select */
export type HeatmapLayerType = 'drone' | 'task' | 'member';
export type FlightStatusType = 'flying' | 'idle';
export type ChartType = 'list' | 'pie' | 'bar';

/** China administrative regions data with center coordinates and zoom levels */
export interface RegionData {
  name: string;
  center: [number, number]; // [lng, lat]
  zoom: number;
  children?: Record<string, RegionData>;
}
