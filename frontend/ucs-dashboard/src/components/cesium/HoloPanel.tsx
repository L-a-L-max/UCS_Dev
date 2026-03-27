/**
 * Holographic Panel - Matches HTML prototype panel style
 * 
 * Design: rgba(10, 20, 50, 0.9) background, blue border, 6px radius
 * Title bar with blue title-line indicator (#52a8ff)
 */
import { type ReactNode, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface HoloPanelProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
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
  animated = true,
  delay = 0,
  collapsible = false,
  collapsed = false,
  onToggle,
}: HoloPanelProps) {
  const baseStyle: CSSProperties = {
    background: 'rgba(10, 20, 50, 0.9)',
    border: '1px solid rgba(60, 120, 220, 0.3)',
    borderRadius: '6px',
    padding: '10px 12px',
    boxShadow: '0 0 12px rgba(60, 120, 220, 0.15)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    transition: 'all 0.2s',
    ...style,
  };

  const content = (
    <div
      className={cn('relative overflow-hidden', className)}
      style={baseStyle}
    >
      {/* Title bar */}
      {title && (
        <div
          style={{
            fontSize: '14px',
            color: '#a0cfff',
            marginBottom: collapsed ? 0 : '8px',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <div
            style={{
              width: '3px',
              height: '14px',
              background: '#52a8ff',
              borderRadius: '1px',
              flexShrink: 0,
            }}
          />
          <span style={{ flex: 1 }}>{title}</span>
          {collapsible && onToggle && (
            <button
              onClick={onToggle}
              style={{
                fontSize: '11px',
                color: '#a0cfff',
                opacity: 0.7,
                cursor: 'pointer',
                background: 'none',
                border: 'none',
                padding: '0 2px',
              }}
            >
              {collapsed ? '[ + ]' : '[ - ]'}
            </button>
          )}
        </div>
      )}

      {/* Content */}
      {!collapsed && children}
    </div>
  );

  if (!animated) return content;

  return (
    <motion.div
      initial={{ opacity: 0, y: 15, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.4,
        delay,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
    >
      {content}
    </motion.div>
  );
}

export default HoloPanel;
