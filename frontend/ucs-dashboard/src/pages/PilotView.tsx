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
  CheckSquare,
  Square,
  ListChecks,
} from 'lucide-react';
import {
  sendControlCommand,
  getDroneStatus,
  getPilotDrones,
  type DroneInfo,
  type ControlCommandResponse,
} from '@/services/api';
import MapPanel, { type MapDrone } from '@/components/MapPanel';
import { useTelemetryWebSocket, type PartitionTelemetryMessage } from '@/hooks/useTelemetryWebSocket';

interface PilotViewProps {
  token: string;
  username: string;
  partitions?: string[];
  onLogout: () => void;
}

// PX4 command types
const COMMANDS = [
  { type: 'ARM', label: '解锁', icon: Unlock, color: 'bg-green-600 hover:bg-green-700', description: '解锁电机' },
  { type: 'DISARM', label: '锁定', icon: Lock, color: 'bg-slate-600 hover:bg-slate-700', description: '锁定电机' },
  { type: 'TAKEOFF', label: '起飞', icon: ArrowUp, color: 'bg-blue-600 hover:bg-blue-700', description: '自动起飞到指定高度' },
  { type: 'LAND', label: '降落', icon: ArrowDown, color: 'bg-amber-600 hover:bg-amber-700', description: '原地降落' },
  { type: 'RTL', label: '返航', icon: RotateCcw, color: 'bg-purple-600 hover:bg-purple-700', description: '返回起飞点' },
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

export default function PilotView({ token, username, partitions = [], onLogout }: PilotViewProps) {
  const [drones, setDrones] = useState<DroneInfo[]>([]);
  const [selectedDrone, setSelectedDrone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [commandResult, setCommandResult] = useState<ControlCommandResponse | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [sendingCommand, setSendingCommand] = useState<string | null>(null);
  // 快捷指令反馈
  const [quickFeedback, setQuickFeedback] = useState<{ uavId: string; message: string; success: boolean } | null>(null);

  // 详细控制面板显示开关（默认隐藏，点击无人机后显示）
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [detailPanelEnabled, setDetailPanelEnabled] = useState(true);

  // 多选模式
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedDrones, setSelectedDrones] = useState<Set<string>>(new Set());

  // GOTO params
  const [gotoLat, setGotoLat] = useState('39.9042');
  const [gotoLon, setGotoLon] = useState('116.4074');
  const [gotoAlt, setGotoAlt] = useState('50');

  // TAKEOFF params - 默认20米
  const [takeoffAlt, setTakeoffAlt] = useState('20');

  // Real-time telemetry from WebSocket
  const [telemetryDrones, setTelemetryDrones] = useState<Map<string, MapDrone>>(new Map());

  const handlePartitionData = useCallback((data: PartitionTelemetryMessage) => {
    if (!data.drones || data.drones.length === 0) return;
    console.log('[PilotView] handlePartitionData:', data.partition, data.drones.length, 'drones');
    setTelemetryDrones(prev => {
      const next = new Map(prev);
      data.drones.forEach(uav => {
        next.set(uav.uavId, {
          uavId: uav.uavId,
          lat: uav.lat,
          lng: uav.lon,
          altitude: uav.alt,
          battery: undefined,
          flightStatus: uav.armed ? 'FLYING' : 'IDLE',
          onlineStatus: true, // Receiving telemetry = online
          armed: uav.armed ?? uav.isActive ?? false,
        });
      });
      return next;
    });
  }, []);

  // Handle drone removal notification from WebSocket (permission transfer)
  const handleDroneRemoved = useCallback((removedUavIds: string[]) => {
    console.log('[PilotView] Drones removed from partition:', removedUavIds);
    setTelemetryDrones(prev => {
      const next = new Map(prev);
      removedUavIds.forEach(id => next.delete(id));
      return next;
    });
    // Clear selection if the selected drone was removed (don't auto-jump)
    setSelectedDrone(prev => {
      if (prev && removedUavIds.includes(prev)) return null;
      return prev;
    });
  }, []);

  useTelemetryWebSocket({
    enabled: partitions.length > 0,
    partitions,
    onPartitionDataReceived: handlePartitionData,
    onDroneRemoved: handleDroneRemoved,
  });

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

  // 将 DroneInfo 转换为 MapDrone 格式，合并 WebSocket 实时遥测
  const mapDrones: MapDrone[] = (() => {
    const droneMap = new Map<string, MapDrone>();
    drones.forEach(d => {
      droneMap.set(d.uavId, {
        uavId: d.uavId, lat: d.lat, lng: d.lng, altitude: d.altitude,
        battery: d.battery, flightStatus: d.flightStatus, onlineStatus: d.onlineStatus,
        model: d.model, owner: d.owner, teamName: d.teamName, teamLeader: d.teamLeader,
      });
    });
    telemetryDrones.forEach((td, uavId) => {
      const existing = droneMap.get(uavId);
      if (existing) {
        existing.lat = td.lat;
        existing.lng = td.lng;
        existing.altitude = td.altitude;
        existing.onlineStatus = td.onlineStatus;
        existing.armed = td.armed;
        if (td.flightStatus) existing.flightStatus = td.flightStatus;
      } else {
        droneMap.set(uavId, td);
      }
    });
    return Array.from(droneMap.values());
  })();

  // 多选聚合数据
  const multiSelectedDronesList = mapDrones.filter(d => selectedDrones.has(d.uavId));
  const aggregateData = multiSelectedDronesList.length >= 2 ? {
    count: multiSelectedDronesList.length,
    maxAlt: Math.max(...multiSelectedDronesList.map(d => d.altitude ?? 0)),
    minAlt: Math.min(...multiSelectedDronesList.map(d => d.altitude ?? 0)),
    lowBatteryCount: multiSelectedDronesList.filter(d => (d.battery ?? 0) < 20).length,
    onlineCount: multiSelectedDronesList.filter(d => d.onlineStatus === true).length,
    flyingCount: multiSelectedDronesList.filter(d => d.flightStatus === 'FLYING').length,
  } : null;

  const selectedDroneInfo = mapDrones.find(d => d.uavId === selectedDrone);

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
          {/* 多选模式 */}
          <Button variant="outline" size="sm"
            onClick={() => {
              if (!multiSelectMode) {
                // 进入多选模式：清除之前的单选状态
                setSelectedDrones(new Set());
                setShowDetailPanel(false);
                setSelectedDrone(null);
              } else {
                // 退出多选模式：清除多选状态
                setSelectedDrones(new Set());
              }
              setMultiSelectMode(!multiSelectMode);
            }}
            className={`text-xs ${multiSelectMode ? 'bg-amber-600/30 border-amber-500 text-amber-300' : 'bg-slate-700/50 border-slate-500/50 text-slate-400'}`}
            title={multiSelectMode ? '退出多选' : '多选模式'}>
            <ListChecks className="w-4 h-4 mr-1" />
            多选
          </Button>
          {/* 显示/隐藏详细控制面板的勾选按钮 */}
          <Button variant="outline" size="sm"
            onClick={() => {
              const newEnabled = !detailPanelEnabled;
              setDetailPanelEnabled(newEnabled);
              if (!newEnabled) {
                // 关闭详情面板按钮 -> 隐藏面板
                setShowDetailPanel(false);
              } else {
                // 开启详情面板按钮 -> 如果有选中无人机则立即显示
                if (selectedDrone) setShowDetailPanel(true);
              }
            }}
            className={`text-xs ${detailPanelEnabled ? 'bg-blue-600/30 border-blue-500 text-blue-300' : 'bg-slate-700/50 border-slate-500/50 text-slate-400'}`}
            title={detailPanelEnabled ? '禁用详情面板' : '启用详情面板'}>
            {detailPanelEnabled ? <Eye className="w-4 h-4 mr-1" /> : <EyeOff className="w-4 h-4 mr-1" />}
            详情面板
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
          {mapDrones.length === 0 && <p className="text-slate-500 text-xs text-center py-6">暂无可控制的无人机</p>}
          {[...mapDrones].sort((a, b) => {
            const aO = a.onlineStatus === true ? 1 : 0, bO = b.onlineStatus === true ? 1 : 0;
            if (aO !== bO) return bO - aO;
            const aA = a.armed === true ? 1 : 0, bA = b.armed === true ? 1 : 0;
            return bA - aA;
          }).map(drone => (
            <div key={drone.uavId}
              className={`p-2 rounded text-xs cursor-pointer transition-all ${
                multiSelectMode && selectedDrones.has(drone.uavId) ? 'bg-amber-900/40 border border-amber-500' :
                selectedDrone === drone.uavId
                  ? 'bg-blue-900/50 border border-blue-500'
                  : 'bg-slate-700 border border-slate-600 hover:border-slate-500'
              }`}
              onClick={() => {
                if (multiSelectMode) {
                  // 多选模式：切换选中状态
                  const newSet = new Set(selectedDrones);
                  if (newSet.has(drone.uavId)) {
                    newSet.delete(drone.uavId);
                  } else {
                    newSet.add(drone.uavId);
                  }
                  setSelectedDrones(newSet);
                  // 多选模式下：选中1个显示详情面板，选中2+显示聚合面板（均受 detailPanelEnabled 控制）
                  if (newSet.size === 1) {
                    const singleId = Array.from(newSet)[0];
                    setSelectedDrone(singleId);
                    setShowDetailPanel(detailPanelEnabled);
                  } else if (newSet.size === 0) {
                    setSelectedDrone(null);
                    setShowDetailPanel(false);
                  } else {
                    // 2+ 选中，由 aggregateData 面板接管（同样受 detailPanelEnabled 控制）
                    setShowDetailPanel(false);
                  }
                } else if (selectedDrone === drone.uavId) {
                  setShowDetailPanel(false);
                  setSelectedDrone(null);
                } else {
                  setSelectedDrone(drone.uavId);
                  // 详情面板显示条件：detailPanelEnabled && 有选中无人机
                  setShowDetailPanel(detailPanelEnabled);
                }
              }}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-bold text-blue-300 flex items-center gap-1">
                  {multiSelectMode && (selectedDrones.has(drone.uavId)
                    ? <CheckSquare className="w-3 h-3 text-amber-400" />
                    : <Square className="w-3 h-3 text-slate-500" />)}
                  {drone.uavId}
                </span>
                <Badge className={`text-[10px] px-1 py-0 ${
                  !drone.onlineStatus ? 'bg-slate-600' : drone.armed === true ? 'bg-green-600' : 'bg-blue-600'
                }`}>
                  {!drone.onlineStatus ? '离线' : drone.armed === true ? '已解锁' : '未解锁'}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-slate-400 mb-1">
                <span className="flex items-center gap-0.5"><Battery className="w-2.5 h-2.5" />{drone.battery != null ? `${drone.battery}%` : 'N/A'}</span>
                <span className="flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{drone.altitude != null ? `${drone.altitude.toFixed(2)}m` : 'N/A'}</span>
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

        {/* 中间: 多选聚合数据面板（受 detailPanelEnabled 控制） */}
        {multiSelectMode && aggregateData && detailPanelEnabled && (
          <div className="w-[300px] min-w-[260px] bg-slate-900 border-r border-slate-700 overflow-y-auto p-3 space-y-3">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader className="pb-2 px-3 pt-3">
                <CardTitle className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1">
                    <ListChecks className="w-3 h-3 text-amber-400" />多机聚合信息
                  </div>
                  <Badge className="bg-amber-600 text-[10px]">{aggregateData.count} 架</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-700/50 rounded p-2 text-center">
                    <div className="text-[10px] text-slate-400 mb-0.5">最高高度</div>
                    <div className="text-sm font-bold text-blue-300">{aggregateData.maxAlt.toFixed(2)}m</div>
                  </div>
                  <div className="bg-slate-700/50 rounded p-2 text-center">
                    <div className="text-[10px] text-slate-400 mb-0.5">最低高度</div>
                    <div className="text-sm font-bold text-cyan-300">{aggregateData.minAlt.toFixed(2)}m</div>
                  </div>
                  <div className="bg-slate-700/50 rounded p-2 text-center">
                    <div className="text-[10px] text-slate-400 mb-0.5">低电量</div>
                    <div className="text-sm font-bold text-red-400">{aggregateData.lowBatteryCount} 架</div>
                  </div>
                  <div className="bg-slate-700/50 rounded p-2 text-center">
                    <div className="text-[10px] text-slate-400 mb-0.5">在线</div>
                    <div className="text-sm font-bold text-green-400">{aggregateData.onlineCount} 架</div>
                  </div>
                  <div className="bg-slate-700/50 rounded p-2 text-center col-span-2">
                    <div className="text-[10px] text-slate-400 mb-0.5">飞行中</div>
                    <div className="text-sm font-bold text-green-300">{aggregateData.flyingCount} 架</div>
                  </div>
                </div>
                {/* 多机批量控制 */}
                <div className="mt-3">
                  <div className="text-[10px] text-slate-400 mb-1">批量控制指令</div>
                  <div className="grid grid-cols-4 gap-1">
                    {COMMANDS.map(cmd => {
                      const Icon = cmd.icon;
                      return (
                        <Button key={cmd.type}
                          className={`h-auto py-1.5 flex flex-col items-center gap-0.5 ${cmd.color} text-white text-[10px]`}
                          onClick={() => { multiSelectedDronesList.forEach(d => handleCommand(cmd.type, d.uavId)); }}>
                          <Icon className="w-3 h-3" />
                          <span className="font-bold text-[9px]">{cmd.label}</span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
                {/* 已选无人机列表 */}
                <div className="mt-3">
                  <div className="text-[10px] text-slate-400 mb-1">已选无人机</div>
                  <div className="space-y-0.5 max-h-32 overflow-y-auto">
                    {multiSelectedDronesList.map(d => (
                      <div key={d.uavId} className="flex items-center justify-between text-[10px] bg-slate-700/50 rounded px-2 py-1">
                        <span className="text-blue-300">{d.uavId}</span>
                        <span className="text-slate-400">{d.battery != null ? `${d.battery}%` : 'N/A'} | {d.altitude != null ? `${d.altitude.toFixed(2)}m` : 'N/A'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 中间: 详细控制面板（可通过顶部按钮隐藏/显示） */}
        {showDetailPanel && !aggregateData && (
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
                        <div className="text-sm font-bold">{selectedDroneInfo.altitude != null ? `${selectedDroneInfo.altitude.toFixed(2)}m` : 'N/A'}</div>
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
                  <div className="grid grid-cols-3 gap-1">
                    {COMMANDS.map(cmd => {
                      const Icon = cmd.icon;
                      return (
                        <Button key={cmd.type}
                          className={`h-auto py-1.5 flex flex-col items-center gap-0.5 ${cmd.color} text-white text-[10px]`}
                          onClick={() => handleCommand(cmd.type)} disabled={sendingCommand !== null}>
                          <Icon className="w-3.5 h-3.5" />
                          <span className="font-bold">{cmd.label}</span>
                          {sendingCommand === cmd.type && <RefreshCw className="w-3 h-3 animate-spin" />}
                        </Button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* 参数设置 - 起飞高度 + 前往目标（纵向排列，空间充足） */}
              <div className="space-y-1.5">
                <Card className="bg-slate-800 border-slate-700">
                  <CardContent className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 whitespace-nowrap flex items-center gap-0.5"><ArrowUp className="w-2.5 h-2.5 text-blue-400" />起飞高度</span>
                      <Input type="number" value={takeoffAlt} onChange={e => setTakeoffAlt(e.target.value)}
                        className="bg-slate-700 border-slate-600 text-white text-xs h-7 flex-1" placeholder="20" />
                      <span className="text-[10px] text-slate-400">米</span>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-slate-800 border-slate-700">
                  <CardContent className="px-3 py-2 space-y-1.5">
                    <div className="flex items-center gap-1 text-[10px] text-slate-400"><Navigation className="w-2.5 h-2.5 text-cyan-400" />前往目标</div>
                    <div className="space-y-1">
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
                    </div>
                    <Button className="w-full text-xs h-7 bg-cyan-600 hover:bg-cyan-700 text-white"
                      onClick={() => handleCommand('GOTO')} disabled={sendingCommand !== null}>
                      <Navigation className="w-3 h-3 mr-1" />前往
                    </Button>
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
          <MapPanel drones={mapDrones} selectedDroneId={selectedDrone}
            selectedDroneIds={multiSelectMode ? selectedDrones : undefined}
            onDroneClick={(id) => {
              if (multiSelectMode) {
                // 多选模式下地图点击也切换选中状态
                const newSet = new Set(selectedDrones);
                if (newSet.has(id)) { newSet.delete(id); } else { newSet.add(id); }
                setSelectedDrones(newSet);
                if (newSet.size === 1) {
                  const singleId = Array.from(newSet)[0];
                  setSelectedDrone(singleId);
                  // 详情面板显示条件：detailPanelEnabled && 有选中无人机
                  setShowDetailPanel(detailPanelEnabled);
                } else if (newSet.size === 0) {
                  setSelectedDrone(null);
                  setShowDetailPanel(false);
                } else {
                  setShowDetailPanel(false);
                }
              } else {
                // 单选模式：点击同时高亮 + 显示详情
                if (selectedDrone === id) {
                  setShowDetailPanel(false);
                  setSelectedDrone(null);
                } else {
                  setSelectedDrone(id);
                  // 详情面板显示条件：detailPanelEnabled && 有选中无人机
                  setShowDetailPanel(detailPanelEnabled);
                }
              }
            }}
            showDroneList={false} showEventLog={false} />
        </div>
      </div>
    </div>
  );
}
