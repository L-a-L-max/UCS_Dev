import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
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
  ChevronUp,
  Navigation
} from 'lucide-react';
import './App.css';
import { useTelemetryWebSocket, TelemetryBatch } from './hooks/useTelemetryWebSocket';

// Popup auto-close timing constants (watchdog mechanism)
const POPUP_DEFAULT_TIMEOUT = 6000; // 6 seconds default
const POPUP_WATCHDOG_INTERVAL = 3000; // Check every 3 seconds (half of default)


// Team colors for member markers
const TEAM_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#06b6d4', // cyan
];

const getApiBase = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return `${window.location.protocol}//${window.location.hostname}:8080`;
  }
  return 'http://localhost:8080';
};

const API_BASE = getApiBase();

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
  footerInfo: 'UCS 平台 v1.2',
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
  
  // Chart view types
  listView: '列表',
  pieChart: '饼图',
  barChart: '柱状图',
  
  // Location error
  locationFailed: '无法获取您的位置',
  locationDenied: '定位权限被拒绝，请在浏览器设置中允许定位',
  locationUnsupported: '您的浏览器不支持定位功能',
  retryLocation: '重新获取',
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

// China administrative regions data with center coordinates and zoom levels
interface RegionData {
  name: string;
  center: [number, number]; // [lng, lat]
  zoom: number;
  children?: Record<string, RegionData>;
}

const CHINA_REGIONS: Record<string, RegionData> = {
  '中国': {
    name: '中国',
    center: [105, 35],
    zoom: 3,
    children: {
      '北京市': { name: '北京市', center: [116.4074, 39.9042], zoom: 8 },
      '上海市': { name: '上海市', center: [121.4737, 31.2304], zoom: 8 },
      '天津市': { name: '天津市', center: [117.1901, 39.1256], zoom: 8 },
      '重庆市': { name: '重庆市', center: [106.5516, 29.5630], zoom: 6 },
      '河北省': { name: '河北省', center: [114.5149, 38.0428], zoom: 5, children: {
        '石家庄市': { name: '石家庄市', center: [114.5149, 38.0428], zoom: 8 },
        '唐山市': { name: '唐山市', center: [118.1802, 39.6306], zoom: 8 },
        '保定市': { name: '保定市', center: [115.4646, 38.8737], zoom: 8 },
      }},
      '山西省': { name: '山西省', center: [112.5489, 37.8706], zoom: 5, children: {
        '太原市': { name: '太原市', center: [112.5489, 37.8706], zoom: 8 },
        '大同市': { name: '大同市', center: [113.2951, 40.0903], zoom: 8 },
      }},
      '内蒙古': { name: '内蒙古自治区', center: [111.7656, 40.8175], zoom: 4 },
      '辽宁省': { name: '辽宁省', center: [123.4291, 41.7968], zoom: 5, children: {
        '沈阳市': { name: '沈阳市', center: [123.4291, 41.7968], zoom: 8 },
        '大连市': { name: '大连市', center: [121.6147, 38.9140], zoom: 8 },
      }},
      '吉林省': { name: '吉林省', center: [125.3245, 43.8868], zoom: 5 },
      '黑龙江省': { name: '黑龙江省', center: [126.6424, 45.7570], zoom: 4 },
      '江苏省': { name: '江苏省', center: [118.7969, 32.0603], zoom: 5, children: {
        '南京市': { name: '南京市', center: [118.7969, 32.0603], zoom: 8 },
        '苏州市': { name: '苏州市', center: [120.6195, 31.2990], zoom: 8 },
        '无锡市': { name: '无锡市', center: [120.3119, 31.4912], zoom: 8 },
      }},
      '浙江省': { name: '浙江省', center: [120.1536, 30.2875], zoom: 5, children: {
        '杭州市': { name: '杭州市', center: [120.1536, 30.2875], zoom: 8 },
        '宁波市': { name: '宁波市', center: [121.5440, 29.8683], zoom: 8 },
        '温州市': { name: '温州市', center: [120.6994, 28.0003], zoom: 8 },
      }},
      '安徽省': { name: '安徽省', center: [117.2830, 31.8612], zoom: 5 },
      '福建省': { name: '福建省', center: [119.2965, 26.0789], zoom: 5 },
      '江西省': { name: '江西省', center: [115.8922, 28.6765], zoom: 5 },
      '山东省': { name: '山东省', center: [117.0009, 36.6758], zoom: 5, children: {
        '济南市': { name: '济南市', center: [117.0009, 36.6758], zoom: 8 },
        '青岛市': { name: '青岛市', center: [120.3826, 36.0671], zoom: 8 },
      }},
      '河南省': { name: '河南省', center: [113.6254, 34.7466], zoom: 5 },
      '湖北省': { name: '湖北省', center: [114.3055, 30.5928], zoom: 5, children: {
        '武汉市': { name: '武汉市', center: [114.3055, 30.5928], zoom: 8 },
      }},
      '湖南省': { name: '湖南省', center: [112.9823, 28.1941], zoom: 5 },
      '广东省': { name: '广东省', center: [113.2644, 23.1291], zoom: 5, children: {
        '广州市': { name: '广州市', center: [113.2644, 23.1291], zoom: 8 },
        '深圳市': { name: '深圳市', center: [114.0579, 22.5431], zoom: 8 },
        '东莞市': { name: '东莞市', center: [113.7518, 23.0207], zoom: 8 },
      }},
      '广西': { name: '广西壮族自治区', center: [108.3200, 22.8240], zoom: 5 },
      '海南省': { name: '海南省', center: [110.3312, 20.0310], zoom: 6 },
      '四川省': { name: '四川省', center: [104.0657, 30.6595], zoom: 5, children: {
        '成都市': { name: '成都市', center: [104.0657, 30.6595], zoom: 8 },
      }},
      '贵州省': { name: '贵州省', center: [106.7135, 26.5783], zoom: 5 },
      '云南省': { name: '云南省', center: [102.7123, 25.0406], zoom: 5 },
      '西藏': { name: '西藏自治区', center: [91.1322, 29.6604], zoom: 4 },
      '陕西省': { name: '陕西省', center: [108.9540, 34.2658], zoom: 5, children: {
        '西安市': { name: '西安市', center: [108.9540, 34.2658], zoom: 8 },
      }},
      '甘肃省': { name: '甘肃省', center: [103.8236, 36.0594], zoom: 5 },
      '青海省': { name: '青海省', center: [101.7782, 36.6171], zoom: 5 },
      '宁夏': { name: '宁夏回族自治区', center: [106.2782, 38.4664], zoom: 5 },
      '新疆': { name: '新疆维吾尔自治区', center: [87.6177, 43.7928], zoom: 4 },
      '香港': { name: '香港特别行政区', center: [114.1694, 22.3193], zoom: 9 },
      '澳门': { name: '澳门特别行政区', center: [113.5439, 22.1987], zoom: 11 },
      '台湾省': { name: '台湾省', center: [121.5654, 25.0330], zoom: 6 },
    }
  }
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
  const [_userRoles, setUserRoles] = useState<string[]>([]);
  
  const [drones, setDrones] = useState<DroneStatus[]>([]);
  const [taskSummary, setTaskSummary] = useState<TaskSummary | null>(null);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  // Multi-select for heatmap layers (can show multiple at once)
  const [selectedHeatmapLayers, setSelectedHeatmapLayers] = useState<Set<HeatmapLayerType>>(new Set());
  // Multi-select for flight status filter (can show both flying and idle)
  const [selectedFlightStatus, setSelectedFlightStatus] = useState<Set<FlightStatusType>>(new Set(['flying', 'idle']));
  const [currentLocation, setCurrentLocation] = useState<{lat: number, lng: number} | null>(null);
  
  // New state for sidebar collapse, chart types, popup persistence, weather overlay
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
  const [showWeatherOverlay, setShowWeatherOverlay] = useState(false);
  const [taskChartType, setTaskChartType] = useState<ChartType>('list');
  const [statsChartType, setStatsChartType] = useState<ChartType>('list');
  const [_selectedDroneId, setSelectedDroneId] = useState<string | null>(null);
  
    // New state for UI refinements
    const [isLocating, setIsLocating] = useState(false);
    const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
    const [teamMembers, setTeamMembers] = useState<Record<string, TeamMember[]>>({});
    const [visibleTeamIds, setVisibleTeamIds] = useState<Set<string>>(new Set());
  
        // Collapsible button groups state
        const [heatmapPanelCollapsed, setHeatmapPanelCollapsed] = useState(false);
        const [flightStatusPanelCollapsed, setFlightStatusPanelCollapsed] = useState(false);
  
        // Drone tracking state - track which drone the map view should follow
        const [trackingDroneId, setTrackingDroneId] = useState<string | null>(null);

        // WebSocket telemetry state
        const [useLiveTelemetry, _setUseLiveTelemetry] = useState(true); // Enable live telemetry data from WebSocket
        const [_wsConnected, setWsConnected] = useState(false);

  // Popup watchdog timer refs
  const popupTimerRef = useRef<NodeJS.Timeout | null>(null);
  const popupWatchdogRef = useRef<NodeJS.Timeout | null>(null);
  const popupDeadlineRef = useRef<number>(0);
  const popupHoveredRef = useRef<boolean>(false);
  const activePopupKeyRef = useRef<string | null>(null);
  
    const memberMarkersRef = useRef<maplibregl.Marker[]>([]);
    
    // Drone heading and trail refsfor direction calibration and flight path display
    const droneHeadingsRef = useRef<Map<string, number>>(new Map()); // uavId -> heading in degrees (0 = north, 90 = east)
    const dronePrevPositionsRef = useRef<Map<string, { lng: number; lat: number }>>(new Map()); // uavId -> previous position
    const droneTrailsRef = useRef<Map<string, Array<{ lng: number; lat: number; timestamp: number }>>>(new Map()); // uavId -> trail points
    const lastTrailUpdateRef = useRef<number>(0);
    const TRAIL_UPDATE_THROTTLE = 200; // Update trail every 200ms
    const TRAIL_MAX_POINTS = 50; // Maximum number of trail points per drone
    const TRAIL_MAX_AGE_MS = 10000; // Trail points older than 10 seconds will be removed (shorter trails to avoid map clutter)
  
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
  const [_locationSource, setLocationSource] = useState<'geolocation' | 'default' | 'failed' | 'unsupported'>('default');
  const [locationErrorMessage, setLocationErrorMessage] = useState<string | null>(null);
  const [tileSource, setTileSource] = useState<TileSourceKey>('gaode');
  const [showTileSelector, setShowTileSelector] = useState(false);
  
  // Location selector state
  const [showLocationSelector, setShowLocationSelector] = useState(false);
  const [locationMode, setLocationMode] = useState<'coordinate' | 'region'>('coordinate');
  const [coordLat, setCoordLat] = useState('');
  const [coordLng, setCoordLng] = useState('');
  const [coordZoom, setCoordZoom] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('');
  const [selectedProvince, setSelectedProvince] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [selectedDistrict, setSelectedDistrict] = useState('');
  
  // Scroll position refs for preserving scroll during data refresh
  const droneListScrollRef = useRef<HTMLDivElement>(null);
  const teamListScrollRef = useRef<HTMLDivElement>(null);
  const droneListScrollTopRef = useRef<number>(0);
  const teamListScrollTopRef = useRef<number>(0);
  

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

    // Fetch drone data from backend API
    const fetchDroneData = useCallback(async () => {
      if (!token) return;
      
      // When live telemetry mode is enabled, completely skip REST API for drone data
      // User only cares about real-time data, not historical database data
      // This prevents any possibility of stale data overwriting real-time telemetry
      if (useLiveTelemetry) {
        return; // Live telemetry mode - only use WebSocket data
      }
      
      // Save scroll position before updating
      if (droneListScrollRef.current) {
        droneListScrollTopRef.current = droneListScrollRef.current.scrollTop;
      }
      const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
      try {
        const response = await fetch(`${API_BASE}/api/v1/screen/uav/list`, { headers });
        if (response.status === 403) {
          setError(zhCN.accessDenied); setIsLoggedIn(false);
          localStorage.removeItem('token'); localStorage.removeItem('roles'); return;
        }
        const data = await response.json();
        if (data.code === 0) {
          // Sort by uavId to maintain stable order
          const sortedData = (data.data || []).sort((a: DroneStatus, b: DroneStatus) => a.uavId.localeCompare(b.uavId));
          // Cheap diff: only update state if data actually changed to prevent flickering
          setDrones(prevDrones => {
            if (prevDrones.length !== sortedData.length) return sortedData;
            // Compare by uavId and key fields to detect changes
            const hasChanges = sortedData.some((drone: DroneStatus, i: number) => {
              const prev = prevDrones[i];
              return drone.uavId !== prev.uavId || 
                     drone.lat !== prev.lat || 
                     drone.lng !== prev.lng ||
                     drone.flightStatus !== prev.flightStatus ||
                     drone.taskStatus !== prev.taskStatus ||
                     drone.battery !== prev.battery;
            });
            return hasChanges ? sortedData : prevDrones;
          });
        }
      } catch (err) { console.error('Failed to fetch drone data:', err); }
    }, [token, useLiveTelemetry]);

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
    // Save scroll position before updating
    if (teamListScrollRef.current) {
      teamListScrollTopRef.current = teamListScrollRef.current.scrollTop;
    }
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    try {
      const response = await fetch(`${API_BASE}/api/v1/screen/team/status`, { headers });
      const data = await response.json();
      if (data.code === 0) {
        // Sort by teamId to maintain stable order
        const sortedData = (data.data || []).sort((a: TeamInfo, b: TeamInfo) => a.teamId.localeCompare(b.teamId));
        // Cheap diff: only update state if data actually changed to prevent flickering
        setTeams(prevTeams => {
          if (prevTeams.length !== sortedData.length) return sortedData;
          // Compare by teamId and key fields to detect changes
          const hasChanges = sortedData.some((team: TeamInfo, i: number) => {
            const prev = prevTeams[i];
            return team.teamId !== prev.teamId || 
                   team.teamName !== prev.teamName ||
                   team.memberCount !== prev.memberCount ||
                   team.leader !== prev.leader;
          });
          return hasChanges ? sortedData : prevTeams;
        });
      }
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

  // Handle incoming telemetry data from WebSocket
  const handleTelemetryReceived = useCallback((batch: TelemetryBatch) => {
    if (!useLiveTelemetry) return; // Only process if live telemetry mode is enabled
    
    // Convert telemetry data to DroneStatus format and update drones
    setDrones(prevDrones => {
      let hasChanges = false;
      const updatedDrones = [...prevDrones];
      
      batch.uavs.forEach(uav => {
        const uavIdStr = `UAV_${String(uav.uavId).padStart(3, '0')}`;
        const existingIndex = updatedDrones.findIndex(d => d.uavId === uavIdStr);
        
        // Validate and normalize coordinates
        // Latitude must be in [-90, 90], Longitude must be in [-180, 180]
        // If lat is outside [-90, 90] but lon is within [-90, 90], they are likely swapped
        let normalizedLat = uav.lat;
        let normalizedLng = uav.lon;
        
        if (Math.abs(uav.lat) > 90 && Math.abs(uav.lon) <= 90) {
          // Coordinates appear to be swapped - swap them back
          normalizedLat = uav.lon;
          normalizedLng = uav.lat;
        }
        
        if (existingIndex >= 0) {
          // Check if data actually changed before updating
          const existing = updatedDrones[existingIndex];
          const newFlightStatus = uav.isActive ? 'FLYING' : 'IDLE';
          if (existing.lat !== normalizedLat || 
              existing.lng !== normalizedLng || 
              existing.altitude !== uav.alt ||
              existing.flightStatus !== newFlightStatus) {
            hasChanges = true;
            updatedDrones[existingIndex] = {
              ...existing,
              lat: normalizedLat,
              lng: normalizedLng,
              altitude: uav.alt,
              flightStatus: newFlightStatus,
            };
          }
        } else {
          // Add new drone
          hasChanges = true;
          const droneData: DroneStatus = {
            uavId: uavIdStr,
            droneSn: `SN${String(uav.uavId).padStart(6, '0')}`,
            lat: normalizedLat,
            lng: normalizedLng,
            altitude: uav.alt,
            battery: 85,
            hardwareStatus: 'NORMAL',
            flightStatus: uav.isActive ? 'FLYING' : 'IDLE',
            taskStatus: uav.isActive ? 'EXECUTING' : 'IDLE',
            color: '#22c55e',
            model: 'DJI Mavic 3',
            owner: 'System',
            currentTask: uav.isActive ? 'Live Mission' : undefined,
            teamName: 'Alpha'
          };
          updatedDrones.push(droneData);
        }
      });
      
      // Only return new array if there were actual changes to prevent flickering
      // Sort by uavId to maintain stable order and prevent list reordering flicker
      if (hasChanges) {
        updatedDrones.sort((a, b) => a.uavId.localeCompare(b.uavId));
        return updatedDrones;
      }
      return prevDrones;
    });
  }, [useLiveTelemetry]);

  // WebSocket hook for real-time telemetry
  const { connected: _telemetryConnected } = useTelemetryWebSocket({
    enabled: isLoggedIn && useLiveTelemetry,
    onTelemetryReceived: handleTelemetryReceived,
    onConnectionChange: setWsConnected,
  });

  const getCurrentLocation = (flyToLocation = true) => {
    setLocationErrorMessage(null);
    if (navigator.geolocation) {
      setIsLocating(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setCurrentLocation({ lat: latitude, lng: longitude });
          setLocationSource('geolocation');
          setIsLocating(false);
          setLocationErrorMessage(null);
          if (flyToLocation && map.current) {
            map.current.flyTo({
              center: [longitude, latitude],
              zoom: 10,
              duration: 2000
            });
          }
        },
        (error) => {
          setLocationSource('failed');
          setIsLocating(false);
          if (error.code === error.PERMISSION_DENIED) {
            setLocationErrorMessage(zhCN.locationDenied);
          } else {
            setLocationErrorMessage(zhCN.locationFailed);
          }
        },
        {
          enableHighAccuracy: false,
          timeout: 5000,
          maximumAge: 60000
        }
      );
    } else {
      setLocationSource('unsupported');
      setLocationErrorMessage(zhCN.locationUnsupported);
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
        layers: [
          {
            id: 'basemap',
            type: 'raster',
            source: 'basemap',
            maxzoom: 19
          }
        ]
      },
      center: [105, 30],
      zoom: 3,
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
        layout: { visibility: 'none' },
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

      // Add drone trail source and layers (base line + chevron arrows)
      map.current?.addSource('drone-trails-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      
      // Base trail line layer - dashed style for better visibility
      map.current?.addLayer({
        id: 'drone-trails-layer',
        type: 'line',
        source: 'drone-trails-source',
        layout: {
          'line-join': 'round',
          'line-cap': 'butt' // Use butt cap for proper dash appearance
        },
        paint: {
          'line-color': '#3b82f6', // Blue color for trail
          'line-width': 3,
          'line-opacity': 0.7,
          'line-dasharray': [2, 3] // Dashed line pattern: 2 units dash, 3 units gap
        }
      });
      
      // Create chevron arrow image for trail arrows
      const chevronSize = 24;
      const chevronCanvas = document.createElement('canvas');
      chevronCanvas.width = chevronSize;
      chevronCanvas.height = chevronSize;
      const ctx = chevronCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, chevronSize, chevronSize);
        ctx.strokeStyle = '#60a5fa'; // Light blue to match trail color
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // Draw chevron arrow pointing right (will be rotated along line)
        ctx.beginPath();
        ctx.moveTo(6, 4);
        ctx.lineTo(18, 12);
        ctx.lineTo(6, 20);
        ctx.stroke();
        
        // Add the image to the map
        const imageData = ctx.getImageData(0, 0, chevronSize, chevronSize);
        map.current?.addImage('trail-chevron', imageData, { sdf: false });
      }
      
      // Chevron arrow symbol layer along the trail
      map.current?.addLayer({
        id: 'drone-trails-arrows',
        type: 'symbol',
        source: 'drone-trails-source',
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 30, // Space between chevrons in pixels
          'icon-image': 'trail-chevron',
          'icon-size': 0.8,
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true
        }
      });

      // Don't auto-locate on login - user should click "my location" button to locate
      // Map defaults to global view with China centered at [105, 35] zoom 1.5
    });
  };

  const changeTileSource = async (newSource: TileSourceKey) => {
    setTileSource(newSource);
    setShowTileSelector(false);
    await initMap(newSource);
  };

  // Calculate bearing (heading) between two points in degrees (0 = north, 90 = east)
  const calculateBearing = (from: { lng: number; lat: number }, to: { lng: number; lat: number }): number => {
    const dLng = (to.lng - from.lng) * Math.PI / 180;
    const lat1 = from.lat * Math.PI / 180;
    const lat2 = to.lat * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360; // Normalize to 0-360
  };

  // Calculate distance between two points in km (Haversine formula)
  const calculateDistance = (from: { lng: number; lat: number }, to: { lng: number; lat: number }): number => {
    const R = 6371; // Earth's radius in km
    const dLat = (to.lat - from.lat) * Math.PI / 180;
    const dLng = (to.lng - from.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(from.lat * Math.PI / 180) * Math.cos(to.lat * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Update drone trails on the map
  const updateDroneTrails = useCallback(() => {
    if (!map.current) return;
    
    const trailSource = map.current.getSource('drone-trails-source') as maplibregl.GeoJSONSource;
    if (!trailSource) return;

    const features: GeoJSON.Feature[] = [];
    
    droneTrailsRef.current.forEach((trail, uavId) => {
      if (trail.length < 2) return;
      
      // Create a LineString feature for each drone's trail
      // Trail follows the exact path the drone has taken
      const coordinates = trail.map(point => [point.lng, point.lat]);
      
      features.push({
        type: 'Feature',
        properties: {
          uavId,
          color: '#3b82f6' // Blue color for all trails as requested
        },
        geometry: {
          type: 'LineString',
          coordinates
        }
      });
    });

    trailSource.setData({
      type: 'FeatureCollection',
      features
    });
  }, [drones]);

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

  // Note: Legacy popup timer functions removed - now using watchdog mechanism via startPopupWatchdog

    // Incremental marker update - only update positions, don't recreate markers
    const updateMapMarkers = useCallback(() => {
      if (!map.current) return;

      const now = Date.now();
      const shouldUpdateTrails = now - lastTrailUpdateRef.current >= TRAIL_UPDATE_THROTTLE;

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
        const currentPos = { lng: drone.lng, lat: drone.lat };
        const prevPos = dronePrevPositionsRef.current.get(drone.uavId);
        const isFlying = drone.flightStatus === 'FLYING';
        
        // Calculate heading based on movement direction
        let heading = droneHeadingsRef.current.get(drone.uavId) || 0;
        if (prevPos && isFlying) {
          const distance = calculateDistance(prevPos, currentPos);
          // Only update heading if drone moved significantly (> 1 meter)
          if (distance > 0.001) {
            heading = calculateBearing(prevPos, currentPos);
            droneHeadingsRef.current.set(drone.uavId, heading);
          }
        }
        
        // Update previous position
        dronePrevPositionsRef.current.set(drone.uavId, currentPos);
        
        // Update trail data (throttled) - time-based cleanup with longer duration
        if (shouldUpdateTrails && isFlying) {
          const trail = droneTrailsRef.current.get(drone.uavId) || [];
          
          // Only add point if drone has moved significantly (> 2 meters) to avoid duplicate points
          // Reduced from 5m to 2m for smoother trail curves
          const lastPoint = trail[trail.length - 1];
          const shouldAddPoint = !lastPoint || calculateDistance(lastPoint, currentPos) > 0.002;
          
          if (shouldAddPoint) {
            trail.push({ lng: drone.lng, lat: drone.lat, timestamp: now });
          }
          
          // Time-based cleanup: remove points older than TRAIL_MAX_AGE_MS (90 seconds) from the front
          const cutoffTime = now - TRAIL_MAX_AGE_MS;
          while (trail.length > 0 && trail[0].timestamp < cutoffTime) {
            trail.shift();
          }
          
          // Limit max points (keep most recent)
          while (trail.length > TRAIL_MAX_POINTS) {
            trail.shift();
          }
          
          droneTrailsRef.current.set(drone.uavId, trail);
        }
        
        const existingMarkerData = droneMarkersMapRef.current.get(drone.uavId);
      
        if (existingMarkerData) {
          // INCREMENTAL UPDATE: Just update position, don't recreate marker
          existingMarkerData.marker.setLngLat([drone.lng, drone.lat]);
          
          // Update rotation based on heading
          const svgElement = existingMarkerData.element.querySelector('svg');
          if (svgElement) {
            svgElement.style.transform = `rotate(${heading}deg)`;
          }
        
          // Update marker style if flight status changed (simple shadow, no glow)
          // Using orange (#f97316) for flying and gray (#6b7280) for idle - better contrast with map
          const currentFilter = existingMarkerData.element.style.filter;
          const expectedFilter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))';
          if (currentFilter !== expectedFilter) {
            existingMarkerData.element.style.filter = expectedFilter;
            // Update SVG colors - orange for flying, gray for idle
            const gElement = existingMarkerData.element.querySelector('g');
            if (gElement) {
              gElement.setAttribute('fill', isFlying ? '#f97316' : '#6b7280');
              gElement.removeAttribute('filter');
              const circles = gElement.querySelectorAll('circle[fill]');
              circles.forEach(circle => circle.setAttribute('fill', isFlying ? '#f97316' : '#6b7280'));
            }
          }
        } else {
          // CREATE NEW MARKER: Only for drones that don't have a marker yet
          const el = document.createElement('div');
          el.className = 'drone-marker';
          // Pure drone icon without circular background - simple shadow, no glow
          // Using orange (#f97316) for flying and gray (#6b7280) for idle - better contrast with map
          const droneColor = isFlying ? '#f97316' : '#6b7280';
          el.style.cssText = `width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3)); transition: filter 0.3s ease;`;
          // Pure drone icon SVG - quadcopter shape (from iconfont style) pointing up (north = 0 degrees)
          // No circular background, just the drone shape with stroke for visibility
          el.innerHTML = `<svg width="32" height="32" viewBox="0 0 1024 1024" style="transform: rotate(${heading}deg); transition: transform 0.1s linear;">
            <!-- Quadcopter drone icon - 4 rotors with arms and central body -->
            <g fill="${droneColor}" stroke="#ffffff" stroke-width="20">
              <!-- Central body -->
              <circle cx="512" cy="512" r="80"/>
              <!-- Arms -->
              <line x1="512" y1="432" x2="512" y2="200" stroke-width="40" stroke-linecap="round"/>
              <line x1="512" y1="592" x2="512" y2="824" stroke-width="40" stroke-linecap="round"/>
              <line x1="432" y1="512" x2="200" y2="512" stroke-width="40" stroke-linecap="round"/>
              <line x1="592" y1="512" x2="824" y2="512" stroke-width="40" stroke-linecap="round"/>
              <!-- Rotors (circles at the end of arms) -->
              <circle cx="512" cy="150" r="100" fill="${droneColor}" stroke="#ffffff" stroke-width="16"/>
              <circle cx="512" cy="874" r="100" fill="${droneColor}" stroke="#ffffff" stroke-width="16"/>
              <circle cx="150" cy="512" r="100" fill="${droneColor}" stroke="#ffffff" stroke-width="16"/>
              <circle cx="874" cy="512" r="100" fill="${droneColor}" stroke="#ffffff" stroke-width="16"/>
              <!-- Direction indicator (front arrow) -->
              <path d="M512 100 L480 180 L512 150 L544 180 Z" fill="#ffffff" stroke="none"/>
            </g>
          </svg>`;

          // Enhanced popup with tech-blue styling (no white border)
          const popup = new maplibregl.Popup({ offset: 25, closeButton: true, closeOnClick: false, className: 'drone-popup tech-blue-popup' }).setHTML(`
            <div class="drone-popup-content" style="padding: 12px; font-family: system-ui, -apple-system, sans-serif; min-width: 220px; background: linear-gradient(135deg, #1e40af 0%, #1e3a8a 50%, #172554 100%); color: white; border-radius: 8px; box-shadow: 0 4px 20px rgba(30, 64, 175, 0.5);">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(96, 165, 250, 0.3);">
                <div style="width: 32px; height: 32px; background: ${isFlying ? 'linear-gradient(135deg, #f97316, #ea580c)' : 'linear-gradient(135deg, #6b7280, #4b5563)'}; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2L4 12l8 10 8-10L12 2z"/></svg>
                </div>
                <div>
                  <h3 style="margin: 0; font-size: 16px; font-weight: bold; color: #93c5fd;">${drone.uavId}</h3>
                  <span style="font-size: 11px; color: ${isFlying ? '#fdba74' : '#d1d5db'};">${isFlying ? zhCN.flyingStatus : zhCN.idleStatus}</span>
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
                    // Note: Map marker click only shows details, does NOT start tracking
                    // Tracking is only started from the right sidebar drone list
                    el.addEventListener('click', () => {
                      const popupKey = `drone:${droneId}`;
          
                      // If clicking the same marker that's already open, just reset timer
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
      
      // Update trail timestamp and render trails
      if (shouldUpdateTrails) {
        lastTrailUpdateRef.current = now;
        updateDroneTrails();
      }
    }, [drones, selectedFlightStatus, startPopupWatchdog, attachPopupHoverListeners, updateDroneTrails]);

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

    // Click on drone in list - fly to, open popup, and start tracking mode
    // This is the ONLY place where tracking mode is started (not from map marker click)
    const handleDroneListClick = (drone: DroneStatus) => {
      if (!map.current || !drone.lat || !drone.lng) return;
    
      const popupKey = `drone:${drone.uavId}`;
    
      // Toggle tracking mode: if clicking the same drone that's being tracked, stop tracking
      if (trackingDroneId === drone.uavId) {
        setTrackingDroneId(null);
      } else {
        // Start tracking this drone
        setTrackingDroneId(drone.uavId);
      }
    
      // Fly to drone location
      map.current.flyTo({
        center: [drone.lng, drone.lat],
        zoom: 14,
        duration: 1000
      });
    
      // Close any existing popup before opening new one
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    
      // Find the marker and open its popup
      const markerData = droneMarkersMapRef.current.get(drone.uavId);
      if (markerData) {
        // Open the popup
        markerData.marker.togglePopup();
        popupRef.current = markerData.popup;
        setSelectedDroneId(drone.uavId);
        
        // Attach hover listeners for watchdog mechanism
        attachPopupHoverListeners(markerData.popup);
        
        // Start watchdog timer with popup key
        startPopupWatchdog(popupKey);
      } else {
        // Marker not yet created, just set selected drone
        setSelectedDroneId(drone.uavId);
      }
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

  // Restore scroll positions after data updates (useLayoutEffect to avoid visual flicker)
  useLayoutEffect(() => {
    if (droneListScrollRef.current && droneListScrollTopRef.current > 0) {
      const maxScroll = droneListScrollRef.current.scrollHeight - droneListScrollRef.current.clientHeight;
      droneListScrollRef.current.scrollTop = Math.min(droneListScrollTopRef.current, maxScroll);
    }
  }, [drones]);

  useLayoutEffect(() => {
    if (teamListScrollRef.current && teamListScrollTopRef.current > 0) {
      const maxScroll = teamListScrollRef.current.scrollHeight - teamListScrollRef.current.clientHeight;
      teamListScrollRef.current.scrollTop = Math.min(teamListScrollTopRef.current, maxScroll);
    }
  }, [teams]);

  // Navigate to location by coordinates
  const navigateToCoordinates = useCallback(() => {
    if (!map.current) return;
    const lat = parseFloat(coordLat);
    const lng = parseFloat(coordLng);
    const zoom = coordZoom ? parseFloat(coordZoom) : 12;
    
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setError('请输入有效的经纬度坐标');
      return;
    }
    
    map.current.flyTo({ center: [lng, lat], zoom: Math.min(Math.max(zoom, 1), 18), duration: 1500 });
    setShowLocationSelector(false);
    setError('');
  }, [coordLat, coordLng, coordZoom]);

  // Navigate to region by selection
  const navigateToRegion = useCallback(() => {
    if (!map.current) return;
    
    let region: RegionData | undefined;
    
    if (selectedCountry && CHINA_REGIONS[selectedCountry]) {
      region = CHINA_REGIONS[selectedCountry];
      
      if (selectedProvince && region.children?.[selectedProvince]) {
        region = region.children[selectedProvince];
        
        if (selectedCity && region.children?.[selectedCity]) {
          region = region.children[selectedCity];
          
          if (selectedDistrict && region.children?.[selectedDistrict]) {
            region = region.children[selectedDistrict];
          }
        }
      }
    }
    
    if (region) {
      map.current.flyTo({ center: region.center, zoom: region.zoom, duration: 1500 });
      setShowLocationSelector(false);
    }
  }, [selectedCountry, selectedProvince, selectedCity, selectedDistrict]);

  // Get available provinces based on selected country
  const getProvinces = useCallback(() => {
    if (selectedCountry && CHINA_REGIONS[selectedCountry]?.children) {
      return Object.keys(CHINA_REGIONS[selectedCountry].children!);
    }
    return [];
  }, [selectedCountry]);

  // Get available cities based on selected province
  const getCities = useCallback(() => {
    if (selectedCountry && selectedProvince) {
      const province = CHINA_REGIONS[selectedCountry]?.children?.[selectedProvince];
      if (province?.children) {
        return Object.keys(province.children);
      }
    }
    return [];
  }, [selectedCountry, selectedProvince]);

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
        // Throttle heatmap updates to reduce performance impact
        const now = Date.now();
        if (now - lastHeatmapUpdateRef.current >= HEATMAP_UPDATE_THROTTLE) {
          updateHeatmap();
          lastHeatmapUpdateRef.current = now;
        }
      }
    }, [drones, selectedHeatmapLayers, selectedFlightStatus]);

    // Update popup position and content when drones move
    // This avoids the extra setDrones call that was causing performance issues
    useEffect(() => {
      if (!popupRef.current || !activePopupKeyRef.current?.startsWith('drone:')) return;
      
      const droneId = activePopupKeyRef.current.replace('drone:', '');
      const drone = drones.find(d => d.uavId === droneId);
      
      if (drone && drone.lat && drone.lng) {
        // Update popup position
        popupRef.current.setLngLat([drone.lng, drone.lat]);
        
        // Update popup content with new position (throttled to reduce DOM updates)
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
    }, [drones]);

      // Resize map when sidebars collapse/expand
      useEffect(() => {
        if (map.current) {
          setTimeout(() => { map.current?.resize(); }, 300);
        }
      }, [leftSidebarCollapsed, rightSidebarCollapsed]);

            // Drone tracking effect - update map center when tracked drone moves
            useEffect(() => {
              if (!map.current || !trackingDroneId) return;
        
              // Find the tracked drone and update map center
              const trackedDrone = drones.find(d => d.uavId === trackingDroneId);
              if (trackedDrone && trackedDrone.lat && trackedDrone.lng) {
                // Use easeTo for smooth tracking without changing zoom level
                map.current.easeTo({
                  center: [trackedDrone.lng, trackedDrone.lat],
                  duration: 200 // Short duration for smooth following
                });
              } else if (drones.length > 0 && !trackedDrone) {
                // Tracked drone no longer exists in the list, stop tracking
                setTrackingDroneId(null);
              }
            }, [drones, trackingDroneId]);

            // Exit drone tracking mode only when user drags the map
            // Zoom/rotate/pitch should NOT exit tracking so user can adjust view while following
            useEffect(() => {
              if (!map.current || !trackingDroneId) return;
      
              const exitTracking = () => {
                setTrackingDroneId(null);
              };
      
              // Only listen for drag - user explicitly requested that zoom should NOT exit tracking
              map.current.on('dragstart', exitTracking);
      
              return () => {
                map.current?.off('dragstart', exitTracking);
              };
            }, [trackingDroneId]);

    if (!isLoggedIn) {
    return (
      <div className="min-h-screen login-bg flex items-center justify-center">
        {/* Sci-fi background effects */}
        <div className="login-particles"></div>
        <div className="hud-corner hud-corner-tl"></div>
        <div className="hud-corner hud-corner-tr"></div>
        <div className="hud-corner hud-corner-bl"></div>
        <div className="hud-corner hud-corner-br"></div>
        <div className="scan-line"></div>
        
        <Card className="w-96 bg-slate-800/90 backdrop-blur-md border-slate-600 shadow-2xl shadow-blue-500/10 relative z-10">
          <CardHeader className="pb-2">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/30">
                <Plane className="w-8 h-8 text-white" />
              </div>
            </div>
            <CardTitle className="text-white text-center text-xl">
              {zhCN.platformTitle}
            </CardTitle>
            <p className="text-slate-400 text-xs text-center mt-1">UAV Integrated Control System</p>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            <Input placeholder={zhCN.username} value={username} onChange={(e) => setUsername(e.target.value)} className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400" />
            <Input type="password" placeholder={zhCN.password} value={password} onChange={(e) => setPassword(e.target.value)} className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400" onKeyPress={(e) => e.key === 'Enter' && handleLogin()} />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <Button onClick={handleLogin} className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 shadow-lg shadow-blue-500/20">
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
        <div className={`${leftSidebarCollapsed ? 'w-0 overflow-hidden' : 'w-64'} bg-slate-800 overflow-y-auto p-3 space-y-3 transition-all duration-300`}>
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
                      
                      // Handle 100% cases - when one category is 100%, draw a full circle
                      if (flyingCount === total) {
                        return <circle cx="50" cy="50" r="40" fill="#22c55e" />;
                      }
                      if (idleCount === total) {
                        return <circle cx="50" cy="50" r="40" fill="#6b7280" />;
                      }
                      
                      const flyingAngle = (flyingCount / total) * 360;
                      const idleAngle = (idleCount / total) * 360;
                      let currentAngle = 0;
                      const createArc = (angle: number, color: string, key: string) => {
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
                        return <path key={key} d={`M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z`} fill={color} />;
                      };
                      return (
                        <>
                          {createArc(flyingAngle, '#22c55e', 'flying')}
                          {createArc(idleAngle, '#6b7280', 'idle')}
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
          
          {locationErrorMessage && (
            <div className="absolute top-0 left-0 right-0 z-30 bg-gradient-to-r from-amber-600/95 to-orange-600/95 backdrop-blur-sm shadow-lg animate-in slide-in-from-top duration-300">
              <div className="flex items-center justify-between px-4 py-2">
                <div className="flex items-center gap-2 text-white">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span className="text-sm font-medium">{locationErrorMessage}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    size="sm" 
                    onClick={() => getCurrentLocation()} 
                    disabled={isLocating}
                    className="bg-white/20 hover:bg-white/30 text-white border-white/30 h-7 px-3 text-xs"
                  >
                    {isLocating ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Locate className="w-3 h-3 mr-1" />}
                    {zhCN.retryLocation}
                  </Button>
                  <button 
                    onClick={() => setLocationErrorMessage(null)} 
                    className="text-white/80 hover:text-white p-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

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

          {showLocationSelector && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 z-30">
              <div className="bg-slate-800 p-4 rounded-lg w-80">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-white font-bold flex items-center gap-2">
                    <Navigation className="w-4 h-4" />地图定位
                  </h3>
                  <button onClick={() => setShowLocationSelector(false)} className="text-slate-400 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                
                <div className="flex gap-2 mb-4">
                  <Button 
                    size="sm" 
                    onClick={() => setLocationMode('coordinate')} 
                    className={`flex-1 ${locationMode === 'coordinate' ? 'bg-blue-600' : 'bg-slate-700'}`}
                  >
                    坐标输入
                  </Button>
                  <Button 
                    size="sm" 
                    onClick={() => setLocationMode('region')} 
                    className={`flex-1 ${locationMode === 'region' ? 'bg-blue-600' : 'bg-slate-700'}`}
                  >
                    地区选择
                  </Button>
                </div>

                {locationMode === 'coordinate' && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">纬度 (Latitude)</label>
                      <Input 
                        type="number" 
                        placeholder="例如: 39.9042" 
                        value={coordLat} 
                        onChange={(e) => setCoordLat(e.target.value)}
                        className="bg-slate-700 border-slate-600 text-white"
                        step="0.0001"
                        min="-90"
                        max="90"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">经度 (Longitude)</label>
                      <Input 
                        type="number" 
                        placeholder="例如: 116.4074" 
                        value={coordLng} 
                        onChange={(e) => setCoordLng(e.target.value)}
                        className="bg-slate-700 border-slate-600 text-white"
                        step="0.0001"
                        min="-180"
                        max="180"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">缩放级别 (可选, 1-18)</label>
                      <Input 
                        type="number" 
                        placeholder="默认: 12" 
                        value={coordZoom} 
                        onChange={(e) => setCoordZoom(e.target.value)}
                        className="bg-slate-700 border-slate-600 text-white"
                        min="1"
                        max="18"
                      />
                    </div>
                    {error && <p className="text-red-400 text-xs">{error}</p>}
                    <Button onClick={navigateToCoordinates} className="w-full bg-blue-600 hover:bg-blue-700">
                      定位到坐标
                    </Button>
                  </div>
                )}

                {locationMode === 'region' && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">国家/地区</label>
                      <select 
                        value={selectedCountry} 
                        onChange={(e) => { setSelectedCountry(e.target.value); setSelectedProvince(''); setSelectedCity(''); setSelectedDistrict(''); }}
                        className="w-full bg-slate-700 border border-slate-600 text-white rounded-md px-3 py-2 text-sm"
                      >
                        <option value="">请选择</option>
                        {Object.keys(CHINA_REGIONS).map(key => (
                          <option key={key} value={key}>{CHINA_REGIONS[key].name}</option>
                        ))}
                      </select>
                    </div>
                    
                    {selectedCountry && getProvinces().length > 0 && (
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">省/直辖市/自治区</label>
                        <select 
                          value={selectedProvince} 
                          onChange={(e) => { setSelectedProvince(e.target.value); setSelectedCity(''); setSelectedDistrict(''); }}
                          className="w-full bg-slate-700 border border-slate-600 text-white rounded-md px-3 py-2 text-sm"
                        >
                          <option value="">请选择</option>
                          {getProvinces().map(key => (
                            <option key={key} value={key}>{key}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    
                    {selectedProvince && getCities().length > 0 && (
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">城市</label>
                        <select 
                          value={selectedCity} 
                          onChange={(e) => { setSelectedCity(e.target.value); setSelectedDistrict(''); }}
                          className="w-full bg-slate-700 border border-slate-600 text-white rounded-md px-3 py-2 text-sm"
                        >
                          <option value="">请选择</option>
                          {getCities().map(key => (
                            <option key={key} value={key}>{key}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    
                    <Button 
                      onClick={navigateToRegion} 
                      disabled={!selectedCountry}
                      className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600"
                    >
                      定位到地区
                    </Button>
                  </div>
                )}

                <p className="text-slate-400 text-xs mt-3">
                  提示：坐标输入支持精确定位，地区选择可快速跳转到省市
                </p>
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
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => setShowLocationSelector(true)} 
              className="bg-slate-700/50 backdrop-blur-sm border-slate-500/50 text-slate-100 hover:bg-slate-600/50 h-8 w-8 p-0"
              title="地图定位"
            >
              <Navigation className="w-4 h-4" />
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
        <div className={`${rightSidebarCollapsed ? 'w-0 overflow-hidden' : 'w-72'} bg-slate-800 overflow-y-auto p-3 space-y-3 transition-all duration-300`}>
          <Card className="bg-slate-700 border-slate-600">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-sm flex items-center gap-2 text-white">
                <Plane className="w-4 h-4 text-blue-400" />{zhCN.uavList}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div ref={droneListScrollRef} className="space-y-2 max-h-64 overflow-y-auto">
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
              <div ref={teamListScrollRef} className="space-y-2 max-h-64 overflow-y-auto">
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
                          <Badge className="text-xs bg-slate-500">
                            {teamMembers[team.teamId] ? teamMembers[team.teamId].length : team.memberCount} {zhCN.teamMembers}
                          </Badge>
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
