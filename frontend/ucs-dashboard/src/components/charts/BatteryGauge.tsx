import { cn } from '@/lib/utils';

interface BatteryGaugeProps {
  percent: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

export function BatteryGauge({ percent, size = 'md', showLabel = true, className }: BatteryGaugeProps) {
  const clampedPercent = Math.max(0, Math.min(100, percent));
  const isLow = clampedPercent < 20;
  const isMedium = clampedPercent >= 20 && clampedPercent < 50;

  const color = isLow ? '#FF3B5C' : isMedium ? '#FFB800' : '#00FF88';
  const glowColor = isLow
    ? 'rgba(255, 59, 92, 0.4)'
    : isMedium
    ? 'rgba(255, 184, 0, 0.3)'
    : 'rgba(0, 255, 136, 0.3)';

  const sizeStyles = {
    sm: { width: 'w-12', height: 'h-2', text: 'text-[10px]' },
    md: { width: 'w-20', height: 'h-2.5', text: 'text-xs' },
    lg: { width: 'w-28', height: 'h-3', text: 'text-sm' },
  };

  const s = sizeStyles[size];

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <div
        className={cn('relative rounded-full overflow-hidden bg-slate-700/50', s.width, s.height)}
      >
        <div
          className={cn('h-full rounded-full transition-all duration-500', isLow && 'animate-pulse')}
          style={{
            width: `${clampedPercent}%`,
            backgroundColor: color,
            boxShadow: `0 0 6px ${glowColor}`,
          }}
        />
      </div>
      {showLabel && (
        <span className={cn(s.text, 'font-medium tabular-nums')} style={{ color }}>
          {clampedPercent.toFixed(0)}%
        </span>
      )}
    </div>
  );
}

export default BatteryGauge;
