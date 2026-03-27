import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
// Card imports removed - using glass-panel classes for glassmorphism theme
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
  MapPin,
  Plus,
  Pencil,
  Trash2,
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
  getRallyPoints,
  createRallyPoint,
  updateRallyPoint,
  deleteRallyPoint,
  geocodeAddress,
  type DroneInfo,
  type OperationLog,
  type RallyPoint,
} from '@/services/api';
import MapPanel, { type MapDrone, type MapRallyPoint } from '@/components/MapPanel';
import { HoloDashboard, type LogEntry } from '@/components/cesium';
import { useTelemetryWebSocket, type PartitionTelemetryMessage } from '@/hooks/useTelemetryWebSocket';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { PieChart as EPieChart, BarChart as EBarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([EPieChart, EBarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

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
  const [activeTab, setActiveTab] = useState<'fleet' | 'permission' | 'logs' | 'teams' | 'rally'>('fleet');

  // Rally point state
  const [rallyPoints, setRallyPoints] = useState<RallyPoint[]>([]);
  const [rpEditOpen, setRpEditOpen] = useState(false);
  const [rpEditData, setRpEditData] = useState<Partial<RallyPoint>>({});
  const [rpEditId, setRpEditId] = useState<number | null>(null);
  const [rpLoading, setRpLoading] = useState(false);
  const [rpGeocoding, setRpGeocoding] = useState(false);

  // Teams state
  const [teams, setTeams] = useState<Array<{ teamId: string; teamName: string; leader: string; memberCount: number; droneCount?: number; description?: string }>>([]);
  const [teamMembers, setTeamMembers] = useState<Record<string, Array<{ userId: string; username: string; realName: string; role: string; name?: string }>>>({});
  // 修复: 使用 Set 支持多个团队同时展开
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());

  // 可折叠面板状态
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);

  // 全息模式状态
  const [holoMode, setHoloMode] = useState(false);

  // 地图选中的无人机
  const [selectedMapDrone, setSelectedMapDrone] = useState<string | null>(null);

  // 多选无人机状态 (Phase 6)
  const [selectedDroneIdsSet, setSelectedDroneIdsSet] = useState<Set<string>>(new Set());
  const toggleDroneMultiSelect = useCallback((uavId: string) => {
    setSelectedDroneIdsSet(prev => {
      const next = new Set(prev);
      if (next.has(uavId)) next.delete(uavId); else next.add(uavId);
      return next;
    });
  }, []);

  // ==================== Telemetry Buffer (no-flicker) ====================
  // Use useRef buffer + version counter instead of useState<Map> to avoid
  // per-message React re-renders. Only bump version at 10Hz from the hook's
  // flush timer, giving a single batched state update.
  const telemetryBufferRef = useRef<Map<string, MapDrone>>(new Map());
  const [telemetryVersion, setTelemetryVersion] = useState(0);

  // WebSocket telemetry handler - writes to ref buffer (no setState per message)
  const handlePartitionData = useCallback((data: PartitionTelemetryMessage) => {
    if (!data.drones || data.drones.length === 0) return;
    const buf = telemetryBufferRef.current;
    data.drones.forEach(uav => {
      const existing = buf.get(uav.uavId);
      if (existing) {
        // In-place field update — reuse object to minimize GC and diff
        existing.lat = uav.lat;
        existing.lng = uav.lon;
        existing.altitude = uav.alt;
        existing.onlineStatus = true;
        existing.armed = uav.armed ?? uav.isActive ?? false;
        existing.flightStatus = existing.armed ? 'FLYING' : 'IDLE';
        existing.heading = uav.heading;
        if (uav.batteryPercent != null && uav.batteryPercent >= 0) {
          existing.battery = uav.batteryPercent;
        }
      } else {
        buf.set(uav.uavId, {
          uavId: uav.uavId,
          lat: uav.lat,
          lng: uav.lon,
          altitude: uav.alt,
          battery: uav.batteryPercent != null && uav.batteryPercent >= 0 ? uav.batteryPercent : undefined,
          flightStatus: uav.armed ? 'FLYING' : 'IDLE',
          onlineStatus: true,
          armed: uav.armed ?? uav.isActive ?? false,
          heading: uav.heading,
        });
      }
    });
    // Bump version to trigger a single re-render (called at 10Hz by hook flush)
    setTelemetryVersion(v => v + 1);
  }, []);

  // Handle drone removal notification from WebSocket (permission transfer)
  const handleDroneRemoved = useCallback((removedUavIds: string[]) => {
    const buf = telemetryBufferRef.current;
    removedUavIds.forEach(id => buf.delete(id));
    setTelemetryVersion(v => v + 1);
    // Clear selection if the selected drone was removed
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

  // Fetch rally points
  const fetchRallyPoints = useCallback(async () => {
    try {
      const res = await getRallyPoints(token);
      if (res.code === 0 && res.data) {
        setRallyPoints(Array.isArray(res.data) ? res.data : []);
      }
    } catch (err) {
      console.error('Failed to fetch rally points:', err);
    }
  }, [token]);

  // Rally point CRUD handlers
  const SERVICE_TYPE_LABELS: Record<number, string> = { 0: '停机', 1: '充电', 2: '维修', 3: '补给' };
  const STATUS_LABELS: Record<number, string> = { 0: '禁用', 1: '启用', 2: '维护中' };
  const SERVICE_TYPE_COLORS: Record<number, string> = { 0: '#f59e0b', 1: '#22c55e', 2: '#f97316', 3: '#8b5cf6' };

  const handleRpSave = async () => {
    setRpLoading(true);
    try {
      const res = rpEditId
        ? await updateRallyPoint(token, rpEditId, rpEditData)
        : await createRallyPoint(token, rpEditData);
      if (res.code === 0) {
        setRpEditOpen(false);
        setRpEditData({});
        setRpEditId(null);
        fetchRallyPoints();
      }
    } catch (err) {
      console.error('Failed to save rally point:', err);
    } finally {
      setRpLoading(false);
    }
  };

  const handleRpDelete = async (id: number) => {
    if (!confirm('确定删除该集结点？')) return;
    try {
      const res = await deleteRallyPoint(token, id);
      if (res.code === 0) fetchRallyPoints();
    } catch (err) {
      console.error('Failed to delete rally point:', err);
    }
  };

  const openRpEdit = (rp?: RallyPoint) => {
    if (rp) {
      setRpEditId(rp.id);
      setRpEditData({ name: rp.name, latitude: rp.latitude, longitude: rp.longitude, altitude: rp.altitude, capacity: rp.capacity, status: rp.status, scope: rp.scope, teamId: rp.teamId, radius: rp.radius, serviceType: rp.serviceType, description: rp.description, address: rp.address });
    } else {
      setRpEditId(null);
      setRpEditData({ status: 1, scope: 0, capacity: 10, radius: 5.0, serviceType: 0 });
    }
    setRpEditOpen(true);
  };

  // Map rally points for MapPanel
  const mapRallyPoints: MapRallyPoint[] = rallyPoints.map(rp => ({
    id: rp.id, name: rp.name, latitude: rp.latitude, longitude: rp.longitude,
    capacity: rp.capacity, currentOccupancy: rp.currentOccupancy, status: rp.status, serviceType: rp.serviceType,
  }));

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
    fetchRallyPoints();
    const interval = setInterval(fetchFleet, 5000);
    return () => clearInterval(interval);
  }, [fetchFleet, fetchLogs, fetchTeams, fetchUsers, fetchRallyPoints]);

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
  // useMemo ensures this only recalculates when drones or telemetryVersion changes
  const mapDrones: MapDrone[] = useMemo(() => {
    // Start with REST API drones (metadata: owner, team, model, etc.)
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
    const telBuf = telemetryBufferRef.current;
    telBuf.forEach((td, uavId) => {
      const existing = droneMap.get(uavId);
      if (existing) {
        existing.lat = td.lat;
        existing.lng = td.lng;
        existing.altitude = td.altitude;
        existing.onlineStatus = td.onlineStatus;
        existing.armed = td.armed;
        if (td.battery != null) existing.battery = td.battery;
        if (td.flightStatus) existing.flightStatus = td.flightStatus;
        if (td.heading != null) existing.heading = td.heading;
      } else {
        droneMap.set(uavId, { ...td });
      }
    });
    // Stable sort by uavId to prevent list reorder flicker
    return Array.from(droneMap.values()).sort((a, b) => a.uavId.localeCompare(b.uavId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drones, telemetryVersion]);

  // Chart data for fleet overview
  const droneChartData = useMemo(() => {
    const armed = mapDrones.filter(d => d.onlineStatus === true && d.armed === true).length;
    const disarmed = mapDrones.filter(d => d.onlineStatus === true && d.armed !== true).length;
    const offline = mapDrones.filter(d => !d.onlineStatus).length;
    return [
      { name: '飞行中', value: armed, color: '#00ff7f' },
      { name: '在线未解锁', value: disarmed, color: '#3b82f6' },
      { name: '离线', value: offline, color: '#64748b' },
    ].filter(d => d.value > 0);
  }, [mapDrones]);

  // 事件日志格式化为地图面板使用
  const eventLogsForMap = logs.slice(0, 20).map(log => ({
    id: log.id, time: formatTime(log.createdAt),
    detail: log.detail || log.operationType, result: log.result,
  }));

  // 日志格式化为全息面板使用
  const holoLogs: LogEntry[] = logs.slice(0, 20).map(log => ({
    id: String(log.id),
    time: formatTime(log.createdAt),
    message: log.detail || log.operationType || '操作',
    detail: log.detail || log.operationType || '操作',
    level: log.result === 'SUCCESS' ? 'success' as const : log.result === 'FAIL' ? 'error' as const : 'info' as const,
    result: log.result,
    operatorName: log.username,
    operationType: log.operationType,
  }));

  // 成员数据用于全息面板
  const holoMembers = registeredUsers.map(u => ({
    userId: String(u.userId),
    username: u.username,
    realName: u.realName,
    role: u.role,
    online: undefined,
  }));

  return (
    <div className="h-screen bg-dark-primary text-white flex flex-col overflow-hidden">
      {/* 顶部栏 */}
      <header className="flex justify-between items-center px-4 py-2 bg-[rgba(13,21,38,0.8)] backdrop-blur-md border-b border-[rgba(0,240,255,0.1)]">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Shield className="w-6 h-6 text-neon-amber" />
          指挥员控制台
          <Badge variant="outline" className="ml-2 text-neon-amber border-neon-amber/50">{username}</Badge>
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
          <Button variant="outline" size="sm" onClick={() => setHoloMode(!holoMode)}
            className={`border-slate-500/50 text-slate-100 hover:bg-slate-600/50 ${holoMode ? 'bg-cyan-700/50 border-cyan-400/50 text-cyan-300' : 'bg-slate-700/50'}`}
            title={holoMode ? '退出全息模式' : '全息3D模式'}>
            🌐 {holoMode ? '退出全息' : '全息3D'}
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
          <div className={`${leftPanelCollapsed ? 'w-0 min-w-0 overflow-hidden' : rightPanelCollapsed ? 'flex-1' : 'w-[420px] min-w-[320px]'} bg-[rgba(13,21,38,0.7)] backdrop-blur-md border-r border-[rgba(0,240,255,0.08)] flex flex-col transition-all duration-500 ease-in-out`}>
            {/* Tab 切换 */}
            <div className="flex gap-0.5 bg-[rgba(13,21,38,0.5)] border-b border-[rgba(0,240,255,0.08)] p-1">
              <button onClick={() => setActiveTab('fleet')}
                className={`flex items-center px-2 py-1 rounded text-xs transition-colors ${activeTab === 'fleet' ? 'bg-[rgba(0,240,255,0.15)] text-neon-cyan border border-[rgba(0,240,255,0.2)]' : 'text-slate-400 hover:text-white hover:bg-[rgba(0,240,255,0.05)]'}`}>
                <Plane className="w-3 h-3 mr-1" />机队
              </button>
              <button onClick={() => setActiveTab('permission')}
                className={`flex items-center px-2 py-1 rounded text-xs transition-colors ${activeTab === 'permission' ? 'bg-[rgba(0,240,255,0.15)] text-neon-cyan border border-[rgba(0,240,255,0.2)]' : 'text-slate-400 hover:text-white hover:bg-[rgba(0,240,255,0.05)]'}`}>
                <ArrowRightLeft className="w-3 h-3 mr-1" />权限
              </button>
              <button onClick={() => { setActiveTab('logs'); fetchLogs(0, logFilter); }}
                className={`flex items-center px-2 py-1 rounded text-xs transition-colors ${activeTab === 'logs' ? 'bg-[rgba(0,240,255,0.15)] text-neon-cyan border border-[rgba(0,240,255,0.2)]' : 'text-slate-400 hover:text-white hover:bg-[rgba(0,240,255,0.05)]'}`}>
                <FileText className="w-3 h-3 mr-1" />日志
              </button>
              <button onClick={() => setActiveTab('teams')}
                className={`flex items-center px-2 py-1 rounded text-xs transition-colors ${activeTab === 'teams' ? 'bg-[rgba(0,240,255,0.15)] text-neon-cyan border border-[rgba(0,240,255,0.2)]' : 'text-slate-400 hover:text-white hover:bg-[rgba(0,240,255,0.05)]'}`}>
                <Users className="w-3 h-3 mr-1" />团队
              </button>
              <button onClick={() => { setActiveTab('rally'); fetchRallyPoints(); }}
                className={`flex items-center px-2 py-1 rounded text-xs transition-colors ${activeTab === 'rally' ? 'bg-[rgba(0,240,255,0.15)] text-neon-cyan border border-[rgba(0,240,255,0.2)]' : 'text-slate-400 hover:text-white hover:bg-[rgba(0,240,255,0.05)]'}`}>
                <MapPin className="w-3 h-3 mr-1" />集结点
              </button>
            </div>

            {/* Tab 内容 */}
            <div className="flex-1 overflow-auto p-3">
              {/* 机队总览 */}
              {activeTab === 'fleet' && (
                <div className="flex flex-col h-full">
                  {/* 统计卡片 - 始终固定显示 */}
                  <div className="grid grid-cols-4 gap-1.5 mb-2 flex-shrink-0">
                    <div className="bg-[rgba(13,21,38,0.5)] border border-[rgba(0,240,255,0.1)] rounded-lg p-1.5 text-center">
                      <div className="text-base font-bold text-neon-cyan">{mapDrones.length}</div>
                      <div className="text-[9px] text-slate-400">总数</div>
                    </div>
                    <div className="bg-[rgba(13,21,38,0.5)] border border-[rgba(0,240,255,0.1)] rounded-lg p-1.5 text-center">
                      <div className="text-base font-bold text-green-400">{mapDrones.filter(d => d.armed === true).length}</div>
                      <div className="text-[9px] text-slate-400">飞行中</div>
                    </div>
                    <div className="bg-[rgba(13,21,38,0.5)] border border-[rgba(0,240,255,0.1)] rounded-lg p-1.5 text-center">
                      <div className="text-base font-bold text-neon-aqua">{mapDrones.filter(d => d.onlineStatus === true).length}</div>
                      <div className="text-[9px] text-slate-400">在线</div>
                    </div>
                    <div className="bg-[rgba(13,21,38,0.5)] border border-[rgba(255,59,92,0.15)] rounded-lg p-1.5 text-center">
                      <div className="text-base font-bold text-neon-red">{mapDrones.filter(d => (d.battery || 0) < 20).length}</div>
                      <div className="text-[9px] text-slate-400">低电量</div>
                    </div>
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
                      <div className="bg-slate-800 rounded border border-slate-700 p-1" style={{ height: chartType === 'pie' ? 90 : 100 }}>
                        {chartType === 'pie' ? (
                          <div className="flex items-center h-full">
                            <ReactEChartsCore
                              echarts={echarts}
                              option={{
                                series: [{
                                  type: 'pie',
                                  radius: ['45%', '80%'],
                                  center: ['50%', '50%'],
                                  data: droneChartData.map(d => ({ value: d.value, name: d.name, itemStyle: { color: d.color } })),
                                  label: { show: false },
                                  animationDuration: 600,
                                }],
                              }}
                              style={{ width: 80, height: 80 }}
                              opts={{ renderer: 'canvas' }}
                            />
                            <div className="flex-1 pl-2 space-y-1">
                              {droneChartData.map((entry) => (
                                <div key={entry.name} className="flex items-center gap-1.5 text-[10px]">
                                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
                                  <span className="text-slate-300 truncate">{entry.name}</span>
                                  <span className="text-white font-bold ml-auto">{entry.value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <ReactEChartsCore
                            echarts={echarts}
                            option={{
                              grid: { left: 10, right: 10, top: 20, bottom: 20, containLabel: true },
                              xAxis: { type: 'category', data: droneChartData.map(d => d.name), axisLabel: { fontSize: 9, color: '#94a3b8' }, axisLine: { show: false }, axisTick: { show: false } },
                              yAxis: { type: 'value', show: false },
                              series: [{
                                type: 'bar',
                                data: droneChartData.map(d => ({ value: d.value, itemStyle: { color: d.color, borderRadius: [4, 4, 0, 0] } })),
                                label: { show: true, position: 'top', fontSize: 10, color: '#e2e8f0' },
                                animationDuration: 600,
                                barMaxWidth: 30,
                              }],
                              tooltip: { trigger: 'item', backgroundColor: '#1e293b', borderColor: '#475569', textStyle: { fontSize: 11, color: '#e2e8f0' } },
                            }}
                            style={{ width: '100%', height: '100%' }}
                            opts={{ renderer: 'canvas' }}
                          />
                        )}
                      </div>
                    </div>
                  )}
                  {/* 一键全选 + 无人机列表 */}
                  <div className="flex items-center justify-between mb-1 flex-shrink-0">
                    <span className="text-[10px] text-slate-400">{mapDrones.length} 架无人机</span>
                    <Button size="sm" variant="outline"
                      onClick={() => {
                        if (selectedUavIds.length === drones.length && drones.length > 0) {
                          setSelectedUavIds([]);
                        } else {
                          setSelectedUavIds(drones.map(d => d.uavId));
                        }
                      }}
                      className={`text-[9px] h-5 px-2 ${selectedUavIds.length === drones.length && drones.length > 0 ? 'bg-green-600/30 border-green-500 text-green-300' : 'bg-slate-700/50 border-slate-500/50 text-slate-400'}`}>
                      全选
                    </Button>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-1 scrollbar-thin" style={{ scrollbarWidth: 'thin', scrollbarColor: '#475569 #1e293b' }}>
                    {/* Use stable sort order from mapDrones (sorted by uavId) to prevent list reorder flicker */}
                    {mapDrones.map(drone => (
                      <div key={drone.uavId}
                        className={`p-2 rounded text-xs cursor-pointer transition-all ${selectedMapDrone === drone.uavId ? 'bg-[rgba(0,240,255,0.1)] border border-neon-cyan/40' : 'bg-[rgba(13,21,38,0.5)] border border-[rgba(0,240,255,0.08)] hover:border-neon-cyan/30'}`}
                        onClick={() => setSelectedMapDrone(prev => prev === drone.uavId ? null : drone.uavId)}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="font-bold text-blue-300">{drone.uavId}</span>
                          <div className="flex items-center gap-1">
                            <Badge className={`text-[10px] px-1 py-0 ${!drone.onlineStatus ? 'bg-slate-600' : drone.armed === true ? 'bg-green-600' : 'bg-blue-600'}`}>
                              {!drone.onlineStatus ? '离线' : drone.armed === true ? '飞行中' : '未解锁'}
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
                  <div className="bg-[rgba(13,21,38,0.5)] border border-[rgba(160,32,240,0.15)] rounded-lg">
                    <div className="pb-2 px-3 pt-3">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <ArrowRightLeft className="w-4 h-4 text-neon-purple" />控制权限转移
                      </div>
                    </div>
                    <div className="px-3 pb-3">
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
                    </div>
                  </div>
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

              {/* 集结点管理 */}
              {activeTab === 'rally' && (
                <div className="flex flex-col h-full">
                  <div className="flex items-center justify-between mb-2 flex-shrink-0">
                    <span className="text-xs text-slate-400">共 {rallyPoints.length} 个集结点</span>
                    <Button size="sm" onClick={() => openRpEdit()} className="bg-amber-600 hover:bg-amber-700 text-xs h-6 px-2">
                      <Plus className="w-3 h-3 mr-1" />新增
                    </Button>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-1.5 scrollbar-thin" style={{ scrollbarWidth: 'thin', scrollbarColor: '#475569 #1e293b' }}>
                    {rallyPoints.map(rp => (
                      <div key={rp.id} className="bg-[rgba(13,21,38,0.5)] border border-[rgba(255,184,0,0.12)] rounded-lg">
                        <div className="p-2">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5">
                              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: SERVICE_TYPE_COLORS[rp.serviceType] || '#f59e0b' }} />
                              <span className="text-xs font-bold text-slate-200">{rp.name}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Badge className={`text-[9px] px-1 py-0 ${rp.status === 1 ? 'bg-green-600' : rp.status === 2 ? 'bg-orange-600' : 'bg-slate-600'}`}>
                                {STATUS_LABELS[rp.status] || '未知'}
                              </Badge>
                              <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-slate-400 hover:text-blue-400" onClick={() => openRpEdit(rp)}>
                                <Pencil className="w-3 h-3" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-slate-400 hover:text-red-400" onClick={() => handleRpDelete(rp.id)}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-x-2 text-[10px] text-slate-400">
                            <span>类型: <span className="text-slate-300">{SERVICE_TYPE_LABELS[rp.serviceType] || '未知'}</span></span>
                            <span>容量: <span className="text-slate-300">{rp.currentOccupancy}/{rp.capacity}</span></span>
                            <span>范围: <span className="text-slate-300">{rp.scope === 0 ? '全局' : `团队 ${rp.teamId || ''}`}</span></span>
                            <span>半径: <span className="text-slate-300">{rp.radius}m</span></span>
                          </div>
                          <div className="text-[9px] text-slate-500 mt-0.5">
                            {rp.latitude?.toFixed(6)}, {rp.longitude?.toFixed(6)}
                            {rp.address && <span className="ml-1">· {rp.address}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                    {rallyPoints.length === 0 && <div className="text-center text-slate-500 py-4 text-xs">暂无集结点数据</div>}
                  </div>

                  {/* Rally Point Edit/Create Dialog */}
                  {rpEditOpen && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setRpEditOpen(false)}>
                      <div className="bg-slate-800 border border-slate-600 rounded-lg p-4 w-[360px] max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <h3 className="text-sm font-bold text-white mb-3">{rpEditId ? '编辑集结点' : '新增集结点'}</h3>
                        <div className="space-y-2">
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">名称 *</label>
                            <Input value={rpEditData.name || ''} onChange={e => setRpEditData(p => ({ ...p, name: e.target.value }))}
                              className="bg-slate-700 border-slate-600 text-white text-xs h-7" placeholder="集结点名称" />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">纬度 *</label>
                              <Input type="number" step="0.000001" value={rpEditData.latitude ?? ''} onChange={e => setRpEditData(p => ({ ...p, latitude: parseFloat(e.target.value) }))}
                                className="bg-slate-700 border-slate-600 text-white text-xs h-7" />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">经度 *</label>
                              <Input type="number" step="0.000001" value={rpEditData.longitude ?? ''} onChange={e => setRpEditData(p => ({ ...p, longitude: parseFloat(e.target.value) }))}
                                className="bg-slate-700 border-slate-600 text-white text-xs h-7" />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">高度 (m)</label>
                              <Input type="number" value={rpEditData.altitude ?? ''} onChange={e => setRpEditData(p => ({ ...p, altitude: e.target.value ? parseFloat(e.target.value) : null }))}
                                className="bg-slate-700 border-slate-600 text-white text-xs h-7" />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">半径 (m)</label>
                              <Input type="number" value={rpEditData.radius ?? 5} onChange={e => setRpEditData(p => ({ ...p, radius: parseFloat(e.target.value) }))}
                                className="bg-slate-700 border-slate-600 text-white text-xs h-7" />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">容量</label>
                              <Input type="number" value={rpEditData.capacity ?? 10} onChange={e => setRpEditData(p => ({ ...p, capacity: parseInt(e.target.value) }))}
                                className="bg-slate-700 border-slate-600 text-white text-xs h-7" />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">服务类型</label>
                              <select value={rpEditData.serviceType ?? 0} onChange={e => setRpEditData(p => ({ ...p, serviceType: parseInt(e.target.value) }))}
                                className="w-full rounded-md bg-slate-700 border-slate-600 text-white px-2 py-1 text-xs h-7">
                                <option value={0}>停机</option><option value={1}>充电</option><option value={2}>维修</option><option value={3}>补给</option>
                              </select>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">状态</label>
                              <select value={rpEditData.status ?? 1} onChange={e => setRpEditData(p => ({ ...p, status: parseInt(e.target.value) }))}
                                className="w-full rounded-md bg-slate-700 border-slate-600 text-white px-2 py-1 text-xs h-7">
                                <option value={0}>禁用</option><option value={1}>启用</option><option value={2}>维护中</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">范围</label>
                              <select value={rpEditData.scope ?? 0} onChange={e => setRpEditData(p => ({ ...p, scope: parseInt(e.target.value) }))}
                                className="w-full rounded-md bg-slate-700 border-slate-600 text-white px-2 py-1 text-xs h-7">
                                <option value={0}>全局</option><option value={1}>团队专属</option>
                              </select>
                            </div>
                          </div>
                          {rpEditData.scope === 1 && (
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">团队ID</label>
                              <Input value={rpEditData.teamId || ''} onChange={e => setRpEditData(p => ({ ...p, teamId: e.target.value }))}
                                className="bg-slate-700 border-slate-600 text-white text-xs h-7" placeholder="输入团队ID" />
                            </div>
                          )}
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">地址 (填写后可自动填充坐标)</label>
                            <div className="flex gap-1">
                              <Input value={rpEditData.address || ''} onChange={e => setRpEditData(p => ({ ...p, address: e.target.value }))}
                                className="bg-slate-700 border-slate-600 text-white text-xs h-7 flex-1" placeholder="输入地址自动获取坐标" />
                              <Button size="sm" className="h-7 px-2 text-[10px] bg-teal-600 hover:bg-teal-700" disabled={rpGeocoding || !rpEditData.address}
                                onClick={async () => {
                                  if (!rpEditData.address) return;
                                  setRpGeocoding(true);
                                  const result = await geocodeAddress(rpEditData.address);
                                  if (result) {
                                    setRpEditData(p => ({ ...p, latitude: result.lat, longitude: result.lon }));
                                  } else {
                                    alert('地址解析失败，请尝试更具体的地址或手动输入坐标');
                                  }
                                  setRpGeocoding(false);
                                }}>
                                {rpGeocoding ? <RefreshCw className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />}
                              </Button>
                            </div>
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">描述</label>
                            <Input value={rpEditData.description || ''} onChange={e => setRpEditData(p => ({ ...p, description: e.target.value }))}
                              className="bg-slate-700 border-slate-600 text-white text-xs h-7" placeholder="集结点描述" />
                          </div>
                        </div>
                        <div className="flex gap-2 mt-3">
                          <Button variant="outline" className="flex-1 text-xs h-7 bg-slate-700 border-slate-600 text-slate-300" onClick={() => setRpEditOpen(false)}>取消</Button>
                          <Button className="flex-1 text-xs h-7 bg-amber-600 hover:bg-amber-700" onClick={handleRpSave} disabled={rpLoading || !rpEditData.name || rpEditData.latitude == null || rpEditData.longitude == null}>
                            {rpLoading ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : null}
                            {rpEditId ? '保存' : '创建'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 团队管理 */}
              {activeTab === 'teams' && (
                <div className="space-y-2">
                  {teams.map(team => (
                    <div key={team.teamId} className="bg-[rgba(13,21,38,0.5)] border border-[rgba(0,240,255,0.1)] rounded-lg">
                      <div className="pb-1 px-3 pt-2 cursor-pointer" onClick={() => handleTeamExpand(team.teamId)}>
                        <div className="flex items-center justify-between text-xs font-semibold">
                          <div className="flex items-center gap-1"><Users className="w-3 h-3 text-blue-400" />{team.teamName}</div>
                          <Badge variant="outline" className="text-slate-400 border-slate-600 text-[10px]">{team.memberCount} 人</Badge>
                        </div>
                      </div>
                      <div className="px-3 pb-2">
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
                      </div>
                    </div>
                  ))}
                  {teams.length === 0 && <div className="text-center text-slate-500 py-4 text-xs">暂无团队数据</div>}
                </div>
              )}
            </div>
          </div>

        {/* 右侧面板: 地图视图 (约2/3宽度) */}
          <div className={`${rightPanelCollapsed ? 'w-0 overflow-hidden' : 'flex-1'} h-full transition-all duration-500 ease-in-out`}>
            <MapPanel drones={mapDrones} selectedDroneId={selectedMapDrone} onDroneClick={setSelectedMapDrone}
              rallyPoints={mapRallyPoints}
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
      <Dialog open={transferDialogOpen} onOpenChange={(open) => {
        setTransferDialogOpen(open);
        if (!open) {
          // Dialog data cleanup: clear all transfer state to prevent stale data on next open
          setTransferResult(null);
          setToUserId('');
          setToTeamId('');
          setTransferReason('');
          setTransferLoading(false);
        }
      }}>
        <DialogContent className="bg-[rgba(13,21,38,0.95)] backdrop-blur-xl border border-[rgba(0,240,255,0.2)] text-white shadow-[0_0_30px_rgba(0,240,255,0.1)]">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-neon-purple" />确认权限转移
            </DialogTitle>
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
            <Button variant="outline" onClick={() => {
              setTransferDialogOpen(false);
              setTransferResult(null);
              setToUserId('');
              setToTeamId('');
              setTransferReason('');
            }}
              className="bg-[rgba(0,240,255,0.05)] border-[rgba(0,240,255,0.15)] text-slate-300 hover:bg-[rgba(0,240,255,0.1)]">取消</Button>
            <Button onClick={() => { setTransferDialogOpen(false); handleTransfer(); }}
              disabled={transferLoading} className="bg-[rgba(160,32,240,0.3)] border border-neon-purple/40 hover:bg-[rgba(160,32,240,0.5)] text-white">
              {transferLoading ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : null}
              确认转移
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 快捷转接弹窗 - 单架无人机快速转接 */}
      <Dialog open={quickTransferOpen} onOpenChange={(open) => {
        setQuickTransferOpen(open);
        if (!open) {
          // Dialog data cleanup: clear all quick transfer state
          setQuickTransferUavId('');
          setQuickTransferToUserId('');
          setQuickTransferToTeamId('');
          setQuickTransferResult(null);
          setQuickTransferLoading(false);
        }
      }}>
        <DialogContent className="bg-[rgba(13,21,38,0.95)] backdrop-blur-xl border border-[rgba(0,240,255,0.2)] text-white shadow-[0_0_30px_rgba(0,240,255,0.1)]">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-neon-purple" />快捷转接 - <span className="text-neon-cyan font-mono">{quickTransferUavId}</span>
            </DialogTitle>
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
            <Button variant="outline" onClick={() => {
              setQuickTransferOpen(false);
              setQuickTransferUavId('');
              setQuickTransferToUserId('');
              setQuickTransferToTeamId('');
              setQuickTransferResult(null);
            }}
              className="bg-[rgba(0,240,255,0.05)] border-[rgba(0,240,255,0.15)] text-slate-300 hover:bg-[rgba(0,240,255,0.1)]">取消</Button>
            <Button onClick={handleQuickTransfer}
              disabled={quickTransferLoading || (quickTransferMode === 'user' ? !quickTransferToUserId : !quickTransferToTeamId)}
              className="bg-[rgba(160,32,240,0.3)] border border-neon-purple/40 hover:bg-[rgba(160,32,240,0.5)] text-white">
              {quickTransferLoading ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : null}
              确认转接
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* 全息3D模式 */}
      {holoMode && (
        <HoloDashboard
          drones={mapDrones}
          selectedDroneId={selectedMapDrone}
          selectedDroneIds={selectedDroneIdsSet}
          onDroneClick={setSelectedMapDrone}
          onDroneToggleSelect={toggleDroneMultiSelect}
          logs={holoLogs}
          members={holoMembers}
          teams={teams}
          teamMembers={teamMembers}
          rallyPoints={mapRallyPoints}
          registeredUsers={registeredUsers}
          logPage={logPage}
          logTotalPages={logTotalPages}
          logFilter={logFilter}
          logLoading={logLoading}
          onCommand={(cmd, uavIds) => {
            if (uavIds && uavIds.length > 0) {
              import('@/services/api').then(api => {
                if (uavIds.length === 1) {
                  api.sendControlCommand(token, { uavId: uavIds[0], command: cmd });
                } else {
                  api.sendBatchControlCommand(token, { uavIds, command: cmd });
                }
                fetchLogs(logPage, logFilter);
              });
            }
          }}
          onTransferPermission={(uavIds, toUserId, toTeamId, mode) => {
            if (mode === 'team' && toTeamId) {
              transferPermissionToTeam(token, uavIds, toTeamId).then(res => {
                if (res.code === 0) { fetchFleet(); fetchTeams(); fetchLogs(0, logFilter); }
              });
            } else if (mode === 'user' && toUserId) {
              transferPermission(token, { uavIds, toUserId, reason: '全息模式转接' }).then(res => {
                if (res.code === 0) { fetchFleet(); fetchTeams(); fetchLogs(0, logFilter); }
              });
            }
          }}
          onFetchLogs={(page, filter) => {
            setLogFilter(filter);
            fetchLogs(page, filter);
          }}
          onTeamExpand={(teamId) => {
            if (!teamMembers[teamId]) fetchMembers(teamId);
          }}
          onRallyPointCreate={() => openRpEdit()}
          onRallyPointEdit={(rp) => {
            const full = rallyPoints.find(r => r.id === rp.id);
            if (full) openRpEdit(full);
          }}
          onRallyPointDelete={handleRpDelete}
          onClose={() => setHoloMode(false)}
        />
      )}
    </div>
  );
}
