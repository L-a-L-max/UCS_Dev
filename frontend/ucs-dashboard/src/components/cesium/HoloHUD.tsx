/**
 * Holographic HUD Overlay
 * 
 * Full-screen decorative elements:
 * - Corner rotating rings/gears
 * - Vignette (corner darkening)
 * - Scanline overlay
 * - Crosshair at center
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
          background: 'radial-gradient(ellipse at center, transparent 50%, rgba(10, 15, 26, 0.6) 100%)',
        }}
      />

      {/* Scanline overlay */}
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          background: `repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            rgba(0, 255, 255, 1) 2px,
            rgba(0, 255, 255, 1) 4px
          )`,
        }}
      />

      {/* Corner decorations - rotating rings */}
      <CornerRing position="top-left" />
      <CornerRing position="top-right" />
      <CornerRing position="bottom-left" />
      <CornerRing position="bottom-right" />

      {/* Top-left tech text */}
      <div className="absolute top-3 left-3 text-[9px] font-mono text-cyan-500/30 leading-tight">
        <div>UCS :: HOLO-CTRL</div>
        <div>SYS.STATUS: ACTIVE</div>
      </div>

      {/* Top-right tech text */}
      <div className="absolute top-3 right-3 text-[9px] font-mono text-cyan-500/30 leading-tight text-right">
        <div>CESIUM.GL :: v3.0</div>
        <div>RENDER: WebGL2</div>
      </div>

      {/* Bottom-left coordinates */}
      <div className="absolute bottom-3 left-3 text-[9px] font-mono text-cyan-500/20">
        GRID.REF: 39.909°N 116.397°E
      </div>

      {/* Center crosshair */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <svg width="24" height="24" viewBox="0 0 24 24" className="opacity-20">
          <line x1="12" y1="0" x2="12" y2="8" stroke="#00ffff" strokeWidth="0.5" />
          <line x1="12" y1="16" x2="12" y2="24" stroke="#00ffff" strokeWidth="0.5" />
          <line x1="0" y1="12" x2="8" y2="12" stroke="#00ffff" strokeWidth="0.5" />
          <line x1="16" y1="12" x2="24" y2="12" stroke="#00ffff" strokeWidth="0.5" />
          <circle cx="12" cy="12" r="3" fill="none" stroke="#00ffff" strokeWidth="0.5" />
        </svg>
      </div>

      {/* Edge glow lines */}
      <div
        className="absolute top-0 left-[10%] right-[10%] h-px"
        style={{
          background: 'linear-gradient(to right, transparent, rgba(0, 255, 255, 0.15), transparent)',
        }}
      />
      <div
        className="absolute bottom-0 left-[10%] right-[10%] h-px"
        style={{
          background: 'linear-gradient(to right, transparent, rgba(0, 255, 255, 0.1), transparent)',
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
      <svg width="64" height="64" viewBox="0 0 64 64" className="opacity-[0.08]">
        <circle cx="32" cy="32" r="28" fill="none" stroke="#00ffff" strokeWidth="0.5" strokeDasharray="4 8" />
        <circle cx="32" cy="32" r="20" fill="none" stroke="#00ffff" strokeWidth="0.3" strokeDasharray="2 6" />
        {/* Flow dots on the ring */}
        <circle cx="32" cy="4" r="1.5" fill="#00ffff" opacity="0.6" />
        <circle cx="60" cy="32" r="1" fill="#00ffff" opacity="0.4" />
      </svg>
    </motion.div>
  );
}

export default HoloHUD;
