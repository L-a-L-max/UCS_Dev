/**
 * Holographic Fleet Management Panel
 * 
 * Left-side floating island showing drone fleet status.
 * Each drone displayed as a glowing sphere with battery ring and signal indicator.
 */
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { MapDrone } from '../MapPanel';
import { HoloEnergyGauge } from './HoloEnergyGauge';

interface HoloFleetPanelProps {
  drones: MapDrone[];
  selectedDroneId?: string | null;
  onDroneClick?: (uavId: string) => void;
  className?: string;
}

function DroneCard({
  drone,
  isSelected,
  onClick,
  index,
}: {
  drone: MapDrone;
  isSelected: boolean;
  onClick: () => void;
  index: number;
}) {
  const isOnline = drone.onlineStatus !== false;
  const isArmed = drone.armed === true;
  const statusColor = !isOnline ? '#64748b' : isArmed ? '#22c55e' : '#3b82f6';
  const statusText = !isOnline ? '离线' : isArmed ? '已解锁' : '未解锁';

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className={cn(
        'flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-all duration-200',
        'hover:bg-cyan-500/10',
        isSelected && 'bg-cyan-500/15 ring-1 ring-cyan-500/40'
      )}
      onClick={onClick}
    >
      {/* Battery gauge */}
      <HoloEnergyGauge
        value={drone.battery ?? 0}
        size={40}
        thickness={3}
      />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-white truncate">
            {drone.uavId}
          </span>
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{
              backgroundColor: statusColor,
              boxShadow: isOnline ? `0 0 6px ${statusColor}` : 'none',
            }}
          />
        </div>
        <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
          <span style={{ color: statusColor }}>{statusText}</span>
          <span className="text-slate-600">|</span>
          <span>{drone.altitude != null ? `${drone.altitude.toFixed(1)}m` : '--'}</span>
        </div>
      </div>

      {/* Hex data stream on hover */}
      {isSelected && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-[8px] text-cyan-500/40 font-mono leading-tight"
        >
          {`${drone.lat?.toFixed(4) ?? '0'}`}
          <br />
          {`${drone.lng?.toFixed(4) ?? '0'}`}
        </motion.div>
      )}
    </motion.div>
  );
}

export function HoloFleetPanel({
  drones,
  selectedDroneId,
  onDroneClick,
  className = '',
}: HoloFleetPanelProps) {
  const onlineCount = drones.filter(d => d.onlineStatus !== false).length;
  const armedCount = drones.filter(d => d.armed === true).length;

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Fleet summary */}
      <div className="flex items-center gap-4 px-3 py-2 text-[10px] uppercase tracking-wider">
        <span className="text-cyan-400">
          总计: <span className="text-white font-bold">{drones.length}</span>
        </span>
        <span className="text-green-400">
          在线: <span className="text-white font-bold">{onlineCount}</span>
        </span>
        <span className="text-amber-400">
          解锁: <span className="text-white font-bold">{armedCount}</span>
        </span>
      </div>

      {/* Drone list */}
      <div className="flex-1 overflow-y-auto px-1 max-h-[300px] scrollbar-thin scrollbar-thumb-cyan-500/20">
        {drones.length === 0 ? (
          <div className="text-center text-slate-500 py-6 text-xs">
            暂无无人机数据
          </div>
        ) : (
          drones.map((drone, i) => (
            <DroneCard
              key={drone.uavId}
              drone={drone}
              isSelected={drone.uavId === selectedDroneId}
              onClick={() => onDroneClick?.(drone.uavId)}
              index={i}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default HoloFleetPanel;
