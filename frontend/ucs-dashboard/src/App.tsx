import { useState, useEffect } from 'react';
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
  MapPin,
  Activity,
  RefreshCw,
  LogIn
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
  riskLevel: string;
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
  
  const [drones, setDrones] = useState<DroneStatus[]>([]);
  const [taskSummary, setTaskSummary] = useState<TaskSummary | null>(null);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);

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
        setToken(data.data.token);
        setIsLoggedIn(true);
        localStorage.setItem('token', data.data.token);
      } else {
        setError(data.msg || 'Login failed');
      }
    } catch {
      setError('Connection failed. Please check if the server is running.');
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

  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    if (savedToken) {
      setToken(savedToken);
      setIsLoggedIn(true);
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn && token) {
      fetchData();
      const interval = setInterval(fetchData, 5000);
      return () => clearInterval(interval);
    }
  }, [isLoggedIn, token]);

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <Card className="w-96 bg-slate-800 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-center flex items-center justify-center gap-2">
              <Plane className="w-6 h-6" />
              无人机集群管控平台
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              placeholder="用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="bg-slate-700 border-slate-600 text-white"
            />
            <Input
              type="password"
              placeholder="密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-slate-700 border-slate-600 text-white"
              onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
            />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <Button onClick={handleLogin} className="w-full bg-blue-600 hover:bg-blue-700">
              <LogIn className="w-4 h-4 mr-2" />
              登录
            </Button>
            <p className="text-slate-400 text-xs text-center">
              测试账号: observer / 123456
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4">
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Plane className="w-8 h-8 text-blue-400" />
          无人机集群管控平台 - 全局大屏
        </h1>
        <div className="flex items-center gap-4">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={fetchData}
            disabled={loading}
            className="border-slate-600 text-slate-300"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => {
              localStorage.removeItem('token');
              setIsLoggedIn(false);
              setToken('');
            }}
            className="border-slate-600 text-slate-300"
          >
            退出
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-3 bg-slate-800 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2 text-white">
              <ClipboardList className="w-5 h-5 text-blue-400" />
              任务态势
            </CardTitle>
          </CardHeader>
          <CardContent>
            {taskSummary && (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-700 p-3 rounded-lg text-center">
                  <div className="text-2xl font-bold text-blue-400">{taskSummary.total}</div>
                  <div className="text-xs text-slate-400">总任务</div>
                </div>
                <div className="bg-slate-700 p-3 rounded-lg text-center">
                  <div className="text-2xl font-bold text-green-400">{taskSummary.executing}</div>
                  <div className="text-xs text-slate-400">执行中</div>
                </div>
                <div className="bg-slate-700 p-3 rounded-lg text-center">
                  <div className="text-2xl font-bold text-slate-300">{taskSummary.completed}</div>
                  <div className="text-xs text-slate-400">已完成</div>
                </div>
                <div className="bg-slate-700 p-3 rounded-lg text-center">
                  <div className="text-2xl font-bold text-red-400">{taskSummary.abnormal}</div>
                  <div className="text-xs text-slate-400">异常</div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-3 bg-slate-800 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2 text-white">
              <Cloud className="w-5 h-5 text-blue-400" />
              天气状况
            </CardTitle>
          </CardHeader>
          <CardContent>
            {weather && (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">温度</span>
                  <span className="text-xl font-bold">{weather.temperature?.toFixed(1)}°C</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">湿度</span>
                  <span>{weather.humidity?.toFixed(0)}%</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">风速</span>
                  <span>{weather.windSpeed?.toFixed(1)} m/s</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">飞行风险</span>
                  <Badge variant={
                    weather.riskLevel === 'LOW' ? 'default' : 
                    weather.riskLevel === 'MEDIUM' ? 'secondary' : 'destructive'
                  }>
                    {weather.riskLevel === 'LOW' ? '低' : 
                     weather.riskLevel === 'MEDIUM' ? '中' : '高'}
                  </Badge>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-3 bg-slate-800 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2 text-white">
              <Users className="w-5 h-5 text-blue-400" />
              任务小队
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {teams.map((team) => (
                <div key={team.teamId} className="bg-slate-700 p-2 rounded flex justify-between items-center">
                  <div>
                    <div className="font-medium text-sm">{team.teamName}</div>
                    <div className="text-xs text-slate-400">队长: {team.leader || '未分配'}</div>
                  </div>
                  <Badge variant="outline" className="text-slate-300">
                    {team.memberCount}人
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-3 bg-slate-800 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2 text-white">
              <Activity className="w-5 h-5 text-blue-400" />
              实时统计
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">在线无人机</span>
                <span className="text-xl font-bold text-green-400">
                  {drones.filter(d => d.flightStatus === 'FLYING').length}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">总无人机数</span>
                <span className="text-xl font-bold">{drones.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">低电量告警</span>
                <span className="text-xl font-bold text-yellow-400">
                  {drones.filter(d => d.battery < 30).length}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">异常状态</span>
                <span className="text-xl font-bold text-red-400">
                  {drones.filter(d => d.hardwareStatus !== 'NORMAL').length}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-8 bg-slate-800 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2 text-white">
              <Plane className="w-5 h-5 text-blue-400" />
              无人机列表
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700">
                    <th className="text-left p-2">编号</th>
                    <th className="text-left p-2">型号</th>
                    <th className="text-left p-2">位置</th>
                    <th className="text-left p-2">高度</th>
                    <th className="text-left p-2">电量</th>
                    <th className="text-left p-2">状态</th>
                    <th className="text-left p-2">任务</th>
                    <th className="text-left p-2">操作员</th>
                  </tr>
                </thead>
                <tbody>
                  {drones.map((drone) => (
                    <tr key={drone.uavId} className="border-b border-slate-700 hover:bg-slate-700">
                      <td className="p-2 font-mono">{drone.uavId}</td>
                      <td className="p-2">{drone.model}</td>
                      <td className="p-2">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {drone.lat?.toFixed(4)}, {drone.lng?.toFixed(4)}
                        </span>
                      </td>
                      <td className="p-2">{drone.altitude?.toFixed(0)}m</td>
                      <td className="p-2">
                        <span className={`flex items-center gap-1 ${
                          drone.battery > 50 ? 'text-green-400' : 
                          drone.battery > 20 ? 'text-yellow-400' : 'text-red-400'
                        }`}>
                          <Battery className="w-3 h-3" />
                          {drone.battery?.toFixed(0)}%
                        </span>
                      </td>
                      <td className="p-2">
                        <Badge 
                          variant={drone.flightStatus === 'FLYING' ? 'default' : 'secondary'}
                          className={drone.flightStatus === 'FLYING' ? 'bg-green-600' : ''}
                        >
                          {drone.flightStatus === 'FLYING' ? '飞行中' : '空闲'}
                        </Badge>
                      </td>
                      <td className="p-2">
                        <Badge variant={drone.taskStatus === 'EXECUTING' ? 'default' : 'outline'}>
                          {drone.taskStatus === 'EXECUTING' ? '执行中' : '无任务'}
                        </Badge>
                      </td>
                      <td className="p-2 text-slate-400">{drone.owner}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-4 bg-slate-800 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2 text-white">
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
              事件告警
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {events.length === 0 ? (
                <p className="text-slate-400 text-center py-4">暂无事件</p>
              ) : (
                events.map((event, idx) => (
                  <div 
                    key={idx} 
                    className={`p-2 rounded text-sm ${
                      event.level === 'ERROR' ? 'bg-red-900/30 border-l-2 border-red-500' :
                      event.level === 'WARN' ? 'bg-yellow-900/30 border-l-2 border-yellow-500' :
                      'bg-slate-700'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <span className="font-medium">{event.eventType}</span>
                      <span className="text-xs text-slate-400">
                        {event.time ? new Date(event.time).toLocaleTimeString() : ''}
                      </span>
                    </div>
                    {event.uavId && (
                      <div className="text-xs text-slate-400">{event.uavId}</div>
                    )}
                    {event.message && (
                      <div className="text-xs mt-1">{event.message}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <footer className="mt-6 text-center text-slate-500 text-sm">
        UCS 无人机集群管控平台 v1.0 | 数据每5秒自动刷新
      </footer>
    </div>
  );
}

export default App;
