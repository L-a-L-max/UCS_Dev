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
  Layers
} from 'lucide-react';
import './App.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080';

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
          setError('Only observer role can access the dashboard');
          return;
        }
        setToken(data.data.token);
        setUserRoles(roles);
        setIsLoggedIn(true);
        localStorage.setItem('token', data.data.token);
        localStorage.setItem('roles', JSON.stringify(roles));
      } else {
        setError(data.msg || 'Login failed');
      }
    } catch {
      setError('Connection failed');
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
      const [dronesRes, taskRes, teamsRes, weatherRes, eventsRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/screen/uav/list`, { headers }),
        fetch(`${API_BASE}/api/v1/screen/task/summary`, { headers }),
        fetch(`${API_BASE}/api/v1/screen/team/status`, { headers }),
        fetch(`${API_BASE}/api/v1/screen/weather`, { headers }),
        fetch(`${API_BASE}/api/v1/screen/events?limit=10`, { headers })
      ]);

      if (dronesRes.status === 403) {
        setError('Access denied: Observer role required');
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

  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setCurrentLocation({ lat: latitude, lng: longitude });
          if (map.current) {
            map.current.flyTo({
              center: [longitude, latitude],
              zoom: 10,
              duration: 2000
            });
          }
        },
        () => {
          if (map.current) {
            map.current.flyTo({
              center: [116.4074, 39.9042],
              zoom: 10,
              duration: 2000
            });
          }
        }
      );
    }
  };

  const initMap = () => {
    if (!mapContainer.current || map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'osm': {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: 'OpenStreetMap'
          }
        },
        layers: [{
          id: 'osm',
          type: 'raster',
          source: 'osm',
          minzoom: 0,
          maxzoom: 19
        }]
      },
      center: [116.4074, 39.9042],
      zoom: 5,
      minZoom: 2,
      maxZoom: 18
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
            <p style="margin:4px 0;font-size:12px;">Model: ${drone.model}</p>
            <p style="margin:4px 0;font-size:12px;">Battery: ${drone.battery?.toFixed(0)}%</p>
            <p style="margin:4px 0;font-size:12px;">Altitude: ${drone.altitude?.toFixed(0)}m</p>
            <p style="margin:4px 0;font-size:12px;">Status: ${isFlying ? 'Flying' : 'Idle'}</p>
            <p style="margin:4px 0;font-size:12px;">Operator: ${drone.owner}</p>
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
    if (isLoggedIn) initMap();
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
              UAV Swarm Control Platform
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} className="bg-slate-700 border-slate-600 text-white" />
            <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="bg-slate-700 border-slate-600 text-white" onKeyPress={(e) => e.key === 'Enter' && handleLogin()} />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <Button onClick={handleLogin} className="w-full bg-blue-600 hover:bg-blue-700">
              <LogIn className="w-4 h-4 mr-2" />Login
            </Button>
            <p className="text-slate-400 text-xs text-center">Observer: observer / 123456</p>
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
          UAV Swarm Control - Dashboard
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="border-slate-600 text-slate-300">
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => { localStorage.removeItem('token'); localStorage.removeItem('roles'); setIsLoggedIn(false); setToken(''); }} className="border-slate-600 text-slate-300">Logout</Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-72 bg-slate-800 border-r border-slate-700 overflow-y-auto p-3 space-y-3">
          <Card className="bg-slate-700 border-slate-600">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-sm flex items-center gap-2 text-white">
                <ClipboardList className="w-4 h-4 text-blue-400" />Tasks
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              {taskSummary && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-600 p-2 rounded text-center">
                    <div className="text-lg font-bold text-blue-400">{taskSummary.total}</div>
                    <div className="text-xs text-slate-400">Total</div>
                  </div>
                  <div className="bg-slate-600 p-2 rounded text-center">
                    <div className="text-lg font-bold text-green-400">{taskSummary.executing}</div>
                    <div className="text-xs text-slate-400">Active</div>
                  </div>
                  <div className="bg-slate-600 p-2 rounded text-center">
                    <div className="text-lg font-bold text-slate-300">{taskSummary.completed}</div>
                    <div className="text-xs text-slate-400">Done</div>
                  </div>
                  <div className="bg-slate-600 p-2 rounded text-center">
                    <div className="text-lg font-bold text-red-400">{taskSummary.abnormal}</div>
                    <div className="text-xs text-slate-400">Error</div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-slate-700 border-slate-600">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-sm flex items-center gap-2 text-white">
                <Cloud className="w-4 h-4 text-blue-400" />Weather
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              {weather && (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-slate-400">Location</span><span>{weather.location || 'Beijing'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Temp</span><span className="text-lg font-bold">{weather.temperature?.toFixed(1)}C</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Humidity</span><span>{weather.humidity?.toFixed(0)}%</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Wind</span><span>{weather.windSpeed?.toFixed(1)} m/s</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Risk</span>
                    <Badge variant={weather.riskLevel === 'LOW' ? 'default' : weather.riskLevel === 'MEDIUM' ? 'secondary' : 'destructive'}>
                      {weather.riskLevel === 'LOW' ? 'Low' : weather.riskLevel === 'MEDIUM' ? 'Med' : 'High'}
                    </Badge>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-slate-700 border-slate-600">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-sm flex items-center gap-2 text-white">
                <Users className="w-4 h-4 text-blue-400" />Teams
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="space-y-2">
                {teams.map((team) => (
                  <div key={team.teamId} className="bg-slate-600 p-2 rounded flex justify-between items-center">
                    <div>
                      <div className="font-medium text-xs">{team.teamName}</div>
                      <div className="text-xs text-slate-400">Leader: {team.leader || 'N/A'}</div>
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
                <Activity className="w-4 h-4 text-blue-400" />Stats
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-400">Flying</span><span className="font-bold text-green-400">{drones.filter(d => d.flightStatus === 'FLYING').length}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Total UAVs</span><span className="font-bold">{drones.length}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Low Battery</span><span className="font-bold text-yellow-400">{drones.filter(d => d.battery < 30).length}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Errors</span><span className="font-bold text-red-400">{drones.filter(d => d.hardwareStatus !== 'NORMAL').length}</span></div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex-1 relative">
          <div ref={mapContainer} className="absolute inset-0" />
          
          <div className="absolute top-3 left-3 z-10 bg-slate-800/90 rounded-lg p-2 space-y-2">
            <div className="flex items-center gap-1 text-xs text-slate-300 mb-1">
              <Layers className="w-3 h-3" />Heatmap Mode
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant={heatmapMode === 'drone' ? 'default' : 'outline'} onClick={() => setHeatmapMode('drone')} className={`text-xs px-2 py-1 h-7 ${heatmapMode === 'drone' ? 'bg-blue-600' : 'border-slate-600'}`}>UAV</Button>
              <Button size="sm" variant={heatmapMode === 'task' ? 'default' : 'outline'} onClick={() => setHeatmapMode('task')} className={`text-xs px-2 py-1 h-7 ${heatmapMode === 'task' ? 'bg-blue-600' : 'border-slate-600'}`}>Task</Button>
              <Button size="sm" variant={heatmapMode === 'member' ? 'default' : 'outline'} onClick={() => setHeatmapMode('member')} className={`text-xs px-2 py-1 h-7 ${heatmapMode === 'member' ? 'bg-blue-600' : 'border-slate-600'}`}>Team</Button>
            </div>
          </div>

          <div className="absolute top-3 right-14 z-10 flex flex-col gap-1">
            <Button size="sm" variant="outline" onClick={getCurrentLocation} className="bg-slate-800/90 border-slate-600 text-white h-8 w-8 p-0" title="My Location"><Locate className="w-4 h-4" /></Button>
            <Button size="sm" variant="outline" onClick={focusOnDrones} className="bg-slate-800/90 border-slate-600 text-white h-8 w-8 p-0" title="Focus UAVs"><MapPin className="w-4 h-4" /></Button>
          </div>

          <div className="absolute bottom-3 left-3 z-10 bg-slate-800/90 rounded-lg p-2 max-w-xs">
            <div className="flex items-center gap-2 text-xs text-slate-300 mb-2">
              <div className="w-3 h-3 rounded-full bg-green-500"></div><span>Flying</span>
              <div className="w-3 h-3 rounded-full bg-gray-500 ml-2"></div><span>Idle</span>
            </div>
            <div className="text-xs text-slate-400">Click marker for details</div>
          </div>
        </div>

        <div className="w-80 bg-slate-800 border-l border-slate-700 overflow-y-auto p-3 space-y-3">
          <Card className="bg-slate-700 border-slate-600">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-sm flex items-center gap-2 text-white">
                <Plane className="w-4 h-4 text-blue-400" />UAV List
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
                        {drone.flightStatus === 'FLYING' ? 'Flying' : 'Idle'}
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
                <AlertTriangle className="w-4 h-4 text-yellow-400" />Events
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {events.length === 0 ? (
                  <p className="text-slate-400 text-center py-2 text-xs">No events</p>
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
        UCS Platform v1.0 | Auto-refresh every 5s
        {currentLocation && ` | Location: ${currentLocation.lat.toFixed(4)}, ${currentLocation.lng.toFixed(4)}`}
      </footer>
    </div>
  );
}

export default App;
