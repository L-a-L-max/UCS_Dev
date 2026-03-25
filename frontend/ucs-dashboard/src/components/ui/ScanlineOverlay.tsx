import { cn } from '@/lib/utils';

interface ScanlineOverlayProps {
  className?: string;
  intensity?: 'low' | 'medium' | 'high';
}

const intensityMap = {
  low: 'opacity-[0.015]',
  medium: 'opacity-[0.03]',
  high: 'opacity-[0.05]',
};

export function ScanlineOverlay({ className, intensity = 'low' }: ScanlineOverlayProps) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-[1]',
        intensityMap[intensity],
        className
      )}
      style={{
        background: `repeating-linear-gradient(
          0deg,
          transparent,
          transparent 2px,
          rgba(0, 240, 255, 1) 2px,
          rgba(0, 240, 255, 1) 4px
        )`,
      }}
    />
  );
}

export default ScanlineOverlay;
