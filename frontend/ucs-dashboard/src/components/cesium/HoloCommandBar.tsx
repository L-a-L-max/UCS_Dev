/**
 * Holographic Arc Command Bar
 * 
 * Bottom arc-shaped command bar with core action buttons.
 * Features energy ripple effects on click and glowing borders.
 */
import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface CommandButton {
  id: string;
  label: string;
  icon: ReactNode;
  color?: 'cyan' | 'amber' | 'magenta' | 'green';
  disabled?: boolean;
  onClick?: () => void;
}

interface HoloCommandBarProps {
  buttons: CommandButton[];
  className?: string;
}

const colorMap = {
  cyan: {
    bg: 'rgba(0, 255, 255, 0.1)',
    border: 'rgba(0, 255, 255, 0.4)',
    text: '#00ffff',
    glow: 'rgba(0, 255, 255, 0.3)',
    ripple: 'rgba(0, 255, 255, 0.4)',
  },
  amber: {
    bg: 'rgba(255, 170, 68, 0.1)',
    border: 'rgba(255, 170, 68, 0.4)',
    text: '#ffaa44',
    glow: 'rgba(255, 170, 68, 0.3)',
    ripple: 'rgba(255, 170, 68, 0.4)',
  },
  magenta: {
    bg: 'rgba(255, 68, 170, 0.1)',
    border: 'rgba(255, 68, 170, 0.3)',
    text: '#ff44aa',
    glow: 'rgba(255, 68, 170, 0.2)',
    ripple: 'rgba(255, 68, 170, 0.4)',
  },
  green: {
    bg: 'rgba(34, 197, 94, 0.1)',
    border: 'rgba(34, 197, 94, 0.4)',
    text: '#22c55e',
    glow: 'rgba(34, 197, 94, 0.3)',
    ripple: 'rgba(34, 197, 94, 0.4)',
  },
};

function CommandBtn({ button }: { button: CommandButton }) {
  const [ripple, setRipple] = useState(false);
  const colors = colorMap[button.color || 'cyan'];

  const handleClick = () => {
    if (button.disabled) return;
    setRipple(true);
    setTimeout(() => setRipple(false), 600);
    button.onClick?.();
  };

  return (
    <motion.button
      whileHover={{ scale: 1.05, y: -2 }}
      whileTap={{ scale: 0.95 }}
      className={cn(
        'relative flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl',
        'transition-all duration-200 min-w-[72px]',
        button.disabled && 'opacity-40 cursor-not-allowed'
      )}
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        boxShadow: `0 0 12px ${colors.glow}`,
      }}
      onClick={handleClick}
      disabled={button.disabled}
    >
      <span style={{ color: colors.text }} className="text-lg">
        {button.icon}
      </span>
      <span
        style={{ color: colors.text }}
        className="text-[10px] font-bold tracking-wider uppercase whitespace-nowrap"
      >
        {button.label}
      </span>

      {/* Energy ripple effect */}
      <AnimatePresence>
        {ripple && (
          <motion.div
            initial={{ scale: 0.5, opacity: 0.6 }}
            animate={{ scale: 2.5, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="absolute inset-0 rounded-xl pointer-events-none"
            style={{
              border: `2px solid ${colors.ripple}`,
            }}
          />
        )}
      </AnimatePresence>
    </motion.button>
  );
}

export function HoloCommandBar({ buttons, className = '' }: HoloCommandBarProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.8 }}
      className={cn(
        'flex items-center justify-center gap-3 px-6 py-3',
        'rounded-t-2xl',
        className
      )}
      style={{
        background: 'rgba(10, 20, 40, 0.7)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderTop: '1px solid rgba(0, 255, 255, 0.3)',
        borderLeft: '1px solid rgba(0, 255, 255, 0.15)',
        borderRight: '1px solid rgba(0, 255, 255, 0.15)',
        boxShadow: '0 -4px 30px rgba(0, 255, 255, 0.1)',
      }}
    >
      {/* Left decorative bracket */}
      <div className="hidden sm:block text-cyan-500/30 text-xs font-mono mr-2">
        {'['}
      </div>

      {buttons.map((btn) => (
        <CommandBtn key={btn.id} button={btn} />
      ))}

      {/* Right decorative bracket */}
      <div className="hidden sm:block text-cyan-500/30 text-xs font-mono ml-2">
        {']'}
      </div>
    </motion.div>
  );
}

export default HoloCommandBar;
