import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Plane,
  Battery,
  MapPin,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Lock,
  Unlock,
  Navigation,
  Pause,
  RefreshCw,
  LogOut,
  AlertTriangle,
  Activity,
} from 'lucide-react';
import {
  sendControlCommand,
  getDroneStatus,
  getPilotDrones,
  type DroneInfo,
  type ControlCommandResponse,
} from '@/services/api';

interface PilotViewProps {
  token: string;
  username: string;
  onLogout: () => void;
}

// PX4 command types
const COMMANDS = [
  { type: 'ARM', label: '解锁', icon: Unlock, color: 'bg-green-600 hover:bg-green-700', description: '解锁电机' },
  { type: 'DISARM', label: '锁定', icon: Lock, color: 'bg-slate-600 hover:bg-slate-700', description: '锁定电机' },
  { type: 'TAKEOFF', label: '起飞', icon: ArrowUp, color: 'bg-blue-600 hover:bg-blue-700', description: '自动起飞到指定高度' },
  { type: 'LAND', label: '降落', icon: ArrowDown, color: 'bg-amber-600 hover:bg-amber-700', description: '原地降落' },
  { type: 'RTL', label: '返航', icon: RotateCcw, color: 'bg-purple-600 hover:bg-purple-700', description: '返回起飞点' },
  { type: 'GOTO', label: '前往', icon: Navigation, color: 'bg-cyan-600 hover:bg-cyan-700', description: '前往指定坐标' },
  { type: 'HOLD', label: '悬停', icon: Pause, color: 'bg-orange-600 hover:bg-orange-700', description: '原地悬停' },
];

export default function PilotView({ token, username, onLogout }: PilotViewProps) {
  const [drones, setDrones] = useState<DroneInfo[]>([]);
  const [selectedDrone, setSelectedDrone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [commandResult, setCommandResult] = useState<ControlCommandResponse | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [sendingCommand, setSendingCommand] = useState<string | null>(null);

  // GOTO params
  const [gotoLat, setGotoLat] = useState('39.9042');
  const [gotoLon, setGotoLon] = useState('116.4074');
  const [gotoAlt, setGotoAlt] = useState('50');

  // TAKEOFF params
  const [takeoffAlt, setTakeoffAlt] = useState('50');

  // Issue #8: Only show drones the pilot has permission to control
  const fetchDrones = useCallback(async () => {
    try {
      const res = await getPilotDrones(token);
      if (res.code === 0 && res.data) {
        setDrones(Array.isArray(res.data) ? res.data as unknown as DroneInfo[] : []);
      }
    } catch (err) {
      console.error('Failed to fetch pilot drones:', err);
    }
  }, [token]);

  const refreshDroneStatus = useCallback(async () => {
    if (!selectedDrone) return;
    setLoading(true);
    try {
      const res = await getDroneStatus(token, selectedDrone);
      if (res.code === 0 && res.data) {
        setDrones(prev => prev.map(d => d.uavId === selectedDrone ? { ...d, ...res.data } : d));
      }
    } catch (err) {
      console.error('Failed to refresh drone status:', err);
    } finally {
      setLoading(false);
    }
  }, [token, selectedDrone]);

  useEffect(() => {
    fetchDrones();
    const interval = setInterval(fetchDrones, 5000);
    return () => clearInterval(interval);
  }, [fetchDrones]);

  const handleCommand = async (commandType: string) => {
    if (!selectedDrone) return;
    setSendingCommand(commandType);
    setCommandResult(null);
    setCommandError(null);

    let params = '{}';
    if (commandType === 'TAKEOFF') {
      params = JSON.stringify({ altitude: parseFloat(takeoffAlt) || 50 });
    } else if (commandType === 'GOTO') {
      params = JSON.stringify({
        lat: parseFloat(gotoLat) || 0,
        lon: parseFloat(gotoLon) || 0,
        alt: parseFloat(gotoAlt) || 50,
      });
    }

    try {
      const res = await sendControlCommand(token, {
        uavId: selectedDrone,
        commandType,
        params,
        confirmed: true,
      });
      if (res.code === 0 && res.data) {
        setCommandResult(res.data);
      } else {
        setCommandError(res.msg || '指令发送失败');
      }
    } catch {
      setCommandError('网络错误，请检查后端服务');
    } finally {
      setSendingCommand(null);
    }
  };

  const selectedDroneInfo = drones.find(d => d.uavId === selectedDrone);

  return (
    <div className="h-screen bg-slate-900 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex justify-between items-center px-4 py-2 bg-slate-800 border-b border-slate-700">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Plane className="w-6 h-6 text-blue-400" />
          飞手控制面板
          <Badge variant="outline" className="ml-2 text-blue-300 border-blue-500">
            {username}
          </Badge>
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchDrones} disabled={loading}
            className="bg-slate-700/50 border-slate-500/50 text-slate-100 hover:bg-slate-600/50">
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />刷新
          </Button>
          <Button variant="outline" size="sm" onClick={onLogout}
            className="bg-slate-700/50 border-slate-500/50 text-slate-100 hover:bg-slate-600/50">
            <LogOut className="w-4 h-4 mr-1" />退出
          </Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Drone List */}
        <div className="w-72 bg-slate-800 border-r border-slate-700 overflow-y-auto p-3 space-y-2">
          <h2 className="text-sm font-semibold text-slate-400 mb-2">我的无人机</h2>
          {drones.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-8">暂无可控制的无人机</p>
          )}
          {drones.map(drone => (
            <Card
              key={drone.uavId}
              className={`cursor-pointer transition-all ${
                selectedDrone === drone.uavId
                  ? 'bg-blue-900/50 border-blue-500'
                  : 'bg-slate-700 border-slate-600 hover:border-slate-500'
              }`}
              onClick={() => setSelectedDrone(drone.uavId)}
            >
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-sm">{drone.uavId}</span>
                  <Badge className={
                    drone.flightStatus === 'FLYING'
                      ? 'bg-green-600'
                      : drone.onlineStatus
                        ? 'bg-blue-600'
                        : 'bg-slate-600'
                  }>
                    {drone.flightStatus === 'FLYING' ? '飞行中' : drone.onlineStatus ? '在线' : '离线'}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs text-slate-400">
                  <div className="flex items-center gap-1">
                    <Battery className="w-3 h-3" />
                    {drone.battery != null ? `${drone.battery}%` : 'N/A'}
                  </div>
                  <div className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {drone.altitude != null ? `${drone.altitude}m` : 'N/A'}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Right: Control Panel */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selectedDrone ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-slate-500">
                <Plane className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg">请从左侧选择一架无人机</p>
                <p className="text-sm mt-1">选择后可进行控制操作</p>
              </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-6">
              {/* Drone Status Card */}
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Activity className="w-5 h-5 text-blue-400" />
                      {selectedDrone} 状态
                    </div>
                    <Button size="sm" variant="outline" onClick={refreshDroneStatus}
                      className="bg-slate-700 border-slate-600 hover:bg-slate-600">
                      <RefreshCw className={`w-3 h-3 mr-1 ${loading ? 'animate-spin' : ''}`} />刷新状态
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {selectedDroneInfo && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-slate-700/50 rounded-lg p-3 text-center">
                        <div className="text-xs text-slate-400 mb-1">飞行状态</div>
                        <Badge className={selectedDroneInfo.flightStatus === 'FLYING' ? 'bg-green-600' : 'bg-slate-600'}>
                          {selectedDroneInfo.flightStatus === 'FLYING' ? '飞行中' : '待机'}
                        </Badge>
                      </div>
                      <div className="bg-slate-700/50 rounded-lg p-3 text-center">
                        <div className="text-xs text-slate-400 mb-1">电量</div>
                        <div className="text-lg font-bold flex items-center justify-center gap-1">
                          <Battery className={`w-4 h-4 ${(selectedDroneInfo.battery || 0) < 20 ? 'text-red-400' : 'text-green-400'}`} />
                          {selectedDroneInfo.battery != null ? `${selectedDroneInfo.battery}%` : 'N/A'}
                        </div>
                      </div>
                      <div className="bg-slate-700/50 rounded-lg p-3 text-center">
                        <div className="text-xs text-slate-400 mb-1">高度</div>
                        <div className="text-lg font-bold">{selectedDroneInfo.altitude != null ? `${selectedDroneInfo.altitude}m` : 'N/A'}</div>
                      </div>
                      <div className="bg-slate-700/50 rounded-lg p-3 text-center">
                        <div className="text-xs text-slate-400 mb-1">位置</div>
                        <div className="text-xs font-mono">
                          {selectedDroneInfo.lat?.toFixed(4)}, {selectedDroneInfo.lng?.toFixed(4)}
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Command Buttons */}
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2">
                    <Navigation className="w-5 h-5 text-blue-400" />
                    控制指令
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {COMMANDS.map(cmd => {
                      const Icon = cmd.icon;
                      const isGoto = cmd.type === 'GOTO';
                      const isTakeoff = cmd.type === 'TAKEOFF';
                      return (
                        <Button
                          key={cmd.type}
                          className={`h-auto py-3 flex flex-col items-center gap-1 ${cmd.color} text-white`}
                          onClick={() => handleCommand(cmd.type)}
                          disabled={sendingCommand !== null}
                        >
                          <Icon className="w-6 h-6" />
                          <span className="text-sm font-bold">{cmd.label}</span>
                          <span className="text-xs opacity-80">{cmd.description}</span>
                          {sendingCommand === cmd.type && (
                            <RefreshCw className="w-4 h-4 animate-spin mt-1" />
                          )}
                          {isGoto && <span className="text-xs opacity-60">(需设置坐标)</span>}
                          {isTakeoff && <span className="text-xs opacity-60">(需设置高度)</span>}
                        </Button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Parameters */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Takeoff Params */}
                <Card className="bg-slate-800 border-slate-700">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <ArrowUp className="w-4 h-4 text-blue-400" />
                      起飞参数
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div>
                      <label className="text-xs text-slate-400">目标高度 (米)</label>
                      <Input
                        type="number"
                        value={takeoffAlt}
                        onChange={e => setTakeoffAlt(e.target.value)}
                        className="bg-slate-700 border-slate-600 text-white mt-1"
                        placeholder="50"
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* GOTO Params */}
                <Card className="bg-slate-800 border-slate-700">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Navigation className="w-4 h-4 text-cyan-400" />
                      前往目标参数
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-slate-400">纬度</label>
                        <Input
                          type="number"
                          step="0.0001"
                          value={gotoLat}
                          onChange={e => setGotoLat(e.target.value)}
                          className="bg-slate-700 border-slate-600 text-white mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400">经度</label>
                        <Input
                          type="number"
                          step="0.0001"
                          value={gotoLon}
                          onChange={e => setGotoLon(e.target.value)}
                          className="bg-slate-700 border-slate-600 text-white mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400">高度(米)</label>
                        <Input
                          type="number"
                          value={gotoAlt}
                          onChange={e => setGotoAlt(e.target.value)}
                          className="bg-slate-700 border-slate-600 text-white mt-1"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Command Result */}
              {(commandResult || commandError) && (
                <Card className={`border ${commandError ? 'bg-red-900/30 border-red-700' : 'bg-green-900/30 border-green-700'}`}>
                  <CardContent className="p-4">
                    {commandError ? (
                      <div className="flex items-center gap-2 text-red-300">
                        <AlertTriangle className="w-5 h-5" />
                        <span>{commandError}</span>
                      </div>
                    ) : commandResult && (
                      <div className="flex items-center gap-2 text-green-300">
                        <Activity className="w-5 h-5" />
                        <span>
                          指令 <strong>{commandResult.commandType}</strong> 已发送至 {commandResult.uavId}
                          {commandResult.message && ` - ${commandResult.message}`}
                        </span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
