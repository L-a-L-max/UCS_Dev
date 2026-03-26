/**
 * Holographic Drone Statistics Panel
 * Top-left floating panel showing drone count statistics
 */
import { useMemo } from 'react';
import { Plane, Wifi, WifiOff, BatteryWarning } from 'lucide-react';
import type { MapDrone } from '../MapPanel';

interface HoloDroneStatsPanelProps {
  drones: MapDrone[];
}

export function HoloDroneStatsPanel({ drones }: HoloDroneStatsPanelProps) {
  const stats = useMemo(() => {
    const total = drones.length;
    const flying = drones.filter(d => d.onlineStatus === true && d.armed === true).length;
    const online = drones.filter(d => d.onlineStatus === true).length;
    const lowBattery = drones.filter(d => (d.battery ?? 100) < 20).length;
    return { total, flying, online, lowBattery };
  }, [drones]);

  return (
    <div className="p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <StatItem
          icon={<Plane className="w-4 h-4" />}
          label="总数"
          value={stats.total}
          color="#00e5ff"
        />
        <StatItem
          icon={<Plane className="w-4 h-4" />}
          label="飞行中"
          value={stats.flying}
          color="#22c55e"
        />
        <StatItem
          icon={<Wifi className="w-4 h-4" />}
          label="在线"
          value={stats.online}
          color="#3b82f6"
        />
        <StatItem
          icon={<BatteryWarning className="w-4 h-4" />}
          label="低电量"
          value={stats.lowBattery}
          color={stats.lowBattery > 0 ? '#ef4444' : '#64748b'}
        />
      </div>
      {/* Mini bar visualization */}
      <div className="flex items-center gap-1 h-2">
        {stats.total > 0 && (
          <>
            <div
              className="h-full rounded-sm transition-all"
              style={{
                width: `${(stats.flying / stats.total) * 100}%`,
                background: 'linear-gradient(90deg, #22c55e, #4ade80)',
                minWidth: stats.flying > 0 ? 4 : 0,
              }}
            />
            <div
              className="h-full rounded-sm transition-all"
              style={{
                width: `${((stats.online - stats.flying) / stats.total) * 100}%`,
                background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                minWidth: stats.online - stats.flying > 0 ? 4 : 0,
              }}
            />
            <div
              className="h-full rounded-sm transition-all"
              style={{
                width: `${((stats.total - stats.online) / stats.total) * 100}%`,
                background: 'linear-gradient(90deg, #475569, #64748b)',
                minWidth: stats.total - stats.online > 0 ? 4 : 0,
              }}
            />
          </>
        )}
        {stats.total === 0 && (
          <div className="h-full w-full rounded-sm bg-slate-700/50" />
        )}
      </div>
    </div>
  );
}

function StatItem({ icon, label, value, color }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div style={{ color }} className="opacity-80">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-slate-400">{label}</div>
        <div className="text-lg font-bold leading-tight" style={{ color }}>{value}</div>
      </div>
    </div>
  );
}

export default HoloDroneStatsPanel;
