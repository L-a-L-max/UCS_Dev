/**
 * Holographic Drone Control Panel
 * Bottom center horizontal panel
 * Left: basic controls (takeoff, land, return)
 * Center: drone info / multi-drone aggregate
 * Right: advanced settings (mark home, hover, etc.)
 */
import {
  Plane,
  ArrowDown,
  RotateCcw,
  MapPin,
  Crosshair,
  Navigation,
  Battery,
  Wifi,
  WifiOff,
  AlertTriangle,
} from 'lucide-react';
import type { MapDrone } from '../MapPanel';

interface HoloDroneControlPanelProps {
  drones: MapDrone[];
  selectedDroneId?: string | null;
  selectedDroneIds?: Set<string>;
  onCommand?: (command: string, uavIds?: string[]) => void;
}

export function HoloDroneControlPanel({
  drones,
  selectedDroneId,
  selectedDroneIds,
  onCommand,
}: HoloDroneControlPanelProps) {
  // Get selected drones
  const selectedDrones = drones.filter(d => {
    if (selectedDroneIds && selectedDroneIds.size > 0) return selectedDroneIds.has(d.uavId);
    if (selectedDroneId) return d.uavId === selectedDroneId;
    return false;
  });

  const hasDrones = drones.length > 0;
  const hasSelection = selectedDrones.length > 0;
  const singleDrone = selectedDrones.length === 1 ? selectedDrones[0] : null;

  const handleCmd = (cmd: string) => {
    const ids = selectedDrones.map(d => d.uavId);
    onCommand?.(cmd, ids.length > 0 ? ids : undefined);
  };

  // Aggregate stats for multiple selection
  const avgBattery = hasSelection
    ? Math.round(selectedDrones.reduce((s, d) => s + (d.battery ?? 0), 0) / selectedDrones.length)
    : drones.length > 0
    ? Math.round(drones.reduce((s, d) => s + (d.battery ?? 0), 0) / drones.length)
    : 0;

  const onlineCount = (hasSelection ? selectedDrones : drones).filter(d => d.onlineStatus).length;
  const flyingCount = (hasSelection ? selectedDrones : drones).filter(d => d.armed).length;

  return (
    <div className="flex items-center gap-3 p-3">
      {/* Left: Basic Controls */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <ControlButton
          icon={<Plane className="w-3.5 h-3.5" />}
          label="起飞"
          color="#22c55e"
          onClick={() => handleCmd('takeoff')}
          disabled={!hasDrones}
        />
        <ControlButton
          icon={<ArrowDown className="w-3.5 h-3.5" />}
          label="降落"
          color="#f59e0b"
          onClick={() => handleCmd('land')}
          disabled={!hasDrones}
        />
        <ControlButton
          icon={<RotateCcw className="w-3.5 h-3.5" />}
          label="返航"
          color="#00e5ff"
          onClick={() => handleCmd('return')}
          disabled={!hasDrones}
        />
      </div>

      {/* Center: Drone info */}
      <div className="flex-1 min-w-0 px-3 border-x border-cyan-500/10">
        {singleDrone ? (
          <div className="flex items-center gap-4">
            <div>
              <div className="text-xs text-cyan-300 font-mono font-bold">{singleDrone.uavId}</div>
              <div className="text-[9px] text-slate-400">
                {singleDrone.armed ? '飞行中' : singleDrone.onlineStatus ? '在线' : '离线'}
              </div>
            </div>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1 text-slate-300">
                <Battery className="w-3 h-3" style={{ color: (singleDrone.battery ?? 100) < 20 ? '#ef4444' : '#22c55e' }} />
                {singleDrone.battery?.toFixed(0) ?? '--'}%
              </span>
              <span className="flex items-center gap-1 text-slate-300">
                <Navigation className="w-3 h-3 text-cyan-400" />
                {singleDrone.altitude?.toFixed(0) ?? '--'}m
              </span>
              <span className="flex items-center gap-1 text-slate-300">
                {singleDrone.onlineStatus
                  ? <Wifi className="w-3 h-3 text-green-400" />
                  : <WifiOff className="w-3 h-3 text-slate-500" />}
              </span>
            </div>
          </div>
        ) : hasSelection ? (
          <div className="text-center">
            <div className="text-xs text-cyan-300 font-mono">已选 {selectedDrones.length} 架</div>
            <div className="flex items-center justify-center gap-3 text-[10px] text-slate-400 mt-0.5">
              <span>飞行: {flyingCount}</span>
              <span>在线: {onlineCount}</span>
              <span>平均电量: {avgBattery}%</span>
            </div>
          </div>
        ) : (
          <div className="text-center">
            <div className="text-[10px] text-slate-500 font-mono">
              {hasDrones ? `${drones.length} 架无人机 | 在线 ${onlineCount} | 飞行 ${flyingCount}` : '暂无无人机数据'}
            </div>
            <div className="text-[9px] text-slate-600 mt-0.5">点击地图或列表选择无人机</div>
          </div>
        )}
      </div>

      {/* Right: Advanced Controls */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <ControlButton
          icon={<MapPin className="w-3.5 h-3.5" />}
          label="标记Home"
          color="#8b5cf6"
          onClick={() => handleCmd('markHome')}
          disabled={!hasDrones}
        />
        <ControlButton
          icon={<Crosshair className="w-3.5 h-3.5" />}
          label="盘旋"
          color="#f59e0b"
          onClick={() => handleCmd('hover')}
          disabled={!hasDrones}
        />
        <ControlButton
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
          label="紧急"
          color="#ef4444"
          onClick={() => handleCmd('emergency')}
          disabled={!hasDrones}
        />
      </div>
    </div>
  );
}

function ControlButton({ icon, label, color, onClick, disabled }: {
  icon: React.ReactNode;
  label: string;
  color: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg transition-all
        hover:scale-105 active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
      style={{
        background: `${color}10`,
        border: `1px solid ${color}30`,
      }}
      onClick={onClick}
      disabled={disabled}
      title={label}
    >
      <span style={{ color }}>{icon}</span>
      <span className="text-[8px] font-mono" style={{ color: `${color}cc` }}>{label}</span>
    </button>
  );
}

export default HoloDroneControlPanel;
