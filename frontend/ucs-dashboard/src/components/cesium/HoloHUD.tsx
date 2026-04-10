/**
 * Holographic HUD Overlay - Phase 4 (blue theme)
 * Minimal decorative elements matching the prototype style
 */
import { motion } from 'framer-motion';

interface HoloHUDProps {
  className?: string;
}

export function HoloHUD({ className = '' }: HoloHUDProps) {
  return (
    <div className={`pointer-events-none absolute inset-0 z-[5] overflow-hidden ${className}`}>
      {/* Vignette - corner darkening */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 50%, rgba(5, 10, 30, 0.5) 100%)',
        }}
      />

      {/* Scanline overlay - subtle */}
      <div
        className="absolute inset-0 opacity-[0.015]"
        style={{
          background: `repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            rgba(82, 168, 255, 1) 2px,
            rgba(82, 168, 255, 1) 4px
          )`,
        }}
      />

      {/* Corner decorations */}
      <CornerRing position="top-left" />
      <CornerRing position="top-right" />
      <CornerRing position="bottom-left" />
      <CornerRing position="bottom-right" />

      {/* Edge glow lines */}
      <div
        className="absolute top-0 left-[10%] right-[10%] h-px"
        style={{
          background: 'linear-gradient(to right, transparent, rgba(82, 168, 255, 0.12), transparent)',
        }}
      />
      <div
        className="absolute bottom-0 left-[10%] right-[10%] h-px"
        style={{
          background: 'linear-gradient(to right, transparent, rgba(82, 168, 255, 0.08), transparent)',
        }}
      />
    </div>
  );
}

function CornerRing({ position }: { position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' }) {
  const posMap = {
    'top-left': '-top-4 -left-4',
    'top-right': '-top-4 -right-4',
    'bottom-left': '-bottom-4 -left-4',
    'bottom-right': '-bottom-4 -right-4',
  };

  return (
    <motion.div
      className={`absolute ${posMap[position]} w-16 h-16`}
      animate={{ rotate: 360 }}
      transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
    >
      <svg width="64" height="64" viewBox="0 0 64 64" className="opacity-[0.06]">
        <circle cx="32" cy="32" r="28" fill="none" stroke="#52a8ff" strokeWidth="0.5" strokeDasharray="4 8" />
        <circle cx="32" cy="32" r="20" fill="none" stroke="#52a8ff" strokeWidth="0.3" strokeDasharray="2 6" />
        <circle cx="32" cy="4" r="1.5" fill="#52a8ff" opacity="0.6" />
        <circle cx="60" cy="32" r="1" fill="#52a8ff" opacity="0.4" />
      </svg>
    </motion.div>
  );
}

export default HoloHUD;
