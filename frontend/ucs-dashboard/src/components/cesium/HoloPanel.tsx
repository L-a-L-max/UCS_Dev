/**
 * Holographic Panel - Sci-fi glass panel with perspective tilt and glow effects
 * 
 * Core UI building block for the holographic drone control interface.
 * Features CSS 3D transforms, backdrop blur, flowing edge lights.
 */
import { type ReactNode, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface HoloPanelProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
  /** Tilt direction for perspective effect */
  tilt?: 'left' | 'right' | 'none';
  /** Glow accent color */
  glow?: 'cyan' | 'amber' | 'magenta' | 'none';
  /** Whether to animate entrance */
  animated?: boolean;
  /** Delay for staggered entrance */
  delay?: number;
  /** Whether panel is collapsible */
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}

export function HoloPanel({
  children,
  className,
  style,
  title,
  tilt = 'none',
  glow = 'cyan',
  animated = true,
  delay = 0,
  collapsible = false,
  collapsed = false,
  onToggle,
}: HoloPanelProps) {
  const tiltTransform = {
    left: 'perspective(800px) rotateX(2deg) rotateY(1deg)',
    right: 'perspective(800px) rotateX(2deg) rotateY(-1deg)',
    none: 'perspective(800px) rotateX(0deg)',
  };

  const glowShadow = {
    cyan: '0 0 20px rgba(0, 255, 255, 0.2), inset 0 1px 0 rgba(255,255,255,0.1)',
    amber: '0 0 20px rgba(255, 170, 68, 0.2), inset 0 1px 0 rgba(255,255,255,0.1)',
    magenta: '0 0 20px rgba(255, 68, 170, 0.15), inset 0 1px 0 rgba(255,255,255,0.1)',
    none: 'inset 0 1px 0 rgba(255,255,255,0.05)',
  };

  const glowBorder = {
    cyan: 'rgba(0, 255, 255, 0.4)',
    amber: 'rgba(255, 170, 68, 0.4)',
    magenta: 'rgba(255, 68, 170, 0.3)',
    none: 'rgba(255, 255, 255, 0.1)',
  };

  const baseStyle: CSSProperties = {
    background: 'rgba(10, 20, 40, 0.65)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: `1px solid ${glowBorder[glow]}`,
    borderRadius: '16px',
    boxShadow: glowShadow[glow],
    transform: tiltTransform[tilt],
    transition: 'all 0.3s ease',
    ...style,
  };

  const content = (
    <div
      className={cn(
        'relative overflow-hidden holo-panel',
        className
      )}
      style={baseStyle}
    >
      {/* Top edge glow line */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{
          background: `linear-gradient(to right, transparent, ${glowBorder[glow]}, transparent)`,
        }}
      />
      {/* Bottom edge glow line */}
      <div
        className="absolute bottom-0 left-0 right-0 h-px"
        style={{
          background: `linear-gradient(to right, transparent, ${glowBorder[glow]}40, transparent)`,
        }}
      />

      {/* Title bar */}
      {title && (
        <div
          className="flex items-center justify-between px-4 py-2 border-b"
          style={{ borderColor: `${glowBorder[glow]}40` }}
        >
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ backgroundColor: glowBorder[glow] }}
            />
            <span
              className="text-xs font-bold tracking-widest uppercase"
              style={{ color: glowBorder[glow] }}
            >
              {title}
            </span>
          </div>
          {collapsible && (
            <button
              onClick={onToggle}
              className="text-xs opacity-60 hover:opacity-100 transition-opacity"
              style={{ color: glowBorder[glow] }}
            >
              {collapsed ? '[ + ]' : '[ - ]'}
            </button>
          )}
        </div>
      )}

      {/* Content */}
      {!collapsed && (
        <div className="relative">{children}</div>
      )}
    </div>
  );

  if (!animated) return content;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.5,
        delay,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
    >
      {content}
    </motion.div>
  );
}

export default HoloPanel;
