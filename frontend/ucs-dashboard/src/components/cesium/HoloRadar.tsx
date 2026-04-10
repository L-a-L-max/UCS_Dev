/**
 * Holographic Radar Display
 * 
 * Canvas-based radar with rotating scan line, drone position blips,
 * and coordinate grid. Positioned at top-right of the interface.
 */
import { useEffect, useRef, useCallback } from 'react';
import type { MapDrone } from '../MapPanel';

interface HoloRadarProps {
  drones: MapDrone[];
  centerLng?: number;
  centerLat?: number;
  radius?: number; // degrees radius to show
  size?: number;
  className?: string;
}

export function HoloRadar({
  drones,
  centerLng = 116.4,
  centerLat = 39.9,
  radius = 2,
  size = 180,
  className = '',
}: HoloRadarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const angleRef = useRef(0);
  const animFrameRef = useRef<number>(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(cx, cy) - 4;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = 'rgba(10, 20, 40, 0.6)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Grid rings
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.15)';
    ctx.lineWidth = 0.5;
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (r * i) / 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Cross lines
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();

    // Diagonal lines
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.08)';
    const diag = r * Math.SQRT1_2;
    ctx.beginPath();
    ctx.moveTo(cx - diag, cy - diag);
    ctx.lineTo(cx + diag, cy + diag);
    ctx.moveTo(cx + diag, cy - diag);
    ctx.lineTo(cx - diag, cy + diag);
    ctx.stroke();

    // Scan line (rotating)
    angleRef.current = (angleRef.current + 0.02) % (Math.PI * 2);
    const scanAngle = angleRef.current;

    // Scan cone gradient
    const gradient = ctx.createConicGradient(scanAngle - Math.PI / 6, cx, cy);
    gradient.addColorStop(0, 'rgba(0, 255, 255, 0)');
    gradient.addColorStop(0.08, 'rgba(0, 255, 255, 0.12)');
    gradient.addColorStop(0.1, 'rgba(0, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Scan line
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(
      cx + Math.cos(scanAngle) * r,
      cy + Math.sin(scanAngle) * r
    );
    ctx.stroke();

    // Drone blips
    drones.forEach(drone => {
      if (drone.lat == null || drone.lng == null) return;
      const dx = (drone.lng - centerLng) / radius;
      const dy = -(drone.lat - centerLat) / radius;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 1) return; // Outside radar range

      const px = cx + dx * r;
      const py = cy + dy * r;

      // Blip glow
      const isOnline = drone.onlineStatus !== false;
      const blipColor = !isOnline
        ? 'rgba(100, 116, 139, 0.8)'
        : drone.armed
        ? 'rgba(34, 197, 94, 0.9)'
        : 'rgba(0, 255, 255, 0.9)';

      // Outer glow
      ctx.fillStyle = blipColor.replace(/[\d.]+\)$/, '0.3)');
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();

      // Inner dot
      ctx.fillStyle = blipColor;
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Trail effect after scan passes
      const blipAngle = Math.atan2(py - cy, px - cx);
      const angleDiff = ((scanAngle - blipAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      if (angleDiff > 0 && angleDiff < 0.5) {
        ctx.fillStyle = blipColor.replace(/[\d.]+\)$/, `${0.4 * (1 - angleDiff / 0.5)})`);
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Outer ring glow
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = 'rgba(0, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fill();

    // Dynamic noise dots (subtle)
    for (let i = 0; i < 5; i++) {
      const nx = cx + (Math.random() - 0.5) * 2 * r;
      const ny = cy + (Math.random() - 0.5) * 2 * r;
      const ndist = Math.sqrt((nx - cx) ** 2 + (ny - cy) ** 2);
      if (ndist < r) {
        ctx.fillStyle = 'rgba(0, 255, 255, 0.05)';
        ctx.fillRect(nx, ny, 1, 1);
      }
    }

    animFrameRef.current = requestAnimationFrame(draw);
  }, [drones, centerLng, centerLat, radius]);

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(draw);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={className}
      style={{ borderRadius: '50%' }}
    />
  );
}

export default HoloRadar;
