import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Plane,
  Shield,
  FileText,
  Users,
  RefreshCw,
  LogOut,
  ArrowRightLeft,
  Battery,
  Activity,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelRightClose,
  PanelLeftOpen,
  PanelRightOpen,
} from 'lucide-react';
import {
  getFleetOverview,
  transferPermission,
  transferPermissionToTeam,
  getOperationLogs,
  getLogsByType,
  getCommanderTeams,
  getTeamMembers,
  getCommanderUsers,
  type DroneInfo,
  type OperationLog,
} from '@/services/api';
import MapPanel, { type MapDrone } from '@/components/MapPanel';
import { useTelemetryWebSocket, type PartitionTelemetryMessage } from '@/hooks/useTelemetryWebSocket';
import { PieChart, Pie, BarChart, Bar, Cell, Tooltip, ResponsiveContainer } from 'recharts';

interface CommanderViewProps {
  token: string;
  username: string;
  partitions?: string[];
  onLogout: () => void;
}

export default function CommanderView({ token, username, partitions = [], onLogout }: CommanderViewProps) {
  // Fleet state
  const [drones, setDrones] = useState<DroneInfo[]>([]);
  const [loading, setLoading] = useState(false);

  // Permission transfer state
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [selectedUavIds, setSelectedUavIds] = useState<string[]>([]);
  const [toUserId, setToUserId] = useState('');
  const [toTeamId, setToTeamId] = useState('');
  const [transferMode, setTransferMode] = useState<'user' | 'team'>('team');
  const [transferReason, setTransferReason] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferResult, setTransferResult] = useState<{ success: boolean; message: string } | null>(null);

  // Operation logs state
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [logPage, setLogPage] = useState(0);
  const [logTotalPages, setLogTotalPages] = useState(0);
  const [logFilter, setLogFilter] = useState('ALL');
  const [logLoading, setLogLoading] = useState(false);
  const [logPageSize, setLogPageSize] = useState(10);

  // Chart state
  const [chartType, setChartType] = useState<'pie' | 'bar'>('pie');

  // Active tab state
  const [activeTab, setActiveTab] = useState<'fleet' | 'permission' | 'logs' | 'teams'>('fleet');

  // Teams state
  const [teams, setTeams] = useState<Array<{ teamId: string; teamName: string; leader: string; memberCount: number; droneCount?: number; description?: string }>>([]);
  const [teamMembers, setTeamMembers] = useState<Record<string, Array<{ userId: string; username: string; realName: string; role: string; name?: string }>>>({});
  // 修复: 使用 Set 支持多个团队同时展开
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());

  // 可折叠面板状态
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);

  // 地图选中的无人机
  const [selectedMapDrone, setSelectedMapDrone] = useState<string | null>(null);

  // Real-time telemetry drones from WebSocket partition subscription
  const [telemetryDrones, setTelemetryDrones] = useState<Map<string, MapDrone>>(new Map());

  // WebSocket telemetry handler - updates drone positions in real-time
  const handlePartitionData = useCallback((data: PartitionTelemetryMessage) => {
    if (!data.drones || data.drones.length === 0) return;
    console.log('[CommanderView] handlePartitionData:', data.partition, data.drones.length, 'drones');
    setTelemetryDrones(prev => {
      const next = new Map(prev);
      data.drones.forEach(uav => {
        next.set(uav.uavId, {
          uavId: uav.uavId,
          lat: uav.lat,
          lng: uav.lon,
          altitude: uav.alt,
          battery: uav.batteryPercent != null && uav.batteryPercent >= 0 ? uav.batteryPercent : undefined,
          flightStatus: uav.armed ? 'FLYING' : 'IDLE',
          onlineStatus: true, // Receiving telemetry = online
          armed: uav.armed ?? uav.isActive ?? false,
          model: undefined,
          owner: undefined,
          heading: uav.heading,
        });
      });
      return next;
    });
  }, []);

  // Handle drone removal notification from WebSocket (permission transfer)
  const handleDroneRemoved = useCallback((removedUavIds: string[]) => {
    console.log('[CommanderView] Drones removed from partition:', removedUavIds);
    setTelemetryDrones(prev => {
      const next = new Map(prev);
      removedUavIds.forEach(id => next.delete(id));
      return next;
    });
    // Clear selection if the selected drone was removed (don't auto-jump)
    setSelectedMapDrone(prev => {
      if (prev && removedUavIds.includes(prev)) return null;
      return prev;
    });
  }, []);

  // Subscribe to partition-specific WebSocket topics for real-time telemetry
  useTelemetryWebSocket({
    enabled: partitions.length > 0,
    partitions,
    onPartitionDataReceived: handlePartitionData,
    onDroneRemoved: handleDroneRemoved,
  });

  // 快捷转接弹窗状态
  const [quickTransferOpen, setQuickTransferOpen] = useState(false);
  const [quickTransferUavId, setQuickTransferUavId] = useState('');
  const [quickTransferMode, setQuickTransferMode] = useState<'user' | 'team'>('team');
  const [quickTransferToUserId, setQuickTransferToUserId] = useState('');
  const [quickTransferToTeamId, setQuickTransferToTeamId] = useState('');
  const [quickTransferLoading, setQuickTransferLoading] = useState(false);
  const [quickTransferResult, setQuickTransferResult] = useState<{ success: boolean; message: string } | null>(null);

  // 注册用户列表（用于下拉选择）
  const [registeredUsers, setRegisteredUsers] = useState<Array<{ userId: number; username: string; realName: string; role: string }>>([]);

  // Fetch fleet data
  const fetchFleet = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getFleetOverview(token);
      if (res.code === 0 && res.data) {
        const data = res.data as unknown as Record<string, unknown>;
        setDrones(Array.isArray(data.drones) ? data.drones as DroneInfo[] : (Array.isArray(res.data) ? res.data : []));
      }
    } catch (err) {
      console.error('Failed to fetch fleet:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Dynamic log page size based on viewport
  useEffect(() => {
    const calculatePageSize = () => {
      // Each log item ~68px, overhead ~220px (header, tabs, filters, pagination)
      const available = window.innerHeight - 220;
      setLogPageSize(Math.max(5, Math.floor(available / 68)));
    };
    calculatePageSize();
    window.addEventListener('resize', calculatePageSize);
    return () => window.removeEventListener('resize', calculatePageSize);
  }, []);

  // Fetch operation logs
  const fetchLogs = useCallback(async (page: number = 0, filter: string = 'ALL') => {
    setLogLoading(true);
    try {
      const res = filter === 'ALL'
        ? await getOperationLogs(token, page, logPageSize)
        : await getLogsByType(token, filter, page, logPageSize);
      if (res.code === 0 && res.data) {
        setLogs(res.data.content || []);
        setLogTotalPages(res.data.totalPages || 0);
        setLogPage(page);
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    } finally {
      setLogLoading(false);
    }
  }, [token, logPageSize]);

  // Fetch teams via commander API (fixes Issue #2: "暂无团队数据")
  const fetchTeams = useCallback(async () => {
    try {
      const res = await getCommanderTeams(token);
      if (res.code === 0 && res.data) {
        setTeams(Array.isArray(res.data) ? res.data : []);
      }
    } catch (err) {
      console.error('Failed to fetch teams:', err);
    }
  }, [token]);

  // Fetch team members
  const fetchMembers = useCallback(async (teamId: string) => {
    try {
      const res = await getTeamMembers(token, teamId);
      if (res.code === 0 && res.data) {
        // 后端TeamMemberDTO返回 name 字段，前端需要映射为 realName
        const mapped = (Array.isArray(res.data) ? res.data : []).map((m: Record<string, unknown>) => ({
          userId: (m.userId as string) || '',
          username: (m.name as string) || (m.username as string) || '',
          realName: (m.name as string) || (m.realName as string) || '',
          role: (m.role as string) || '',
        }));
        setTeamMembers(prev => ({ ...prev, [teamId]: mapped }));
      }
    } catch (err) {
      console.error('Failed to fetch team members:', err);
    }
  }, [token]);

  // 获取注册用户列表（下拉选择用）
  const fetchUsers = useCallback(async () => {
    try {
      const res = await getCommanderUsers(token);
      if (res.code === 0 && res.data) {
        setRegisteredUsers(Array.isArray(res.data) ? res.data : []);
      }
    } catch (err) { console.error(err); }
  }, [token]);

  useEffect(() => {
    fetchFleet();
    fetchLogs(0, 'ALL');
    fetchTeams();
    fetchUsers();
    const interval = setInterval(fetchFleet, 5000);
    return () => clearInterval(interval);
  }, [fetchFleet, fetchLogs, fetchTeams, fetchUsers]);

  // Toggle drone selection for permission transfer
  const toggleDroneSelection = (uavId: string) => {
    setSelectedUavIds(prev =>
      prev.includes(uavId)
        ? prev.filter(id => id !== uavId)
        : [...prev, uavId]
    );
  };

  // Handle permission transfer (supports both user and team targets)
  const handleTransfer = async () => {
    if (selectedUavIds.length === 0) return;
    if (transferMode === 'user' && !toUserId) return;
    if (transferMode === 'team' && !toTeamId) return;
    setTransferLoading(true);
    setTransferResult(null);
    try {
      let res;
      if (transferMode === 'team') {
        // Issue #4: Transfer to team (assigns to team leader)
        res = await transferPermissionToTeam(token, selectedUavIds, parseInt(toTeamId));
      } else {
        res = await transferPermission(token, {
          uavIds: selectedUavIds,
          toUserId: parseInt(toUserId),
          reason: transferReason || '指挥员操作',
        });
      }
      if (res.code === 0) {
        setTransferResult({ success: true, message: '权限转移成功' });
        setSelectedUavIds([]);
        setToUserId('');
        setToTeamId('');
        setTransferReason('');
        fetchFleet();
        fetchTeams();
        fetchLogs(0, logFilter);
      } else {
        setTransferResult({ success: false, message: res.msg || '权限转移失败' });
      }
    } catch {
      setTransferResult({ success: false, message: '网络错误' });
    } finally {
      setTransferLoading(false);
    }
  };

  // 快捷转接处理
  const handleQuickTransfer = async () => {
    if (!quickTransferUavId) return;
    if (quickTransferMode === 'user' && !quickTransferToUserId) return;
    if (quickTransferMode === 'team' && !quickTransferToTeamId) return;
    setQuickTransferLoading(true);
    setQuickTransferResult(null);
    try {
      let res;
      if (quickTransferMode === 'team') {
        res = await transferPermissionToTeam(token, [quickTransferUavId], parseInt(quickTransferToTeamId));
      } else {
        res = await transferPermission(token, {
          uavIds: [quickTransferUavId],
          toUserId: parseInt(quickTransferToUserId),
          reason: '快捷转接',
        });
      }
      if (res.code === 0) {
        setQuickTransferResult({ success: true, message: '转接成功' });
        fetchFleet();
        fetchTeams();
        fetchLogs(0, logFilter);
        setTimeout(() => { setQuickTransferOpen(false); setQuickTransferResult(null); }, 1500);
      } else {
        setQuickTransferResult({ success: false, message: res.msg || '转接失败' });
      }
    } catch {
      setQuickTransferResult({ success: false, message: '网络错误' });
    } finally {
      setQuickTransferLoading(false);
    }
  };

  // 修复: 支持多个团队同时展开
  const handleTeamExpand = (teamId: string) => {
    setExpandedTeams(prev => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
        if (!teamMembers[teamId]) fetchMembers(teamId);
      }
      return next;
    });
  };

  // Log type options
  const LOG_TYPES = [
    { value: 'ALL', label: '全部' },
    { value: 'CONTROL_COMMAND', label: '控制指令' },
    { value: 'PERMISSION_TRANSFER', label: '权限转移' },
    { value: 'BATCH_CONTROL', label: '批量控制' },
  ];

  const formatTime = (ts: string) => {
    if (!ts) return '-';
    try {
      return new Date(ts).toLocaleString('zh-CN');
    } catch {
      return ts;
    }
  };

  const getOperationBadgeColor = (type: string) => {
    switch (type) {
      case 'CONTROL_COMMAND': return 'bg-blue-600';
      case 'PERMISSION_TRANSFER': return 'bg-purple-600';
      case 'BATCH_CONTROL': return 'bg-cyan-600';
      default: return 'bg-slate-600';
    }
  };

  const getResultBadgeColor = (result: string) => {
    if (result === 'SUCCESS') return 'bg-green-600';
    if (result === 'FAILURE') return 'bg-red-600';
    return 'bg-slate-600';
  };

  // 将 DroneInfo 转换为 MapDrone 格式，并合并 WebSocket 实时遥测数据
  const mapDrones: MapDrone[] = (() => {
    // Start with REST API drones
    const droneMap = new Map<string, MapDrone>();
    drones.forEach(d => {
      droneMap.set(d.uavId, {
        uavId: d.uavId, lat: d.lat, lng: d.lng, altitude: d.altitude,
        battery: d.battery, flightStatus: d.flightStatus, onlineStatus: d.onlineStatus,
        model: d.model, owner: d.owner, teamName: d.teamName, teamLeader: d.teamLeader,
        controlOwnerName: d.controlOwnerName,
      });
    });
    // Merge real-time telemetry data (WebSocket takes priority for position/battery)
    telemetryDrones.forEach((td, uavId) => {
      const existing = droneMap.get(uavId);
      if (existing) {
        // Update position from real-time telemetry
        existing.lat = td.lat;
        existing.lng = td.lng;
        existing.altitude = td.altitude;
        existing.onlineStatus = td.onlineStatus;
        existing.armed = td.armed;
        if (td.battery != null) existing.battery = td.battery;
        if (td.flightStatus) existing.flightStatus = td.flightStatus;
      } else {
        // New drone only seen via WebSocket telemetry
        droneMap.set(uavId, td);
      }
    });
    const result = Array.from(droneMap.values());
    if (telemetryDrones.size > 0) {
      console.log('[CommanderView] mapDrones:', result.length, 'total,', telemetryDrones.size, 'from WS');
    }
    return result;
  })();

  // Chart data for fleet overview
  const droneChartData = useMemo(() => {
    const armed = mapDrones.filter(d => d.onlineStatus === true && d.armed === true).length;
    const disarmed = mapDrones.filter(d => d.onlineStatus === true && d.armed !== true).length;
    const offline = mapDrones.filter(d => !d.onlineStatus).length;
    return [
      { name: '在线已解锁', value: armed, color: '#22c55e' },
      { name: '在线未解锁', value: disarmed, color: '#3b82f6' },
      { name: '离线', value: offline, color: '#64748b' },
    ].filter(d => d.value > 0);
  }, [mapDrones]);

  // 事件日志格式化为地图面板使用
  const eventLogsForMap = logs.slice(0, 20).map(log => ({
    id: log.id, time: formatTime(log.createdAt),
    detail: log.detail || log.operationType, result: log.result,
  }));

  return (
    <div className="h-screen bg-slate-900 text-white flex flex-col overflow-hidden">
      {/* 顶部栏 */}
      <header className="flex justify-between items-center px-4 py-2 bg-slate-800 border-b border-slate-700">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Shield className="w-6 h-6 text-amber-400" />
          指挥员控制台
          <Badge variant="outline" className="ml-2 text-amber-300 border-amber-500">{username}</Badge>
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setLeftPanelCollapsed(!leftPanelCollapsed)}
            className="bg-slate-700/50 border-slate-500/50 text-slate-100 hover:bg-slate-600/50"
            title={leftPanelCollapsed ? '展开左侧面板' : '收起左侧面板'}>
            {leftPanelCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRightPanelCollapsed(!rightPanelCollapsed)}
            className="bg-slate-700/50 border-slate-500/50 text-slate-100 hover:bg-slate-600/50"
            title={rightPanelCollapsed ? '展开右侧面板' : '收起右侧面板'}>
            {rightPanelCollapsed ? <PanelRightOpen className="w-4 h-4" /> : <PanelRightClose className="w-4 h-4" />}
          </Button>
          <Button variant="outline" size="sm" onClick={() => { fetchFleet(); fetchLogs(logPage, logFilter); fetchTeams(); }}
            disabled={loading} className="bg-slate-700/50 border-slate-500/50 text-slate-100 hover:bg-slate-600/50">
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />刷新
          </Button>
          <Button variant="outline" size="sm" onClick={onLogout}
            className="bg-slate-700/50 border-slate-500/50 text-slate-100 hover:bg-slate-600/50">
            <LogOut className="w-4 h-4 mr-1" />退出
          </Button>
        </div>
      </header>

      {/* 主体: 左右分栏布局 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧面板: 控制功能 - 右侧收起时自动扩展 */}
          <div className={`${leftPanelCollapsed ? 'w-0 min-w-0 overflow-hidden' : rightPanelCollapsed ? 'flex-1' : 'w-[420px] min-w-[320px]'} bg-slate-900 border-r border-slate-700 flex flex-col transition-all duration-500 ease-in-out`}>
            {/* Tab 切换 */}
            <div className="flex gap-0.5 bg-slate-800 border-b border-slate-700 p-1">
              <button onClick={() => setActiveTab('fleet')}
                className={`flex items-center px-2 py-1 rounded text-xs transition-colors ${activeTab === 'fleet' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
                <Plane className="w-3 h-3 mr-1" />机队
              </button>
              <button onClick={() => setActiveTab('permission')}
                className={`flex items-center px-2 py-1 rounded text-xs transition-colors ${activeTab === 'permission' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
                <ArrowRightLeft className="w-3 h-3 mr-1" />权限
              </button>
              <button onClick={() => { setActiveTab('logs'); fetchLogs(0, logFilter); }}
                className={`flex items-center px-2 py-1 rounded text-xs transition-colors ${activeTab === 'logs' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
                <FileText className="w-3 h-3 mr-1" />日志
              </button>
              <button onClick={() => setActiveTab('teams')}
                className={`flex items-center px-2 py-1 rounded text-xs transition-colors ${activeTab === 'teams' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
                <Users className="w-3 h-3 mr-1" />团队
              </button>
            </div>

            {/* Tab 内容 */}
            <div className="flex-1 overflow-auto p-3">
              {/* 机队总览 */}
              {activeTab === 'fleet' && (
                <div className="flex flex-col h-full">
                  {/* 统计卡片 - 始终固定显示 */}
                  <div className="grid grid-cols-4 gap-1.5 mb-2 flex-shrink-0">
                    <Card className="bg-slate-800 border-slate-700"><CardContent className="p-1.5 text-center">
                      <div className="text-base font-bold text-blue-400">{mapDrones.length}</div>
                      <div className="text-[9px] text-slate-400">总数</div>
                    </CardContent></Card>
                    <Card className="bg-slate-800 border-slate-700"><CardContent className="p-1.5 text-center">
                      <div className="text-base font-bold text-green-400">{mapDrones.filter(d => d.armed === true).length}</div>
                      <div className="text-[9px] text-slate-400">已解锁</div>
                    </CardContent></Card>
                    <Card className="bg-slate-800 border-slate-700"><CardContent className="p-1.5 text-center">
                      <div className="text-base font-bold text-cyan-400">{mapDrones.filter(d => d.onlineStatus === true).length}</div>
                      <div className="text-[9px] text-slate-400">在线</div>
                    </CardContent></Card>
                    <Card className="bg-slate-800 border-slate-700"><CardContent className="p-1.5 text-center">
                      <div className="text-base font-bold text-red-400">{mapDrones.filter(d => (d.battery || 0) < 20).length}</div>
                      <div className="text-[9px] text-slate-400">低电量</div>
                    </CardContent></Card>
                  </div>
                  {/* 状态分布图表 */}
                  {droneChartData.length > 0 && (
                    <div className="mb-2 flex-shrink-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-slate-400">状态分布</span>
                        <div className="flex gap-0.5">
                          <button onClick={() => setChartType('pie')}
                            className={`text-[9px] px-1.5 py-0.5 rounded ${chartType === 'pie' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}>饼图</button>
                          <button onClick={() => setChartType('bar')}
                            className={`text-[9px] px-1.5 py-0.5 rounded ${chartType === 'bar' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}>柱状图</button>
                        </div>
                      </div>
                      <div className="bg-slate-800 rounded border border-slate-700 p-1" style={{ height: 120 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          {chartType === 'pie' ? (
                            <PieChart>
                              <Pie data={droneChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={40}
                                animationDuration={600} label={({ name, value }) => `${name}: ${value}`}
                                labelLine={false} fontSize={9}>
                                {droneChartData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                              </Pie>
                              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569', fontSize: 11 }} />
                            </PieChart>
                          ) : (
                            <BarChart data={droneChartData}>
                              <Bar dataKey="value" animationDuration={600} radius={[4, 4, 0, 0]}>
                                {droneChartData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                              </Bar>
                              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569', fontSize: 11 }}
                                formatter={(value: number, name: string, props: { payload?: { name?: string } }) => [value, props.payload?.name || name]} />
                            </BarChart>
                          )}
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                  {/* 无人机列表（在线优先排序）- 独立滚动区域 */}
                  <div className="flex-1 overflow-y-auto space-y-1 scrollbar-thin" style={{ scrollbarWidth: 'thin', scrollbarColor: '#475569 #1e293b' }}>
                    {[...mapDrones].sort((a, b) => {
                      const aO = a.onlineStatus === true ? 1 : 0, bO = b.onlineStatus === true ? 1 : 0;
                      if (aO !== bO) return bO - aO;
                      const aA = a.armed === true ? 1 : 0, bA = b.armed === true ? 1 : 0;
                      return bA - aA;
                    }).map(drone => (
                      <div key={drone.uavId}
                        className={`p-2 rounded text-xs cursor-pointer transition-all ${selectedMapDrone === drone.uavId ? 'bg-blue-900/50 border border-blue-500' : 'bg-slate-800 border border-slate-700 hover:border-slate-500'}`}
                        onClick={() => setSelectedMapDrone(prev => prev === drone.uavId ? null : drone.uavId)}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="font-bold text-blue-300">{drone.uavId}</span>
                          <div className="flex items-center gap-1">
                            <Badge className={`text-[10px] px-1 py-0 ${!drone.onlineStatus ? 'bg-slate-600' : drone.armed === true ? 'bg-green-600' : 'bg-blue-600'}`}>
                              {!drone.onlineStatus ? '离线' : drone.armed === true ? '已解锁' : '未解锁'}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-slate-400">
                          <span className="flex items-center gap-0.5"><Battery className="w-2.5 h-2.5" />{drone.battery != null ? `${drone.battery.toFixed(1)}%` : 'N/A'}</span>
                          <span>{drone.altitude != null ? `${drone.altitude.toFixed(2)}m` : ''}</span>
                          <span className="text-slate-500">{drone.teamName || ''}</span>
                          {drone.teamLeader && <span className="text-slate-500">队长:{drone.teamLeader}</span>}
                          {drone.controlOwnerName && <span className="text-amber-400">控制:{drone.controlOwnerName}</span>}
                          <Button size="sm" variant="outline"
                            className="text-[9px] h-4 px-1 py-0 bg-purple-700/30 border-purple-600/50 text-purple-300 hover:bg-purple-600 ml-auto"
                            onClick={e => {
                              e.stopPropagation();
                              setQuickTransferUavId(drone.uavId);
                              setQuickTransferMode('team');
                              setQuickTransferToUserId('');
                              setQuickTransferToTeamId('');
                              setQuickTransferResult(null);
                              setQuickTransferOpen(true);
                            }}>
                            <ArrowRightLeft className="w-2 h-2 mr-0.5" />转接
                          </Button>
                        </div>
                      </div>
                    ))}
                    {mapDrones.length === 0 && <div className="text-center text-slate-500 py-4 text-xs">暂无无人机数据</div>}
                  </div>
                </div>
              )}

              {/* 权限管理 */}
              {activeTab === 'permission' && (
                <div className="space-y-3">
                  <Card className="bg-slate-800 border-slate-700">
                    <CardHeader className="pb-2 px-3 pt-3">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <ArrowRightLeft className="w-4 h-4 text-purple-400" />控制权限转移
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-3">
                      <p className="text-xs text-slate-400 mb-3">选择无人机，指定目标队伍或用户。转移至队伍时自动分配给队长。</p>
                      <div className="mb-3">
                        <label className="text-xs text-slate-300 mb-1 block">选择无人机</label>
                        <div className="flex flex-wrap gap-1">
                          {drones.map(drone => (
                            <Button key={drone.uavId} size="sm"
                              variant={selectedUavIds.includes(drone.uavId) ? 'default' : 'outline'}
                              className={`text-xs h-6 px-2 ${selectedUavIds.includes(drone.uavId) ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'}`}
                              onClick={() => toggleDroneSelection(drone.uavId)}>{drone.uavId}</Button>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-1 mb-3">
                        <Button size="sm" variant={transferMode === 'team' ? 'default' : 'outline'}
                          className={`text-xs h-7 ${transferMode === 'team' ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}`}
                          onClick={() => setTransferMode('team')}>转移至队伍</Button>
                        <Button size="sm" variant={transferMode === 'user' ? 'default' : 'outline'}
                          className={`text-xs h-7 ${transferMode === 'user' ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}`}
                          onClick={() => setTransferMode('user')}>转移至个人</Button>
                      </div>
                      <div className="space-y-2 mb-3">
                        {transferMode === 'team' ? (
                          <div>
                            <label className="text-xs text-slate-300 mb-1 block">目标队伍</label>
                            <select value={toTeamId} onChange={e => setToTeamId(e.target.value)}
                              className="w-full rounded-md bg-slate-700 border-slate-600 text-white px-2 py-1.5 text-xs">
                              <option value="">选择队伍...</option>
                              {teams.map(team => (
                                <option key={team.teamId} value={team.teamId.replace('T', '')}>{team.teamName} ({team.leader || '无队长'})</option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div>
                            <label className="text-xs text-slate-300 mb-1 block">目标用户</label>
                            <select value={toUserId} onChange={e => setToUserId(e.target.value)}
                              className="w-full rounded-md bg-slate-700 border-slate-600 text-white px-2 py-1.5 text-xs">
                              <option value="">选择用户...</option>
                              {registeredUsers.map(user => (
                                <option key={user.userId} value={user.userId}>{user.realName || user.username} ({user.role || '无角色'})</option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div>
                          <label className="text-xs text-slate-300 mb-1 block">转移原因</label>
                          <Input value={transferReason} onChange={e => setTransferReason(e.target.value)}
                            placeholder="输入转移原因" className="bg-slate-700 border-slate-600 text-white text-xs h-8" />
                        </div>
                      </div>
                      <Button onClick={() => setTransferDialogOpen(true)}
                        disabled={selectedUavIds.length === 0 || (transferMode === 'user' ? !toUserId : !toTeamId)}
                        className="bg-purple-600 hover:bg-purple-700 text-xs h-8 w-full">
                        <ArrowRightLeft className="w-3 h-3 mr-1" />
                        确认转移 ({selectedUavIds.length} 架)
                      </Button>
                      {transferResult && (
                        <div className={`mt-2 p-2 rounded text-xs ${transferResult.success ? 'bg-green-900/30 border border-green-700' : 'bg-red-900/30 border border-red-700'}`}>
                          <div className="flex items-center gap-1">
                            {transferResult.success ? <Activity className="w-3 h-3 text-green-400" /> : <AlertTriangle className="w-3 h-3 text-red-400" />}
                            <span className={transferResult.success ? 'text-green-300' : 'text-red-300'}>{transferResult.message}</span>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* 操作日志 */}
              {activeTab === 'logs' && (
                <div className="flex flex-col h-full">
                  <div className="flex flex-wrap gap-1 mb-2 flex-shrink-0">
                    {LOG_TYPES.map(lt => (
                      <Button key={lt.value} size="sm" variant={logFilter === lt.value ? 'default' : 'outline'}
                        className={`text-xs h-6 ${logFilter === lt.value ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'}`}
                        onClick={() => { setLogFilter(lt.value); fetchLogs(0, lt.value); }}>{lt.label}</Button>
                    ))}
                  </div>
                  <div className="flex-1 space-y-1">
                    {logs.map(log => (
                      <div key={log.id} className="p-2 rounded bg-slate-800 border border-slate-700 text-xs">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-slate-500">{formatTime(log.createdAt)}</span>
                          <Badge className={`${getResultBadgeColor(log.result)} text-[10px] px-1 py-0`}>
                            {log.result === 'SUCCESS' ? '成功' : log.result === 'FAILURE' ? '失败' : log.result || '-'}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={`${getOperationBadgeColor(log.operationType)} text-[10px] px-1 py-0`}>{log.operationType}</Badge>
                          <span className="text-slate-300">{log.username || '-'}</span>
                          {log.targetUavId && <span className="text-blue-300 font-mono">{log.targetUavId}</span>}
                        </div>
                        {log.detail && <div className="text-slate-400 mt-0.5 truncate">{log.detail}</div>}
                      </div>
                    ))}
                    {logs.length === 0 && <div className="text-center text-slate-500 py-4 text-xs">{logLoading ? '加载中...' : '暂无操作日志'}</div>}
                  </div>
                  <div className="flex items-center justify-center gap-2 pt-2 flex-shrink-0 border-t border-slate-700 mt-1">
                    <Button size="sm" variant="outline" disabled={logPage === 0} onClick={() => fetchLogs(logPage - 1, logFilter)}
                      className="bg-slate-700 border-slate-600 text-slate-300 h-6 text-xs"><ChevronLeft className="w-3 h-3" /></Button>
                    <span className="text-xs text-slate-400">{logPage + 1} / {Math.max(1, logTotalPages)}</span>
                    <Button size="sm" variant="outline" disabled={logPage >= logTotalPages - 1} onClick={() => fetchLogs(logPage + 1, logFilter)}
                      className="bg-slate-700 border-slate-600 text-slate-300 h-6 text-xs"><ChevronRight className="w-3 h-3" /></Button>
                  </div>
                </div>
              )}

              {/* 团队管理 */}
              {activeTab === 'teams' && (
                <div className="space-y-2">
                  {teams.map(team => (
                    <Card key={team.teamId} className="bg-slate-800 border-slate-700">
                      <CardHeader className="pb-1 px-3 pt-2 cursor-pointer" onClick={() => handleTeamExpand(team.teamId)}>
                        <CardTitle className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1"><Users className="w-3 h-3 text-blue-400" />{team.teamName}</div>
                          <Badge variant="outline" className="text-slate-400 border-slate-600 text-[10px]">{team.memberCount} 人</Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-3 pb-2">
                        <div className="text-xs text-slate-400 mb-1">
                          队长: <span className="text-slate-300">{team.leader}</span>
                          {team.droneCount != null && <span className="ml-2">无人机: {team.droneCount}</span>}
                        </div>
                        {expandedTeams.has(team.teamId) && teamMembers[team.teamId] && (
                          <div className="space-y-0.5 mt-1 pt-1 border-t border-slate-700">
                            {teamMembers[team.teamId].map(member => (
                              <div key={member.userId} className="flex items-center justify-between text-[11px] p-1 rounded bg-slate-700/50">
                                <span className="text-slate-300">{member.realName || member.username}</span>
                                <Badge className="bg-slate-600 text-[10px] px-1 py-0">{member.role}</Badge>
                              </div>
                            ))}
                            {teamMembers[team.teamId].length === 0 && <div className="text-center text-slate-500 py-1 text-[10px]">暂无成员</div>}
                          </div>
                        )}
                        <Button size="sm" variant="ghost" className="w-full mt-1 text-[10px] text-slate-400 hover:text-white h-5"
                          onClick={() => handleTeamExpand(team.teamId)}>
                          {expandedTeams.has(team.teamId) ? '收起成员' : '展开成员'}
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                  {teams.length === 0 && <div className="text-center text-slate-500 py-4 text-xs">暂无团队数据</div>}
                </div>
              )}
            </div>
          </div>

        {/* 右侧面板: 地图视图 (约2/3宽度) */}
          <div className={`${rightPanelCollapsed ? 'w-0 overflow-hidden' : 'flex-1'} h-full transition-all duration-500 ease-in-out`}>
            <MapPanel drones={mapDrones} selectedDroneId={selectedMapDrone} onDroneClick={setSelectedMapDrone}
              showDroneList={leftPanelCollapsed} showEventLog={true} eventLogs={eventLogsForMap} />
          </div>

        {/* 两侧都收起时显示提示 */}
        {leftPanelCollapsed && rightPanelCollapsed && (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            <div className="text-center">
              <Shield className="w-16 h-16 mx-auto mb-4 opacity-20" />
              <p>左右面板均已收起</p>
              <p className="text-xs mt-1">点击顶部按钮展开面板</p>
            </div>
          </div>
        )}
      </div>

      {/* 确认对话框 - 批量权限转移 */}
      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">确认权限转移</DialogTitle>
            <DialogDescription className="text-slate-400">
              {transferMode === 'team'
                ? `将以下无人机的控制权转移给队伍 (ID: ${toTeamId})`
                : `将以下无人机的控制权转移给用户: ${registeredUsers.find(u => u.userId.toString() === toUserId)?.realName || toUserId}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {selectedUavIds.map(id => (<Badge key={id} className="bg-purple-600">{id}</Badge>))}
            </div>
            {transferReason && <p className="text-sm text-slate-400">原因: {transferReason}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferDialogOpen(false)}
              className="bg-slate-700 border-slate-600 text-slate-300">取消</Button>
            <Button onClick={() => { setTransferDialogOpen(false); handleTransfer(); }}
              disabled={transferLoading} className="bg-purple-600 hover:bg-purple-700">
              {transferLoading ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : null}
              确认转移
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 快捷转接弹窗 - 单架无人机快速转接 */}
      <Dialog open={quickTransferOpen} onOpenChange={(open) => { setQuickTransferOpen(open); if (!open) setQuickTransferResult(null); }}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">快捷转接 - {quickTransferUavId}</DialogTitle>
            <DialogDescription className="text-slate-400">
              将无人机 {quickTransferUavId} 的控制权快速转接给队伍或个人
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {/* 转接模式选择 */}
            <div className="flex gap-2">
              <Button size="sm" variant={quickTransferMode === 'team' ? 'default' : 'outline'}
                className={`text-xs flex-1 ${quickTransferMode === 'team' ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}`}
                onClick={() => setQuickTransferMode('team')}>转接至队伍</Button>
              <Button size="sm" variant={quickTransferMode === 'user' ? 'default' : 'outline'}
                className={`text-xs flex-1 ${quickTransferMode === 'user' ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}`}
                onClick={() => setQuickTransferMode('user')}>转接至个人</Button>
            </div>
            {/* 目标选择 */}
            {quickTransferMode === 'team' ? (
              <div>
                <label className="text-xs text-slate-300 mb-1 block">目标队伍</label>
                <select value={quickTransferToTeamId} onChange={e => setQuickTransferToTeamId(e.target.value)}
                  className="w-full rounded-md bg-slate-700 border-slate-600 text-white px-3 py-2 text-sm">
                  <option value="">选择队伍...</option>
                  {teams.map(team => (
                    <option key={team.teamId} value={team.teamId.replace('T', '')}>{team.teamName} ({team.leader || '无队长'})</option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="text-xs text-slate-300 mb-1 block">目标用户</label>
                <select value={quickTransferToUserId} onChange={e => setQuickTransferToUserId(e.target.value)}
                  className="w-full rounded-md bg-slate-700 border-slate-600 text-white px-3 py-2 text-sm">
                  <option value="">选择用户...</option>
                  {registeredUsers.map(user => (
                    <option key={user.userId} value={user.userId}>{user.realName || user.username} ({user.role || '无角色'})</option>
                  ))}
                </select>
              </div>
            )}
            {quickTransferResult && (
              <div className={`p-2 rounded text-xs ${quickTransferResult.success ? 'bg-green-900/30 border border-green-700' : 'bg-red-900/30 border border-red-700'}`}>
                <div className="flex items-center gap-1">
                  {quickTransferResult.success ? <Activity className="w-3 h-3 text-green-400" /> : <AlertTriangle className="w-3 h-3 text-red-400" />}
                  <span className={quickTransferResult.success ? 'text-green-300' : 'text-red-300'}>{quickTransferResult.message}</span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setQuickTransferOpen(false); setQuickTransferResult(null); }}
              className="bg-slate-700 border-slate-600 text-slate-300">取消</Button>
            <Button onClick={handleQuickTransfer}
              disabled={quickTransferLoading || (quickTransferMode === 'user' ? !quickTransferToUserId : !quickTransferToTeamId)}
              className="bg-purple-600 hover:bg-purple-700">
              {quickTransferLoading ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : null}
              确认转接
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
