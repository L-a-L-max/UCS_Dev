import { useState, useEffect, useCallback, useRef } from 'react';
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
  Navigation,
  Pause,
  RefreshCw,
  LogOut,
  Activity,
  Eye,
  EyeOff,
  CheckSquare,
  Square,
  ListChecks,
  Home,
  Crosshair,
  Locate,
  ChevronDown,
  ChevronRight,
  Circle,
} from 'lucide-react';
import {
  sendControlCommand,
  sendBatchControlCommand,
  getDroneStatus,
  getPilotDrones,
  getEnabledRallyPoints,
  getDroneHomePosition,
  type DroneInfo,
  type RallyPoint,
} from '@/services/api';
import MapPanel, { type MapDrone } from '@/components/MapPanel';
import { useTelemetryWebSocket, type PartitionTelemetryMessage, type CommandAckMessage } from '@/hooks/useTelemetryWebSocket';

interface PilotViewProps {
  token: string;
  username: string;
  partitions?: string[];
  onLogout: () => void;
}

// Control commands - ARM/DISARM removed, TAKEOFF handles ARM+OFFBOARD+climb
// RTL removed from quick commands - use the configurable RTL panel below instead
const COMMANDS = [
  { type: 'TAKEOFF', label: '\u8d77\u98de', icon: ArrowUp, color: 'bg-blue-600 hover:bg-blue-700', description: '\u89e3\u9501+\u8d77\u98de\u5230\u6307\u5b9a\u9ad8\u5ea6' },
  { type: 'LAND', label: '\u964d\u843d', icon: ArrowDown, color: 'bg-amber-600 hover:bg-amber-700', description: '\u505c\u6b62\u5fc3\u8df3+\u539f\u5730\u964d\u843d' },
  { type: 'HOLD', label: '\u60ac\u505c', icon: Pause, color: 'bg-orange-600 hover:bg-orange-700', description: '\u9501\u5b9a\u5f53\u524d\u4f4d\u7f6e\u60ac\u505c' },
  { type: 'MARK_HOME', label: '\u6807\u8bb0Home', icon: Home, color: 'bg-teal-600 hover:bg-teal-700', description: '\u8bbe\u7f6e\u5f53\u524d\u4f4d\u7f6e\u4e3aHome' },
];

// Quick commands on drone cards
const QUICK_COMMANDS = [
  { type: 'TAKEOFF', label: '\u8d77\u98de' },
  { type: 'LAND', label: '\u964d\u843d' },
  { type: 'RTL', label: '\u8fd4\u822a' },
  { type: 'HOLD', label: '\u60ac\u505c' },
];

export default function PilotView({ token, username, partitions = [], onLogout }: PilotViewProps) {
  const [drones, setDrones] = useState<DroneInfo[]>([]);
  const [selectedDrone, setSelectedDrone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendingCommand, setSendingCommand] = useState<string | null>(null);
  const [quickFeedback, setQuickFeedback] = useState<{ uavId: string; message: string; success: boolean } | null>(null);
  const [commandAckFeedback, setCommandAckFeedback] = useState<{ uavId: string; message: string; success: boolean } | null>(null);

  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [detailPanelEnabled, setDetailPanelEnabled] = useState(true);

  // Multi-select mode
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedDrones, setSelectedDrones] = useState<Set<string>>(new Set());

  // GOTO params
  const [gotoLat, setGotoLat] = useState('39.9042');
  const [gotoLon, setGotoLon] = useState('116.4074');
  const [gotoAlt, setGotoAlt] = useState('50');
  const [gotoAddress, setGotoAddress] = useState('');

  // TAKEOFF params
  const [takeoffAlt, setTakeoffAlt] = useState('5');

  // RTL params - single drone mode: 'home' or 'rally'
  const [singleRtlMode, setSingleRtlMode] = useState<'home' | 'rally'>('home');
  const [singleSelectedRallyId, setSingleSelectedRallyId] = useState<number | null>(null);
  const [singleRallySearch, setSingleRallySearch] = useState('');

  // Detail panel section collapse states (Issue 6: collapsed by default)
  const [gotoExpanded, setGotoExpanded] = useState(false);
  const [rtlExpanded, setRtlExpanded] = useState(false);
  const [markHomeExpanded, setMarkHomeExpanded] = useState(false);
  const [orbitExpanded, setOrbitExpanded] = useState(false);

  // Orbit params (Issue 4)
  const [orbitLat, setOrbitLat] = useState('');
  const [orbitLon, setOrbitLon] = useState('');
  const [orbitRadius, setOrbitRadius] = useState('5');

  // Map click coordinates for dynamic fill (Issue 5)
  const [mapClickCoords, setMapClickCoords] = useState<{ lat: number; lon: number } | null>(null);

  // Multi-select panel section collapse states
  const [batchGotoExpanded, setBatchGotoExpanded] = useState(false);
  const [batchMarkHomeExpanded, setBatchMarkHomeExpanded] = useState(false);
  const [batchRtlExpanded, setBatchRtlExpanded] = useState(false);
  const [batchOrbitExpanded, setBatchOrbitExpanded] = useState(false);

  // Home position display
  const [homePosition, setHomePosition] = useState<{ lat: number; lon: number; alt: number } | null>(null);

  // Home marker for map (flashing dot)
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
    setSelectedDrone(prev => {
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
    fetchRallyPoints();
    const interval = setInterval(fetchDrones, 5000);
    return () => clearInterval(interval);
  }, [fetchDrones, fetchRallyPoints]);

  // Fetch Home position from Redis when a drone is selected (cross-view sync)
  useEffect(() => {
    if (!selectedDrone) {
      setHomePosition(null);
      return;
    }
    // Clear previous Home immediately to avoid stale data from prior drone
    setHomePosition(null);
    (async () => {
      try {
        const res = await getDroneHomePosition(token, selectedDrone);
        if (res.code === 0 && res.data && res.data.lat !== 0 && res.data.lon !== 0) {
          setHomePosition({ lat: res.data.lat, lon: res.data.lon, alt: res.data.alt });
        }
      } catch {
        // Silently ignore - Home may not be set yet
      }
    })();
  }, [selectedDrone, token]);

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

  // Unified command handler
  const handleCommand = async (commandType: string, uavId?: string) => {
    const targetUav = uavId || selectedDrone;
    if (!targetUav) return;
    // Command protection (Issue 5): check drone online/armed status
    const droneStatus = mapDrones.find(d => d.uavId === targetUav);
    if (droneStatus) {
      if (droneStatus.onlineStatus === 'OFFLINE') {
        setQuickFeedback({ uavId: targetUav, message: '无人机离线，无法执行命令', success: false });
        setTimeout(() => setQuickFeedback(null), 3000);
        return;
      }
      if (!droneStatus.armed && !['ARM', 'TAKEOFF', 'MARK_HOME'].includes(commandType)) {
        setQuickFeedback({ uavId: targetUav, message: '无人机未解锁，请先ARM', success: false });
        setTimeout(() => setQuickFeedback(null), 3000);
        return;
      }
    }
    setSendingCommand(commandType);

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
      // RTL uses rally point coordinates if in rally mode
      if (singleRtlMode === 'rally' && singleSelectedRallyId) {
        const rp = rallyPoints.find(r => r.id === singleSelectedRallyId);
        if (rp) {
          params = JSON.stringify({ lat: rp.latitude, lon: rp.longitude });
        }
      }
      // Home mode: no extra params, drone returns to its Home point
    } else if (commandType === 'ORBIT') {
      // Include current drone altitude to prevent altitude loss during orbit
      const droneAlt = mapDrones.find(d => d.uavId === targetUav)?.altitude || 0;
      params = JSON.stringify({
        lat: parseFloat(orbitLat) || 0,
        lon: parseFloat(orbitLon) || 0,
        radius: Math.max(2.5, Math.min(20, parseFloat(orbitRadius) || 5)),
        alt: droneAlt > 0 ? droneAlt : (parseFloat(gotoAlt) || 50),
      });
    } else if (commandType === 'MARK_HOME') {
      const droneInfo = mapDrones.find(d => d.uavId === targetUav);
      if (droneInfo && droneInfo.lat && droneInfo.lng) {
        params = JSON.stringify({
          lat: droneInfo.lat,
          lon: droneInfo.lng,
          alt: droneInfo.altitude || 0,
        });
      }
    }

    try {
      const res = await sendControlCommand(token, {
        uavId: targetUav,
        commandType,
        params,
        confirmed: true,
      });
      if (res.code === 0 && res.data) {
        setQuickFeedback({ uavId: targetUav, message: `${commandType} \u6307\u4ee4\u5df2\u53d1\u9001`, success: true });
        if (commandType === 'MARK_HOME' || commandType === 'TAKEOFF') {
          const droneInfo = mapDrones.find(d => d.uavId === targetUav);
          if (droneInfo && droneInfo.lat && droneInfo.lng) {
            setHomePosition({ lat: droneInfo.lat, lon: droneInfo.lng, alt: droneInfo.altitude || 0 });
          }
        }
      } else {
        setQuickFeedback({ uavId: targetUav, message: res.msg || '\u6307\u4ee4\u53d1\u9001\u5931\u8d25', success: false });
      }
    } catch {
      setQuickFeedback({ uavId: targetUav, message: '\u7f51\u7edc\u9519\u8bef\uff0c\u8bf7\u68c0\u67e5\u540e\u7aef\u670d\u52a1', success: false });
    } finally {
      setSendingCommand(null);
      setTimeout(() => setQuickFeedback(null), 3000);
    }
  };

  // Dynamic lat/lng fill from map click (Issue 5)
  useEffect(() => {
    if (!mapClickCoords) return;
    setGotoLat(mapClickCoords.lat.toFixed(6));
    setGotoLon(mapClickCoords.lon.toFixed(6));
    setBatchHomeLat(mapClickCoords.lat.toFixed(6));
    setBatchHomeLon(mapClickCoords.lon.toFixed(6));
    setOrbitLat(mapClickCoords.lat.toFixed(6));
    setOrbitLon(mapClickCoords.lon.toFixed(6));
  }, [mapClickCoords]);

  // QGC-style map command handler (Issue 3)
  const handleMapCommand = async (lat: number, lon: number, commandType: string) => {
    const uavId = selectedDrone;
    if (!uavId) return;
    // Command protection (Issue 5)
    const droneInfo = mapDrones.find(d => d.uavId === uavId);
    if (droneInfo) {
      if (droneInfo.onlineStatus === 'OFFLINE') {
        setQuickFeedback({ uavId, message: '无人机离线，无法执行命令', success: false });
        setTimeout(() => setQuickFeedback(null), 3000);
        return;
      }
      if (!droneInfo.armed && !['ARM', 'TAKEOFF'].includes(commandType)) {
        setQuickFeedback({ uavId, message: '无人机未解锁，请先ARM', success: false });
        setTimeout(() => setQuickFeedback(null), 3000);
        return;
      }
    }
    const droneAlt = droneInfo?.altitude || 0;
    let params = '{}';
    if (commandType === 'GOTO') {
      params = JSON.stringify({ lat, lon, alt: droneAlt > 0 ? droneAlt : 50 });
    } else if (commandType === 'ORBIT') {
      params = JSON.stringify({ lat, lon, radius: 5, alt: droneAlt > 0 ? droneAlt : 50 });
    } else if (commandType === 'SET_ROI') {
      params = JSON.stringify({ lat, lon, alt: droneAlt > 0 ? droneAlt : 50 });
    } else if (commandType === 'SET_YAW') {
      if (droneInfo && droneInfo.lat && droneInfo.lng) {
        const dLon = lon - droneInfo.lng;
        const y = Math.sin(dLon * Math.PI / 180) * Math.cos(lat * Math.PI / 180);
        const x = Math.cos(droneInfo.lat * Math.PI / 180) * Math.sin(lat * Math.PI / 180) -
                  Math.sin(droneInfo.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * Math.cos(dLon * Math.PI / 180);
        const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
        params = JSON.stringify({ yaw: bearing });
      }
    } else if (commandType === 'SET_GPS_ORIGIN') {
      params = JSON.stringify({ lat, lon, alt: 0 });
    }
    try {
      const res = await sendControlCommand(token, { uavId, commandType, params, confirmed: true });
      if (res.code === 0) {
        setQuickFeedback({ uavId, message: `${commandType} 指令已发送`, success: true });
      } else {
        setQuickFeedback({ uavId, message: res.msg || '指令发送失败', success: false });
      }
    } catch {
      setQuickFeedback({ uavId, message: '网络错误', success: false });
    }
    setTimeout(() => setQuickFeedback(null), 3000);
  };

  // Locate home on map (flashing dot for 5s)
  const locateHome = () => {
    if (homePosition) {
      setHomeMarker({ lat: homePosition.lat, lng: homePosition.lon });
      setTimeout(() => setHomeMarker(null), 5000);
    }
  };

  // Multi-select aggregate data
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
    <div className="h-screen bg-slate-900 text-white flex flex-col overflow-hidden relative">
      {/* Floating Toast feedback */}
      {(quickFeedback || commandAckFeedback) && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-1.5 pointer-events-none" style={{ minWidth: 280, maxWidth: 420 }}>
          {quickFeedback && (
            <div className={`px-4 py-2 rounded-lg text-xs shadow-lg backdrop-blur-sm pointer-events-auto transition-all duration-300 ${
              quickFeedback.success ? 'bg-green-900/70 border border-green-600/50 text-green-200' : 'bg-red-900/70 border border-red-600/50 text-red-200'
            }`}>
              <span className="font-medium">[{quickFeedback.uavId}]</span> {quickFeedback.message}
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
          <Plane className="w-5 h-5 text-blue-400" />
          {'\u98de\u624b\u63a7\u5236\u9762\u677f'}
          <Badge variant="outline" className="ml-2 text-blue-300 border-blue-500">{username}</Badge>
        </h1>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm"
            onClick={() => {
              if (!multiSelectMode) {
                setSelectedDrones(new Set());
                setShowDetailPanel(false);
                setSelectedDrone(null);
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
                  setSelectedDrone(null);
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
              else if (selectedDrone) setShowDetailPanel(true);
            }}
            className={`text-xs h-7 ${detailPanelEnabled ? 'bg-blue-600/30 border-blue-500 text-blue-300' : 'bg-slate-700/50 border-slate-500/50 text-slate-400'}`}>
            {detailPanelEnabled ? <Eye className="w-3.5 h-3.5 mr-1" /> : <EyeOff className="w-3.5 h-3.5 mr-1" />}{'\u8be6\u60c5'}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchDrones} disabled={loading}
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
        {/* Left: Drone list with quick controls */}
        <div className="w-60 bg-slate-800 border-r border-slate-700 overflow-y-auto p-1.5 space-y-1 shrink-0">
          <h2 className="text-[10px] font-semibold text-slate-400 mb-0.5 px-1">{'\u6211\u7684\u65e0\u4eba\u673a'}</h2>
          {mapDrones.length === 0 && <p className="text-slate-500 text-xs text-center py-6">{'\u6682\u65e0\u53ef\u63a7\u5236\u7684\u65e0\u4eba\u673a'}</p>}
          {[...mapDrones].sort((a, b) => {
            const aO = a.onlineStatus === true ? 1 : 0, bO = b.onlineStatus === true ? 1 : 0;
            if (aO !== bO) return bO - aO;
            const aA = a.armed === true ? 1 : 0, bA = b.armed === true ? 1 : 0;
            return bA - aA;
          }).map(drone => (
            <div key={drone.uavId}
              className={`p-1.5 rounded text-xs cursor-pointer transition-all ${
                multiSelectMode && selectedDrones.has(drone.uavId) ? 'bg-amber-900/40 border border-amber-500' :
                selectedDrone === drone.uavId
                  ? 'bg-blue-900/50 border border-blue-500'
                  : 'bg-slate-700 border border-slate-600 hover:border-slate-500'
              }`}
              onClick={() => {
                if (multiSelectMode) {
                  const newSet = new Set(selectedDrones);
                  if (newSet.has(drone.uavId)) newSet.delete(drone.uavId);
                  else newSet.add(drone.uavId);
                  setSelectedDrones(newSet);
                  if (newSet.size === 1) {
                    setSelectedDrone(Array.from(newSet)[0]);
                    setShowDetailPanel(detailPanelEnabled);
                  } else if (newSet.size === 0) {
                    setSelectedDrone(null);
                    setShowDetailPanel(false);
                  } else {
                    setShowDetailPanel(false);
                  }
                } else if (selectedDrone === drone.uavId) {
                  setShowDetailPanel(false);
                  setSelectedDrone(null);
                } else {
                  setSelectedDrone(drone.uavId);
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
                <Badge className={`text-[9px] px-1 py-0 ${
                  !drone.onlineStatus ? 'bg-slate-600' : drone.armed === true ? 'bg-green-600' : 'bg-blue-600'
                }`}>
                  {!drone.onlineStatus ? '\u79bb\u7ebf' : drone.armed === true ? '\u98de\u884c\u4e2d' : '\u672a\u89e3\u9501'}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-slate-400 text-[10px]">
                <span className="flex items-center gap-0.5"><Battery className="w-2.5 h-2.5" />{drone.battery != null ? `${drone.battery.toFixed(1)}%` : 'N/A'}</span>
                <span className="flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{drone.altitude != null ? `${drone.altitude.toFixed(2)}m` : 'N/A'}</span>
              </div>
              {/* Quick control buttons */}
              <div className="flex flex-wrap gap-0.5 mt-1">
                {QUICK_COMMANDS.map(cmd => (
                  <Button key={cmd.type} size="sm" variant="outline"
                    className="text-[9px] h-[18px] px-1.5 bg-slate-600/50 border-slate-500 text-slate-300 hover:bg-slate-500"
                    onClick={e => { e.stopPropagation(); handleCommand(cmd.type, drone.uavId); }}
                    disabled={sendingCommand !== null}>
                    {cmd.label}
                  </Button>
                ))}
              </div>
            </div>
          ))}
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
                    <div className="text-[11px] font-bold text-blue-300">{aggregateData.maxAlt.toFixed(1)}m / {aggregateData.minAlt.toFixed(1)}m</div>
                  </div>
                  <div className="bg-slate-700/50 rounded p-2 text-center">
                    <div className="text-[10px] text-slate-400">{'\u5728\u7ebf/\u98de\u884c\u4e2d'}</div>
                    <div className="text-[11px] font-bold text-green-300">{aggregateData.onlineCount} / {aggregateData.flyingCount}</div>
                  </div>
                </div>
                {/* Batch control - larger buttons */}
                <div className="mt-3">
                  <div className="text-xs text-slate-400 mb-1.5 font-medium">{'\u63a7\u5236'}</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[{ type: 'TAKEOFF', label: '\u8d77\u98de', icon: ArrowUp, color: 'bg-blue-600 hover:bg-blue-700' },
                      { type: 'LAND', label: '\u964d\u843d', icon: ArrowDown, color: 'bg-amber-600 hover:bg-amber-700' },
                      { type: 'HOLD', label: '\u60ac\u505c', icon: Pause, color: 'bg-orange-600 hover:bg-orange-700' }].map(cmd => {
                      const Icon = cmd.icon;
                      return (
                        <Button key={cmd.type}
                          className={`h-auto py-1.5 flex flex-col items-center gap-0.5 ${cmd.color} text-white text-xs`}
                          onClick={() => {
                            const uavIds = multiSelectedDronesList.map(d => d.uavId);
                            const params: Record<string, unknown> = {};
                            if (cmd.type === 'TAKEOFF') params.altitude = parseFloat(takeoffAlt) || 5;
                            sendBatchControlCommand(token, { uavIds, commandType: cmd.type, params: JSON.stringify(params), confirmed: true })
                              .then(res => {
                                if (res.code === 0) {
                                  setQuickFeedback({ uavId: `${uavIds.length}\u67b6`, message: `${cmd.label}\u6307\u4ee4\u5df2\u53d1\u9001`, success: true });
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
                            setTimeout(() => setQuickFeedback(null), 3000);
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
                      const uavIds = multiSelectedDronesList.map(d => d.uavId);
                      const params = JSON.stringify({
                        lat: parseFloat(gotoLat) || 0,
                        lon: parseFloat(gotoLon) || 0,
                        alt: parseFloat(gotoAlt) || 50,
                        formation: true,
                        droneCount: uavIds.length,
                        droneArea: 6.25,
                      });
                      sendBatchControlCommand(token, { uavIds, commandType: 'GOTO', params, confirmed: true })
                        .then(res => { if (res.code === 0) setQuickFeedback({ uavId: `${uavIds.length}\u67b6`, message: '\u524d\u5f80\u6307\u4ee4\u5df2\u53d1\u9001', success: true }); })
                        .catch(() => {});
                      setTimeout(() => setQuickFeedback(null), 3000);
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
                      multiSelectedDronesList.forEach(d => {
                        const homeLat = lat && lon ? lat : d.lat;
                        const homeLon = lat && lon ? lon : d.lng;
                        const params = JSON.stringify({ lat: homeLat, lon: homeLon, alt: d.altitude || 0 });
                        sendControlCommand(token, { uavId: d.uavId, commandType: 'MARK_HOME', params, confirmed: true });
                      });
                      setQuickFeedback({ uavId: `${multiSelectedDronesList.length}\u67b6`, message: '\u6279\u91cfMARK_HOME\u6307\u4ee4\u5df2\u53d1\u9001', success: true });
                      setTimeout(() => setQuickFeedback(null), 3000);
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
                          multiSelectedDronesList.forEach(d => {
                            const params = JSON.stringify({ lat: rp.latitude, lon: rp.longitude });
                            sendControlCommand(token, { uavId: d.uavId, commandType: 'RTL', params, confirmed: true });
                          });
                        }
                      } else {
                        multiSelectedDronesList.forEach(d => {
                          sendControlCommand(token, { uavId: d.uavId, commandType: 'RTL', params: '{}', confirmed: true });
                        });
                      }
                      setQuickFeedback({ uavId: `${multiSelectedDronesList.length}\u67b6`, message: '\u8fd4\u822a\u6307\u4ee4\u5df2\u53d1\u9001', success: true });
                      setTimeout(() => setQuickFeedback(null), 3000);
                    }}>
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />{'\u8fd4\u822a'}
                  </Button>
                </div>
                {/* Selected drones list */}
                <div className="mt-3 border-t border-slate-700 pt-2">
                  <div className="text-xs text-slate-400 mb-1">{'\u5df2\u9009'} ({multiSelectedDronesList.length})</div>
                  <div className="space-y-0.5 max-h-28 overflow-y-auto">
                    {multiSelectedDronesList.map(d => (
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
        {showDetailPanel && !aggregateData && (
          <div className="w-[300px] overflow-y-auto p-2 border-r border-slate-700 space-y-2 shrink-0">
            {!selectedDrone ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-slate-500">
                  <Plane className="w-10 h-10 mx-auto mb-2 opacity-20" />
                  <p className="text-xs">{'\u8bf7\u4ece\u5de6\u4fa7\u9009\u62e9\u65e0\u4eba\u673a'}</p>
                </div>
              </div>
            ) : (
            <div className="space-y-2">
              {/* Drone status */}
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-1 px-2 pt-2">
                  <CardTitle className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1">
                      <Activity className="w-3 h-3 text-blue-400" />{selectedDrone}
                    </div>
                    <Button size="sm" variant="outline" onClick={refreshDroneStatus}
                      className="bg-slate-700 border-slate-600 hover:bg-slate-600 text-[10px] h-5 px-1.5">
                      <RefreshCw className={`w-2.5 h-2.5 mr-0.5 ${loading ? 'animate-spin' : ''}`} />{'\u5237\u65b0'}
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-2 pb-2">
                  {selectedDroneInfo && (
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="bg-slate-700/50 rounded p-1.5 text-center">
                        <div className="text-[9px] text-slate-400">{'\u72b6\u6001'}</div>
                        <Badge className={`text-[9px] ${selectedDroneInfo.flightStatus === 'FLYING' ? 'bg-green-600' : 'bg-slate-600'}`}>
                          {selectedDroneInfo.flightStatus === 'FLYING' ? '\u98de\u884c\u4e2d' : '\u5f85\u673a'}
                        </Badge>
                      </div>
                      <div className="bg-slate-700/50 rounded p-1.5 text-center">
                        <div className="text-[9px] text-slate-400">{'\u7535\u91cf'}</div>
                        <div className="text-xs font-bold flex items-center justify-center gap-0.5">
                          <Battery className={`w-2.5 h-2.5 ${(selectedDroneInfo.battery || 0) < 20 ? 'text-red-400' : 'text-green-400'}`} />
                          {selectedDroneInfo.battery != null ? `${selectedDroneInfo.battery.toFixed(1)}%` : 'N/A'}
                        </div>
                      </div>
                      <div className="bg-slate-700/50 rounded p-1.5 text-center">
                        <div className="text-[9px] text-slate-400">{'\u9ad8\u5ea6'}</div>
                        <div className="text-xs font-bold">{selectedDroneInfo.altitude != null ? `${selectedDroneInfo.altitude.toFixed(2)}m` : 'N/A'}</div>
                      </div>
                      <div className="bg-slate-700/50 rounded p-1.5 text-center">
                        <div className="text-[9px] text-slate-400">{'\u4f4d\u7f6e'}</div>
                        <div className="text-[9px] font-mono">{selectedDroneInfo.lat?.toFixed(4)}, {selectedDroneInfo.lng?.toFixed(4)}</div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Control commands */}
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-1 px-2 pt-2">
                  <CardTitle className="flex items-center gap-1 text-xs">
                    <Navigation className="w-3 h-3 text-blue-400" />{'\u63a7\u5236\u6307\u4ee4'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-2 pb-2">
                  <div className="grid grid-cols-3 gap-1">
                    {COMMANDS.map(cmd => {
                      const Icon = cmd.icon;
                      return (
                        <Button key={cmd.type}
                          className={`h-auto py-1 flex flex-col items-center gap-0.5 ${cmd.color} text-white text-[9px]`}
                          onClick={() => handleCommand(cmd.type)} disabled={sendingCommand !== null}
                          title={cmd.description}>
                          <Icon className="w-3 h-3" />
                          <span className="font-bold text-[9px]">{cmd.label}</span>
                          {sendingCommand === cmd.type && <RefreshCw className="w-2.5 h-2.5 animate-spin" />}
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

              {/* GOTO target - collapsible */}
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="px-2 py-1.5 space-y-1">
                  <div className="flex items-center gap-1 text-[9px] text-slate-400 cursor-pointer" onClick={() => setGotoExpanded(!gotoExpanded)}>
                    {gotoExpanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
                    <Crosshair className="w-2.5 h-2.5 text-cyan-400" />{'\u524d\u5f80\u76ee\u6807'}
                  </div>
                  {gotoExpanded && (
                    <>
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
                        onClick={() => handleCommand('GOTO')} disabled={sendingCommand !== null}>
                        <Navigation className="w-3 h-3 mr-1" />{'\u524d\u5f80'}
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* RTL with Home/Rally mode - collapsible */}
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="px-2 py-1.5 space-y-1">
                  <div className="flex items-center gap-1 text-[9px] text-slate-400 cursor-pointer" onClick={() => setRtlExpanded(!rtlExpanded)}>
                    {rtlExpanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
                    <RotateCcw className="w-2.5 h-2.5 text-purple-400" />{'\u8fd4\u822a\u8bbe\u7f6e'}
                  </div>
                  {rtlExpanded && (
                    <>
                      <div className="flex gap-1 mb-1">
                        <button onClick={() => setSingleRtlMode('home')}
                          className={`text-[9px] px-2 py-0.5 rounded ${singleRtlMode === 'home' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
                          {'\u8fd4\u56deHome'}
                        </button>
                        <button onClick={() => setSingleRtlMode('rally')}
                          className={`text-[9px] px-2 py-0.5 rounded ${singleRtlMode === 'rally' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
                          {'\u8fd4\u56de\u96c6\u7ed3\u70b9'}
                        </button>
                      </div>
                      {singleRtlMode === 'home' && (
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
                      )}
                      {singleRtlMode === 'rally' && (
                        <div className="space-y-1">
                          <Input value={singleRallySearch} onChange={e => setSingleRallySearch(e.target.value)}
                            className="bg-slate-700 border-slate-600 text-white text-[9px] h-6" placeholder={'\u641c\u7d22\u96c6\u7ed3\u70b9...'} />
                          <div className="max-h-20 overflow-y-auto space-y-0.5">
                            {rallyPoints.filter(rp => !singleRallySearch || rp.name.toLowerCase().includes(singleRallySearch.toLowerCase()) || (rp.address || '').toLowerCase().includes(singleRallySearch.toLowerCase()))
                              .map(rp => (
                              <div key={rp.id}
                                className={`flex items-center justify-between text-[9px] rounded px-2 py-0.5 cursor-pointer ${singleSelectedRallyId === rp.id ? 'bg-purple-700/50 border border-purple-500' : 'bg-slate-700/50 hover:bg-slate-600/50'}`}
                                onClick={() => setSingleSelectedRallyId(rp.id)}>
                                <span className="text-purple-300 truncate">{rp.name}</span>
                                <span className="text-slate-400 text-[8px] shrink-0 ml-1">{rp.currentOccupancy}/{rp.capacity}</span>
                              </div>
                            ))}
                            {rallyPoints.length === 0 && <div className="text-[8px] text-slate-500 text-center py-1">{'\u6682\u65e0\u96c6\u7ed3\u70b9'}</div>}
                          </div>
                        </div>
                      )}
                      <Button className="w-full text-xs h-6 bg-purple-600 hover:bg-purple-700 text-white"
                        onClick={() => handleCommand('RTL')} disabled={sendingCommand !== null}>
                        <RotateCcw className="w-3 h-3 mr-1" />{'\u8fd4\u822a'}
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Orbit - collapsible (Issue 4) */}
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="px-2 py-1.5 space-y-1">
                  <div className="flex items-center gap-1 text-[9px] text-slate-400 cursor-pointer" onClick={() => setOrbitExpanded(!orbitExpanded)}>
                    {orbitExpanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
                    <Circle className="w-2.5 h-2.5 text-indigo-400" />{'\u76d8\u65cb'}
                  </div>
                  {orbitExpanded && (
                    <>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1">
                          <label className="text-[9px] text-slate-500 w-8 shrink-0">{'\u7eac\u5ea6'}</label>
                          <Input type="number" step="0.0001" value={orbitLat} onChange={e => setOrbitLat(e.target.value)}
                            className="bg-slate-700 border-slate-600 text-white text-xs h-6 flex-1" placeholder={'\u5706\u5fc3\u7eac\u5ea6(\u5fc5\u586b)'} />
                        </div>
                        <div className="flex items-center gap-1">
                          <label className="text-[9px] text-slate-500 w-8 shrink-0">{'\u7ecf\u5ea6'}</label>
                          <Input type="number" step="0.0001" value={orbitLon} onChange={e => setOrbitLon(e.target.value)}
                            className="bg-slate-700 border-slate-600 text-white text-xs h-6 flex-1" placeholder={'\u5706\u5fc3\u7ecf\u5ea6(\u5fc5\u586b)'} />
                        </div>
                        <div className="flex items-center gap-1">
                          <label className="text-[9px] text-slate-500 w-8 shrink-0">{'\u534a\u5f84'}</label>
                          <Input type="number" min="2.5" max="20" step="0.5" value={orbitRadius} onChange={e => setOrbitRadius(e.target.value)}
                            className="bg-slate-700 border-slate-600 text-white text-xs h-6 flex-1" placeholder="5" />
                          <span className="text-[9px] text-slate-400">{'\u7c73(2.5-20)'}</span>
                        </div>
                      </div>
                      <Button className="w-full text-xs h-6 bg-indigo-600 hover:bg-indigo-700 text-white"
                        onClick={() => handleCommand('ORBIT')} disabled={sendingCommand !== null}>
                        <Circle className="w-3 h-3 mr-1" />{'\u76d8\u65cb'}
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>

            </div>
          )}
          </div>
        )}

        {/* Right: Map view */}
        <div className="flex-1 h-full">
          <MapPanel drones={mapDrones} selectedDroneId={selectedDrone}
            selectedDroneIds={multiSelectMode ? selectedDrones : undefined}
            homeMarker={homeMarker}
            hasDroneSelected={!!selectedDrone || selectedDrones.size > 0}
            onMapClick={(lat, lon) => setMapClickCoords({ lat, lon })}
            onMapCommand={handleMapCommand}
            rallyPoints={rallyPoints.map(rp => ({ id: rp.id, name: rp.name, latitude: rp.latitude, longitude: rp.longitude, capacity: rp.capacity, currentOccupancy: rp.currentOccupancy, status: rp.status, serviceType: rp.serviceType }))}
            onDroneClick={(id) => {
              if (multiSelectMode) {
                const newSet = new Set(selectedDrones);
                if (newSet.has(id)) { newSet.delete(id); } else { newSet.add(id); }
                setSelectedDrones(newSet);
                if (newSet.size === 1) {
                  setSelectedDrone(Array.from(newSet)[0]);
                  setShowDetailPanel(detailPanelEnabled);
                } else if (newSet.size === 0) {
                  setSelectedDrone(null);
                  setShowDetailPanel(false);
                } else {
                  setShowDetailPanel(false);
                }
              } else {
                if (selectedDrone === id) {
                  setShowDetailPanel(false);
                  setSelectedDrone(null);
                } else {
                  setSelectedDrone(id);
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
