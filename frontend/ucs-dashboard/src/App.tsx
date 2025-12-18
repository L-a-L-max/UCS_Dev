import { useState, useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Plane, 
  Users, 
  ClipboardList, 
  Cloud, 
  AlertTriangle,
  Battery,
  Activity,
  RefreshCw,
  LogIn,
  MapPin,
  Locate,
  Layers,
  Settings,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  PieChart,
  List,
  X,
  Loader2,
  User,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import './App.css';

// Popup auto-close timing constants (watchdog mechanism)
const POPUP_DEFAULT_TIMEOUT = 6000; // 6 seconds default
const POPUP_WATCHDOG_INTERVAL = 3000; // Check every 3 seconds (half of default)

// Drone flight simulation constants
const FLIGHT_SIMULATION_INTERVAL = 100; // Update every 100ms for smooth animation
const BEIJING_CENTER = { lat: 39.9042, lng: 116.4074 }; // Beijing center coordinates

// Pre-defined flight paths for each drone (circular orbits around Beijing)
// Each drone has its own orbit radius and starting angle to prevent collisions
const DRONE_FLIGHT_PATHS = [
  { centerLat: 39.92, centerLng: 116.42, radius: 0.02, speed: 0.5, startAngle: 0 },      // UAV_001
  { centerLat: 39.88, centerLng: 116.38, radius: 0.025, speed: 0.4, startAngle: 45 },    // UAV_002
  { centerLat: 39.95, centerLng: 116.45, radius: 0.018, speed: 0.6, startAngle: 90 },    // UAV_003
  { centerLat: 39.85, centerLng: 116.42, radius: 0.022, speed: 0.45, startAngle: 135 },  // UAV_004
  { centerLat: 39.90, centerLng: 116.35, radius: 0.03, speed: 0.35, startAngle: 180 },   // UAV_005
  { centerLat: 39.93, centerLng: 116.50, radius: 0.02, speed: 0.55, startAngle: 225 },   // UAV_006
  { centerLat: 39.87, centerLng: 116.48, radius: 0.024, speed: 0.42, startAngle: 270 },  // UAV_007
  { centerLat: 39.96, centerLng: 116.38, radius: 0.019, speed: 0.58, startAngle: 315 },  // UAV_008
  { centerLat: 39.82, centerLng: 116.45, radius: 0.026, speed: 0.38, startAngle: 30 },   // UAV_009
  { centerLat: 39.91, centerLng: 116.52, radius: 0.021, speed: 0.48, startAngle: 150 },  // UAV_010
];

// Team colors for member markers
const TEAM_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#06b6d4', // cyan
];

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080';

// Chinese localization dictionary
const zhCN = {
  // Login page
  platformTitle: '无人机综合管控平台',
  username: '用户名',
  password: '密码',
  login: '登录',
  loginHint: '观察员账号: observer / 123456',
  loginFailed: '登录失败',
  connectionFailed: '连接失败',
  observerOnly: '仅观察员角色可访问大屏',
  accessDenied: '访问被拒绝：需要观察员角色',
  
  // Header
  dashboardTitle: '无人机综合管控平台',
  refresh: '刷新',
  logout: '退出',
  
  // Task card
  tasks: '任务态势',
  total: '总计',
  active: '执行中',
  done: '已完成',
  error: '异常',
  pending: '待执行',
  
  // Weather card
  weather: '天气信息',
  location: '位置',
  defaultLocation: '(默认)',
  temperature: '温度',
  humidity: '湿度',
  wind: '风速',
  risk: '飞行风险',
  riskLow: '低',
  riskMedium: '中',
  riskHigh: '高',
  
  // Teams card
  teams: '任务小队',
  leader: '队长',
  
  // Stats card
  stats: '实时统计',
  flying: '飞行中',
  totalUavs: '无人机总数',
  lowBattery: '低电量',
  errors: '异常状态',
  
  // Map controls
  heatmapMode: '热力图',
  heatmapDrone: '无人机',
  heatmapTask: '任务',
  heatmapMember: '成员',
  myLocation: '我的位置',
  focusUavs: '聚焦无人机',
  showWeather: '天气信息',
  
  // Map legend
  flightStatusFilter: '飞行状态',
  flyingStatus: '飞行中',
  idleStatus: '待机',
  clickForDetails: '点击标记查看详情',
  
  // UAV list
  uavList: '无人机列表',
  
  // Events
  events: '事件日志',
  noEvents: '暂无事件',
  
  // Footer
  footerInfo: 'UCS 平台 v1.0',
  locationInfo: '当前位置',
  
  // Drone popup
  model: '型号',
  battery: '电量',
  altitude: '高度',
  status: '状态',
  operator: '操作员',
  task: '当前任务',
  team: '所属小队',
  position: '位置',
  noTask: '无任务',
  
  // Map error
  mapLoadFailed: '地图加载失败',
  mapErrorHint: '请检查网络连接或尝试切换地图源',
  webglNotSupported: '您的浏览器不支持 WebGL，无法显示地图',
  tileLoadFailed: '地图瓦片加载失败',
  networkError: '网络连接异常',
  tryRefresh: '请尝试刷新页面',
  apiKeyNotConfigured: '高德地图 API 密钥未配置',
  apiKeyConfigHint: '请设置环境变量后重启后端服务',
  backendNotReachable: '无法连接后端服务',
  checkBackendHint: '请确保后端服务已启动 (端口 8080)',
  
  // Tile source selector
  tileSource: '地图源',
  tileSourceGaode: '高德地图',
  tileSourceOSM: 'OpenStreetMap',
  tileSourceCarto: 'CartoDB',
  
  // Chart types
  chartList: '列表',
  chartPie: '饼图',
  chartBar: '柱状图',
  
  // Sidebar
  collapseSidebar: '收起侧边栏',
  expandSidebar: '展开侧边栏',
  
  // Team members
  teamMembers: '队员',
  memberName: '姓名',
  memberRole: '角色',
  locating: '定位中...',
  
  // Team visibility filter
  teamMemberFilter: '小队成员显示',
};

// Map tile source configurations
type TileSourceKey = 'gaode' | 'osm' | 'carto';

interface TileSourceConfig {
  name: string;
  tiles: string[];
  attribution: string;
}

// Gaode (高德) Map - uses backend proxy to handle API key and security key
const TILE_SOURCES: Record<TileSourceKey, TileSourceConfig> = {
  gaode: {
    name: '高德地图',
    tiles: [
      // Use backend proxy for Gaode tiles (handles API key + security key)
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

// Heatmap layer types for multi-select
type HeatmapLayerType = 'drone' | 'task' | 'member';
type FlightStatusType = 'flying' | 'idle';
type ChartType = 'list' | 'pie' | 'bar';

// Data refresh intervals (in milliseconds)
const REFRESH_INTERVALS = {
  drone: 2000,      // 2 seconds - highest frequency for real-time UAV data
  weather: 30000,   // 30 seconds - weather changes slowly
  team: 10000,      // 10 seconds - team/member data
  task: 5000,       // 5 seconds - task status
  event: 5000,      // 5 seconds - event logs
};

interface DroneStatus {
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

interface TaskSummary {
  total: number;
  executing: number;
  completed: number;
  abnormal: number;
  pending: number;
}

interface TeamInfo {
  teamId: string;
  teamName: string;
  leader: string;
  memberCount: number;
}

interface TeamMember {
  userId: string;
  username: string;
  realName: string;
  role: string;
  teamId: string;
  lat?: number;
  lng?: number;
}

interface Weather {
  temperature: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  riskLevel: string;
  location: string;
}

interface Event {
  eventType: string;
  uavId: string;
  level: string;
  time: string;
  message: string;
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [userRoles, setUserRoles] = useState<string[]>([]);
  
  const [drones, setDrones] = useState<DroneStatus[]>([]);
  const [taskSummary, setTaskSummary] = useState<TaskSummary | null>(null);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  // Multi-select for heatmap layers (can show multiple at once)
  const [selectedHeatmapLayers, setSelectedHeatmapLayers] = useState<Set<HeatmapLayerType>>(new Set(['drone']));
  // Multi-select for flight status filter (can show both flying and idle)
  const [selectedFlightStatus, setSelectedFlightStatus] = useState<Set<FlightStatusType>>(new Set(['flying', 'idle']));
  const [currentLocation, setCurrentLocation] = useState<{lat: number, lng: number} | null>(null);
  
  // New state for sidebar collapse, chart types, popup persistence, weather overlay
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
  const [showWeatherOverlay, setShowWeatherOverlay] = useState(false);
  const [taskChartType, setTaskChartType] = useState<ChartType>('list');
  const [statsChartType, setStatsChartType] = useState<ChartType>('list');
  const [selectedDroneId, setSelectedDroneId] = useState<string | null>(null);
  
    // New state for UI refinements
    const [isLocating, setIsLocating] = useState(false);
    const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
    const [teamMembers, setTeamMembers] = useState<Record<string, TeamMember[]>>({});
    const [visibleTeamIds, setVisibleTeamIds] = useState<Set<string>>(new Set());
  
    // Collapsible button groups state
    const [heatmapPanelCollapsed, setHeatmapPanelCollapsed] = useState(false);
    const [flightStatusPanelCollapsed, setFlightStatusPanelCollapsed] = useState(false);
  
  // Popup watchdog timer refs
  const popupTimerRef = useRef<NodeJS.Timeout | null>(null);
  const popupWatchdogRef = useRef<NodeJS.Timeout | null>(null);
  const popupDeadlineRef = useRef<number>(0);
  const popupHoveredRef = useRef<boolean>(false);
  const activePopupKeyRef = useRef<string | null>(null);
  
    const memberMarkersRef = useRef<maplibregl.Marker[]>([]);
  
    // Flight simulation refs
    const flightAnglesRef = useRef<number[]>(DRONE_FLIGHT_PATHS.map(path => path.startAngle));
    const flightSimulationRef = useRef<NodeJS.Timeout | null>(null);
  
      const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<maplibregl.Map | null>(null);
    // Use Map for incremental marker updates (key: uavId, value: { marker, popup, element })
    const droneMarkersMapRef = useRef<Map<string, { marker: maplibregl.Marker; popup: maplibregl.Popup; element: HTMLDivElement }>>(new Map());
    const popupRef = useRef<maplibregl.Popup | null>(null);
    // Throttle heatmap updates to reduce performance impact
    const lastHeatmapUpdateRef = useRef<number>(0);
    const HEATMAP_UPDATE_THROTTLE = 500; // Only update heatmap every 500ms
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapErrorDetails, setMapErrorDetails] = useState<string | null>(null);
  const [locationSource, setLocationSource] = useState<'geolocation' | 'default'>('default');
  const [tileSource, setTileSource] = useState<TileSourceKey>('gaode');
  const [showTileSelector, setShowTileSelector] = useState(false);

  const handleLogin = async () => {
    try {
      setError('');
      const response = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      if (data.code === 0) {
        const roles = data.data.roles || [];
        if (!roles.includes('OBSERVER') && !roles.includes('observer')) {
          setError(zhCN.observerOnly);
          return;
        }
        setToken(data.data.token);
        setUserRoles(roles);
        setIsLoggedIn(true);
        localStorage.setItem('token', data.data.token);
        localStorage.setItem('roles', JSON.stringify(roles));
      } else {
        setError(data.msg || zhCN.loginFailed);
      }
    } catch {
      setError(zhCN.connectionFailed);
    }
  };

    // Separate fetch functions with useCallback for different refresh intervals
    // Note: During flight simulation, we merge backend data but preserve simulated lat/lng positions
    const fetchDroneData = useCallback(async () => {
      if (!token) return;
      const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
      try {
        const response = await fetch(`${API_BASE}/api/v1/screen/uav/list`, { headers });
        if (response.status === 403) {
          setError(zhCN.accessDenied); setIsLoggedIn(false);
          localStorage.removeItem('token'); localStorage.removeItem('roles'); return;
        }
        const data = await response.json();
        if (data.code === 0) {
          const newDrones = data.data || [];
          // Merge with existing drones to preserve simulated positions during flight simulation
          setDrones(prevDrones => {
            if (prevDrones.length === 0) {
              // First load - use backend data directly
              return newDrones;
            }
            // Merge: update non-position fields from backend, keep simulated lat/lng
            return newDrones.map(newDrone => {
              const existingDrone = prevDrones.find(d => d.uavId === newDrone.uavId);
              if (existingDrone && flightSimulationRef.current) {
                // During flight simulation, preserve simulated position but update other fields
                return {
                  ...newDrone,
                  lat: existingDrone.lat,
                  lng: existingDrone.lng,
                  flightStatus: existingDrone.flightStatus, // Keep flying status during simulation
                };
              }
              return newDrone;
            });
          });
        }
      } catch (err) { console.error('Failed to fetch drone data:', err); }
    }, [token]);

  const fetchWeatherData = useCallback(async () => {
    if (!token) return;
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    try {
      let weatherUrl = `${API_BASE}/api/v1/screen/weather`;
      if (currentLocation) weatherUrl += `?lat=${currentLocation.lat}&lng=${currentLocation.lng}`;
      const response = await fetch(weatherUrl, { headers });
      const data = await response.json();
      if (data.code === 0) setWeather(data.data);
    } catch (err) { console.error('Failed to fetch weather data:', err); }
  }, [token, currentLocation]);

  const fetchTaskData = useCallback(async () => {
    if (!token) return;
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    try {
      const response = await fetch(`${API_BASE}/api/v1/screen/task/summary`, { headers });
      const data = await response.json();
      if (data.code === 0) setTaskSummary(data.data);
    } catch (err) { console.error('Failed to fetch task data:', err); }
  }, [token]);

  const fetchTeamData = useCallback(async () => {
    if (!token) return;
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    try {
      const response = await fetch(`${API_BASE}/api/v1/screen/team/status`, { headers });
      const data = await response.json();
      if (data.code === 0) setTeams(data.data || []);
    } catch (err) { console.error('Failed to fetch team data:', err); }
  }, [token]);

  const fetchEventData = useCallback(async () => {
    if (!token) return;
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    try {
      const response = await fetch(`${API_BASE}/api/v1/screen/events?limit=10`, { headers });
      const data = await response.json();
      if (data.code === 0) setEvents(data.data || []);
    } catch (err) { console.error('Failed to fetch event data:', err); }
  }, [token]);

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchDroneData(), fetchWeatherData(), fetchTaskData(), fetchTeamData(), fetchEventData()]);
    setLoading(false);
  }, [fetchDroneData, fetchWeatherData, fetchTaskData, fetchTeamData, fetchEventData]);

  const getCurrentLocation = (flyToLocation = true) => {
    if (navigator.geolocation) {
      setIsLocating(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setCurrentLocation({ lat: latitude, lng: longitude });
          setLocationSource('geolocation');
          setIsLocating(false);
          if (flyToLocation && map.current) {
            map.current.flyTo({
              center: [longitude, latitude],
              zoom: 10,
              duration: 2000
            });
          }
        },
        () => {
          // Geolocation failed, use Beijing as default
          setCurrentLocation({ lat: 39.9042, lng: 116.4074 });
          setLocationSource('default');
          setIsLocating(false);
          if (flyToLocation && map.current) {
            map.current.flyTo({
              center: [116.4074, 39.9042],
              zoom: 10,
              duration: 2000
            });
          }
        },
        {
          enableHighAccuracy: false,
          timeout: 5000,
          maximumAge: 60000 // Cache location for 1 minute to avoid cold-start delay
        }
      );
    } else {
      // Geolocation not supported, use Beijing as default
      setCurrentLocation({ lat: 39.9042, lng: 116.4074 });
      setLocationSource('default');
    }
  };
  
  // Pre-warm geolocation on component mount to avoid cold-start delay
  const preWarmGeolocation = useCallback(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        () => {}, // Success - just warming up
        () => {}, // Error - ignore
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
      );
    }
  }, []);

  // Check if Gaode tile proxy is configured
  const checkTileHealth = async (): Promise<{ configured: boolean; message: string }> => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/map/tiles/health`);
      if (!response.ok) {
        return { configured: false, message: zhCN.backendNotReachable };
      }
      const data = await response.json();
      return {
        configured: data.configured === true,
        message: data.message || (data.configured ? '' : zhCN.apiKeyConfigHint)
      };
    } catch {
      return { configured: false, message: zhCN.backendNotReachable };
    }
  };

  const initMap = async (selectedTileSource: TileSourceKey = tileSource) => {
    if (!mapContainer.current) return;

    // Remove existing map if any
    if (map.current) {
      map.current.remove();
      map.current = null;
    }

    // Get tile configuration
    const tileConfig = TILE_SOURCES[selectedTileSource];
    if (!tileConfig.tiles.length) {
      setMapError(zhCN.mapLoadFailed);
      setMapErrorDetails('No tile source configured');
      return;
    }

    // Check tile health for Gaode source
    if (selectedTileSource === 'gaode') {
      const health = await checkTileHealth();
      if (!health.configured) {
        setMapError(zhCN.apiKeyNotConfigured);
        setMapErrorDetails(health.message);
        // Don't return - still try to initialize map, but user will see error
      }
    }

    setMapError(null);
    setMapErrorDetails(null);

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'basemap': {
            type: 'raster',
            tiles: tileConfig.tiles,
            tileSize: 256,
            attribution: tileConfig.attribution
          }
        },
        layers: [{
          id: 'basemap',
          type: 'raster',
          source: 'basemap',
          minzoom: 0,
          maxzoom: 19
        }]
      },
      center: [116.4074, 39.9042],
      zoom: 5,
      minZoom: 2,
      maxZoom: 18
    });

    // Enhanced error handling for map loading
    map.current.on('error', (e) => {
      console.error('Map error:', e);
      const errorMsg = e.error?.message || '';
      const sourceId = (e as { sourceId?: string }).sourceId || '';
      
      if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
        setMapError(zhCN.networkError);
        setMapErrorDetails(`${zhCN.tileLoadFailed}: ${sourceId || 'basemap'}`);
      } else {
        setMapError(zhCN.mapLoadFailed);
        setMapErrorDetails(errorMsg || zhCN.tryRefresh);
      }
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.current.addControl(new maplibregl.ScaleControl(), 'bottom-left');

    map.current.on('load', () => {
      // Force resize to ensure map fills container properly
      // This fixes the issue where MapLibre container has 0 height initially
      requestAnimationFrame(() => {
        map.current?.resize();
      });

      // Add drone heatmap source and layer (blue-cyan gradient)
      map.current?.addSource('heatmap-drone-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.current?.addLayer({
        id: 'heatmap-drone-layer',
        type: 'heatmap',
        source: 'heatmap-drone-source',
        layout: { visibility: 'visible' },
        paint: {
          'heatmap-weight': ['get', 'weight'],
          'heatmap-intensity': 1,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0, 100, 255, 0)',
            0.2, 'rgba(0, 150, 255, 0.4)',
            0.4, 'rgba(0, 200, 255, 0.6)',
            0.6, 'rgba(0, 230, 255, 0.7)',
            0.8, 'rgba(0, 255, 255, 0.8)',
            1, 'rgba(100, 255, 255, 0.9)'
          ],
          'heatmap-radius': 30,
          'heatmap-opacity': 0.7
        }
      });

      // Add task heatmap source and layer (yellow-orange-red gradient)
      map.current?.addSource('heatmap-task-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.current?.addLayer({
        id: 'heatmap-task-layer',
        type: 'heatmap',
        source: 'heatmap-task-source',
        layout: { visibility: 'none' },
        paint: {
          'heatmap-weight': ['get', 'weight'],
          'heatmap-intensity': 1,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(255, 200, 0, 0)',
            0.2, 'rgba(255, 180, 0, 0.4)',
            0.4, 'rgba(255, 150, 0, 0.6)',
            0.6, 'rgba(255, 100, 0, 0.7)',
            0.8, 'rgba(255, 50, 0, 0.8)',
            1, 'rgba(255, 0, 0, 0.9)'
          ],
          'heatmap-radius': 30,
          'heatmap-opacity': 0.7
        }
      });

      // Add member heatmap source and layer (green gradient)
      map.current?.addSource('heatmap-member-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.current?.addLayer({
        id: 'heatmap-member-layer',
        type: 'heatmap',
        source: 'heatmap-member-source',
        layout: { visibility: 'none' },
        paint: {
          'heatmap-weight': ['get', 'weight'],
          'heatmap-intensity': 1,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0, 200, 100, 0)',
            0.2, 'rgba(0, 220, 100, 0.4)',
            0.4, 'rgba(0, 240, 100, 0.6)',
            0.6, 'rgba(50, 255, 100, 0.7)',
            0.8, 'rgba(100, 255, 150, 0.8)',
            1, 'rgba(150, 255, 200, 0.9)'
          ],
          'heatmap-radius': 30,
          'heatmap-opacity': 0.7
        }
      });

      getCurrentLocation();
    });
  };

  const changeTileSource = async (newSource: TileSourceKey) => {
    setTileSource(newSource);
    setShowTileSelector(false);
    await initMap(newSource);
  };

  // Clear all popup timers (watchdog and deadline)
  const clearAllPopupTimers = useCallback(() => {
    if (popupTimerRef.current) {
      clearTimeout(popupTimerRef.current);
      popupTimerRef.current = null;
    }
    if (popupWatchdogRef.current) {
      clearInterval(popupWatchdogRef.current);
      popupWatchdogRef.current = null;
    }
    popupDeadlineRef.current = 0;
    popupHoveredRef.current = false;
  }, []);

  // Close the active popup and clean up
  const closeActivePopup = useCallback(() => {
    clearAllPopupTimers();
    if (popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }
    activePopupKeyRef.current = null;
    setSelectedDroneId(null);
  }, [clearAllPopupTimers]);

  // Start popup watchdog timer mechanism
  // Watchdog checks every POPUP_WATCHDOG_INTERVAL (3s) if mouse is inside popup
  // If inside, reset deadline to now + POPUP_DEFAULT_TIMEOUT (6s)
  // If deadline passed, close popup
  const startPopupWatchdog = useCallback((popupKey: string) => {
    // Clear any existing timers
    clearAllPopupTimers();
    
    // Set initial deadline
    popupDeadlineRef.current = Date.now() + POPUP_DEFAULT_TIMEOUT;
    activePopupKeyRef.current = popupKey;
    
    // Start watchdog interval
    popupWatchdogRef.current = setInterval(() => {
      const now = Date.now();
      const deadline = popupDeadlineRef.current;
      
      // Check if deadline has passed
      if (now >= deadline) {
        closeActivePopup();
        return;
      }
      
      // Check if we're in the last half-window and mouse is hovering
      // If so, extend the deadline
      if (now >= deadline - POPUP_WATCHDOG_INTERVAL && popupHoveredRef.current) {
        popupDeadlineRef.current = now + POPUP_DEFAULT_TIMEOUT;
      }
    }, POPUP_WATCHDOG_INTERVAL);
  }, [clearAllPopupTimers, closeActivePopup]);

  // Attach hover listeners to popup element
  const attachPopupHoverListeners = useCallback((popup: maplibregl.Popup) => {
    popup.on('open', () => {
      const popupElement = popup.getElement();
      if (popupElement) {
        const handleMouseEnter = () => {
          popupHoveredRef.current = true;
          // Immediately extend deadline when mouse enters
          popupDeadlineRef.current = Date.now() + POPUP_DEFAULT_TIMEOUT;
        };
        const handleMouseLeave = () => {
          popupHoveredRef.current = false;
        };
        
        popupElement.addEventListener('mouseenter', handleMouseEnter);
        popupElement.addEventListener('mouseleave', handleMouseLeave);
        
        // Store handlers for cleanup
        (popupElement as any)._hoverHandlers = { handleMouseEnter, handleMouseLeave };
      }
    });
    
    popup.on('close', () => {
      const popupElement = popup.getElement();
      if (popupElement && (popupElement as any)._hoverHandlers) {
        const { handleMouseEnter, handleMouseLeave } = (popupElement as any)._hoverHandlers;
        popupElement.removeEventListener('mouseenter', handleMouseEnter);
        popupElement.removeEventListener('mouseleave', handleMouseLeave);
        delete (popupElement as any)._hoverHandlers;
      }
      clearAllPopupTimers();
      activePopupKeyRef.current = null;
    });
  }, [clearAllPopupTimers]);

  // Legacy function for backward compatibility
  const startPopupTimer = useCallback((timeout: number) => {
    // Use the new watchdog mechanism
    if (activePopupKeyRef.current) {
      popupDeadlineRef.current = Date.now() + timeout;
    }
  }, []);

  // Legacy function for backward compatibility
  const clearPopupTimer = useCallback(() => {
    // Extend deadline when clearing (mouse entered)
    popupDeadlineRef.current = Date.now() + POPUP_DEFAULT_TIMEOUT;
  }, []);

    // Incremental marker update - only update positions, don't recreate markers
    const updateMapMarkers = useCallback(() => {
      if (!map.current) return;

      // Filter drones based on selected flight status
      const filteredDrones = drones.filter(drone => {
        if (!drone.lat || !drone.lng) return false;
        const isFlying = drone.flightStatus === 'FLYING';
        if (isFlying && !selectedFlightStatus.has('flying')) return false;
        if (!isFlying && !selectedFlightStatus.has('idle')) return false;
        return true;
      });

      // Create a set of currently visible drone IDs
      const visibleDroneIds = new Set(filteredDrones.map(d => d.uavId));
    
      // Remove markers for drones that are no longer visible
      droneMarkersMapRef.current.forEach((markerData, uavId) => {
        if (!visibleDroneIds.has(uavId)) {
          markerData.marker.remove();
          droneMarkersMapRef.current.delete(uavId);
        }
      });

      // Update or create markers for visible drones
      filteredDrones.forEach(drone => {
        const existingMarkerData = droneMarkersMapRef.current.get(drone.uavId);
      
        if (existingMarkerData) {
          // INCREMENTAL UPDATE: Just update position, don't recreate marker
          existingMarkerData.marker.setLngLat([drone.lng, drone.lat]);
        
          // Update marker style if flight status changed (less frequent)
          const isFlying = drone.flightStatus === 'FLYING';
          const currentBg = existingMarkerData.element.style.background;
          const expectedBg = isFlying ? 'linear-gradient(135deg, rgb(34, 197, 94) 0%, rgb(22, 163, 74) 100%)' : 'linear-gradient(135deg, rgb(107, 114, 128) 0%, rgb(75, 85, 99) 100%)';
          if (!currentBg.includes(isFlying ? '34, 197, 94' : '107, 114, 128')) {
            existingMarkerData.element.style.background = isFlying ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' : 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)';
            existingMarkerData.element.style.boxShadow = `0 4px 12px rgba(0,0,0,0.4), 0 0 20px ${isFlying ? 'rgba(34, 197, 94, 0.5)' : 'rgba(107, 114, 128, 0.3)'}`;
          }
        } else {
          // CREATE NEW MARKER: Only for drones that don't have a marker yet
          const el = document.createElement('div');
          el.className = 'drone-marker';
          const isFlying = drone.flightStatus === 'FLYING';
          el.style.cssText = `width: 36px; height: 36px; background: ${isFlying ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' : 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)'}; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 12px rgba(0,0,0,0.4), 0 0 20px ${isFlying ? 'rgba(34, 197, 94, 0.5)' : 'rgba(107, 114, 128, 0.3)'}; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.3s ease;`;
          el.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 2L4 12l8 10 8-10L12 2z"/></svg>';

          // Enhanced popup with tech-blue styling (no white border)
          const popup = new maplibregl.Popup({ offset: 25, closeButton: true, closeOnClick: false, className: 'drone-popup tech-blue-popup' }).setHTML(`
            <div class="drone-popup-content" style="padding: 12px; font-family: system-ui, -apple-system, sans-serif; min-width: 220px; background: linear-gradient(135deg, #1e40af 0%, #1e3a8a 50%, #172554 100%); color: white; border-radius: 8px; box-shadow: 0 4px 20px rgba(30, 64, 175, 0.5);">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(96, 165, 250, 0.3);">
                <div style="width: 32px; height: 32px; background: ${isFlying ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'linear-gradient(135deg, #6b7280, #4b5563)'}; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2L4 12l8 10 8-10L12 2z"/></svg>
                </div>
                <div>
                  <h3 style="margin: 0; font-size: 16px; font-weight: bold; color: #93c5fd;">${drone.uavId}</h3>
                  <span style="font-size: 11px; color: ${isFlying ? '#86efac' : '#d1d5db'};">${isFlying ? zhCN.flyingStatus : zhCN.idleStatus}</span>
                </div>
              </div>
              <div style="display: grid; gap: 8px; font-size: 12px;">
                <div style="display: flex; justify-content: space-between;"><span style="color: #93c5fd;">${zhCN.model}</span><span style="font-weight: 500;">${drone.model || 'N/A'}</span></div>
                <div style="display: flex; justify-content: space-between;"><span style="color: #93c5fd;">${zhCN.battery}</span><span style="font-weight: 500; color: ${drone.battery > 50 ? '#86efac' : drone.battery > 20 ? '#fde047' : '#fca5a5'};">${drone.battery?.toFixed(0)}%</span></div>
                <div style="display: flex; justify-content: space-between;"><span style="color: #93c5fd;">${zhCN.altitude}</span><span style="font-weight: 500;">${drone.altitude?.toFixed(0)}m</span></div>
                <div style="display: flex; justify-content: space-between;"><span style="color: #93c5fd;">${zhCN.position}</span><span style="font-weight: 500; font-size: 10px;">${drone.lat?.toFixed(4)}, ${drone.lng?.toFixed(4)}</span></div>
                <div style="display: flex; justify-content: space-between;"><span style="color: #93c5fd;">${zhCN.task}</span><span style="font-weight: 500; color: ${drone.taskStatus === 'EXECUTING' ? '#93c5fd' : '#d1d5db'};">${drone.currentTask || drone.taskStatus || zhCN.noTask}</span></div>
                <div style="display: flex; justify-content: space-between;"><span style="color: #93c5fd;">${zhCN.team}</span><span style="font-weight: 500;">${drone.teamName || drone.owner || 'N/A'}</span></div>
              </div>
            </div>
          `);

          const marker = new maplibregl.Marker({ element: el })
            .setLngLat([drone.lng, drone.lat])
            .setPopup(popup)
            .addTo(map.current!);

          // Store drone.uavId in closure for click handler
          const droneId = drone.uavId;
        
          // Handle popup state persistence with singleton popup management
          el.addEventListener('click', () => {
            const popupKey = `drone:${droneId}`;
          
            // If clicking the same marker that's already open, just reset the timer
            if (activePopupKeyRef.current === popupKey && popupRef.current) {
              popupDeadlineRef.current = Date.now() + POPUP_DEFAULT_TIMEOUT;
              return;
            }
          
            // Close any existing popup before opening new one
            if (popupRef.current) {
              popupRef.current.remove();
            }
          
            setSelectedDroneId(droneId);
            popupRef.current = popup;
          
            // Start watchdog timer with popup key
            startPopupWatchdog(popupKey);
          });

          // Attach hover listeners for watchdog mechanism
          attachPopupHoverListeners(popup);

          popup.on('close', () => {
            // Use ref to check current selected drone (avoid stale closure)
            if (activePopupKeyRef.current === `drone:${droneId}`) {
              setSelectedDroneId(null);
              popupRef.current = null;
            }
          });

          // Store marker data in map for future incremental updates
          droneMarkersMapRef.current.set(drone.uavId, { marker, popup, element: el });

          // Restore popup if this drone was previously selected
          if (activePopupKeyRef.current === `drone:${drone.uavId}`) {
            marker.togglePopup();
            popupRef.current = popup;
          }
        }
      });
    }, [drones, selectedFlightStatus, startPopupWatchdog, attachPopupHoverListeners]);

  // Update heatmap layers based on selected layers (multi-select support)
  const updateHeatmap = () => {
    if (!map.current) return;

    // Update drone heatmap layer
    const droneSource = map.current.getSource('heatmap-drone-source') as maplibregl.GeoJSONSource;
    if (droneSource) {
      const droneFeatures = drones.filter(d => d.lat && d.lng).map(drone => ({
        type: 'Feature' as const,
        properties: { weight: 1 },
        geometry: { type: 'Point' as const, coordinates: [drone.lng, drone.lat] }
      }));
      droneSource.setData({ type: 'FeatureCollection', features: droneFeatures });
      
      // Toggle visibility based on selection
      if (map.current.getLayer('heatmap-drone-layer')) {
        map.current.setLayoutProperty('heatmap-drone-layer', 'visibility', 
          selectedHeatmapLayers.has('drone') ? 'visible' : 'none');
      }
    }

    // Update task heatmap layer
    const taskSource = map.current.getSource('heatmap-task-source') as maplibregl.GeoJSONSource;
    if (taskSource) {
      const taskFeatures = drones.filter(d => d.lat && d.lng && d.taskStatus === 'EXECUTING').map(drone => ({
        type: 'Feature' as const,
        properties: { weight: 2 },
        geometry: { type: 'Point' as const, coordinates: [drone.lng, drone.lat] }
      }));
      taskSource.setData({ type: 'FeatureCollection', features: taskFeatures });
      
      // Toggle visibility based on selection
      if (map.current.getLayer('heatmap-task-layer')) {
        map.current.setLayoutProperty('heatmap-task-layer', 'visibility', 
          selectedHeatmapLayers.has('task') ? 'visible' : 'none');
      }
    }

    // Update member heatmap layer
    const memberSource = map.current.getSource('heatmap-member-source') as maplibregl.GeoJSONSource;
    if (memberSource) {
      const teamLocs: { [key: string]: { lat: number; lng: number; count: number } } = {};
      drones.forEach(drone => {
        if (drone.lat && drone.lng && drone.owner) {
          const key = `${drone.lat.toFixed(2)},${drone.lng.toFixed(2)}`;
          if (!teamLocs[key]) teamLocs[key] = { lat: drone.lat, lng: drone.lng, count: 0 };
          teamLocs[key].count++;
        }
      });
      const memberFeatures = Object.values(teamLocs).map(loc => ({
        type: 'Feature' as const,
        properties: { weight: loc.count },
        geometry: { type: 'Point' as const, coordinates: [loc.lng, loc.lat] }
      }));
      memberSource.setData({ type: 'FeatureCollection', features: memberFeatures });
      
      // Toggle visibility based on selection
      if (map.current.getLayer('heatmap-member-layer')) {
        map.current.setLayoutProperty('heatmap-member-layer', 'visibility', 
          selectedHeatmapLayers.has('member') ? 'visible' : 'none');
      }
    }
  };

  // Toggle heatmap layer selection (multi-select)
  const toggleHeatmapLayer = (layer: HeatmapLayerType) => {
    setSelectedHeatmapLayers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(layer)) {
        newSet.delete(layer);
      } else {
        newSet.add(layer);
      }
      return newSet;
    });
  };

  // Toggle flight status selection (multi-select)
  const toggleFlightStatus = (status: FlightStatusType) => {
    setSelectedFlightStatus(prev => {
      const newSet = new Set(prev);
      if (newSet.has(status)) {
        newSet.delete(status);
      } else {
        newSet.add(status);
      }
      return newSet;
    });
  };

  const focusOnDrones = () => {
    if (!map.current || drones.length === 0) return;
    const validDrones = drones.filter(d => d.lat && d.lng);
    if (validDrones.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();
    validDrones.forEach(drone => bounds.extend([drone.lng, drone.lat]));
    map.current.fitBounds(bounds, { padding: 50, duration: 1500 });
  };

  // Fetch team members when expanding a team
  const fetchTeamMembers = async (teamId: string) => {
    if (!token || teamMembers[teamId]) return;
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    try {
      const response = await fetch(`${API_BASE}/api/v1/screen/team/${teamId}/members`, { headers });
      const data = await response.json();
      if (data.code === 0) {
        setTeamMembers(prev => ({ ...prev, [teamId]: data.data || [] }));
      }
    } catch (err) {
      console.error('Failed to fetch team members:', err);
      // Generate mock members if API not available
      const mockMembers: TeamMember[] = Array.from({ length: 3 }, (_, i) => ({
        userId: `${teamId}-member-${i + 1}`,
        username: `user${i + 1}`,
        realName: `队员${i + 1}`,
        role: i === 0 ? '队长' : '队员',
        teamId,
        lat: 39.9042 + (Math.random() - 0.5) * 0.1,
        lng: 116.4074 + (Math.random() - 0.5) * 0.1
      }));
      setTeamMembers(prev => ({ ...prev, [teamId]: mockMembers }));
    }
  };

  // Toggle team expansion and fetch members
  const toggleTeamExpansion = (teamId: string) => {
    if (expandedTeamId === teamId) {
      setExpandedTeamId(null);
    } else {
      setExpandedTeamId(teamId);
      fetchTeamMembers(teamId);
    }
  };

  // Toggle team member visibility on map
  const toggleTeamVisibility = (teamId: string) => {
    setVisibleTeamIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(teamId)) {
        newSet.delete(teamId);
      } else {
        newSet.add(teamId);
        // Auto-fetch team members if not already loaded
        if (!teamMembers[teamId]) {
          fetchTeamMembers(teamId);
        }
      }
      return newSet;
    });
  };

  // Click on drone in list - fly to and auto-open popup with timer
  const handleDroneListClick = (drone: DroneStatus) => {
    if (!map.current || !drone.lat || !drone.lng) return;
    
    // Fly to drone location
    map.current.flyTo({
      center: [drone.lng, drone.lat],
      zoom: 14,
      duration: 1000
    });
    
    // Set selected drone to trigger popup
    setSelectedDroneId(drone.uavId);
    
    // Start auto-close timer
    startPopupTimer(POPUP_DEFAULT_TIMEOUT);
  };

  // Click on team member - fly to and show popup (with singleton popup management)
  const handleMemberClick = useCallback((member: TeamMember, teamIndex: number) => {
    if (!map.current || !member.lat || !member.lng) return;
    
    const popupKey = `member:${member.userId}`;
    
    // If clicking the same marker that's already open, just reset the timer
    if (activePopupKeyRef.current === popupKey && popupRef.current) {
      popupDeadlineRef.current = Date.now() + POPUP_DEFAULT_TIMEOUT;
      return;
    }
    
    // Close any existing popup before opening new one
    if (popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }
    
    // Fly to member location
    map.current.flyTo({
      center: [member.lng, member.lat],
      zoom: 14,
      duration: 1000
    });
    
    // Create and show member popup
    const teamColor = TEAM_COLORS[teamIndex % TEAM_COLORS.length];
    const popup = new maplibregl.Popup({ 
      offset: 25, 
      closeButton: true, 
      closeOnClick: false,
      className: 'member-popup'
    }).setHTML(`
      <div style="padding: 12px; font-family: system-ui, -apple-system, sans-serif; min-width: 180px; background: linear-gradient(135deg, ${teamColor}dd 0%, ${teamColor}99 100%); color: white; border-radius: 8px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          <div style="width: 32px; height: 32px; background: white; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="${teamColor}"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
          </div>
          <div>
            <h3 style="margin: 0; font-size: 14px; font-weight: bold;">${member.realName || member.username}</h3>
            <span style="font-size: 11px; opacity: 0.9;">${member.role}</span>
          </div>
        </div>
        <div style="font-size: 11px; opacity: 0.8;">
          ${zhCN.position}: ${member.lat?.toFixed(4)}, ${member.lng?.toFixed(4)}
        </div>
      </div>
    `).setLngLat([member.lng, member.lat]).addTo(map.current);
    
    // Store popup reference
    popupRef.current = popup;
    
    // Attach hover listeners for watchdog mechanism
    attachPopupHoverListeners(popup);
    
    // Start watchdog timer with popup key
    startPopupWatchdog(popupKey);
  }, [attachPopupHoverListeners, startPopupWatchdog]);

  // Update member markers on map - only show members from visible teams
  const updateMemberMarkers = useCallback(() => {
    if (!map.current) return;
    
    // Remove existing member markers
    memberMarkersRef.current.forEach(marker => marker.remove());
    memberMarkersRef.current = [];
    
    // Add markers for team members from visible teams only
    Object.entries(teamMembers).forEach(([teamId, members], teamIndex) => {
      // Only show members if their team is in visibleTeamIds
      if (!visibleTeamIds.has(teamId)) return;
      
      members.forEach(member => {
        if (!member.lat || !member.lng) return;
        
        const teamColor = TEAM_COLORS[teamIndex % TEAM_COLORS.length];
        const el = document.createElement('div');
        el.className = 'member-marker';
        el.style.cssText = `width: 28px; height: 28px; background: ${teamColor}; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; cursor: pointer;`;
        el.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
        
        el.addEventListener('click', () => handleMemberClick(member, teamIndex));
        
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([member.lng, member.lat])
          .addTo(map.current!);
        
        memberMarkersRef.current.push(marker);
      });
    });
  }, [teamMembers, visibleTeamIds, handleMemberClick]);

  // Update member markers when teamMembers or visibleTeamIds change
  useEffect(() => {
    updateMemberMarkers();
  }, [teamMembers, visibleTeamIds, updateMemberMarkers]);

  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    const savedRoles = localStorage.getItem('roles');
    if (savedToken && savedRoles) {
      const roles = JSON.parse(savedRoles);
      if (roles.includes('OBSERVER') || roles.includes('observer')) {
        setToken(savedToken);
        setUserRoles(roles);
        setIsLoggedIn(true);
      }
    }
    // Pre-warm geolocation to avoid cold-start delay
    preWarmGeolocation();
  }, [preWarmGeolocation]);

  useEffect(() => {
    if (isLoggedIn) {
      initMap().catch(console.error);
      // Get location on login for weather data
      getCurrentLocation(false);
    }
    return () => { if (map.current) { map.current.remove(); map.current = null; } };
  }, [isLoggedIn]);

  useEffect(() => {
    if (isLoggedIn && token) {
      fetchAllData();
      // Set up separate intervals for different data types
      const droneInterval = setInterval(fetchDroneData, REFRESH_INTERVALS.drone);
      const weatherInterval = setInterval(fetchWeatherData, REFRESH_INTERVALS.weather);
      const taskInterval = setInterval(fetchTaskData, REFRESH_INTERVALS.task);
      const teamInterval = setInterval(fetchTeamData, REFRESH_INTERVALS.team);
      const eventInterval = setInterval(fetchEventData, REFRESH_INTERVALS.event);
      return () => {
        clearInterval(droneInterval);
        clearInterval(weatherInterval);
        clearInterval(taskInterval);
        clearInterval(teamInterval);
        clearInterval(eventInterval);
      };
    }
  }, [isLoggedIn, token, fetchDroneData, fetchWeatherData, fetchTaskData, fetchTeamData, fetchEventData, fetchAllData]);

    useEffect(() => {
      if (map.current && drones.length > 0) {
        updateMapMarkers();
        // Throttle heatmap updates to reduce performance impact during flight simulation
        const now = Date.now();
        if (now - lastHeatmapUpdateRef.current >= HEATMAP_UPDATE_THROTTLE) {
          updateHeatmap();
          lastHeatmapUpdateRef.current = now;
        }
      }
    }, [drones, selectedHeatmapLayers, selectedFlightStatus]);

    // Flight simulation - update drone positions in circular orbits
    useEffect(() => {
      if (!isLoggedIn || drones.length === 0) return;
    
      // Start flight simulation
      flightSimulationRef.current = setInterval(() => {
        setDrones(prevDrones => {
          return prevDrones.map((drone, index) => {
            // Get flight path for this drone (use modulo to handle more drones than paths)
            const pathIndex = index % DRONE_FLIGHT_PATHS.length;
            const path = DRONE_FLIGHT_PATHS[pathIndex];
          
            // Update angle for this drone
            flightAnglesRef.current[pathIndex] += path.speed;
            if (flightAnglesRef.current[pathIndex] >= 360) {
              flightAnglesRef.current[pathIndex] -= 360;
            }
          
            // Calculate new position on circular orbit
            const angleRad = (flightAnglesRef.current[pathIndex] * Math.PI) / 180;
            const newLat = path.centerLat + path.radius * Math.sin(angleRad);
            const newLng = path.centerLng + path.radius * Math.cos(angleRad);
          
            // Return updated drone with new position
            return {
              ...drone,
              lat: newLat,
              lng: newLng,
              flightStatus: 'FLYING', // All drones are flying in simulation
            };
          });
        });
      
        // Update popup position if a drone popup is open
        if (popupRef.current && activePopupKeyRef.current?.startsWith('drone:')) {
          const droneId = activePopupKeyRef.current.replace('drone:', '');
          setDrones(currentDrones => {
            const drone = currentDrones.find(d => d.uavId === droneId);
            if (drone && popupRef.current) {
              popupRef.current.setLngLat([drone.lng, drone.lat]);
              // Update popup content with new position
              const popupContent = `
                <div style="background: linear-gradient(135deg, rgba(30, 58, 138, 0.95), rgba(59, 130, 246, 0.9)); padding: 12px; border-radius: 8px; min-width: 200px; color: white; font-family: system-ui, -apple-system, sans-serif; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 8px;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>
                    <h3 style="margin: 0; font-size: 14px; font-weight: bold;">${drone.uavId}</h3>
                    <span style="margin-left: auto; background: ${drone.flightStatus === 'FLYING' ? '#22c55e' : '#64748b'}; padding: 2px 8px; border-radius: 4px; font-size: 11px;">${drone.flightStatus === 'FLYING' ? '飞行中' : '待机'}</span>
                  </div>
                  <div style="display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 12px;">
                    <span style="opacity: 0.8;">型号</span><span>${drone.model}</span>
                    <span style="opacity: 0.8;">电量</span><span>${drone.battery}%</span>
                    <span style="opacity: 0.8;">高度</span><span>${drone.altitude}m</span>
                    <span style="opacity: 0.8;">位置</span><span>${drone.lat.toFixed(4)}, ${drone.lng.toFixed(4)}</span>
                    <span style="opacity: 0.8;">当前任务</span><span>${drone.taskStatus || 'N/A'}</span>
                    <span style="opacity: 0.8;">所属小队</span><span>${drone.teamName || drone.owner || 'N/A'}</span>
                  </div>
                </div>
              `;
              popupRef.current.setHTML(popupContent);
            }
            return currentDrones;
          });
        }
      }, FLIGHT_SIMULATION_INTERVAL);
    
      return () => {
        if (flightSimulationRef.current) {
          clearInterval(flightSimulationRef.current);
          flightSimulationRef.current = null;
        }
      };
    }, [isLoggedIn, drones.length > 0]);

    // Resize map when sidebars collapse/expand
    useEffect(() => {
      if (map.current) {
        setTimeout(() => { map.current?.resize(); }, 300);
      }
    }, [leftSidebarCollapsed, rightSidebarCollapsed]);

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <Card className="w-96 bg-slate-800 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-center flex items-center justify-center gap-2">
              <Plane className="w-6 h-6" />
              {zhCN.platformTitle}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input placeholder={zhCN.username} value={username} onChange={(e) => setUsername(e.target.value)} className="bg-slate-700 border-slate-600 text-white" />
            <Input type="password" placeholder={zhCN.password} value={password} onChange={(e) => setPassword(e.target.value)} className="bg-slate-700 border-slate-600 text-white" onKeyPress={(e) => e.key === 'Enter' && handleLogin()} />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <Button onClick={handleLogin} className="w-full bg-blue-600 hover:bg-blue-700">
              <LogIn className="w-4 h-4 mr-2" />{zhCN.login}
            </Button>
            <p className="text-slate-400 text-xs text-center">{zhCN.loginHint}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-screen bg-slate-900 text-white flex flex-col overflow-hidden">
      <header className="flex justify-between items-center px-4 py-2 bg-slate-800 border-b border-slate-700">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Plane className="w-6 h-6 text-blue-400" />
          {zhCN.dashboardTitle}
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchAllData} disabled={loading} className="bg-slate-700/50 backdrop-blur-sm border-slate-500/50 text-slate-100 hover:bg-slate-600/50 hover:text-white">
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />{zhCN.refresh}
          </Button>
          <Button variant="outline" size="sm" onClick={() => { localStorage.removeItem('token'); localStorage.removeItem('roles'); setIsLoggedIn(false); setToken(''); }} className="bg-slate-700/50 backdrop-blur-sm border-slate-500/50 text-slate-100 hover:bg-slate-600/50 hover:text-white">{zhCN.logout}</Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <div className={`${leftSidebarCollapsed ? 'w-0 overflow-hidden' : 'w-72'} bg-slate-800 overflow-y-auto p-3 space-y-3 transition-all duration-300`}>
          <Card className="bg-slate-700 border-slate-600">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-sm flex items-center justify-between text-white">
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-blue-400" />{zhCN.tasks}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setTaskChartType('list')} className={`p-1 rounded ${taskChartType === 'list' ? 'bg-blue-600' : 'bg-slate-600 hover:bg-slate-500'}`} title={zhCN.listView}><List className="w-3 h-3" /></button>
                  <button onClick={() => setTaskChartType('pie')} className={`p-1 rounded ${taskChartType === 'pie' ? 'bg-blue-600' : 'bg-slate-600 hover:bg-slate-500'}`} title={zhCN.pieChart}><PieChart className="w-3 h-3" /></button>
                  <button onClick={() => setTaskChartType('bar')} className={`p-1 rounded ${taskChartType === 'bar' ? 'bg-blue-600' : 'bg-slate-600 hover:bg-slate-500'}`} title={zhCN.barChart}><BarChart3 className="w-3 h-3" /></button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              {taskSummary && taskChartType === 'list' && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-600 p-2 rounded text-center">
                    <div className="text-lg font-bold text-blue-400">{taskSummary.total}</div>
                    <div className="text-xs text-slate-400">{zhCN.total}</div>
                  </div>
                  <div className="bg-slate-600 p-2 rounded text-center">
                    <div className="text-lg font-bold text-green-400">{taskSummary.executing}</div>
                    <div className="text-xs text-slate-400">{zhCN.active}</div>
                  </div>
                  <div className="bg-slate-600 p-2 rounded text-center">
                    <div className="text-lg font-bold text-slate-300">{taskSummary.completed}</div>
                    <div className="text-xs text-slate-400">{zhCN.done}</div>
                  </div>
                  <div className="bg-slate-600 p-2 rounded text-center">
                    <div className="text-lg font-bold text-red-400">{taskSummary.abnormal}</div>
                    <div className="text-xs text-slate-400">{zhCN.error}</div>
                  </div>
                </div>
              )}
              {taskSummary && taskChartType === 'pie' && (
                <div className="flex items-center justify-center py-2">
                  <svg viewBox="0 0 100 100" className="w-32 h-32">
                    {(() => {
                      const total = taskSummary.executing + taskSummary.completed + taskSummary.abnormal;
                      if (total === 0) return <circle cx="50" cy="50" r="40" fill="#475569" />;
                      const executingAngle = (taskSummary.executing / total) * 360;
                      const completedAngle = (taskSummary.completed / total) * 360;
                      const abnormalAngle = (taskSummary.abnormal / total) * 360;
                      let currentAngle = 0;
                      const createArc = (angle: number, color: string) => {
                        if (angle === 0) return null;
                        const startAngle = currentAngle;
                        const endAngle = currentAngle + angle;
                        currentAngle = endAngle;
                        const startRad = (startAngle - 90) * Math.PI / 180;
                        const endRad = (endAngle - 90) * Math.PI / 180;
                        const x1 = 50 + 40 * Math.cos(startRad);
                        const y1 = 50 + 40 * Math.sin(startRad);
                        const x2 = 50 + 40 * Math.cos(endRad);
                        const y2 = 50 + 40 * Math.sin(endRad);
                        const largeArc = angle > 180 ? 1 : 0;
                        return <path d={`M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z`} fill={color} />;
                      };
                      return (
                        <>
                          {createArc(executingAngle, '#22c55e')}
                          {createArc(completedAngle, '#94a3b8')}
                          {createArc(abnormalAngle, '#ef4444')}
                        </>
                      );
                    })()}
                  </svg>
                  <div className="ml-3 space-y-1 text-xs">
                    <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-green-500"></div>{zhCN.active}: {taskSummary.executing}</div>
                    <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-slate-400"></div>{zhCN.done}: {taskSummary.completed}</div>
                    <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-red-500"></div>{zhCN.error}: {taskSummary.abnormal}</div>
                  </div>
                </div>
              )}
              {taskSummary && taskChartType === 'bar' && (
                <div className="space-y-2 py-2">
                  {(() => {
                    const max = Math.max(taskSummary.executing, taskSummary.completed, taskSummary.abnormal, 1);
                    return (
                      <>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="w-12 text-slate-400">{zhCN.active}</span>
                          <div className="flex-1 bg-slate-600 rounded h-4 overflow-hidden">
                            <div className="h-full bg-green-500 transition-all duration-500" style={{ width: `${(taskSummary.executing / max) * 100}%` }}></div>
                          </div>
                          <span className="w-6 text-right">{taskSummary.executing}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="w-12 text-slate-400">{zhCN.done}</span>
                          <div className="flex-1 bg-slate-600 rounded h-4 overflow-hidden">
                            <div className="h-full bg-slate-400 transition-all duration-500" style={{ width: `${(taskSummary.completed / max) * 100}%` }}></div>
                          </div>
                          <span className="w-6 text-right">{taskSummary.completed}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="w-12 text-slate-400">{zhCN.error}</span>
                          <div className="flex-1 bg-slate-600 rounded h-4 overflow-hidden">
                            <div className="h-full bg-red-500 transition-all duration-500" style={{ width: `${(taskSummary.abnormal / max) * 100}%` }}></div>
                          </div>
                          <span className="w-6 text-right">{taskSummary.abnormal}</span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-slate-700 border-slate-600">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-sm flex items-center gap-2 text-white">
                <Cloud className="w-4 h-4 text-blue-400" />{zhCN.weather}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              {weather && (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-slate-400">{zhCN.location}</span><span>{weather.location || '北京'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">{zhCN.temperature}</span><span className="text-lg font-bold">{weather.temperature?.toFixed(1)}°C</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">{zhCN.humidity}</span><span>{weather.humidity?.toFixed(0)}%</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">{zhCN.wind}</span><span>{weather.windSpeed?.toFixed(1)} m/s</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">{zhCN.risk}</span>
                    <Badge variant={weather.riskLevel === 'LOW' ? 'default' : weather.riskLevel === 'MEDIUM' ? 'secondary' : 'destructive'}>
                      {weather.riskLevel === 'LOW' ? zhCN.riskLow : weather.riskLevel === 'MEDIUM' ? zhCN.riskMedium : zhCN.riskHigh}
                    </Badge>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-slate-700 border-slate-600">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-sm flex items-center justify-between text-white">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-400" />{zhCN.stats}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setStatsChartType('list')} className={`p-1 rounded ${statsChartType === 'list' ? 'bg-blue-600' : 'bg-slate-600 hover:bg-slate-500'}`} title={zhCN.listView}><List className="w-3 h-3" /></button>
                  <button onClick={() => setStatsChartType('pie')} className={`p-1 rounded ${statsChartType === 'pie' ? 'bg-blue-600' : 'bg-slate-600 hover:bg-slate-500'}`} title={zhCN.pieChart}><PieChart className="w-3 h-3" /></button>
                  <button onClick={() => setStatsChartType('bar')} className={`p-1 rounded ${statsChartType === 'bar' ? 'bg-blue-600' : 'bg-slate-600 hover:bg-slate-500'}`} title={zhCN.barChart}><BarChart3 className="w-3 h-3" /></button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              {statsChartType === 'list' && (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-slate-400">{zhCN.flying}</span><span className="font-bold text-green-400">{drones.filter(d => d.flightStatus === 'FLYING').length}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">{zhCN.totalUavs}</span><span className="font-bold">{drones.length}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">{zhCN.lowBattery}</span><span className="font-bold text-yellow-400">{drones.filter(d => d.battery < 30).length}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">{zhCN.errors}</span><span className="font-bold text-red-400">{drones.filter(d => d.hardwareStatus !== 'NORMAL').length}</span></div>
                </div>
              )}
              {statsChartType === 'pie' && (
                <div className="flex items-center justify-center py-2">
                  <svg viewBox="0 0 100 100" className="w-32 h-32">
                    {(() => {
                      const flyingCount = drones.filter(d => d.flightStatus === 'FLYING').length;
                      const idleCount = drones.filter(d => d.flightStatus !== 'FLYING').length;
                      const total = flyingCount + idleCount;
                      if (total === 0) return <circle cx="50" cy="50" r="40" fill="#475569" />;
                      const flyingAngle = (flyingCount / total) * 360;
                      const idleAngle = (idleCount / total) * 360;
                      let currentAngle = 0;
                      const createArc = (angle: number, color: string) => {
                        if (angle === 0) return null;
                        const startAngle = currentAngle;
                        const endAngle = currentAngle + angle;
                        currentAngle = endAngle;
                        const startRad = (startAngle - 90) * Math.PI / 180;
                        const endRad = (endAngle - 90) * Math.PI / 180;
                        const x1 = 50 + 40 * Math.cos(startRad);
                        const y1 = 50 + 40 * Math.sin(startRad);
                        const x2 = 50 + 40 * Math.cos(endRad);
                        const y2 = 50 + 40 * Math.sin(endRad);
                        const largeArc = angle > 180 ? 1 : 0;
                        return <path d={`M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z`} fill={color} />;
                      };
                      return (
                        <>
                          {createArc(flyingAngle, '#22c55e')}
                          {createArc(idleAngle, '#6b7280')}
                        </>
                      );
                    })()}
                  </svg>
                  <div className="ml-3 space-y-1 text-xs">
                    <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-green-500"></div>{zhCN.flying}: {drones.filter(d => d.flightStatus === 'FLYING').length}</div>
                    <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-gray-500"></div>{zhCN.idleStatus}: {drones.filter(d => d.flightStatus !== 'FLYING').length}</div>
                  </div>
                </div>
              )}
              {statsChartType === 'bar' && (
                <div className="space-y-2 py-2">
                  {(() => {
                    const flyingCount = drones.filter(d => d.flightStatus === 'FLYING').length;
                    const lowBatteryCount = drones.filter(d => d.battery < 30).length;
                    const errorCount = drones.filter(d => d.hardwareStatus !== 'NORMAL').length;
                    const max = Math.max(drones.length, flyingCount, lowBatteryCount, errorCount, 1);
                    return (
                      <>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="w-12 text-slate-400">{zhCN.flying}</span>
                          <div className="flex-1 bg-slate-600 rounded h-4 overflow-hidden">
                            <div className="h-full bg-green-500 transition-all duration-500" style={{ width: `${(flyingCount / max) * 100}%` }}></div>
                          </div>
                          <span className="w-6 text-right">{flyingCount}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="w-12 text-slate-400">{zhCN.totalUavs}</span>
                          <div className="flex-1 bg-slate-600 rounded h-4 overflow-hidden">
                            <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${(drones.length / max) * 100}%` }}></div>
                          </div>
                          <span className="w-6 text-right">{drones.length}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="w-12 text-slate-400">{zhCN.lowBattery}</span>
                          <div className="flex-1 bg-slate-600 rounded h-4 overflow-hidden">
                            <div className="h-full bg-yellow-500 transition-all duration-500" style={{ width: `${(lowBatteryCount / max) * 100}%` }}></div>
                          </div>
                          <span className="w-6 text-right">{lowBatteryCount}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="w-12 text-slate-400">{zhCN.errors}</span>
                          <div className="flex-1 bg-slate-600 rounded h-4 overflow-hidden">
                            <div className="h-full bg-red-500 transition-all duration-500" style={{ width: `${(errorCount / max) * 100}%` }}></div>
                          </div>
                          <span className="w-6 text-right">{errorCount}</span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Left Sidebar Collapse Button - On Boundary Line */}
        <div className="w-3 flex-shrink-0 relative bg-slate-700/30 flex items-center justify-center cursor-pointer hover:bg-slate-600/50 transition-colors" onClick={() => setLeftSidebarCollapsed(!leftSidebarCollapsed)}>
          <button
            className="absolute z-20 bg-slate-700/90 hover:bg-slate-600 text-white p-1 rounded-full transition-all duration-300 shadow-lg backdrop-blur-sm border border-slate-600/50"
            title={leftSidebarCollapsed ? zhCN.expandSidebar : zhCN.collapseSidebar}
          >
            {leftSidebarCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
          </button>
        </div>

        <div className="flex-1 relative">
          <div ref={mapContainer} className="absolute inset-0 w-full h-full" style={{ minHeight: '100%' }} />
          
          {mapError && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 z-20">
              <div className="bg-slate-800 p-4 rounded-lg text-center max-w-md">
                <AlertTriangle className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
                <p className="text-white mb-2">{mapError}</p>
                {mapErrorDetails && <p className="text-slate-400 text-xs mb-2">{mapErrorDetails}</p>}
                <p className="text-slate-400 text-sm mb-3">{zhCN.mapErrorHint}</p>
                <div className="flex gap-2 justify-center">
                  <Button size="sm" onClick={() => initMap().catch(console.error)} className="bg-blue-600 hover:bg-blue-700">{zhCN.tryRefresh}</Button>
                  <Button size="sm" variant="outline" onClick={() => setShowTileSelector(true)} className="border-slate-600 text-slate-200">
                    <Settings className="w-3 h-3 mr-1" />{zhCN.tileSource}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {showTileSelector && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 z-30">
              <div className="bg-slate-800 p-4 rounded-lg max-w-sm">
                <h3 className="text-white font-bold mb-3">{zhCN.tileSource}</h3>
                <div className="space-y-2">
                  <Button size="sm" onClick={() => changeTileSource('gaode')} className={`w-full justify-start ${tileSource === 'gaode' ? 'bg-blue-600' : 'bg-slate-700'}`}>
                    {zhCN.tileSourceGaode}
                  </Button>
                  <Button size="sm" onClick={() => changeTileSource('osm')} className={`w-full justify-start ${tileSource === 'osm' ? 'bg-blue-600' : 'bg-slate-700'}`}>
                    {zhCN.tileSourceOSM}
                  </Button>
                  <Button size="sm" onClick={() => changeTileSource('carto')} className={`w-full justify-start ${tileSource === 'carto' ? 'bg-blue-600' : 'bg-slate-700'}`}>
                    {zhCN.tileSourceCarto}
                  </Button>
                </div>
                <p className="text-slate-400 text-xs mt-3">
                  推荐使用高德地图（国内网络访问更稳定）
                </p>
                <Button size="sm" variant="outline" onClick={() => setShowTileSelector(false)} className="w-full mt-3 border-slate-600 text-slate-200">
                  关闭
                </Button>
              </div>
            </div>
          )}
          
                    {/* Heatmap Controls - Top Center with Collapse Button */}
                    <div className={`absolute left-1/2 -translate-x-1/2 z-10 bg-slate-800/80 backdrop-blur-sm rounded-lg border border-slate-600/50 transition-all duration-300 ${heatmapPanelCollapsed ? 'top-0 -translate-y-full opacity-0 pointer-events-none' : 'top-3'}`}>
                      <div className="p-2 space-y-2">
                        <div className="flex items-center gap-1 text-xs text-slate-200 mb-1">
                          <Layers className="w-3 h-3" />{zhCN.heatmapMode}
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant={selectedHeatmapLayers.has('drone') ? 'default' : 'outline'} onClick={() => toggleHeatmapLayer('drone')} className={`text-xs px-2 py-1 h-7 ${selectedHeatmapLayers.has('drone') ? 'bg-blue-600 text-white' : 'bg-slate-700/50 backdrop-blur-sm border-slate-500/50 text-slate-100 hover:bg-slate-600/50'}`}>{zhCN.heatmapDrone}</Button>
                          <Button size="sm" variant={selectedHeatmapLayers.has('task') ? 'default' : 'outline'} onClick={() => toggleHeatmapLayer('task')} className={`text-xs px-2 py-1 h-7 ${selectedHeatmapLayers.has('task') ? 'bg-orange-600 text-white' : 'bg-slate-700/50 backdrop-blur-sm border-slate-500/50 text-slate-100 hover:bg-slate-600/50'}`}>{zhCN.heatmapTask}</Button>
                          <Button size="sm" variant={selectedHeatmapLayers.has('member') ? 'default' : 'outline'} onClick={() => toggleHeatmapLayer('member')} className={`text-xs px-2 py-1 h-7 ${selectedHeatmapLayers.has('member') ? 'bg-green-600 text-white' : 'bg-slate-700/50 backdrop-blur-sm border-slate-500/50 text-slate-100 hover:bg-slate-600/50'}`}>{zhCN.heatmapMember}</Button>
                        </div>
                      </div>
                      {/* Collapse button - bottom center of panel */}
                      <button
                        onClick={() => setHeatmapPanelCollapsed(true)}
                        className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-slate-700/90 hover:bg-slate-600 text-white p-1 rounded-full transition-all duration-300 shadow-lg backdrop-blur-sm border border-slate-600/50"
                        title="收起热力图面板"
                      >
                        <ChevronUp className="w-3 h-3" />
                      </button>
                    </div>
                    {/* Heatmap Panel Expand Button - shown when collapsed */}
                    {heatmapPanelCollapsed && (
                      <button
                        onClick={() => setHeatmapPanelCollapsed(false)}
                        className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-slate-800/80 backdrop-blur-sm hover:bg-slate-700 text-white px-3 py-1 rounded-lg transition-all duration-300 shadow-lg border border-slate-600/50 flex items-center gap-1 text-xs"
                        title="展开热力图面板"
                      >
                        <Layers className="w-3 h-3" />
                        <ChevronDown className="w-3 h-3" />
                      </button>
                    )}

          <div className="absolute top-3 right-14 z-10 flex flex-col gap-1">
            <Button size="sm" variant="outline" onClick={() => getCurrentLocation()} disabled={isLocating} className="bg-slate-700/50 backdrop-blur-sm border-slate-500/50 text-slate-100 hover:bg-slate-600/50 h-8 w-8 p-0" title={isLocating ? zhCN.locating : zhCN.myLocation}>
              {isLocating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Locate className="w-4 h-4" />}
            </Button>
            <Button size="sm" variant="outline" onClick={focusOnDrones} className="bg-slate-700/50 backdrop-blur-sm border-slate-500/50 text-slate-100 hover:bg-slate-600/50 h-8 w-8 p-0" title={zhCN.focusUavs}><MapPin className="w-4 h-4" /></Button>
            <Button size="sm" variant="outline" onClick={() => setShowTileSelector(true)} className="bg-slate-700/50 backdrop-blur-sm border-slate-500/50 text-slate-100 hover:bg-slate-600/50 h-8 w-8 p-0" title={zhCN.tileSource}><Settings className="w-4 h-4" /></Button>
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => setShowWeatherOverlay(!showWeatherOverlay)} 
              className={`h-8 w-8 p-0 transition-all duration-300 ${showWeatherOverlay ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/50' : 'bg-slate-700/50 backdrop-blur-sm border-slate-500/50 text-slate-100 hover:bg-slate-600/50'}`}
              title={zhCN.weather}
            >
              <Cloud className="w-4 h-4" />
            </Button>
          </div>

          {/* Weather Overlay - Docked Vertical Panel on Left Side */}
          {showWeatherOverlay && weather && (
            <div className="absolute top-3 left-3 z-10 bg-slate-800/80 backdrop-blur-md rounded-lg p-3 w-48 shadow-xl border border-slate-600/50 animate-in fade-in slide-in-from-left-2 duration-300">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-md flex items-center justify-center">
                    <Cloud className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-sm font-semibold text-white">{zhCN.weather}</span>
                </div>
                <button onClick={() => setShowWeatherOverlay(false)} className="text-slate-400 hover:text-white transition-colors p-0.5">
                  <X className="w-3 h-3" />
                </button>
              </div>
              
              {/* Location */}
              <div className="text-xs text-slate-400 mb-1">{zhCN.location}: {weather.location || '北京'}</div>
              
              {/* Temperature - Large Display */}
              <div className="text-center py-2 border-b border-slate-600/50 mb-2">
                <div className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                  {weather.temperature?.toFixed(1)}°C
                </div>
              </div>
              
              {/* Weather Details - Vertical Stack */}
              <div className="space-y-2">
                <div className="bg-slate-700/50 rounded-md p-2 flex items-center justify-between">
                  <span className="text-xs text-slate-400">{zhCN.humidity}</span>
                  <span className="text-sm font-semibold text-white">{weather.humidity?.toFixed(0)}%</span>
                </div>
                <div className="bg-slate-700/50 rounded-md p-2 flex items-center justify-between">
                  <span className="text-xs text-slate-400">{zhCN.wind}</span>
                  <span className="text-sm font-semibold text-white">{weather.windSpeed?.toFixed(1)} m/s</span>
                </div>
                <div className="bg-slate-700/50 rounded-md p-2 flex items-center justify-between">
                  <span className="text-xs text-slate-400">{zhCN.risk}</span>
                  <Badge 
                    variant={weather.riskLevel === 'LOW' ? 'default' : weather.riskLevel === 'MEDIUM' ? 'secondary' : 'destructive'}
                    className={`text-xs ${weather.riskLevel === 'LOW' ? 'bg-green-600' : weather.riskLevel === 'MEDIUM' ? 'bg-yellow-600' : 'bg-red-600'}`}
                  >
                    {weather.riskLevel === 'LOW' ? zhCN.riskLow : weather.riskLevel === 'MEDIUM' ? zhCN.riskMedium : zhCN.riskHigh}
                  </Badge>
                </div>
              </div>
            </div>
          )}

                    {/* Flight Status Filter - Bottom Left with Collapse Button */}
                    <div className={`absolute left-3 z-10 bg-slate-800/80 backdrop-blur-sm rounded-lg max-w-xs border border-slate-600/50 transition-all duration-300 ${flightStatusPanelCollapsed ? 'bottom-0 translate-y-full opacity-0 pointer-events-none' : 'bottom-3'}`}>
                      {/* Collapse button - top center of panel */}
                      <button
                        onClick={() => setFlightStatusPanelCollapsed(true)}
                        className="absolute -top-3 left-1/2 -translate-x-1/2 bg-slate-700/90 hover:bg-slate-600 text-white p-1 rounded-full transition-all duration-300 shadow-lg backdrop-blur-sm border border-slate-600/50"
                        title="收起飞行状态面板"
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                      <div className="p-2">
                        <div className="flex items-center gap-1 text-xs text-slate-300 mb-1">
                          {zhCN.flightStatusFilter}
                        </div>
                        <div className="flex items-center gap-2 text-xs mb-2">
                          <Button size="sm" variant={selectedFlightStatus.has('flying') ? 'default' : 'outline'} onClick={() => toggleFlightStatus('flying')} className={`text-xs px-2 py-1 h-6 flex items-center gap-1 ${selectedFlightStatus.has('flying') ? 'bg-green-600 text-white' : 'bg-slate-700/50 backdrop-blur-sm border-slate-500/50 text-slate-100 hover:bg-slate-600/50'}`}>
                            <div className="w-2 h-2 rounded-full bg-green-400"></div>{zhCN.flyingStatus}
                          </Button>
                          <Button size="sm" variant={selectedFlightStatus.has('idle') ? 'default' : 'outline'} onClick={() => toggleFlightStatus('idle')} className={`text-xs px-2 py-1 h-6 flex items-center gap-1 ${selectedFlightStatus.has('idle') ? 'bg-gray-600 text-white' : 'bg-slate-700/50 backdrop-blur-sm border-slate-500/50 text-slate-100 hover:bg-slate-600/50'}`}>
                            <div className="w-2 h-2 rounded-full bg-gray-400"></div>{zhCN.idleStatus}
                          </Button>
                        </div>
              
                        {/* Team Member Visibility Filter */}
                        {teams.length > 0 && (
                          <>
                            <div className="flex items-center gap-1 text-xs text-slate-300 mb-1 mt-2 pt-2 border-t border-slate-600/50">
                              <Users className="w-3 h-3" />{zhCN.teamMemberFilter}
                            </div>
                            <div className="flex flex-wrap items-center gap-1 text-xs">
                              {teams.map((team, teamIndex) => (
                                <Button 
                                  key={team.teamId}
                                  size="sm" 
                                  variant={visibleTeamIds.has(team.teamId) ? 'default' : 'outline'} 
                                  onClick={() => toggleTeamVisibility(team.teamId)} 
                                  className={`text-xs px-2 py-1 h-6 flex items-center gap-1 ${visibleTeamIds.has(team.teamId) ? 'text-white' : 'bg-slate-700/50 backdrop-blur-sm border-slate-500/50 text-slate-100 hover:bg-slate-600/50'}`}
                                  style={{ backgroundColor: visibleTeamIds.has(team.teamId) ? TEAM_COLORS[teamIndex % TEAM_COLORS.length] : undefined }}
                                >
                                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: TEAM_COLORS[teamIndex % TEAM_COLORS.length] }}></div>
                                  {team.teamName}
                                </Button>
                              ))}
                            </div>
                          </>
                        )}
              
                        <div className="text-xs text-slate-400 mt-2">{zhCN.clickForDetails}</div>
                      </div>
                    </div>
                    {/* Flight Status Panel Expand Button - shown when collapsed */}
                    {flightStatusPanelCollapsed && (
                      <button
                        onClick={() => setFlightStatusPanelCollapsed(false)}
                        className="absolute bottom-3 left-3 z-10 bg-slate-800/80 backdrop-blur-sm hover:bg-slate-700 text-white px-3 py-1 rounded-lg transition-all duration-300 shadow-lg border border-slate-600/50 flex items-center gap-1 text-xs"
                        title="展开飞行状态面板"
                      >
                        <ChevronUp className="w-3 h-3" />
                        {zhCN.flightStatusFilter}
                      </button>
                    )}
        </div>

        {/* Right Sidebar Collapse Button - On Boundary Line */}
        <div className="w-3 flex-shrink-0 relative bg-slate-700/30 flex items-center justify-center cursor-pointer hover:bg-slate-600/50 transition-colors" onClick={() => setRightSidebarCollapsed(!rightSidebarCollapsed)}>
          <button
            className="absolute z-20 bg-slate-700/90 hover:bg-slate-600 text-white p-1 rounded-full transition-all duration-300 shadow-lg backdrop-blur-sm border border-slate-600/50"
            title={rightSidebarCollapsed ? zhCN.expandSidebar : zhCN.collapseSidebar}
          >
            {rightSidebarCollapsed ? <ChevronLeft className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        </div>

        {/* Right Sidebar */}
        <div className={`${rightSidebarCollapsed ? 'w-0 overflow-hidden' : 'w-80'} bg-slate-800 overflow-y-auto p-3 space-y-3 transition-all duration-300`}>
          <Card className="bg-slate-700 border-slate-600">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-sm flex items-center gap-2 text-white">
                <Plane className="w-4 h-4 text-blue-400" />{zhCN.uavList}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {drones.map((drone) => (
                  <div key={drone.uavId} className="bg-slate-600 p-2 rounded cursor-pointer hover:bg-slate-500 transition-colors" onClick={() => handleDroneListClick(drone)}>
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-mono text-xs font-bold">{drone.uavId}</div>
                        <div className="text-xs text-slate-400">{drone.model}</div>
                      </div>
                      <Badge variant={drone.flightStatus === 'FLYING' ? 'default' : 'secondary'} className={`text-xs ${drone.flightStatus === 'FLYING' ? 'bg-green-600' : ''}`}>
                        {drone.flightStatus === 'FLYING' ? zhCN.flyingStatus : zhCN.idleStatus}
                      </Badge>
                    </div>
                    <div className="flex justify-between mt-1 text-xs">
                      <span className={`flex items-center gap-1 ${drone.battery > 50 ? 'text-green-400' : drone.battery > 20 ? 'text-yellow-400' : 'text-red-400'}`}>
                        <Battery className="w-3 h-3" />{drone.battery?.toFixed(0)}%
                      </span>
                      <span className="text-slate-400">{drone.altitude?.toFixed(0)}m</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Team List with Member Expansion */}
          <Card className="bg-slate-700 border-slate-600">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-sm flex items-center gap-2 text-white">
                <Users className="w-4 h-4 text-green-400" />{zhCN.teams}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {teams.map((team, teamIndex) => (
                  <div key={team.teamId}>
                    <div 
                      className="bg-slate-600 p-2 rounded cursor-pointer hover:bg-slate-500 transition-colors"
                      style={{ borderLeft: `3px solid ${TEAM_COLORS[teamIndex % TEAM_COLORS.length]}` }}
                      onClick={() => toggleTeamExpansion(team.teamId)}
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <div className="text-xs font-bold">{team.teamName}</div>
                          <div className="text-xs text-slate-400">{zhCN.leader}: {team.leader}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className="text-xs bg-slate-500">{team.memberCount} {zhCN.teamMembers}</Badge>
                          {expandedTeamId === team.teamId ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </div>
                      </div>
                    </div>
                    {expandedTeamId === team.teamId && teamMembers[team.teamId] && (
                      <div className="ml-3 mt-1 space-y-1">
                        {teamMembers[team.teamId].map((member) => (
                          <div 
                            key={member.userId}
                            className="bg-slate-500/50 p-2 rounded cursor-pointer hover:bg-slate-500 transition-colors flex items-center gap-2"
                            onClick={() => handleMemberClick(member, teamIndex)}
                          >
                            <div 
                              className="w-6 h-6 rounded-full flex items-center justify-center"
                              style={{ backgroundColor: TEAM_COLORS[teamIndex % TEAM_COLORS.length] }}
                            >
                              <User className="w-3 h-3 text-white" />
                            </div>
                            <div className="flex-1">
                              <div className="text-xs font-medium">{member.realName || member.username}</div>
                              <div className="text-xs text-slate-400">{member.role}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-700 border-slate-600">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-sm flex items-center gap-2 text-white">
                <AlertTriangle className="w-4 h-4 text-yellow-400" />{zhCN.events}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {events.length === 0 ? (
                  <p className="text-slate-400 text-center py-2 text-xs">{zhCN.noEvents}</p>
                ) : (
                  events.map((event, idx) => (
                    <div key={idx} className={`p-2 rounded text-xs ${event.level === 'ERROR' ? 'bg-red-900/30 border-l-2 border-red-500' : event.level === 'WARN' ? 'bg-yellow-900/30 border-l-2 border-yellow-500' : 'bg-slate-600'}`}>
                      <div className="flex justify-between items-start">
                        <span className="font-medium">{event.eventType}</span>
                        <span className="text-slate-400">{event.time ? new Date(event.time).toLocaleTimeString() : ''}</span>
                      </div>
                      {event.uavId && <div className="text-slate-400">{event.uavId}</div>}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <footer className="px-4 py-1 bg-slate-800 border-t border-slate-700 text-center text-slate-500 text-xs">
        {zhCN.footerInfo}
        {currentLocation && ` | ${zhCN.locationInfo}: ${currentLocation.lat.toFixed(4)}, ${currentLocation.lng.toFixed(4)}`}
      </footer>
    </div>
  );
}

export default App;
