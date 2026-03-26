import { memo } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { BatteryGauge } from '@/components/charts/BatteryGauge';
import { Locate, Navigation2 } from 'lucide-react';

export interface DroneListItemData {
  uavId: string;
  lat: number;
  lng: number;
  altitude: number;
  battery?: number;
  flightStatus: string;
  onlineStatus: boolean;
  armed?: boolean;
  heading?: number;
}

interface DroneListItemProps {
  drone: DroneListItemData;
  isSelected?: boolean;
  isTracking?: boolean;
  multiSelectMode?: boolean;
  isChecked?: boolean;
  onSelect?: (uavId: string) => void;
  onLocate?: (uavId: string) => void;
  onFollow?: (uavId: string) => void;
  onToggleCheck?: (uavId: string) => void;
}

export const DroneListItem = memo(function DroneListItem({
  drone,
  isSelected = false,
  isTracking = false,
  multiSelectMode = false,
  isChecked = false,
  onSelect,
  onLocate,
  onFollow,
  onToggleCheck,
}: DroneListItemProps) {
  const isFlying = drone.flightStatus === 'FLYING';
  const isOnline = drone.onlineStatus;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className={cn(
        'group relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer',
        'border transition-all duration-200',
        isSelected
          ? 'bg-[rgba(0,240,255,0.1)] border-[rgba(0,240,255,0.3)]'
          : 'bg-[rgba(13,21,38,0.4)] border-transparent hover:bg-[rgba(13,21,38,0.6)] hover:border-[rgba(0,240,255,0.1)]',
        isTracking && 'ring-1 ring-neon-amber/40',
        !isOnline && 'opacity-50'
      )}
      onClick={() => {
        if (multiSelectMode) {
          onToggleCheck?.(drone.uavId);
        } else {
          onSelect?.(drone.uavId);
        }
      }}
    >
      {/* Multi-select checkbox */}
      {multiSelectMode && (
        <div
          className={cn(
            'w-4 h-4 rounded border flex items-center justify-center shrink-0',
            isChecked
              ? 'bg-neon-cyan/20 border-neon-cyan'
              : 'border-slate-500 hover:border-slate-400'
          )}
        >
          {isChecked && (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 5L4 7L8 3" stroke="#00F0FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      )}

      {/* Status dot */}
      <span className="relative flex shrink-0">
        {isFlying && (
          <span className="absolute inset-0 rounded-full animate-ping opacity-30 bg-neon-cyan" style={{ width: 8, height: 8 }} />
        )}
        <span
          className={cn('w-2 h-2 rounded-full', {
            'bg-neon-cyan shadow-[0_0_4px_rgba(0,240,255,0.5)]': isFlying && isOnline,
            'bg-slate-400': !isFlying && isOnline,
            'bg-slate-600': !isOnline,
          })}
        />
      </span>

      {/* Drone ID */}
      <span className={cn('text-xs font-medium truncate min-w-0 flex-1', isFlying ? 'text-neon-cyan' : 'text-slate-300')}>
        {drone.uavId}
      </span>

      {/* Altitude */}
      <span className="text-[10px] text-slate-400 tabular-nums shrink-0">
        ↑{drone.altitude?.toFixed(0) || 0}m
      </span>

      {/* Battery */}
      {drone.battery != null && drone.battery >= 0 && (
        <BatteryGauge percent={drone.battery} size="sm" showLabel={true} />
      )}

      {/* Quick actions (visible on hover) */}
      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
        <button
          className="p-0.5 rounded hover:bg-white/10 text-slate-400 hover:text-neon-cyan transition-colors"
          title="定位"
          onClick={(e) => {
            e.stopPropagation();
            onLocate?.(drone.uavId);
          }}
        >
          <Locate className="w-3 h-3" />
        </button>
        <button
          className={cn(
            'p-0.5 rounded hover:bg-white/10 transition-colors',
            isTracking ? 'text-neon-amber' : 'text-slate-400 hover:text-neon-amber'
          )}
          title="追随"
          onClick={(e) => {
            e.stopPropagation();
            onFollow?.(drone.uavId);
          }}
        >
          <Navigation2 className="w-3 h-3" />
        </button>
      </div>
    </motion.div>
  );
});

export default DroneListItem;
