import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { type ReactNode, type MouseEventHandler } from 'react';

interface NeonButtonProps {
  variant?: 'cyan' | 'purple' | 'aqua' | 'amber' | 'red' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  glow?: boolean;
  className?: string;
  children?: ReactNode;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  type?: 'button' | 'submit' | 'reset';
}

const variantStyles: Record<string, string> = {
  cyan: 'bg-[rgba(0,240,255,0.1)] border-[rgba(0,240,255,0.3)] text-neon-cyan hover:bg-[rgba(0,240,255,0.2)] hover:shadow-[0_0_15px_rgba(0,240,255,0.3)]',
  purple: 'bg-[rgba(160,32,240,0.1)] border-[rgba(160,32,240,0.3)] text-neon-purple hover:bg-[rgba(160,32,240,0.2)] hover:shadow-[0_0_15px_rgba(160,32,240,0.3)]',
  aqua: 'bg-[rgba(127,255,212,0.1)] border-[rgba(127,255,212,0.3)] text-neon-aqua hover:bg-[rgba(127,255,212,0.2)] hover:shadow-[0_0_15px_rgba(127,255,212,0.3)]',
  amber: 'bg-[rgba(255,184,0,0.1)] border-[rgba(255,184,0,0.3)] text-neon-amber hover:bg-[rgba(255,184,0,0.2)] hover:shadow-[0_0_15px_rgba(255,184,0,0.3)]',
  red: 'bg-[rgba(255,59,92,0.1)] border-[rgba(255,59,92,0.3)] text-neon-red hover:bg-[rgba(255,59,92,0.2)] hover:shadow-[0_0_15px_rgba(255,59,92,0.3)]',
  ghost: 'bg-transparent border-[rgba(255,255,255,0.1)] text-slate-300 hover:bg-[rgba(255,255,255,0.05)] hover:border-[rgba(255,255,255,0.2)]',
};

const sizeStyles: Record<string, string> = {
  sm: 'h-7 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-11 px-6 text-base gap-2.5',
};

export const NeonButton = ({ variant = 'cyan', size = 'md', glow = false, className, children, disabled, onClick, type = 'button' }: NeonButtonProps) => {
  return (
    <motion.button
      whileHover={disabled ? undefined : { scale: 1.02 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      className={cn(
        'inline-flex items-center justify-center rounded-lg border font-medium',
        'transition-all duration-200 ease-out',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none',
        variantStyles[variant],
        sizeStyles[size],
        glow && variant === 'cyan' && 'animate-glow-breathe',
        className
      )}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </motion.button>
  );
};

NeonButton.displayName = 'NeonButton';
export default NeonButton;
