/**
 * Holographic Energy Gauge
 * 
 * Ring-shaped battery/signal gauge with animated glow.
 * Replaces plain text percentages with visual ring indicators.
 */
import { useEffect, useRef } from 'react';

interface HoloEnergyGaugeProps {
  value: number; // 0-100
  label?: string;
  size?: number;
  thickness?: number;
  className?: string;
}

export function HoloEnergyGauge({
  value,
  label,
  size = 64,
  thickness = 4,
  className = '',
}: HoloEnergyGaugeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Color based on value
  const getColor = (v: number) => {
    if (v > 60) return { r: 0, g: 255, b: 255 }; // cyan
    if (v > 30) return { r: 255, g: 170, b: 68 }; // amber
    return { r: 255, g: 68, b: 68 }; // red
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(cx, cy) - thickness - 2;

    ctx.clearRect(0, 0, w, h);

    // Background ring
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = thickness;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI * 1.5);
    ctx.stroke();

    // Value ring
    const color = getColor(value);
    const endAngle = -Math.PI / 2 + (Math.PI * 2 * Math.min(value, 100)) / 100;
    
    // Glow effect
    ctx.shadowColor = `rgba(${color.r}, ${color.g}, ${color.b}, 0.5)`;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.9)`;
    ctx.lineWidth = thickness;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, endAngle);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Center text
    ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.9)`;
    ctx.font = `bold ${Math.floor(size / 4.5)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(value)}%`, cx, cy);

    // Blinking effect for low values
    if (value < 20) {
      const alpha = 0.3 + 0.3 * Math.sin(Date.now() / 300);
      ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
      ctx.lineWidth = thickness + 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, endAngle);
      ctx.stroke();
    }
  }, [value, size, thickness]);

  return (
    <div className={`flex flex-col items-center gap-1 ${className}`}>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        style={{ width: size, height: size }}
      />
      {label && (
        <span className="text-[10px] text-cyan-400/60 uppercase tracking-wider">
          {label}
        </span>
      )}
    </div>
  );
}

export default HoloEnergyGauge;
