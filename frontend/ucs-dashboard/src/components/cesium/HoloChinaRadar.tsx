/**
 * Holographic Radar Panel - Phase 4
 * Circular radar with concentric rings, rotating scan line, 
 * and drone position dots (only flying=green, lowBattery=red)
 * Matches HTML prototype radar-box style
 */
import { useRef, useEffect, useCallback } from 'react';
import type { MapDrone } from '../MapPanel';

interface HoloChinaRadarProps {
  drones: MapDrone[];
  size?: number;
}

// Geographic bounds for mapping coordinates
const GEO_BOUNDS = {
  minLng: 73.5,
  maxLng: 135.0,
  minLat: 18.0,
  maxLat: 53.5,
};

export function HoloChinaRadar({ drones, size = 160 }: HoloChinaRadarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const scanAngleRef = useRef(0);

  const mapToCanvas = useCallback((lng: number, lat: number, r: number) => {
    const cx = r;
    const cy = r;
    // Map to radar circle area (with some padding)
    const padding = r * 0.15;
    const effectiveR = r - padding;
    const nx = ((lng - GEO_BOUNDS.minLng) / (GEO_BOUNDS.maxLng - GEO_BOUNDS.minLng)) * 2 - 1;
    const ny = ((GEO_BOUNDS.maxLat - lat) / (GEO_BOUNDS.maxLat - GEO_BOUNDS.minLat)) * 2 - 1;
    return {
      x: cx + nx * effectiveR * 0.8,
      y: cy + ny * effectiveR * 0.8,
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const canvasSize = size;
    canvas.width = canvasSize * dpr;
    canvas.height = canvasSize * dpr;
    ctx.scale(dpr, dpr);

    const r = canvasSize / 2;

    const draw = () => {
      ctx.clearRect(0, 0, canvasSize, canvasSize);

      // Circular background
      ctx.beginPath();
      ctx.arc(r, r, r - 1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10, 20, 50, 0.9)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(82, 168, 255, 0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Concentric rings (3 levels)
      const ringAlpha = 'rgba(82, 168, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.strokeStyle = ringAlpha;

      // Ring 1 (outer) - already drawn as border
      // Ring 2 (70%)
      ctx.beginPath();
      ctx.arc(r, r, r * 0.7, 0, Math.PI * 2);
      ctx.stroke();

      // Ring 3 (40%)
      ctx.beginPath();
      ctx.arc(r, r, r * 0.4, 0, Math.PI * 2);
      ctx.stroke();

      // Cross lines
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(r, canvasSize);
      ctx.moveTo(0, r);
      ctx.lineTo(canvasSize, r);
      ctx.strokeStyle = 'rgba(82, 168, 255, 0.1)';
      ctx.stroke();

      // Rotating scan sweep (conic gradient simulation)
      scanAngleRef.current += 0.025;
      const angle = scanAngleRef.current;

      // Draw scan sweep arc
      ctx.save();
      ctx.beginPath();
      ctx.arc(r, r, r - 2, 0, Math.PI * 2);
      ctx.clip();

      ctx.beginPath();
      ctx.moveTo(r, r);
      ctx.arc(r, r, r, angle - 0.8, angle, false);
      ctx.closePath();
      const scanGrad = ctx.createRadialGradient(r, r, 0, r, r, r);
      scanGrad.addColorStop(0, 'rgba(82, 168, 255, 0.25)');
      scanGrad.addColorStop(1, 'rgba(82, 168, 255, 0.02)');
      ctx.fillStyle = scanGrad;
      ctx.fill();
      ctx.restore();

      // Scan line
      const scanEndX = r + Math.cos(angle) * (r - 2);
      const scanEndY = r + Math.sin(angle) * (r - 2);
      ctx.beginPath();
      ctx.moveTo(r, r);
      ctx.lineTo(scanEndX, scanEndY);
      ctx.strokeStyle = 'rgba(82, 168, 255, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Center dot
      ctx.beginPath();
      ctx.arc(r, r, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#52a8ff';
      ctx.fill();

      // Draw drone dots - only flying (green) and low battery (red)
      drones.forEach(drone => {
        if (drone.lat == null || drone.lng == null) return;
        if (drone.lng < GEO_BOUNDS.minLng - 5 || drone.lng > GEO_BOUNDS.maxLng + 5) return;
        if (drone.lat < GEO_BOUNDS.minLat - 5 || drone.lat > GEO_BOUNDS.maxLat + 5) return;

        const isFlying = drone.onlineStatus && drone.armed;
        const isLowBattery = (drone.battery ?? 100) < 20;

        // Only show flying drones (green) and low battery drones (red)
        if (!isFlying && !isLowBattery) return;

        const { x, y } = mapToCanvas(drone.lng, drone.lat, r);

        // Check if point is within the circle
        const dist = Math.sqrt((x - r) ** 2 + (y - r) ** 2);
        if (dist > r - 5) return;

        const dotColor = isLowBattery ? '#ff4d4f' : '#00ff7f';
        const glowColor = isLowBattery ? 'rgba(255, 77, 79, 0.5)' : 'rgba(0, 255, 127, 0.5)';

        // Glow
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = glowColor;
        ctx.fill();

        // Dot
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = dotColor;
        ctx.fill();

        // Blink animation
        const blink = 0.3 + 0.7 * Math.abs(Math.sin(Date.now() / 1000 + x));
        ctx.globalAlpha = blink;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = dotColor;
        ctx.fill();
        ctx.globalAlpha = 1;
      });

      animFrameRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [drones, size, mapToCanvas]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size, borderRadius: '50%' }}
      />
      {/* Legend */}
      <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '9px', color: '#a0cfff' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00ff7f', display: 'inline-block', boxShadow: '0 0 4px #00ff7f' }} />
          飞行中
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff4d4f', display: 'inline-block', boxShadow: '0 0 4px #ff4d4f' }} />
          低电量
        </span>
      </div>
    </div>
  );
}

export default HoloChinaRadar;
