import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Plane,
  Users,
  Battery,
  RefreshCw,
  LogOut,
  FileText,
  ChevronLeft,
  ChevronRight,
  ArrowRightLeft,
  AlertTriangle,
  Activity,
  PanelLeftClose,
  PanelLeftOpen,
  Eye,
  EyeOff,
  MapPin,
  Navigation,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Pause,
  CheckSquare,
  Square,
  ListChecks,
  Home,
  Crosshair,
  Locate,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  getLeaderTeamDrones,
  getLeaderTeamMembers,
  getLeaderTeamLogs,
  getLeaderTeamInfo,
  leaderTransferDrone,
  sendControlCommand,
  sendBatchControlCommand,
  getEnabledRallyPoints,
  getDroneHomePosition,
  type DroneInfo,
  type OperationLog,
  type RallyPoint,
} from '@/services/api';
import MapPanel, { type MapDrone } from '@/components/MapPanel';
import { useTelemetryWebSocket, type PartitionTelemetryMessage, type CommandAckMessage } from '@/hooks/useTelemetryWebSocket';

interface LeaderViewProps {
  token: string;
  username: string;
  partitions?: string[];
  onLogout: () => void;
}

// Control commands - ARM/DISARM removed, TAKEOFF handles ARM+OFFBOARD+climb
const COMMANDS = [
  { type: 'TAKEOFF', label: '\u8d77\u98de' },
  { type: 'LAND', label: '\u964d\u843d' },
  { type: 'RTL', label: '\u8fd4\u822a' },
  { type: 'HOLD', label: '\u60ac\u505c' },
  { type: 'MARK_HOME', label: '\u6807\u8bb0Home' },
];

// Batch control commands for multi-select
const BATCH_COMMANDS = [
  { type: 'TAKEOFF', label: '\u8d77\u98de', icon: ArrowUp, color: 'bg-blue-600 hover:bg-blue-700' },
  { type: 'LAND', label: '\u964d\u843d', icon: ArrowDown, color: 'bg-amber-600 hover:bg-amber-700' },
  { type: 'HOLD', label: '\u60ac\u505c', icon: Pause, color: 'bg-orange-600 hover:bg-orange-700' },
];

// Detail panel control commands
const DETAIL_COMMANDS = [
  { type: 'TAKEOFF', label: '\u8d77\u98de', icon: ArrowUp, color: 'bg-blue-600 hover:bg-blue-700' },
  { type: 'LAND', label: '\u964d\u843d', icon: ArrowDown, color: 'bg-amber-600 hover:bg-amber-700' },
  { type: 'RTL', label: '\u8fd4\u822a', icon: RotateCcw, color: 'bg-purple-600 hover:bg-purple-700' },
  { type: 'HOLD', label: '\u60ac\u505c', icon: Pause, color: 'bg-orange-600 hover:bg-orange-700' },
  { type: 'MARK_HOME', label: '\u6807\u8bb0Home', icon: Home, color: 'bg-teal-600 hover:bg-teal-700' },
];

export default function LeaderView({ token, username, partitions = [], onLogout }: LeaderViewProps) {
  const [drones, setDrones] = useState<DroneInfo[]>([]);
  const [teamInfo, setTeamInfo] = useState<{ teamId: string; teamName: string; leader: string; memberCount: number } | null>(null);
  const [members, setMembers] = useState<Array<{ userId: string; username: string; realName: string; role: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [logPage, setLogPage] = useState(0);
  const [logTotalPages, setLogTotalPages] = useState(0);
  const [logPageSize, setLogPageSize] = useState(8);
  const [commandFeedback, setCommandFeedback] = useState<{ uavId: string; message: string; success: boolean } | null>(null);
  const [commandAckFeedback, setCommandAckFeedback] = useState<{ uavId: string; message: string; success: boolean } | null>(null);
  const [activeTab, setActiveTab] = useState<'drones' | 'members' | 'logs'>('drones');

  // GOTO params
  const [gotoLat, setGotoLat] = useState('39.9042');
  const [gotoLon, setGotoLon] = useState('116.4074');
  const [gotoAlt, setGotoAlt] = useState('50');
  const [gotoAddress, setGotoAddress] = useState('');
  // Takeoff altitude
  const [takeoffAlt, setTakeoffAlt] = useState('5');
  // RTL params
  const [rtlLat, setRtlLat] = useState('');
  const [rtlLon, setRtlLon] = useState('');
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [selectedMapDrone, setSelectedMapDrone] = useState<string | null>(null);

  // Home position display
  const [homePosition, setHomePosition] = useState<{ lat: number; lon: number; alt: number } | null>(null);
  const [homeMarker, setHomeMarker] = useState<{ lat: number; lng: number } | null>(null);

  // Multi-select MARK_HOME coordinate input
  const [batchHomeLat, setBatchHomeLat] = useState('');
  const [batchHomeLon, setBatchHomeLon] = useState('');
  // Multi-select RTL mode: 'home' or 'rally'
  const [batchRtlMode, setBatchRtlMode] = useState<'home' | 'rally'>('home');
  const [rallyPoints, setRallyPoints] = useState<RallyPoint[]>([]);
  const [selectedRallyPointId, setSelectedRallyPointId] = useState<number | null>(null);
  const [rallySearchKeyword, setRallySearchKeyword] = useState('');

  // Real-time telemetry from WebSocket
  const [telemetryDrones, setTelemetryDrones] = useState<Map<string, MapDrone>>(new Map());

  const handlePartitionData = useCallback((data: PartitionTelemetryMessage) => {
    if (!data.drones || data.drones.length === 0) return;
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
          onlineStatus: true,
          armed: uav.armed ?? uav.isActive ?? false,
          heading: uav.heading,
        });
      });
      return next;
    });
  }, []);

  const handleDroneRemoved = useCallback((removedUavIds: string[]) => {
    setTelemetryDrones(prev => {
      const next = new Map(prev);
      removedUavIds.forEach(id => next.delete(id));
      return next;
    });
    setSelectedMapDrone(prev => {
      if (prev && removedUavIds.includes(prev)) return null;
      return prev;
    });
  }, []);

  // Dedup ack feedback to prevent repeated toasts (especially for HOLD continuous updates)
  const lastAckKeyRef = useRef<string>('');
  const lastAckTimeRef = useRef<number>(0);
  const handleCommandAck = useCallback((ack: CommandAckMessage) => {
    const ackKey = `${ack.uavId}:${ack.command}:${ack.result}`;
    const now = Date.now();
    if (ackKey === lastAckKeyRef.current && now - lastAckTimeRef.current < 3000) {
      return; // Suppress duplicate ack toast within 3s
    }
    lastAckKeyRef.current = ackKey;
    lastAckTimeRef.current = now;
    const success = ack.result === 0;
    const msg = success
      ? `PX4 \u786e\u8ba4\u6267\u884c: ${ack.resultText}`
      : `PX4 \u62d2\u7edd: ${ack.resultText}`;
    setCommandAckFeedback({ uavId: ack.uavId, message: msg, success });
    setTimeout(() => setCommandAckFeedback(null), 4000);
  }, []);

  useTelemetryWebSocket({
    enabled: partitions.length > 0,
    partitions,
    onPartitionDataReceived: handlePartitionData,
    onDroneRemoved: handleDroneRemoved,
    onCommandAck: handleCommandAck,
  });

  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [detailPanelEnabled, setDetailPanelEnabled] = useState(true);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedDrones, setSelectedDrones] = useState<Set<string>>(new Set());

  // Transfer state
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferUavId, setTransferUavId] = useState('');
  const [transferToUserId, setTransferToUserId] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferResult, setTransferResult] = useState<{ success: boolean; message: string } | null>(null);

  // Dynamic log page size based on viewport
  useEffect(() => {
    const calculatePageSize = () => {
      const available = window.innerHeight - 220;
      setLogPageSize(Math.max(4, Math.floor(available / 68)));
    };
    calculatePageSize();
    window.addEventListener('resize', calculatePageSize);
    return () => window.removeEventListener('resize', calculatePageSize);
  }, []);

  const fetchDrones = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getLeaderTeamDrones(token);
      if (res.code === 0 && res.data) {
        setDrones(Array.isArray(res.data) ? res.data as unknown as DroneInfo[] : []);
      }
    } catch (err) {
      console.error('Failed to fetch team drones:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const fetchTeamInfo = useCallback(async () => {
    try {
      const [infoRes, membersRes] = await Promise.all([
        getLeaderTeamInfo(token),
        getLeaderTeamMembers(token),
      ]);
      if (infoRes.code === 0 && infoRes.data) {
        setTeamInfo(infoRes.data);
      }
      if (membersRes.code === 0 && membersRes.data) {
        const memberList = Array.isArray(membersRes.data) ? membersRes.data : [];
        setMembers(memberList.map(m => ({
          userId: m.userId,
          username: m.name || m.userId,
          realName: m.name || '',
          role: m.role,
        })));
      }
    } catch (err) {
      console.error('Failed to fetch team info:', err);
    }
  }, [token]);

  const fetchLogs = useCallback(async (page: number = 0) => {
    try {
      const res = await getLeaderTeamLogs(token, page, logPageSize);
      if (res.code === 0 && res.data) {
        setLogs(res.data.content || []);
        setLogTotalPages(res.data.totalPages || 0);
        setLogPage(page);
      }
    } catch (err) {
      console.error('Failed to fetch team logs:', err);
    }
  }, [token, logPageSize]);

  const fetchRallyPoints = useCallback(async () => {
    try {
      const res = await getEnabledRallyPoints(token);
      if (res.code === 0 && res.data) {
        setRallyPoints(Array.isArray(res.data) ? res.data : []);
      }
    } catch (err) {
      console.error('Failed to fetch rally points:', err);
    }
  }, [token]);

  useEffect(() => {
    fetchDrones();
    fetchTeamInfo();
    fetchLogs();
    fetchRallyPoints();
    const interval = setInterval(fetchDrones, 5000);
    return () => clearInterval(interval);
  }, [fetchDrones, fetchTeamInfo, fetchLogs, fetchRallyPoints]);

  // Fetch Home position from Redis when a drone is selected (cross-view sync)
  useEffect(() => {
    if (!selectedMapDrone) return;
    (async () => {
      try {
        const res = await getDroneHomePosition(token, selectedMapDrone);
        if (res.code === 0 && res.data && res.data.lat !== 0 && res.data.lon !== 0) {
          setHomePosition({ lat: res.data.lat, lon: res.data.lon, alt: res.data.alt });
        }
      } catch {
        // Silently ignore - Home may not be set yet
      }
    })();
  }, [selectedMapDrone, token]);

  const handleTeamTransfer = async () => {
    if (!transferUavId || !transferToUserId) return;
    setTransferLoading(true);
    setTransferResult(null);
    try {
      const numericUserId = parseInt(transferToUserId.replace(/^U/i, ''));
      const res = await leaderTransferDrone(token, [transferUavId], numericUserId);
      if (res.code === 0) {
        setTransferResult({ success: true, message: '\u961f\u5185\u63a7\u5236\u6743\u8f6c\u79fb\u6210\u529f' });
        setTransferUavId('');
        setTransferToUserId('');
        setTransferDialogOpen(false);
        fetchDrones();
        fetchLogs();
      } else {
        setTransferResult({ success: false, message: res.msg || '\u8f6c\u79fb\u5931\u8d25' });
      }
    } catch {
      setTransferResult({ success: false, message: '\u7f51\u7edc\u9519\u8bef' });
    } finally {
      setTransferLoading(false);
    }
  };

  // Unified command handler with full param support
  const handleQuickCommand = async (uavId: string, commandType: string) => {
    setCommandFeedback(null);
    try {
      let params = '{}';
      if (commandType === 'TAKEOFF') {
        params = JSON.stringify({ altitude: parseFloat(takeoffAlt) || 5 });
      } else if (commandType === 'GOTO') {
        params = JSON.stringify({
          lat: parseFloat(gotoLat) || 0,
          lon: parseFloat(gotoLon) || 0,
          alt: parseFloat(gotoAlt) || 50,
          address: gotoAddress || undefined,
        });
      } else if (commandType === 'RTL') {
        const lat = parseFloat(rtlLat);
        const lon = parseFloat(rtlLon);
        if (lat && lon) {
          params = JSON.stringify({ lat, lon });
        }
      } else if (commandType === 'MARK_HOME') {
        const droneInfo = mapDrones.find(d => d.uavId === uavId);
        if (droneInfo && droneInfo.lat && droneInfo.lng) {
          params = JSON.stringify({
            lat: droneInfo.lat,
            lon: droneInfo.lng,
            alt: droneInfo.altitude || 0,
          });
        }
      }

      const res = await sendControlCommand(token, {
        uavId,
        commandType,
        params,
        confirmed: true,
      });
      if (res.code === 0) {
        setCommandFeedback({ uavId, message: `${commandType} \u6307\u4ee4\u5df2\u53d1\u9001`, success: true });
        if (commandType === 'MARK_HOME' || commandType === 'TAKEOFF') {
          const droneInfo = mapDrones.find(d => d.uavId === uavId);
          if (droneInfo && droneInfo.lat && droneInfo.lng) {
            setHomePosition({ lat: droneInfo.lat, lon: droneInfo.lng, alt: droneInfo.altitude || 0 });
          }
        }
      } else {
        setCommandFeedback({ uavId, message: res.msg || '\u6307\u4ee4\u53d1\u9001\u5931\u8d25', success: false });
      }
    } catch {
      setCommandFeedback({ uavId, message: '\u7f51\u7edc\u9519\u8bef', success: false });
    }
    setTimeout(() => setCommandFeedback(null), 3000);
  };

  const locateHome = () => {
    if (homePosition) {
      setHomeMarker({ lat: homePosition.lat, lng: homePosition.lon });
      setTimeout(() => setHomeMarker(null), 5000);
    }
  };

  const formatTime = (ts: string) => {
    if (!ts) return '-';
    try { return new Date(ts).toLocaleString('zh-CN'); } catch { return ts; }
  };

  // Merge API drones with WebSocket telemetry
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
        if (td.battery != null) existing.battery = td.battery;
        if (td.flightStatus) existing.flightStatus = td.flightStatus;
        if (td.heading != null) existing.heading = td.heading;
      } else {
        droneMap.set(uavId, td);
      }
    });
    return Array.from(droneMap.values());
  })();

  // Multi-select aggregate data
  const multiSelectedDrones = mapDrones.filter(d => selectedDrones.has(d.uavId));
  const aggregateData = multiSelectedDrones.length >= 2 ? {
    count: multiSelectedDrones.length,
    maxAlt: Math.max(...multiSelectedDrones.map(d => d.altitude ?? 0)),
    minAlt: Math.min(...multiSelectedDrones.map(d => d.altitude ?? 0)),
    lowBatteryCount: multiSelectedDrones.filter(d => (d.battery ?? 0) < 20).length,
    onlineCount: multiSelectedDrones.filter(d => d.onlineStatus === true).length,
    flyingCount: multiSelectedDrones.filter(d => d.flightStatus === 'FLYING').length,
  } : null;

  return (
    <div className="h-screen bg-slate-900 text-white flex flex-col overflow-hidden relative">
      {/* Floating Toast feedback */}
      {(commandFeedback || commandAckFeedback) && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-1.5 pointer-events-none" style={{ minWidth: 280, maxWidth: 420 }}>
          {commandFeedback && (
            <div className={`px-4 py-2 rounded-lg text-xs shadow-lg backdrop-blur-sm pointer-events-auto transition-all duration-300 ${
              commandFeedback.success ? 'bg-green-900/70 border border-green-600/50 text-green-200' : 'bg-red-900/70 border border-red-600/50 text-red-200'
            }`}>
              <span className="font-medium">[{commandFeedback.uavId}]</span> {commandFeedback.message}
            </div>
          )}
          {commandAckFeedback && (
            <div className={`px-4 py-2 rounded-lg text-xs shadow-lg backdrop-blur-sm pointer-events-auto transition-all duration-300 ${
              commandAckFeedback.success ? 'bg-emerald-900/70 border border-emerald-500/50 text-emerald-200' : 'bg-orange-900/70 border border-orange-500/50 text-orange-200'
            }`}>
              <span className="font-medium">[{commandAckFeedback.uavId}]</span> {commandAckFeedback.message}
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <header className="flex justify-between items-center px-4 py-1.5 bg-slate-800 border-b border-slate-700 shrink-0">
        <h1 className="text-lg font-bold flex items-center gap-2">
          <Users className="w-5 h-5 text-green-400" />
          {'\u961f\u957f\u7ba1\u7406\u9762\u677f'}
          <Badge variant="outline" className="ml-2 text-green-300 border-green-500">{username}</Badge>
        </h1>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm"
            onClick={() => {
              if (!multiSelectMode) {
                setSelectedDrones(new Set());
                setShowDetailPanel(false);
                setSelectedMapDrone(null);
              } else {
                setSelectedDrones(new Set());
              }
              setMultiSelectMode(!multiSelectMode);
            }}
            className={`text-xs h-7 ${multiSelectMode ? 'bg-amber-600/30 border-amber-500 text-amber-300' : 'bg-slate-700/50 border-slate-500/50 text-slate-400'}`}>
            <ListChecks className="w-3.5 h-3.5 mr-1" />{'\u591a\u9009'}
          </Button>
          {multiSelectMode && (
            <Button variant="outline" size="sm"
              onClick={() => {
                const allIds = new Set(mapDrones.map(d => d.uavId));
                if (selectedDrones.size === mapDrones.length) {
                  setSelectedDrones(new Set());
                  setShowDetailPanel(false);
                  setSelectedMapDrone(null);
                } else {
                  setSelectedDrones(allIds);
                  setShowDetailPanel(false);
                }
              }}
              className={`text-xs h-7 ${selectedDrones.size === mapDrones.length ? 'bg-green-600/30 border-green-500 text-green-300' : 'bg-slate-700/50 border-slate-500/50 text-slate-400'}`}>
              {selectedDrones.size === mapDrones.length ? <CheckSquare className="w-3.5 h-3.5 mr-1" /> : <Square className="w-3.5 h-3.5 mr-1" />}
              {'\u5168\u9009'}
            </Button>
          )}
          <Button variant="outline" size="sm"
            onClick={() => {
              const newEnabled = !detailPanelEnabled;
              setDetailPanelEnabled(newEnabled);
              if (!newEnabled) setShowDetailPanel(false);
              else if (selectedMapDrone) setShowDetailPanel(true);
            }}
            className={`text-xs h-7 ${detailPanelEnabled ? 'bg-blue-600/30 border-blue-500 text-blue-300' : 'bg-slate-700/50 border-slate-500/50 text-slate-400'}`}>
            {detailPanelEnabled ? <Eye className="w-3.5 h-3.5 mr-1" /> : <EyeOff className="w-3.5 h-3.5 mr-1" />}{'\u8be6\u60c5'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setLeftPanelCollapsed(!leftPanelCollapsed)}
            className="bg-slate-700/50 border-slate-500/50 text-slate-100 hover:bg-slate-600/50 h-7 text-xs">
            {leftPanelCollapsed ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
          </Button>
          <Button variant="outline" size="sm" onClick={() => { fetchDrones(); fetchTeamInfo(); fetchLogs(); }} disabled={loading}
            className="bg-slate-700/50 border-slate-500/50 text-slate-100 hover:bg-slate-600/50 h-7 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />{'\u5237\u65b0'}
          </Button>
          <Button variant="outline" size="sm" onClick={onLogout}
            className="bg-slate-700/50 border-slate-500/50 text-slate-100 hover:bg-slate-600/50 h-7 text-xs">
            <LogOut className="w-3.5 h-3.5 mr-1" />{'\u9000\u51fa'}
          </Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left panel: team management */}
        <div className={`${leftPanelCollapsed ? 'w-0 min-w-0 overflow-hidden' : 'w-[380px] min-w-[300px]'} bg-slate-900 border-r border-slate-700 flex flex-col transition-all duration-500 ease-in-out shrink-0`}>
          {/* Tab switch */}
          <div className="flex gap-0.5 bg-slate-800 border-b border-slate-700 p-1">
            <button onClick={() => setActiveTab('drones')}
              className={`flex items-center px-2 py-1 rounded text-xs transition-colors ${activeTab === 'drones' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
              <Plane className="w-3 h-3 mr-1" />{'\u65e0\u4eba\u673a'}
            </button>
            <button onClick={() => setActiveTab('members')}
              className={`flex items-center px-2 py-1 rounded text-xs transition-colors ${activeTab === 'members' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
              <Users className="w-3 h-3 mr-1" />{'\u6210\u5458'}
            </button>
            <button onClick={() => { setActiveTab('logs'); fetchLogs(0); }}
              className={`flex items-center px-2 py-1 rounded text-xs transition-colors ${activeTab === 'logs' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
              <FileText className="w-3 h-3 mr-1" />{'\u65e5\u5fd7'}
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-auto p-2">
            {/* Drones Tab */}
            {activeTab === 'drones' && (
              <div className="space-y-2">
                {/* Stats */}
                <div className="grid grid-cols-4 gap-1">
                  <Card className="bg-slate-800 border-slate-700"><CardContent className="p-1.5 text-center">
                    <div className="text-sm font-bold text-blue-400">{mapDrones.length}</div>
                    <div className="text-[9px] text-slate-400">{'\u65e0\u4eba\u673a'}</div>
                  </CardContent></Card>
                  <Card className="bg-slate-800 border-slate-700"><CardContent className="p-1.5 text-center">
                    <div className="text-sm font-bold text-green-400">{mapDrones.filter(d => d.armed === true).length}</div>
                    <div className="text-[9px] text-slate-400">{'\u5df2\u89e3\u9501'}</div>
                  </CardContent></Card>
                  <Card className="bg-slate-800 border-slate-700"><CardContent className="p-1.5 text-center">
                    <div className="text-sm font-bold text-cyan-400">{mapDrones.filter(d => d.onlineStatus === true).length}</div>
                    <div className="text-[9px] text-slate-400">{'\u5728\u7ebf'}</div>
                  </CardContent></Card>
                  <Card className="bg-slate-800 border-slate-700"><CardContent className="p-1.5 text-center">
                    <div className="text-sm font-bold text-red-400">{mapDrones.filter(d => (d.battery || 0) < 20).length}</div>
                    <div className="text-[9px] text-slate-400">{'\u4f4e\u7535\u91cf'}</div>
                  </CardContent></Card>
                </div>
                {/* Drone list */}
                <div className="space-y-1">
                  {[...mapDrones].sort((a, b) => {
                    const aO = a.onlineStatus === true ? 1 : 0, bO = b.onlineStatus === true ? 1 : 0;
                    if (aO !== bO) return bO - aO;
                    const aA = a.armed === true ? 1 : 0, bA = b.armed === true ? 1 : 0;
                    return bA - aA;
                  }).map(drone => (
                    <div key={drone.uavId}
                      className={`p-1.5 rounded text-xs cursor-pointer transition-all ${
                        multiSelectMode && selectedDrones.has(drone.uavId) ? 'bg-amber-900/40 border border-amber-500' :
                        selectedMapDrone === drone.uavId ? 'bg-blue-900/50 border border-blue-500' : 'bg-slate-800 border border-slate-700 hover:border-slate-500'}`}
                      onClick={() => {
                        if (multiSelectMode) {
                          const newSet = new Set(selectedDrones);
                          if (newSet.has(drone.uavId)) newSet.delete(drone.uavId);
                          else newSet.add(drone.uavId);
                          setSelectedDrones(newSet);
                          if (newSet.size === 1) {
                            setSelectedMapDrone(Array.from(newSet)[0]);
                            setShowDetailPanel(detailPanelEnabled);
                          } else if (newSet.size === 0) {
                            setSelectedMapDrone(null);
                            setShowDetailPanel(false);
                          } else {
                            setShowDetailPanel(false);
                          }
                        } else if (selectedMapDrone === drone.uavId) {
                          setShowDetailPanel(false);
                          setSelectedMapDrone(null);
                        } else {
                          setSelectedMapDrone(drone.uavId);
                          setShowDetailPanel(detailPanelEnabled);
                        }
                      }}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-bold text-blue-300 flex items-center gap-1 text-[11px]">
                          {multiSelectMode && (selectedDrones.has(drone.uavId)
                            ? <CheckSquare className="w-3 h-3 text-amber-400" />
                            : <Square className="w-3 h-3 text-slate-500" />)}
                          {drone.uavId}
                        </span>
                        <Badge className={`text-[9px] px-1 py-0 ${!drone.onlineStatus ? 'bg-slate-600' : drone.armed === true ? 'bg-green-600' : 'bg-blue-600'}`}>
                          {!drone.onlineStatus ? '\u79bb\u7ebf' : drone.armed === true ? '\u98de\u884c\u4e2d' : '\u672a\u89e3\u9501'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-slate-400 text-[10px] mb-0.5">
                        <span className="flex items-center gap-0.5"><Battery className="w-2.5 h-2.5" />{drone.battery != null ? `${drone.battery.toFixed(1)}%` : 'N/A'}</span>
                        <span>{drone.altitude != null ? `${drone.altitude.toFixed(2)}m` : ''}</span>
                        <span className="text-slate-500">{drone.teamName || ''}</span>
                      </div>
                      {/* Quick commands + transfer */}
                      <div className="flex flex-wrap gap-0.5 mt-0.5">
                        {COMMANDS.map(cmd => (
                          <Button key={cmd.type} size="sm" variant="outline"
                            className="text-[9px] h-[18px] px-1.5 bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600"
                            onClick={e => { e.stopPropagation(); handleQuickCommand(drone.uavId, cmd.type); }}>{cmd.label}</Button>
                        ))}
                        <Button size="sm" variant="outline"
                          className="text-[9px] h-[18px] px-1.5 bg-purple-700/50 border-purple-600 text-purple-300 hover:bg-purple-600"
                          onClick={e => { e.stopPropagation(); setTransferUavId(drone.uavId); setTransferResult(null); setTransferToUserId(''); setTransferDialogOpen(true); }}>
                          <ArrowRightLeft className="w-2.5 h-2.5 mr-0.5" />{'\u8f6c\u79fb'}
                        </Button>
                      </div>
                    </div>
                  ))}
                  {mapDrones.length === 0 && <div className="text-center text-slate-500 py-4 text-xs">{'\u6682\u65e0\u6570\u636e'}</div>}
                </div>
              </div>
            )}

            {/* Members Tab */}
            {activeTab === 'members' && (
              <div className="space-y-2">
                <Card className="bg-slate-800 border-slate-700">
                  <CardHeader className="pb-1 px-2 pt-2">
                    <CardTitle className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1"><Users className="w-3 h-3 text-green-400" />{teamInfo?.teamName || '\u6211\u7684\u961f\u4f0d'}</div>
                      <Badge variant="outline" className="text-slate-400 border-slate-600 text-[10px]">{members.length} {'\u4eba'}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-2 pb-2">
                    {teamInfo && <div className="text-xs text-slate-400 mb-1">{'\u961f\u957f'}: <span className="text-slate-300">{teamInfo.leader}</span></div>}
                    <div className="space-y-0.5">
                      {members.map(member => (
                        <div key={member.userId} className="flex items-center justify-between text-[10px] p-1 rounded bg-slate-700/50">
                          <div className="flex items-center gap-1">
                            <span className="text-slate-300">{member.realName || member.username}</span>
                            <span className="text-[9px] text-slate-500">ID:{member.userId}</span>
                          </div>
                          <Badge className="bg-slate-600 text-[9px] px-1 py-0">{member.role}</Badge>
                        </div>
                      ))}
                      {members.length === 0 && <div className="text-center text-slate-500 py-3 text-xs">{'\u6682\u65e0\u6210\u5458\u6570\u636e'}</div>}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Logs Tab */}
            {activeTab === 'logs' && (
              <div className="flex flex-col h-full">
                <div className="flex-1 space-y-1">
                  {logs.map(log => (
                    <div key={log.id} className="p-1.5 rounded bg-slate-800 border border-slate-700 text-xs">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-slate-500 text-[10px]">{formatTime(log.createdAt)}</span>
                        <Badge className={`text-[9px] px-1 py-0 ${log.result === 'SUCCESS' ? 'bg-green-600' : 'bg-red-600'}`}>
                          {log.result === 'SUCCESS' ? '\u6210\u529f' : log.result === 'FAILURE' ? '\u5931\u8d25' : log.result || '-'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-blue-600 text-[9px] px-1 py-0">{log.operationType}</Badge>
                        <span className="text-slate-300 text-[10px]">{log.username || '-'}</span>
                        {log.targetUavId && <span className="text-blue-300 font-mono text-[10px]">{log.targetUavId}</span>}
                      </div>
                      {log.detail && <div className="text-slate-400 mt-0.5 truncate text-[10px]">{log.detail}</div>}
                    </div>
                  ))}
                  {logs.length === 0 && <div className="text-center text-slate-500 py-4 text-xs">{'\u6682\u65e0\u65e5\u5fd7'}</div>}
                </div>
                <div className="flex items-center justify-center gap-2 pt-1.5 flex-shrink-0 border-t border-slate-700 mt-1">
                  <Button size="sm" variant="outline" disabled={logPage === 0} onClick={() => fetchLogs(logPage - 1)}
                    className="bg-slate-700 border-slate-600 text-slate-300 h-5 text-xs"><ChevronLeft className="w-3 h-3" /></Button>
                  <span className="text-xs text-slate-400">{logPage + 1} / {Math.max(1, logTotalPages)}</span>
                  <Button size="sm" variant="outline" disabled={logPage >= logTotalPages - 1} onClick={() => fetchLogs(logPage + 1)}
                    className="bg-slate-700 border-slate-600 text-slate-300 h-5 text-xs"><ChevronRight className="w-3 h-3" /></Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Multi-select aggregate panel - enlarged layout */}
        {multiSelectMode && aggregateData && detailPanelEnabled && (
          <div className="w-[320px] bg-slate-900 border-r border-slate-700 overflow-y-auto p-3 space-y-2.5 shrink-0">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader className="pb-1.5 px-3 pt-2.5">
                <CardTitle className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-1.5"><ListChecks className="w-4 h-4 text-amber-400" />{'\u591a\u673a\u805a\u5408'}</div>
                  <Badge className="bg-amber-600 text-xs px-2">{aggregateData.count} {'\u67b6'}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-700/50 rounded p-2 text-center">
                    <div className="text-[10px] text-slate-400">{'\u6700\u9ad8/\u6700\u4f4e\u9ad8\u5ea6'}</div>
                    <div className="text-sm font-bold text-blue-300">{aggregateData.maxAlt.toFixed(1)}m / {aggregateData.minAlt.toFixed(1)}m</div>
                  </div>
                  <div className="bg-slate-700/50 rounded p-2 text-center">
                    <div className="text-[10px] text-slate-400">{'\u5728\u7ebf/\u98de\u884c\u4e2d'}</div>
                    <div className="text-sm font-bold text-green-300">{aggregateData.onlineCount} / {aggregateData.flyingCount}</div>
                  </div>
                </div>
                {/* Batch control - larger buttons */}
                <div className="mt-3">
                  <div className="text-xs text-slate-400 mb-1.5 font-medium">{'\u6279\u91cf\u63a7\u5236'}</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {BATCH_COMMANDS.map(cmd => {
                      const Icon = cmd.icon;
                      return (
                        <Button key={cmd.type}
                          className={`h-auto py-1.5 flex flex-col items-center gap-0.5 ${cmd.color} text-white text-xs`}
                          onClick={() => {
                            const uavIds = multiSelectedDrones.map(d => d.uavId);
                            const params: Record<string, unknown> = {};
                            if (cmd.type === 'TAKEOFF') params.altitude = parseFloat(takeoffAlt) || 5;
                            sendBatchControlCommand(token, { uavIds, commandType: cmd.type, params: JSON.stringify(params), confirmed: true })
                              .then(res => {
                                if (res.code === 0) {
                                  setCommandFeedback({ uavId: `${uavIds.length}\u67b6`, message: `${cmd.label}\u6307\u4ee4\u5df2\u53d1\u9001`, success: true });
                                  if (cmd.type === 'TAKEOFF') {
                                    setTelemetryDrones(prev => {
                                      const next = new Map(prev);
                                      uavIds.forEach(id => {
                                        const existing = next.get(id);
                                        if (existing) { next.set(id, { ...existing, armed: true, flightStatus: 'FLYING' }); }
                                      });
                                      return next;
                                    });
                                  }
                                }
                              })
                              .catch(() => {});
                            setTimeout(() => setCommandFeedback(null), 3000);
                          }}>
                          <Icon className="w-4 h-4" />
                          <span className="font-bold text-[10px]">{cmd.label}</span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
                {/* Multi-select GOTO with coordinates */}
                <div className="mt-3 border-t border-slate-700 pt-2">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1.5">
                    <Crosshair className="w-3.5 h-3.5 text-cyan-400" />{'\u524d\u5f80\u76ee\u6807'}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1">
                      <label className="text-[10px] text-slate-500 w-8 shrink-0">{'\u7eac\u5ea6'}</label>
                      <Input type="number" step="0.0001" value={gotoLat} onChange={e => setGotoLat(e.target.value)}
                        className="bg-slate-700 border-slate-600 text-white text-xs h-7 flex-1" />
                    </div>
                    <div className="flex items-center gap-1">
                      <label className="text-[10px] text-slate-500 w-8 shrink-0">{'\u7ecf\u5ea6'}</label>
                      <Input type="number" step="0.0001" value={gotoLon} onChange={e => setGotoLon(e.target.value)}
                        className="bg-slate-700 border-slate-600 text-white text-xs h-7 flex-1" />
                    </div>
                    <div className="flex items-center gap-1">
                      <label className="text-[10px] text-slate-500 w-8 shrink-0">{'\u9ad8\u5ea6'}</label>
                      <Input type="number" value={gotoAlt} onChange={e => setGotoAlt(e.target.value)}
                        className="bg-slate-700 border-slate-600 text-white text-xs h-7 flex-1" />
                      <span className="text-[10px] text-slate-400">{'\u7c73'}</span>
                    </div>
                  </div>
                  <Button className="w-full text-xs h-7 bg-cyan-600 hover:bg-cyan-700 text-white mt-1.5"
                    onClick={() => {
                      const uavIds = multiSelectedDrones.map(d => d.uavId);
                      const params = JSON.stringify({
                        lat: parseFloat(gotoLat) || 0,
                        lon: parseFloat(gotoLon) || 0,
                        alt: parseFloat(gotoAlt) || 50,
                        formation: true,
                        droneCount: uavIds.length,
                        droneArea: 6.25,
                      });
                      sendBatchControlCommand(token, { uavIds, commandType: 'GOTO', params, confirmed: true })
                        .then(res => { if (res.code === 0) setCommandFeedback({ uavId: `${uavIds.length}\u67b6`, message: '\u524d\u5f80\u6307\u4ee4\u5df2\u53d1\u9001', success: true }); })
                        .catch(() => {});
                      setTimeout(() => setCommandFeedback(null), 3000);
                    }}>
                    <Navigation className="w-3.5 h-3.5 mr-1" />{'\u524d\u5f80'}
                  </Button>
                </div>
                {/* Multi-select MARK_HOME with optional unified coordinates */}
                <div className="mt-3 border-t border-slate-700 pt-2">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1.5">
                    <Home className="w-3.5 h-3.5 text-teal-400" />{'\u6807\u8bb0Home'}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1">
                      <label className="text-[10px] text-slate-500 w-8 shrink-0">{'\u7eac\u5ea6'}</label>
                      <Input type="number" step="0.0001" value={batchHomeLat} onChange={e => setBatchHomeLat(e.target.value)}
                        className="bg-slate-700 border-slate-600 text-white text-xs h-7 flex-1" placeholder={'\u7559\u7a7a=\u5404\u81ea\u5f53\u524d\u4f4d\u7f6e'} />
                    </div>
                    <div className="flex items-center gap-1">
                      <label className="text-[10px] text-slate-500 w-8 shrink-0">{'\u7ecf\u5ea6'}</label>
                      <Input type="number" step="0.0001" value={batchHomeLon} onChange={e => setBatchHomeLon(e.target.value)}
                        className="bg-slate-700 border-slate-600 text-white text-xs h-7 flex-1" placeholder={'\u7559\u7a7a=\u5404\u81ea\u5f53\u524d\u4f4d\u7f6e'} />
                    </div>
                  </div>
                  <Button className="w-full text-xs h-7 bg-teal-600 hover:bg-teal-700 text-white mt-1.5"
                    onClick={() => {
                      const lat = parseFloat(batchHomeLat);
                      const lon = parseFloat(batchHomeLon);
                      multiSelectedDrones.forEach(d => {
                        const homeLat = lat && lon ? lat : d.lat;
                        const homeLon = lat && lon ? lon : d.lng;
                        const params = JSON.stringify({ lat: homeLat, lon: homeLon, alt: d.altitude || 0 });
                        sendControlCommand(token, { uavId: d.uavId, commandType: 'MARK_HOME', params, confirmed: true });
                      });
                      setCommandFeedback({ uavId: `${multiSelectedDrones.length}\u67b6`, message: '\u6279\u91cfMARK_HOME\u6307\u4ee4\u5df2\u53d1\u9001', success: true });
                      setTimeout(() => setCommandFeedback(null), 3000);
                    }}>
                    <Home className="w-3.5 h-3.5 mr-1" />{'\u6807\u8bb0Home'}
                  </Button>
                </div>
                {/* Multi-select RTL with Home/Rally mode */}
                <div className="mt-3 border-t border-slate-700 pt-2">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1.5">
                    <RotateCcw className="w-3.5 h-3.5 text-purple-400" />{'\u8fd4\u822a'}
                  </div>
                  <div className="flex gap-1 mb-1.5">
                    <button onClick={() => setBatchRtlMode('home')}
                      className={`text-[10px] px-2 py-0.5 rounded ${batchRtlMode === 'home' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
                      {'\u8fd4\u56deHome'}
                    </button>
                    <button onClick={() => setBatchRtlMode('rally')}
                      className={`text-[10px] px-2 py-0.5 rounded ${batchRtlMode === 'rally' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
                      {'\u8fd4\u56de\u96c6\u7ed3\u70b9'}
                    </button>
                  </div>
                  {batchRtlMode === 'rally' && (
                    <div className="space-y-1 mb-1.5">
                      <Input value={rallySearchKeyword} onChange={e => setRallySearchKeyword(e.target.value)}
                        className="bg-slate-700 border-slate-600 text-white text-xs h-7" placeholder={'\u641c\u7d22\u96c6\u7ed3\u70b9...'} />
                      <div className="max-h-20 overflow-y-auto space-y-0.5">
                        {rallyPoints.filter(rp => !rallySearchKeyword || rp.name.toLowerCase().includes(rallySearchKeyword.toLowerCase()) || (rp.address || '').toLowerCase().includes(rallySearchKeyword.toLowerCase()))
                          .map(rp => (
                          <div key={rp.id}
                            className={`flex items-center justify-between text-[10px] rounded px-2 py-1 cursor-pointer ${selectedRallyPointId === rp.id ? 'bg-purple-700/50 border border-purple-500' : 'bg-slate-700/50 hover:bg-slate-600/50'}`}
                            onClick={() => setSelectedRallyPointId(rp.id)}>
                            <span className="text-purple-300 truncate">{rp.name}</span>
                            <span className="text-slate-400 text-[9px] shrink-0 ml-1">{rp.currentOccupancy}/{rp.capacity}</span>
                          </div>
                        ))}
                        {rallyPoints.length === 0 && <div className="text-[9px] text-slate-500 text-center py-1">{'\u6682\u65e0\u96c6\u7ed3\u70b9'}</div>}
                      </div>
                    </div>
                  )}
                  <Button className="w-full text-xs h-7 bg-purple-600 hover:bg-purple-700 text-white"
                    onClick={() => {
                      if (batchRtlMode === 'rally' && selectedRallyPointId) {
                        const rp = rallyPoints.find(r => r.id === selectedRallyPointId);
                        if (rp) {
                          multiSelectedDrones.forEach(d => {
                            const params = JSON.stringify({ lat: rp.latitude, lon: rp.longitude });
                            sendControlCommand(token, { uavId: d.uavId, commandType: 'RTL', params, confirmed: true });
                          });
                        }
                      } else {
                        multiSelectedDrones.forEach(d => {
                          sendControlCommand(token, { uavId: d.uavId, commandType: 'RTL', params: '{}', confirmed: true });
                        });
                      }
                      setCommandFeedback({ uavId: `${multiSelectedDrones.length}\u67b6`, message: '\u8fd4\u822a\u6307\u4ee4\u5df2\u53d1\u9001', success: true });
                      setTimeout(() => setCommandFeedback(null), 3000);
                    }}>
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />{'\u8fd4\u822a'}
                  </Button>
                </div>
                {/* Selected drones list */}
                <div className="mt-3 border-t border-slate-700 pt-2">
                  <div className="text-xs text-slate-400 mb-1">{'\u5df2\u9009'} ({multiSelectedDrones.length})</div>
                  <div className="space-y-0.5 max-h-28 overflow-y-auto">
                    {multiSelectedDrones.map(d => (
                      <div key={d.uavId} className="flex items-center justify-between text-[10px] bg-slate-700/50 rounded px-2 py-1">
                        <span className="text-blue-300 font-medium">{d.uavId}</span>
                        <span className="text-slate-400">{d.battery != null ? `${d.battery.toFixed(0)}%` : '-'} | {d.altitude != null ? `${d.altitude.toFixed(1)}m` : '-'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Detail control panel */}
        {showDetailPanel && selectedMapDrone && !aggregateData && (() => {
          const drone = mapDrones.find(d => d.uavId === selectedMapDrone);
          if (!drone) return null;
          return (
            <div className="w-[280px] bg-slate-900 border-r border-slate-700 overflow-y-auto p-2 space-y-2 shrink-0">
              {/* Drone status */}
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-1 px-2 pt-2">
                  <CardTitle className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1">
                      <Activity className="w-3 h-3 text-green-400" />{drone.uavId}
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setShowDetailPanel(false)}
                      className="bg-slate-700 border-slate-600 hover:bg-slate-600 text-[10px] h-5 px-1.5">{'\u5173\u95ed'}</Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-2 pb-2">
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="bg-slate-700/50 rounded p-1.5 text-center">
                      <div className="text-[9px] text-slate-400">{'\u72b6\u6001'}</div>
                      <Badge className={`text-[9px] ${drone.flightStatus === 'FLYING' ? 'bg-green-600' : 'bg-slate-600'}`}>
                        {drone.flightStatus === 'FLYING' ? '\u98de\u884c\u4e2d' : '\u5f85\u673a'}
                      </Badge>
                    </div>
                    <div className="bg-slate-700/50 rounded p-1.5 text-center">
                      <div className="text-[9px] text-slate-400">{'\u7535\u91cf'}</div>
                      <div className="text-xs font-bold flex items-center justify-center gap-0.5">
                        <Battery className={`w-2.5 h-2.5 ${(drone.battery || 0) < 20 ? 'text-red-400' : 'text-green-400'}`} />
                        {drone.battery != null ? `${drone.battery.toFixed(1)}%` : 'N/A'}
                      </div>
                    </div>
                    <div className="bg-slate-700/50 rounded p-1.5 text-center">
                      <div className="text-[9px] text-slate-400">{'\u9ad8\u5ea6'}</div>
                      <div className="text-xs font-bold">{drone.altitude != null ? `${drone.altitude.toFixed(2)}m` : 'N/A'}</div>
                    </div>
                    <div className="bg-slate-700/50 rounded p-1.5 text-center">
                      <div className="text-[9px] text-slate-400">{'\u4f4d\u7f6e'}</div>
                      <div className="text-[9px] font-mono">
                        <MapPin className="w-2.5 h-2.5 inline mr-0.5" />
                        {drone.lat?.toFixed(4)}, {drone.lng?.toFixed(4)}
                      </div>
                    </div>
                  </div>
                  {(drone.owner || drone.model) && (
                    <div className="flex items-center gap-2 mt-1.5 text-[9px] text-slate-400">
                      {drone.owner && <span>{'\u63a7\u5236\u5458'}: <span className="text-slate-300">{drone.owner}</span></span>}
                      {drone.model && <span>{'\u673a\u578b'}: <span className="text-slate-300">{drone.model}</span></span>}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Control commands */}
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-1 px-2 pt-2">
                  <CardTitle className="flex items-center gap-1 text-xs">
                    <Navigation className="w-3 h-3 text-green-400" />{'\u63a7\u5236\u6307\u4ee4'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-2 pb-2">
                  <div className="grid grid-cols-3 gap-1">
                    {DETAIL_COMMANDS.map(cmd => {
                      const Icon = cmd.icon;
                      return (
                        <Button key={cmd.type}
                          className={`h-auto py-1 flex flex-col items-center gap-0.5 ${cmd.color} text-white text-[9px]`}
                          onClick={() => handleQuickCommand(drone.uavId, cmd.type)}>
                          <Icon className="w-3 h-3" />
                          <span className="font-bold text-[9px]">{cmd.label}</span>
                        </Button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Takeoff altitude */}
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] text-slate-400 whitespace-nowrap flex items-center gap-0.5"><ArrowUp className="w-2.5 h-2.5 text-blue-400" />{'\u8d77\u98de\u9ad8\u5ea6'}</span>
                    <Input type="number" value={takeoffAlt} onChange={e => setTakeoffAlt(e.target.value)}
                      className="bg-slate-700 border-slate-600 text-white text-xs h-6 flex-1" placeholder="5" />
                    <span className="text-[9px] text-slate-400">{'\u7c73'}</span>
                  </div>
                </CardContent>
              </Card>

              {/* GOTO target */}
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="px-2 py-1.5 space-y-1">
                  <div className="flex items-center gap-1 text-[9px] text-slate-400"><Crosshair className="w-2.5 h-2.5 text-cyan-400" />{'\u524d\u5f80\u76ee\u6807'}</div>
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1">
                      <label className="text-[9px] text-slate-500 w-8 shrink-0">{'\u5730\u5740'}</label>
                      <Input value={gotoAddress} onChange={e => setGotoAddress(e.target.value)}
                        className="bg-slate-700 border-slate-600 text-white text-xs h-6 flex-1" placeholder={'\u5730\u5740/\u5730\u540d(\u53ef\u9009)'} />
                    </div>
                    <div className="flex items-center gap-1">
                      <label className="text-[9px] text-slate-500 w-8 shrink-0">{'\u7eac\u5ea6'}</label>
                      <Input type="number" step="0.0001" value={gotoLat} onChange={e => setGotoLat(e.target.value)}
                        className="bg-slate-700 border-slate-600 text-white text-xs h-6 flex-1" />
                    </div>
                    <div className="flex items-center gap-1">
                      <label className="text-[9px] text-slate-500 w-8 shrink-0">{'\u7ecf\u5ea6'}</label>
                      <Input type="number" step="0.0001" value={gotoLon} onChange={e => setGotoLon(e.target.value)}
                        className="bg-slate-700 border-slate-600 text-white text-xs h-6 flex-1" />
                    </div>
                    <div className="flex items-center gap-1">
                      <label className="text-[9px] text-slate-500 w-8 shrink-0">{'\u9ad8\u5ea6'}</label>
                      <Input type="number" value={gotoAlt} onChange={e => setGotoAlt(e.target.value)}
                        className="bg-slate-700 border-slate-600 text-white text-xs h-6 flex-1" />
                      <span className="text-[9px] text-slate-400">{'\u7c73'}</span>
                    </div>
                  </div>
                  <Button className="w-full text-xs h-6 bg-cyan-600 hover:bg-cyan-700 text-white"
                    onClick={() => handleQuickCommand(drone.uavId, 'GOTO')}>
                    <Navigation className="w-3 h-3 mr-1" />{'\u524d\u5f80'}
                  </Button>
                </CardContent>
              </Card>

              {/* RTL with optional custom location */}
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="px-2 py-1.5 space-y-1">
                  <div className="flex items-center gap-1 text-[9px] text-slate-400"><RotateCcw className="w-2.5 h-2.5 text-purple-400" />{'\u8fd4\u822a\u8bbe\u7f6e'}</div>
                  <div className="flex items-center gap-1 text-[9px]">
                    <Home className="w-2.5 h-2.5 text-teal-400" />
                    {homePosition ? (
                      <span className="text-teal-300">Home: {homePosition.lat.toFixed(6)}, {homePosition.lon.toFixed(6)}</span>
                    ) : (
                      <span className="text-slate-500">{'\u672a\u8bbe\u7f6eHome'}</span>
                    )}
                    <Button size="sm" variant="outline" onClick={locateHome}
                      className="h-4 px-1 text-[8px] bg-teal-700/50 border-teal-600 text-teal-300 ml-auto">
                      <Locate className="w-2 h-2 mr-0.5" />{'\u5b9a\u4f4d'}
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="text-[9px] text-slate-500 w-8 shrink-0">{'\u7eac\u5ea6'}</label>
                    <Input type="number" step="0.0001" value={rtlLat} onChange={e => setRtlLat(e.target.value)}
                      className="bg-slate-700 border-slate-600 text-white text-xs h-6 flex-1" placeholder={'\u7559\u7a7a\u8fd4\u56deHome'} />
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="text-[9px] text-slate-500 w-8 shrink-0">{'\u7ecf\u5ea6'}</label>
                    <Input type="number" step="0.0001" value={rtlLon} onChange={e => setRtlLon(e.target.value)}
                      className="bg-slate-700 border-slate-600 text-white text-xs h-6 flex-1" placeholder={'\u7559\u7a7a\u8fd4\u56deHome'} />
                  </div>
                  <Button className="w-full text-xs h-6 bg-purple-600 hover:bg-purple-700 text-white"
                    onClick={() => handleQuickCommand(drone.uavId, 'RTL')}>
                    <RotateCcw className="w-3 h-3 mr-1" />{'\u8fd4\u822a'}
                  </Button>
                </CardContent>
              </Card>
            </div>
          );
        })()}

        {/* Right: Map view */}
        <div className="flex-1 h-full">
          <MapPanel drones={mapDrones} selectedDroneId={selectedMapDrone}
            selectedDroneIds={multiSelectMode ? selectedDrones : undefined}
            homeMarker={homeMarker}
            rallyPoints={rallyPoints.map(rp => ({ id: rp.id, name: rp.name, latitude: rp.latitude, longitude: rp.longitude, capacity: rp.capacity, currentOccupancy: rp.currentOccupancy, status: rp.status, serviceType: rp.serviceType }))}
            onDroneClick={(id) => {
              if (multiSelectMode) {
                const newSet = new Set(selectedDrones);
                if (newSet.has(id)) { newSet.delete(id); } else { newSet.add(id); }
                setSelectedDrones(newSet);
                if (newSet.size === 1) {
                  setSelectedMapDrone(Array.from(newSet)[0]);
                  setShowDetailPanel(detailPanelEnabled);
                } else if (newSet.size === 0) {
                  setSelectedMapDrone(null);
                  setShowDetailPanel(false);
                } else {
                  setShowDetailPanel(false);
                }
              } else {
                if (selectedMapDrone === id) {
                  setShowDetailPanel(false);
                  setSelectedMapDrone(null);
                } else {
                  setSelectedMapDrone(id);
                  setShowDetailPanel(detailPanelEnabled);
                }
              }
            }}
            showDroneList={leftPanelCollapsed} showEventLog={false} />
        </div>
      </div>

      {/* Transfer dialog */}
      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">{'\u961f\u5185\u63a7\u5236\u6743\u8f6c\u79fb'}</DialogTitle>
            <DialogDescription className="text-slate-400">
              {'\u5c06\u65e0\u4eba\u673a'} {transferUavId} {'\u7684\u63a7\u5236\u6743\u8f6c\u79fb\u7ed9\u961f\u5185\u6210\u5458'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-slate-300 mb-1 block">{'\u76ee\u6807\u6210\u5458'}</label>
              <select
                value={transferToUserId}
                onChange={e => setTransferToUserId(e.target.value)}
                className="w-full rounded-md bg-slate-700 border-slate-600 text-white px-3 py-2 text-sm"
              >
                <option value="">{'\u9009\u62e9\u961f\u5185\u6210\u5458...'}</option>
                {members.map(m => (
                  <option key={m.userId} value={m.userId}>
                    {m.realName || m.username} ({m.role})
                  </option>
                ))}
              </select>
            </div>
            {transferResult && (
              <div className={`p-2 rounded ${transferResult.success ? 'bg-green-900/30 border border-green-700' : 'bg-red-900/30 border border-red-700'}`}>
                <div className="flex items-center gap-2 text-sm">
                  {transferResult.success
                    ? <Activity className="w-4 h-4 text-green-400" />
                    : <AlertTriangle className="w-4 h-4 text-red-400" />}
                  <span className={transferResult.success ? 'text-green-300' : 'text-red-300'}>{transferResult.message}</span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setTransferDialogOpen(false); setTransferResult(null); }}
              className="bg-slate-700 border-slate-600 text-slate-300">{'\u53d6\u6d88'}</Button>
            <Button onClick={handleTeamTransfer} disabled={transferLoading || !transferToUserId}
              className="bg-purple-600 hover:bg-purple-700">
              {transferLoading ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : null}
              {'\u786e\u8ba4\u8f6c\u79fb'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
