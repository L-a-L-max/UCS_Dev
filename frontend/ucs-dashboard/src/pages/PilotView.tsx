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
} from 'lucide-react';
import {
  sendControlCommand,
  getDroneStatus,
  getPilotDrones,
  type DroneInfo,
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
const COMMANDS = [
  { type: 'TAKEOFF', label: '\u8d77\u98de', icon: ArrowUp, color: 'bg-blue-600 hover:bg-blue-700', description: '\u89e3\u9501+\u8d77\u98de\u5230\u6307\u5b9a\u9ad8\u5ea6' },
  { type: 'LAND', label: '\u964d\u843d', icon: ArrowDown, color: 'bg-amber-600 hover:bg-amber-700', description: '\u505c\u6b62\u5fc3\u8df3+\u539f\u5730\u964d\u843d' },
  { type: 'RTL', label: '\u8fd4\u822a', icon: RotateCcw, color: 'bg-purple-600 hover:bg-purple-700', description: '\u8fd4\u56deHome\u70b9' },
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

  // RTL params
  const [rtlLat, setRtlLat] = useState('');
  const [rtlLon, setRtlLon] = useState('');

  // Home position display
  const [homePosition, setHomePosition] = useState<{ lat: number; lon: number; alt: number } | null>(null);

  // Home marker for map (flashing dot)
  const [homeMarker, setHomeMarker] = useState<{ lat: number; lng: number } | null>(null);

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

  const handleCommandAck = useCallback((ack: CommandAckMessage) => {
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

  useEffect(() => {
    fetchDrones();
    const interval = setInterval(fetchDrones, 5000);
    return () => clearInterval(interval);
  }, [fetchDrones]);

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
      const lat = parseFloat(rtlLat);
      const lon = parseFloat(rtlLon);
      if (lat && lon) {
        params = JSON.stringify({ lat, lon });
      }
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
                  {!drone.onlineStatus ? '\u79bb\u7ebf' : drone.armed === true ? '\u5df2\u89e3\u9501' : '\u672a\u89e3\u9501'}
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

        {/* Multi-select aggregate panel */}
        {multiSelectMode && aggregateData && detailPanelEnabled && (
          <div className="w-[260px] bg-slate-900 border-r border-slate-700 overflow-y-auto p-2 space-y-2 shrink-0">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader className="pb-1 px-2 pt-2">
                <CardTitle className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1"><ListChecks className="w-3 h-3 text-amber-400" />{'\u591a\u673a\u805a\u5408'}</div>
                  <Badge className="bg-amber-600 text-[10px]">{aggregateData.count} {'\u67b6'}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-2 pb-2">
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="bg-slate-700/50 rounded p-1.5 text-center">
                    <div className="text-[9px] text-slate-400">{'\u6700\u9ad8/\u6700\u4f4e\u9ad8\u5ea6'}</div>
                    <div className="text-xs font-bold text-blue-300">{aggregateData.maxAlt.toFixed(1)}m / {aggregateData.minAlt.toFixed(1)}m</div>
                  </div>
                  <div className="bg-slate-700/50 rounded p-1.5 text-center">
                    <div className="text-[9px] text-slate-400">{'\u5728\u7ebf/\u98de\u884c\u4e2d'}</div>
                    <div className="text-xs font-bold text-green-300">{aggregateData.onlineCount} / {aggregateData.flyingCount}</div>
                  </div>
                </div>
                {/* Batch control */}
                <div className="mt-2">
                  <div className="text-[9px] text-slate-400 mb-1">{'\u6279\u91cf\u63a7\u5236'}</div>
                  <div className="grid grid-cols-3 gap-1">
                    {COMMANDS.map(cmd => {
                      const Icon = cmd.icon;
                      return (
                        <Button key={cmd.type}
                          className={`h-auto py-1 flex flex-col items-center gap-0.5 ${cmd.color} text-white text-[9px]`}
                          onClick={() => { multiSelectedDronesList.forEach(d => handleCommand(cmd.type, d.uavId)); }}>
                          <Icon className="w-3 h-3" />
                          <span className="font-bold text-[8px]">{cmd.label}</span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
                {/* Selected drones list */}
                <div className="mt-2">
                  <div className="text-[9px] text-slate-400 mb-1">{'\u5df2\u9009'} ({multiSelectedDronesList.length})</div>
                  <div className="space-y-0.5 max-h-24 overflow-y-auto">
                    {multiSelectedDronesList.map(d => (
                      <div key={d.uavId} className="flex items-center justify-between text-[9px] bg-slate-700/50 rounded px-1.5 py-0.5">
                        <span className="text-blue-300">{d.uavId}</span>
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
                    onClick={() => handleCommand('GOTO')} disabled={sendingCommand !== null}>
                    <Navigation className="w-3 h-3 mr-1" />{'\u524d\u5f80'}
                  </Button>
                </CardContent>
              </Card>

              {/* RTL with optional custom location */}
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="px-2 py-1.5 space-y-1">
                  <div className="flex items-center gap-1 text-[9px] text-slate-400"><RotateCcw className="w-2.5 h-2.5 text-purple-400" />{'\u8fd4\u822a\u8bbe\u7f6e'}</div>
                  {homePosition && (
                    <div className="flex items-center gap-1 text-[9px]">
                      <Home className="w-2.5 h-2.5 text-teal-400" />
                      <span className="text-teal-300">Home: {homePosition.lat.toFixed(6)}, {homePosition.lon.toFixed(6)}</span>
                      <Button size="sm" variant="outline" onClick={locateHome}
                        className="h-4 px-1 text-[8px] bg-teal-700/50 border-teal-600 text-teal-300 ml-auto">
                        <Locate className="w-2 h-2 mr-0.5" />{'\u5b9a\u4f4d'}
                      </Button>
                    </div>
                  )}
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
                    onClick={() => handleCommand('RTL')} disabled={sendingCommand !== null}>
                    <RotateCcw className="w-3 h-3 mr-1" />{'\u8fd4\u822a'}
                  </Button>
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
