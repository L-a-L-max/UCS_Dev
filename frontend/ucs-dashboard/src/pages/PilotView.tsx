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
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  sendControlCommand,
  getDroneStatus,
  getPilotDrones,
  type DroneInfo,
  type ControlCommandResponse,
} from '@/services/api';
import MapPanel, { type MapDrone } from '@/components/MapPanel';

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

// 无人机卡片上的快捷指令
const QUICK_COMMANDS = [
  { type: 'ARM', label: '解锁' },
  { type: 'DISARM', label: '锁定' },
  { type: 'TAKEOFF', label: '起飞' },
  { type: 'LAND', label: '降落' },
  { type: 'RTL', label: '返航' },
  { type: 'HOLD', label: '悬停' },
];

export default function PilotView({ token, username, onLogout }: PilotViewProps) {
  const [drones, setDrones] = useState<DroneInfo[]>([]);
  const [selectedDrone, setSelectedDrone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [commandResult, setCommandResult] = useState<ControlCommandResponse | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [sendingCommand, setSendingCommand] = useState<string | null>(null);
  // 快捷指令反馈
  const [quickFeedback, setQuickFeedback] = useState<{ uavId: string; message: string; success: boolean } | null>(null);

  // 详细控制面板显示开关（可通过勾选按钮切换）
  const [showDetailPanel, setShowDetailPanel] = useState(true);

  // GOTO params
  const [gotoLat, setGotoLat] = useState('39.9042');
  const [gotoLon, setGotoLon] = useState('116.4074');
  const [gotoAlt, setGotoAlt] = useState('50');

  // TAKEOFF params - 默认20米
  const [takeoffAlt, setTakeoffAlt] = useState('20');

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

  // 统一的指令发送方法，支持从卡片快捷发送或从详细面板发送
  const handleCommand = async (commandType: string, uavId?: string) => {
    const targetUav = uavId || selectedDrone;
    if (!targetUav) return;
    setSendingCommand(commandType);
    if (!uavId) {
      setCommandResult(null);
      setCommandError(null);
    }

    let params = '{}';
    if (commandType === 'TAKEOFF') {
      params = JSON.stringify({ altitude: parseFloat(takeoffAlt) || 20 });
    } else if (commandType === 'GOTO') {
      params = JSON.stringify({
        lat: parseFloat(gotoLat) || 0,
        lon: parseFloat(gotoLon) || 0,
        alt: parseFloat(gotoAlt) || 50,
      });
    }

    try {
      const res = await sendControlCommand(token, {
        uavId: targetUav,
        commandType,
        params,
        confirmed: true,
      });
      if (res.code === 0 && res.data) {
        if (uavId) {
          setQuickFeedback({ uavId, message: `${commandType} 指令已发送`, success: true });
          setTimeout(() => setQuickFeedback(null), 3000);
        } else {
          setCommandResult(res.data);
        }
      } else {
        if (uavId) {
          setQuickFeedback({ uavId, message: res.msg || '指令发送失败', success: false });
          setTimeout(() => setQuickFeedback(null), 3000);
        } else {
          setCommandError(res.msg || '指令发送失败');
        }
      }
    } catch {
      if (uavId) {
        setQuickFeedback({ uavId, message: '网络错误', success: false });
        setTimeout(() => setQuickFeedback(null), 3000);
      } else {
        setCommandError('网络错误，请检查后端服务');
      }
    } finally {
      setSendingCommand(null);
    }
  };

  const selectedDroneInfo = drones.find(d => d.uavId === selectedDrone);

  // 将 DroneInfo 转换为 MapDrone 格式
  const mapDrones: MapDrone[] = drones.map(d => ({
    uavId: d.uavId, lat: d.lat, lng: d.lng, altitude: d.altitude,
    battery: d.battery, flightStatus: d.flightStatus, onlineStatus: d.onlineStatus,
    model: d.model, owner: d.owner, teamName: d.teamName,
  }));

  return (
    <div className="h-screen bg-slate-900 text-white flex flex-col overflow-hidden">
      {/* 顶部栏 */}
      <header className="flex justify-between items-center px-4 py-2 bg-slate-800 border-b border-slate-700">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Plane className="w-6 h-6 text-blue-400" />
          飞手控制面板
          <Badge variant="outline" className="ml-2 text-blue-300 border-blue-500">{username}</Badge>
        </h1>
        <div className="flex items-center gap-2">
          {/* 显示/隐藏详细控制面板的勾选按钮 */}
          <Button variant="outline" size="sm"
            onClick={() => setShowDetailPanel(!showDetailPanel)}
            className={`text-xs ${showDetailPanel ? 'bg-blue-600/30 border-blue-500 text-blue-300' : 'bg-slate-700/50 border-slate-500/50 text-slate-400'}`}
            title={showDetailPanel ? '隐藏详细控制面板' : '显示详细控制面板'}>
            {showDetailPanel ? <Eye className="w-4 h-4 mr-1" /> : <EyeOff className="w-4 h-4 mr-1" />}
            详细面板
          </Button>
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
        {/* 左侧: 无人机列表（带快捷控制按钮） */}
        <div className="w-72 bg-slate-800 border-r border-slate-700 overflow-y-auto p-2 space-y-1">
          <h2 className="text-xs font-semibold text-slate-400 mb-1">我的无人机</h2>
          {/* 快捷指令反馈 */}
          {quickFeedback && (
            <div className={`p-1.5 rounded text-[10px] mb-1 ${quickFeedback.success ? 'bg-green-900/30 border border-green-700 text-green-300' : 'bg-red-900/30 border border-red-700 text-red-300'}`}>
              [{quickFeedback.uavId}] {quickFeedback.message}
            </div>
          )}
          {drones.length === 0 && <p className="text-slate-500 text-xs text-center py-6">暂无可控制的无人机</p>}
          {[...drones].sort((a, b) => {
            const aO = a.onlineStatus ? 1 : 0, bO = b.onlineStatus ? 1 : 0;
            if (aO !== bO) return bO - aO;
            const aF = a.flightStatus === 'FLYING' ? 1 : 0, bF = b.flightStatus === 'FLYING' ? 1 : 0;
            return bF - aF;
          }).map(drone => (
            <div key={drone.uavId}
              className={`p-2 rounded text-xs cursor-pointer transition-all ${
                selectedDrone === drone.uavId
                  ? 'bg-blue-900/50 border border-blue-500'
                  : 'bg-slate-700 border border-slate-600 hover:border-slate-500'
              }`}
              onClick={() => setSelectedDrone(drone.uavId)}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-bold text-blue-300">{drone.uavId}</span>
                <Badge className={`text-[10px] px-1 py-0 ${
                  drone.flightStatus === 'FLYING' ? 'bg-green-600' : drone.onlineStatus ? 'bg-blue-600' : 'bg-slate-600'
                }`}>
                  {drone.flightStatus === 'FLYING' ? '飞行中' : drone.onlineStatus ? '在线' : '离线'}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-slate-400 mb-1">
                <span className="flex items-center gap-0.5"><Battery className="w-2.5 h-2.5" />{drone.battery != null ? `${drone.battery}%` : 'N/A'}</span>
                <span className="flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{drone.altitude != null ? `${drone.altitude}m` : 'N/A'}</span>
              </div>
              {/* 快捷控制按钮 - 直接在卡片上控制 */}
              <div className="flex flex-wrap gap-0.5 mt-1">
                {QUICK_COMMANDS.map(cmd => (
                  <Button key={cmd.type} size="sm" variant="outline"
                    className="text-[10px] h-5 px-1.5 bg-slate-600/50 border-slate-500 text-slate-300 hover:bg-slate-500"
                    onClick={e => { e.stopPropagation(); handleCommand(cmd.type, drone.uavId); }}
                    disabled={sendingCommand !== null}>
                    {cmd.label}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 中间: 详细控制面板（可通过顶部按钮隐藏/显示） */}
        {showDetailPanel && (
          <div className="w-[320px] min-w-[280px] overflow-y-auto p-3 border-r border-slate-700">
            {!selectedDrone ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-slate-500">
                  <Plane className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">请从左侧选择无人机</p>
                  <p className="text-xs mt-1">选择后可进行详细控制操作</p>
                </div>
              </div>
            ) : (
            <div className="space-y-3">
              {/* 无人机状态 */}
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-2 px-3 pt-3">
                  <CardTitle className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1">
                      <Activity className="w-3 h-3 text-blue-400" />{selectedDrone} 状态
                    </div>
                    <Button size="sm" variant="outline" onClick={refreshDroneStatus}
                      className="bg-slate-700 border-slate-600 hover:bg-slate-600 text-xs h-6 px-2">
                      <RefreshCw className={`w-2.5 h-2.5 mr-0.5 ${loading ? 'animate-spin' : ''}`} />刷新
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  {selectedDroneInfo && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-slate-700/50 rounded p-2 text-center">
                        <div className="text-[10px] text-slate-400 mb-0.5">飞行状态</div>
                        <Badge className={`text-[10px] ${selectedDroneInfo.flightStatus === 'FLYING' ? 'bg-green-600' : 'bg-slate-600'}`}>
                          {selectedDroneInfo.flightStatus === 'FLYING' ? '飞行中' : '待机'}
                        </Badge>
                      </div>
                      <div className="bg-slate-700/50 rounded p-2 text-center">
                        <div className="text-[10px] text-slate-400 mb-0.5">电量</div>
                        <div className="text-sm font-bold flex items-center justify-center gap-0.5">
                          <Battery className={`w-3 h-3 ${(selectedDroneInfo.battery || 0) < 20 ? 'text-red-400' : 'text-green-400'}`} />
                          {selectedDroneInfo.battery != null ? `${selectedDroneInfo.battery}%` : 'N/A'}
                        </div>
                      </div>
                      <div className="bg-slate-700/50 rounded p-2 text-center">
                        <div className="text-[10px] text-slate-400 mb-0.5">高度</div>
                        <div className="text-sm font-bold">{selectedDroneInfo.altitude != null ? `${selectedDroneInfo.altitude}m` : 'N/A'}</div>
                      </div>
                      <div className="bg-slate-700/50 rounded p-2 text-center">
                        <div className="text-[10px] text-slate-400 mb-0.5">位置</div>
                        <div className="text-[10px] font-mono">{selectedDroneInfo.lat?.toFixed(4)}, {selectedDroneInfo.lng?.toFixed(4)}</div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 控制指令 */}
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-2 px-3 pt-3">
                  <CardTitle className="flex items-center gap-1 text-xs">
                    <Navigation className="w-3 h-3 text-blue-400" />控制指令
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <div className="grid grid-cols-4 gap-1">
                    {COMMANDS.map(cmd => {
                      const Icon = cmd.icon;
                      return (
                        <Button key={cmd.type}
                          className={`h-auto py-2 flex flex-col items-center gap-0.5 ${cmd.color} text-white text-[10px]`}
                          onClick={() => handleCommand(cmd.type)} disabled={sendingCommand !== null}>
                          <Icon className="w-4 h-4" />
                          <span className="font-bold">{cmd.label}</span>
                          {sendingCommand === cmd.type && <RefreshCw className="w-3 h-3 animate-spin" />}
                        </Button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* 参数设置 - 纵向排列（起飞高度和前往目标不在同一行） */}
              <div className="space-y-2">
                <Card className="bg-slate-800 border-slate-700">
                  <CardHeader className="pb-1 px-3 pt-2">
                    <CardTitle className="text-[10px] flex items-center gap-1">
                      <ArrowUp className="w-3 h-3 text-blue-400" />起飞高度
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-2">
                    <div className="flex items-center gap-2">
                      <Input type="number" value={takeoffAlt} onChange={e => setTakeoffAlt(e.target.value)}
                        className="bg-slate-700 border-slate-600 text-white text-xs h-7 flex-1" placeholder="20" />
                      <span className="text-[10px] text-slate-400">米</span>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-slate-800 border-slate-700">
                  <CardHeader className="pb-1 px-3 pt-2">
                    <CardTitle className="text-[10px] flex items-center gap-1">
                      <Navigation className="w-3 h-3 text-cyan-400" />前往目标
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-2 space-y-1.5">
                    <div>
                      <label className="text-[10px] text-slate-400">纬度</label>
                      <Input type="number" step="0.0001" value={gotoLat} onChange={e => setGotoLat(e.target.value)}
                        className="bg-slate-700 border-slate-600 text-white text-xs h-7" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400">经度</label>
                      <Input type="number" step="0.0001" value={gotoLon} onChange={e => setGotoLon(e.target.value)}
                        className="bg-slate-700 border-slate-600 text-white text-xs h-7" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400">高度 (米)</label>
                      <Input type="number" value={gotoAlt} onChange={e => setGotoAlt(e.target.value)}
                        className="bg-slate-700 border-slate-600 text-white text-xs h-7" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* 指令结果 */}
              {(commandResult || commandError) && (
                <div className={`p-2 rounded text-xs ${commandError ? 'bg-red-900/30 border border-red-700' : 'bg-green-900/30 border border-green-700'}`}>
                  {commandError ? (
                    <div className="flex items-center gap-1 text-red-300">
                      <AlertTriangle className="w-3 h-3" /><span>{commandError}</span>
                    </div>
                  ) : commandResult && (
                    <div className="flex items-center gap-1 text-green-300">
                      <Activity className="w-3 h-3" />
                      <span>指令 <strong>{commandResult.commandType}</strong> 已发送至 {commandResult.uavId}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          </div>
        )}

        {/* 右侧: 地图视图 */}
        <div className="flex-1 h-full">
          <MapPanel drones={mapDrones} selectedDroneId={selectedDrone} onDroneClick={setSelectedDrone}
            showDroneList={false} showEventLog={false} />
        </div>
      </div>
    </div>
  );
}
