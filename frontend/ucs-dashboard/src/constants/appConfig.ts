/** Shared application configuration constants */

export const getApiBase = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return `${window.location.protocol}//${window.location.hostname}:8080`;
  }
  return 'http://localhost:8080';
};

export const API_BASE = getApiBase();

/** Popup auto-close timing constants (watchdog mechanism) */
export const POPUP_DEFAULT_TIMEOUT = 6000; // 6 seconds default
export const POPUP_WATCHDOG_INTERVAL = 3000; // Check every 3 seconds (half of default)

/** Team colors for member markers */
export const TEAM_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#06b6d4', // cyan
];

/** Map tile source configurations */
export type TileSourceKey = 'gaode' | 'osm' | 'carto';

export interface TileSourceConfig {
  name: string;
  tiles: string[];
  attribution: string;
}

/** Gaode (高德) Map - uses backend proxy to handle API key and security key */
export const TILE_SOURCES: Record<TileSourceKey, TileSourceConfig> = {
  gaode: {
    name: '高德地图',
    tiles: [
      `${API_BASE}/api/v1/map/tiles/{z}/{x}/{y}.png?style=7`
    ],
    attribution: '&copy; <a href="https://www.amap.com/">高德地图</a>'
  },
  osm: {
    name: 'OpenStreetMap',
    tiles: [
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
    ],
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  },
  carto: {
    name: 'CartoDB',
    tiles: [
      'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
      'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
      'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'
    ],
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }
};

/** Data refresh intervals (in milliseconds) */
export const REFRESH_INTERVALS = {
  drone: 2000,      // 2 seconds - highest frequency for real-time UAV data
  weather: 30000,   // 30 seconds - weather changes slowly
  team: 10000,      // 10 seconds - team/member data
  task: 5000,       // 5 seconds - task status
  event: 5000,      // 5 seconds - event logs
};
