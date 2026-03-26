import { cn } from '@/lib/utils';

type StatusType = 'online' | 'offline' | 'warning' | 'flying' | 'idle' | 'error';

interface StatusIndicatorProps {
  status: StatusType;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
}

const statusColors: Record<StatusType, string> = {
  online: 'bg-neon-green shadow-[0_0_6px_rgba(0,255,136,0.5)]',
  offline: 'bg-slate-500',
  warning: 'bg-neon-amber shadow-[0_0_6px_rgba(255,184,0,0.5)]',
  flying: 'bg-neon-cyan shadow-[0_0_6px_rgba(0,240,255,0.5)]',
  idle: 'bg-slate-400',
  error: 'bg-neon-red shadow-[0_0_6px_rgba(255,59,92,0.5)]',
};

const statusLabels: Record<StatusType, string> = {
  online: '在线',
  offline: '离线',
  warning: '警告',
  flying: '飞行中',
  idle: '待机',
  error: '异常',
};

const sizeMap = {
  sm: 'w-1.5 h-1.5',
  md: 'w-2 h-2',
  lg: 'w-2.5 h-2.5',
};

export function StatusIndicator({ status, size = 'md', label, className }: StatusIndicatorProps) {
  const shouldPulse = status === 'online' || status === 'flying' || status === 'warning';

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <span className="relative flex">
        {shouldPulse && (
          <span
            className={cn(
              'absolute inset-0 rounded-full animate-ping opacity-40',
              statusColors[status]
            )}
          />
        )}
        <span className={cn('rounded-full', sizeMap[size], statusColors[status])} />
      </span>
      {label !== undefined ? (
        <span className="text-xs text-slate-400">{label}</span>
      ) : (
        <span className="text-xs text-slate-400">{statusLabels[status]}</span>
      )}
    </div>
  );
}

export default StatusIndicator;
