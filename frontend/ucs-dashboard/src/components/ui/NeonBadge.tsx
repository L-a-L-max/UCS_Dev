import { cn } from '@/lib/utils';

interface NeonBadgeProps {
  variant?: 'cyan' | 'purple' | 'aqua' | 'amber' | 'red' | 'green';
  pulse?: boolean;
  className?: string;
  children: React.ReactNode;
}

const badgeStyles: Record<string, string> = {
  cyan: 'bg-[rgba(0,240,255,0.1)] border-[rgba(0,240,255,0.3)] text-[#00F0FF]',
  purple: 'bg-[rgba(160,32,240,0.1)] border-[rgba(160,32,240,0.3)] text-[#A020F0]',
  aqua: 'bg-[rgba(127,255,212,0.1)] border-[rgba(127,255,212,0.3)] text-[#7FFFD4]',
  amber: 'bg-[rgba(255,184,0,0.1)] border-[rgba(255,184,0,0.3)] text-[#FFB800]',
  red: 'bg-[rgba(255,59,92,0.1)] border-[rgba(255,59,92,0.3)] text-[#FF3B5C]',
  green: 'bg-[rgba(0,255,136,0.1)] border-[rgba(0,255,136,0.3)] text-[#00FF88]',
};

export function NeonBadge({ variant = 'cyan', pulse = false, className, children }: NeonBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border',
        badgeStyles[variant],
        pulse && 'animate-neon-pulse',
        className
      )}
    >
      {children}
    </span>
  );
}

export default NeonBadge;
