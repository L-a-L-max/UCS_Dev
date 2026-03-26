import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { type ReactNode } from 'react';

interface GlassPanelProps {
  variant?: 'default' | 'neon' | 'subtle';
  glow?: 'cyan' | 'purple' | 'aqua' | 'none';
  animated?: boolean;
  className?: string;
  children?: ReactNode;
}

export const GlassPanel = ({ variant = 'default', glow = 'none', animated = true, className, children }: GlassPanelProps) => {
  const baseClass = cn(
    'relative overflow-hidden rounded-xl',
    'backdrop-blur-md border',
    {
      'bg-[rgba(13,21,38,0.6)] border-[rgba(0,240,255,0.15)]': variant === 'default',
      'bg-[rgba(13,21,38,0.7)] border-[rgba(0,240,255,0.3)]': variant === 'neon',
      'bg-[rgba(13,21,38,0.4)] border-[rgba(255,255,255,0.05)]': variant === 'subtle',
    },
    {
      'shadow-[0_0_20px_rgba(0,240,255,0.2)]': glow === 'cyan',
      'shadow-[0_0_20px_rgba(160,32,240,0.2)]': glow === 'purple',
      'shadow-[0_0_20px_rgba(127,255,212,0.15)]': glow === 'aqua',
    },
    className
  );

  const highlight = (
    <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[rgba(0,240,255,0.3)] to-transparent" />
  );

  if (!animated) {
    return (
      <div className={baseClass}>
        {highlight}
        {children}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={baseClass}
    >
      {highlight}
      {children}
    </motion.div>
  );
};

GlassPanel.displayName = 'GlassPanel';
export default GlassPanel;
