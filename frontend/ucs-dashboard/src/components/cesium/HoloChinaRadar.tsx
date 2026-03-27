/**
 * Holographic Radar Panel - Phase 5
 * Shows ALL drone states: flying(green), online(blue), offline(gray), lowBattery(red)
 * Fills panel space with responsive sizing
 */
import { useRef, useEffect, useCallback } from 'react';
import type { MapDrone } from '../MapPanel';

interface HoloChinaRadarProps {
  drones: MapDrone[];
  size?: number;
}

const GEO_BOUNDS = { minLng: 73.5, maxLng: 135.0, minLat: 18.0, maxLat: 53.5 };

export function HoloChinaRadar({ drones, size = 160 }: HoloChinaRadarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const scanAngleRef = useRef(0);

  const mapToCanvas = useCallback((lng: number, lat: number, r: number) => {
    const cx = r, cy = r;
    const padding = r * 0.15;
    const effectiveR = r - padding;
    const nx = ((lng - GEO_BOUNDS.minLng) / (GEO_BOUNDS.maxLng - GEO_BOUNDS.minLng)) * 2 - 1;
    const ny = ((GEO_BOUNDS.maxLat - lat) / (GEO_BOUNDS.maxLat - GEO_BOUNDS.minLat)) * 2 - 1;
    return { x: cx + nx * effectiveR * 0.8, y: cy + ny * effectiveR * 0.8 };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    const r = size / 2;

    const draw = () => {
      ctx.clearRect(0, 0, size, size);

      // Background circle
      ctx.beginPath();
      ctx.arc(r, r, r - 1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10, 20, 50, 0.9)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(82, 168, 255, 0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Concentric rings
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(82, 168, 255, 0.2)';
      ctx.beginPath(); ctx.arc(r, r, r * 0.7, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(r, r, r * 0.4, 0, Math.PI * 2); ctx.stroke();

      // Cross lines
      ctx.beginPath();
      ctx.moveTo(r, 0); ctx.lineTo(r, size);
      ctx.moveTo(0, r); ctx.lineTo(size, r);
      ctx.strokeStyle = 'rgba(82, 168, 255, 0.1)';
      ctx.stroke();

      // Scan sweep
      scanAngleRef.current += 0.025;
      const angle = scanAngleRef.current;
      ctx.save();
      ctx.beginPath(); ctx.arc(r, r, r - 2, 0, Math.PI * 2); ctx.clip();
      ctx.beginPath(); ctx.moveTo(r, r); ctx.arc(r, r, r, angle - 0.8, angle, false); ctx.closePath();
      const scanGrad = ctx.createRadialGradient(r, r, 0, r, r, r);
      scanGrad.addColorStop(0, 'rgba(82, 168, 255, 0.25)');
      scanGrad.addColorStop(1, 'rgba(82, 168, 255, 0.02)');
      ctx.fillStyle = scanGrad;
      ctx.fill();
      ctx.restore();

      // Scan line
      ctx.beginPath();
      ctx.moveTo(r, r);
      ctx.lineTo(r + Math.cos(angle) * (r - 2), r + Math.sin(angle) * (r - 2));
      ctx.strokeStyle = 'rgba(82, 168, 255, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Center dot
      ctx.beginPath(); ctx.arc(r, r, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#52a8ff'; ctx.fill();

      // Draw ALL drone dots with state-based colors
      drones.forEach(drone => {
        if (drone.lat == null || drone.lng == null) return;
        if (drone.lng < GEO_BOUNDS.minLng - 5 || drone.lng > GEO_BOUNDS.maxLng + 5) return;
        if (drone.lat < GEO_BOUNDS.minLat - 5 || drone.lat > GEO_BOUNDS.maxLat + 5) return;

        const { x, y } = mapToCanvas(drone.lng, drone.lat, r);
        const dist = Math.sqrt((x - r) ** 2 + (y - r) ** 2);
        if (dist > r - 5) return;

        const isOnline = drone.onlineStatus === true;
        const isArmed = drone.armed === true;
        const isLowBattery = (drone.battery ?? 100) < 20;

        // Color: lowBattery=red, flying=green, online=blue, offline=gray
        let dotColor: string;
        let glowColor: string;
        if (isLowBattery && isOnline) {
          dotColor = '#ff4d4f'; glowColor = 'rgba(255, 77, 79, 0.5)';
        } else if (isArmed) {
          dotColor = '#00ff7f'; glowColor = 'rgba(0, 255, 127, 0.5)';
        } else if (isOnline) {
          dotColor = '#3b82f6'; glowColor = 'rgba(59, 130, 246, 0.5)';
        } else {
          dotColor = '#64748b'; glowColor = 'rgba(100, 116, 139, 0.3)';
        }

        // Glow
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = glowColor; ctx.fill();

        // Dot
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = dotColor; ctx.fill();

        // Blink for flying/low battery
        if (isArmed || isLowBattery) {
          const blink = 0.3 + 0.7 * Math.abs(Math.sin(Date.now() / 1000 + x));
          ctx.globalAlpha = blink;
          ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fillStyle = dotColor; ctx.fill();
          ctx.globalAlpha = 1;
        }
      });

      animFrameRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [drones, size, mapToCanvas]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <canvas ref={canvasRef} style={{ width: size, height: size, borderRadius: '50%' }} />
      {/* Legend - all 4 states */}
      <div style={{ display: 'flex', gap: '10px', marginTop: '6px', fontSize: '9px', color: '#a0cfff', flexWrap: 'wrap', justifyContent: 'center' }}>
        <LegendItem color="#00ff7f" label="飞行中" />
        <LegendItem color="#3b82f6" label="在线" />
        <LegendItem color="#ff4d4f" label="低电量" />
        <LegendItem color="#64748b" label="离线" />
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block', boxShadow: `0 0 4px ${color}` }} />
      {label}
    </span>
  );
}

export default HoloChinaRadar;
