import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

type ConnectionState = 'connected' | 'reconnecting' | 'failed';

interface ConnectionStatusProps {
  state: ConnectionState;
  className?: string;
}

const stateConfig: Record<ConnectionState, { color: string; label: string }> = {
  connected: { color: 'bg-[#00F0FF]', label: '实时连接' },
  reconnecting: { color: 'bg-[#FFB800]', label: '重连中...' },
  failed: { color: 'bg-[#FF3B5C]', label: '连接断开' },
};

export function ConnectionStatus({ state, className }: ConnectionStatusProps) {
  const config = stateConfig[state];

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <motion.div
        className={cn('w-2 h-2 rounded-full', config.color)}
        animate={state !== 'connected' ? { opacity: [1, 0.3, 1] } : {}}
        transition={{ duration: 1, repeat: Infinity }}
      />
      <span className="text-xs text-[#94A3B8]">{config.label}</span>
    </div>
  );
}

export default ConnectionStatus;
