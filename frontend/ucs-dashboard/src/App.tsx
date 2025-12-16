import { useState, useEffect, useRef } from 'react';
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
  Settings
} from 'lucide-react';
import './App.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080';

// Chinese localization dictionary
const zhCN = {
  // Login page
  platformTitle: '无人机集群管控平台',
  username: '用户名',
  password: '密码',
  login: '登录',
  loginHint: '观察员账号: observer / 123456',
  loginFailed: '登录失败',
  connectionFailed: '连接失败',
  observerOnly: '仅观察员角色可访问大屏',
  accessDenied: '访问被拒绝：需要观察员角色',
  
  // Header
  dashboardTitle: '无人机集群管控 - 全局大屏',
  refresh: '刷新',
  logout: '退出',
  
  // Task card
  tasks: '任务态势',
  total: '总计',
  active: '执行中',
  done: '已完成',
  error: '异常',
  
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
  heatmapMode: '热力图模式',
  heatmapDrone: '无人机',
  heatmapTask: '任务',
  heatmapMember: '成员',
  myLocation: '我的位置',
  focusUavs: '聚焦无人机',
  
  // Map legend
  flyingStatus: '飞行中',
  idleStatus: '待机',
  clickForDetails: '点击标记查看详情',
  
  // UAV list
  uavList: '无人机列表',
  
  // Events
  events: '事件日志',
  noEvents: '暂无事件',
  
  // Footer
  footerInfo: 'UCS 平台 v1.0 | 每5秒自动刷新',
  locationInfo: '当前位置',
  
  // Drone popup
  model: '型号',
  battery: '电量',
  altitude: '高度',
  status: '状态',
  operator: '操作员',
  
  // Map error
  mapLoadFailed: '地图加载失败',
  mapErrorHint: '请检查网络连接或尝试切换地图源',
  webglNotSupported: '您的浏览器不支持 WebGL，无法显示地图',
  tileLoadFailed: '地图瓦片加载失败',
  networkError: '网络连接异常',
  tryRefresh: '请尝试刷新页面',
  
  // Tile source selector
  tileSource: '地图源',
  tileSourceOSM: 'OpenStreetMap',
  tileSourceCarto: 'CartoDB',
  tileSourceCustom: '自定义 (需API Key)',
};

// Map tile source configurations
type TileSourceKey = 'osm' | 'carto' | 'custom';

interface TileSourceConfig {
  name: string;
  tiles: string[];
  attribution: string;
}

const TILE_SOURCES: Record<TileSourceKey, TileSourceConfig> = {
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
  },
  custom: {
    name: '自定义',
    tiles: [],
    attribution: ''
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

type HeatmapMode = 'drone' | 'task' | 'member';

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
  const [heatmapMode, setHeatmapMode] = useState<HeatmapMode>('drone');
  const [currentLocation, setCurrentLocation] = useState<{lat: number, lng: number} | null>(null);
  
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapErrorDetails, setMapErrorDetails] = useState<string | null>(null);
  const [locationSource, setLocationSource] = useState<'geolocation' | 'default'>('default');
  const [tileSource, setTileSource] = useState<TileSourceKey>('carto');
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

  const fetchData = async () => {
    if (!token) return;
    setLoading(true);
    
    const headers = { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    try {
      // Build weather URL with location parameters if available
      let weatherUrl = `${API_BASE}/api/v1/screen/weather`;
      if (currentLocation) {
        weatherUrl += `?lat=${currentLocation.lat}&lng=${currentLocation.lng}`;
      }

      const [dronesRes, taskRes, teamsRes, weatherRes, eventsRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/screen/uav/list`, { headers }),
        fetch(`${API_BASE}/api/v1/screen/task/summary`, { headers }),
        fetch(`${API_BASE}/api/v1/screen/team/status`, { headers }),
        fetch(weatherUrl, { headers }),
        fetch(`${API_BASE}/api/v1/screen/events?limit=10`, { headers })
      ]);

      if (dronesRes.status === 403) {
        setError(zhCN.accessDenied);
        setIsLoggedIn(false);
        localStorage.removeItem('token');
        localStorage.removeItem('roles');
        return;
      }

      const dronesData = await dronesRes.json();
      const taskData = await taskRes.json();
      const teamsData = await teamsRes.json();
      const weatherData = await weatherRes.json();
      const eventsData = await eventsRes.json();

      if (dronesData.code === 0) setDrones(dronesData.data || []);
      if (taskData.code === 0) setTaskSummary(taskData.data);
      if (teamsData.code === 0) setTeams(teamsData.data || []);
      if (weatherData.code === 0) setWeather(weatherData.data);
      if (eventsData.code === 0) setEvents(eventsData.data || []);
    } catch (err) {
      console.error('Failed to fetch data:', err);
    }
    
    setLoading(false);
  };

  const getCurrentLocation = (flyToLocation = true) => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setCurrentLocation({ lat: latitude, lng: longitude });
          setLocationSource('geolocation');
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
          if (flyToLocation && map.current) {
            map.current.flyTo({
              center: [116.4074, 39.9042],
              zoom: 10,
              duration: 2000
            });
          }
        }
      );
    } else {
      // Geolocation not supported, use Beijing as default
      setCurrentLocation({ lat: 39.9042, lng: 116.4074 });
      setLocationSource('default');
    }
  };

  const initMap = (selectedTileSource: TileSourceKey = tileSource) => {
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
      map.current?.addSource('heatmap-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.current?.addLayer({
        id: 'heatmap-layer',
        type: 'heatmap',
        source: 'heatmap-source',
        paint: {
          'heatmap-weight': ['get', 'weight'],
          'heatmap-intensity': 1,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0, 0, 255, 0)',
            0.2, 'rgb(0, 255, 255)',
            0.4, 'rgb(0, 255, 0)',
            0.6, 'rgb(255, 255, 0)',
            0.8, 'rgb(255, 128, 0)',
            1, 'rgb(255, 0, 0)'
          ],
          'heatmap-radius': 30,
          'heatmap-opacity': 0.7
        }
      });

      getCurrentLocation();
    });
  };

  const changeTileSource = (newSource: TileSourceKey) => {
    setTileSource(newSource);
    setShowTileSelector(false);
    initMap(newSource);
  };

  const updateMapMarkers = () => {
    if (!map.current) return;

    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    drones.forEach(drone => {
      if (drone.lat && drone.lng) {
        const el = document.createElement('div');
        el.className = 'drone-marker';
        const isFlying = drone.flightStatus === 'FLYING';
        el.style.cssText = `width:32px;height:32px;background:${isFlying ? '#22c55e' : '#6b7280'};border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;cursor:pointer;`;
        el.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2L4 12l8 10 8-10L12 2z"/></svg>';

        const popup = new maplibregl.Popup({ offset: 25 }).setHTML(`
          <div style="padding:8px;font-family:sans-serif;">
            <h3 style="margin:0 0 8px 0;font-size:14px;font-weight:bold;">${drone.uavId}</h3>
            <p style="margin:4px 0;font-size:12px;">${zhCN.model}: ${drone.model}</p>
            <p style="margin:4px 0;font-size:12px;">${zhCN.battery}: ${drone.battery?.toFixed(0)}%</p>
            <p style="margin:4px 0;font-size:12px;">${zhCN.altitude}: ${drone.altitude?.toFixed(0)}m</p>
            <p style="margin:4px 0;font-size:12px;">${zhCN.status}: ${isFlying ? zhCN.flyingStatus : zhCN.idleStatus}</p>
            <p style="margin:4px 0;font-size:12px;">${zhCN.operator}: ${drone.owner}</p>
          </div>
        `);

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([drone.lng, drone.lat])
          .setPopup(popup)
          .addTo(map.current!);

        markersRef.current.push(marker);
      }
    });
  };

  const updateHeatmap = () => {
    if (!map.current) return;

    const source = map.current.getSource('heatmap-source') as maplibregl.GeoJSONSource;
    if (!source) return;

    let features: GeoJSON.Feature[] = [];

    switch (heatmapMode) {
      case 'drone':
        features = drones.filter(d => d.lat && d.lng).map(drone => ({
          type: 'Feature' as const,
          properties: { weight: 1 },
          geometry: { type: 'Point' as const, coordinates: [drone.lng, drone.lat] }
        }));
        break;
      case 'task':
        features = drones.filter(d => d.lat && d.lng && d.taskStatus === 'EXECUTING').map(drone => ({
          type: 'Feature' as const,
          properties: { weight: 2 },
          geometry: { type: 'Point' as const, coordinates: [drone.lng, drone.lat] }
        }));
        break;
      case 'member':
        const teamLocs: { [key: string]: { lat: number; lng: number; count: number } } = {};
        drones.forEach(drone => {
          if (drone.lat && drone.lng && drone.owner) {
            const key = `${drone.lat.toFixed(2)},${drone.lng.toFixed(2)}`;
            if (!teamLocs[key]) teamLocs[key] = { lat: drone.lat, lng: drone.lng, count: 0 };
            teamLocs[key].count++;
          }
        });
        features = Object.values(teamLocs).map(loc => ({
          type: 'Feature' as const,
          properties: { weight: loc.count },
          geometry: { type: 'Point' as const, coordinates: [loc.lng, loc.lat] }
        }));
        break;
    }

    source.setData({ type: 'FeatureCollection', features });
  };

  const focusOnDrones = () => {
    if (!map.current || drones.length === 0) return;
    const validDrones = drones.filter(d => d.lat && d.lng);
    if (validDrones.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();
    validDrones.forEach(drone => bounds.extend([drone.lng, drone.lat]));
    map.current.fitBounds(bounds, { padding: 50, duration: 1500 });
  };

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
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      initMap();
      // Get location on login for weather data
      getCurrentLocation(false);
    }
    return () => { if (map.current) { map.current.remove(); map.current = null; } };
  }, [isLoggedIn]);

  useEffect(() => {
    if (isLoggedIn && token) {
      fetchData();
      const interval = setInterval(fetchData, 5000);
      return () => clearInterval(interval);
    }
  }, [isLoggedIn, token]);

  useEffect(() => {
    if (map.current && drones.length > 0) {
      updateMapMarkers();
      updateHeatmap();
    }
  }, [drones, heatmapMode]);

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
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="border-slate-600 text-slate-300">
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />{zhCN.refresh}
          </Button>
          <Button variant="outline" size="sm" onClick={() => { localStorage.removeItem('token'); localStorage.removeItem('roles'); setIsLoggedIn(false); setToken(''); }} className="border-slate-600 text-slate-300">{zhCN.logout}</Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-72 bg-slate-800 border-r border-slate-700 overflow-y-auto p-3 space-y-3">
          <Card className="bg-slate-700 border-slate-600">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-sm flex items-center gap-2 text-white">
                <ClipboardList className="w-4 h-4 text-blue-400" />{zhCN.tasks}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              {taskSummary && (
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
                  <div className="flex justify-between"><span className="text-slate-400">{zhCN.location}</span><span>{weather.location || '北京'}{locationSource === 'default' ? ` ${zhCN.defaultLocation}` : ''}</span></div>
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
              <CardTitle className="text-sm flex items-center gap-2 text-white">
                <Users className="w-4 h-4 text-blue-400" />{zhCN.teams}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="space-y-2">
                {teams.map((team) => (
                  <div key={team.teamId} className="bg-slate-600 p-2 rounded flex justify-between items-center">
                    <div>
                      <div className="font-medium text-xs">{team.teamName}</div>
                      <div className="text-xs text-slate-400">{zhCN.leader}: {team.leader || 'N/A'}</div>
                    </div>
                    <Badge variant="outline" className="text-slate-300 text-xs">{team.memberCount}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-700 border-slate-600">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-sm flex items-center gap-2 text-white">
                <Activity className="w-4 h-4 text-blue-400" />{zhCN.stats}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-400">{zhCN.flying}</span><span className="font-bold text-green-400">{drones.filter(d => d.flightStatus === 'FLYING').length}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">{zhCN.totalUavs}</span><span className="font-bold">{drones.length}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">{zhCN.lowBattery}</span><span className="font-bold text-yellow-400">{drones.filter(d => d.battery < 30).length}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">{zhCN.errors}</span><span className="font-bold text-red-400">{drones.filter(d => d.hardwareStatus !== 'NORMAL').length}</span></div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex-1 relative">
          <div ref={mapContainer} className="absolute inset-0" />
          
          {mapError && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 z-20">
              <div className="bg-slate-800 p-4 rounded-lg text-center max-w-md">
                <AlertTriangle className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
                <p className="text-white mb-2">{mapError}</p>
                {mapErrorDetails && <p className="text-slate-400 text-xs mb-2">{mapErrorDetails}</p>}
                <p className="text-slate-400 text-sm mb-3">{zhCN.mapErrorHint}</p>
                <div className="flex gap-2 justify-center">
                  <Button size="sm" onClick={() => initMap()} className="bg-blue-600 hover:bg-blue-700">{zhCN.tryRefresh}</Button>
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
                  <Button size="sm" onClick={() => changeTileSource('osm')} className={`w-full justify-start ${tileSource === 'osm' ? 'bg-blue-600' : 'bg-slate-700'}`}>
                    {zhCN.tileSourceOSM}
                  </Button>
                  <Button size="sm" onClick={() => changeTileSource('carto')} className={`w-full justify-start ${tileSource === 'carto' ? 'bg-blue-600' : 'bg-slate-700'}`}>
                    {zhCN.tileSourceCarto}
                  </Button>
                </div>
                <p className="text-slate-400 text-xs mt-3">
                  提示：如需使用高德/天地图等国内地图源，请联系管理员配置 API Key
                </p>
                <Button size="sm" variant="outline" onClick={() => setShowTileSelector(false)} className="w-full mt-3 border-slate-600 text-slate-200">
                  关闭
                </Button>
              </div>
            </div>
          )}
          
          <div className="absolute top-3 left-3 z-10 bg-slate-800/90 rounded-lg p-2 space-y-2">
            <div className="flex items-center gap-1 text-xs text-slate-300 mb-1">
              <Layers className="w-3 h-3" />{zhCN.heatmapMode}
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant={heatmapMode === 'drone' ? 'default' : 'outline'} onClick={() => setHeatmapMode('drone')} className={`text-xs px-2 py-1 h-7 ${heatmapMode === 'drone' ? 'bg-blue-600 text-white' : 'border-slate-600 text-slate-200'}`}>{zhCN.heatmapDrone}</Button>
              <Button size="sm" variant={heatmapMode === 'task' ? 'default' : 'outline'} onClick={() => setHeatmapMode('task')} className={`text-xs px-2 py-1 h-7 ${heatmapMode === 'task' ? 'bg-blue-600 text-white' : 'border-slate-600 text-slate-200'}`}>{zhCN.heatmapTask}</Button>
              <Button size="sm" variant={heatmapMode === 'member' ? 'default' : 'outline'} onClick={() => setHeatmapMode('member')} className={`text-xs px-2 py-1 h-7 ${heatmapMode === 'member' ? 'bg-blue-600 text-white' : 'border-slate-600 text-slate-200'}`}>{zhCN.heatmapMember}</Button>
            </div>
          </div>

          <div className="absolute top-3 right-14 z-10 flex flex-col gap-1">
            <Button size="sm" variant="outline" onClick={() => getCurrentLocation()} className="bg-slate-800/90 border-slate-600 text-white h-8 w-8 p-0" title={zhCN.myLocation}><Locate className="w-4 h-4" /></Button>
            <Button size="sm" variant="outline" onClick={focusOnDrones} className="bg-slate-800/90 border-slate-600 text-white h-8 w-8 p-0" title={zhCN.focusUavs}><MapPin className="w-4 h-4" /></Button>
            <Button size="sm" variant="outline" onClick={() => setShowTileSelector(true)} className="bg-slate-800/90 border-slate-600 text-white h-8 w-8 p-0" title={zhCN.tileSource}><Settings className="w-4 h-4" /></Button>
          </div>

          <div className="absolute bottom-3 left-3 z-10 bg-slate-800/90 rounded-lg p-2 max-w-xs">
            <div className="flex items-center gap-2 text-xs text-slate-300 mb-2">
              <div className="w-3 h-3 rounded-full bg-green-500"></div><span>{zhCN.flyingStatus}</span>
              <div className="w-3 h-3 rounded-full bg-gray-500 ml-2"></div><span>{zhCN.idleStatus}</span>
            </div>
            <div className="text-xs text-slate-400">{zhCN.clickForDetails}</div>
          </div>
        </div>

        <div className="w-80 bg-slate-800 border-l border-slate-700 overflow-y-auto p-3 space-y-3">
          <Card className="bg-slate-700 border-slate-600">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-sm flex items-center gap-2 text-white">
                <Plane className="w-4 h-4 text-blue-400" />{zhCN.uavList}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {drones.map((drone) => (
                  <div key={drone.uavId} className="bg-slate-600 p-2 rounded cursor-pointer hover:bg-slate-500 transition-colors" onClick={() => { if (map.current && drone.lat && drone.lng) map.current.flyTo({ center: [drone.lng, drone.lat], zoom: 14, duration: 1000 }); }}>
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
