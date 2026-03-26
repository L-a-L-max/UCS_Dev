/**
 * Holographic China Radar Panel
 * Top-right corner - shows China map silhouette with drone positions
 * Different colored dots for online/offline/flying status
 */
import { useRef, useEffect, useCallback } from 'react';
import type { MapDrone } from '../MapPanel';

interface HoloChinaRadarProps {
  drones: MapDrone[];
  size?: number;
}

// Simplified China map outline (rooster silhouette) as SVG path data
// Normalized to 0-100 coordinate space
const CHINA_OUTLINE_POINTS = [
  // Northeast
  [73, 10], [76, 8], [79, 6], [82, 5], [85, 7], [87, 10], [89, 13],
  [91, 11], [93, 9], [95, 12], [96, 15], [94, 18], [92, 20],
  // East coast
  [93, 22], [94, 25], [93, 28], [95, 30], [94, 33], [93, 36],
  [94, 38], [93, 41], [91, 44], [90, 47], [88, 50], [87, 53],
  // Southeast
  [86, 56], [85, 59], [83, 62], [82, 64], [80, 66], [78, 68],
  // Hainan
  [77, 70], [76, 72], [75, 70],
  // South coast
  [73, 67], [71, 65], [69, 63], [67, 62], [65, 61],
  // Southwest
  [63, 63], [61, 65], [59, 67], [57, 66], [55, 64], [53, 63],
  [51, 62], [49, 61], [47, 60], [45, 58],
  // West (Tibet)
  [42, 56], [39, 54], [36, 52], [33, 50], [30, 48],
  // Northwest
  [27, 45], [24, 42], [22, 39], [20, 36], [18, 33],
  [16, 30], [15, 27], [14, 24], [15, 21], [17, 18],
  // North
  [20, 16], [23, 14], [26, 13], [30, 12], [34, 11],
  [38, 10], [42, 9], [46, 8], [50, 8], [54, 9],
  [58, 9], [62, 8], [66, 9], [70, 10], [73, 10],
];

// China geographic bounds for mapping lat/lng to canvas
const CHINA_BOUNDS = {
  minLng: 73.5,
  maxLng: 135.0,
  minLat: 18.0,
  maxLat: 53.5,
};

export function HoloChinaRadar({ drones, size = 180 }: HoloChinaRadarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const scanAngleRef = useRef(0);

  // Map drone lat/lng to canvas position
  const mapToCanvas = useCallback((lng: number, lat: number, w: number, h: number) => {
    const padding = 15;
    const x = padding + ((lng - CHINA_BOUNDS.minLng) / (CHINA_BOUNDS.maxLng - CHINA_BOUNDS.minLng)) * (w - padding * 2);
    const y = padding + ((CHINA_BOUNDS.maxLat - lat) / (CHINA_BOUNDS.maxLat - CHINA_BOUNDS.minLat)) * (h - padding * 2);
    return { x, y };
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

    const draw = () => {
      ctx.clearRect(0, 0, size, size);

      // Background
      ctx.fillStyle = 'rgba(5, 10, 25, 0.3)';
      ctx.fillRect(0, 0, size, size);

      // Draw China map outline
      ctx.beginPath();
      const padding = 15;
      CHINA_OUTLINE_POINTS.forEach((pt, i) => {
        const x = padding + (pt[0] / 100) * (size - padding * 2);
        const y = padding + (pt[1] / 100) * (size - padding * 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();

      // Fill China silhouette
      ctx.fillStyle = 'rgba(0, 229, 255, 0.05)';
      ctx.fill();

      // China outline stroke
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Rotating scan line
      scanAngleRef.current += 0.02;
      const centerX = size / 2;
      const centerY = size / 2;
      const scanLen = size * 0.6;
      const scanEndX = centerX + Math.cos(scanAngleRef.current) * scanLen;
      const scanEndY = centerY + Math.sin(scanAngleRef.current) * scanLen;

      const scanGrad = ctx.createLinearGradient(centerX, centerY, scanEndX, scanEndY);
      scanGrad.addColorStop(0, 'rgba(0, 229, 255, 0.15)');
      scanGrad.addColorStop(1, 'rgba(0, 229, 255, 0)');
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(scanEndX, scanEndY);
      ctx.strokeStyle = scanGrad;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Draw scan sweep arc
      const sweepGrad = ctx.createConicGradient(scanAngleRef.current - 0.5, centerX, centerY);
      sweepGrad.addColorStop(0, 'rgba(0, 229, 255, 0)');
      sweepGrad.addColorStop(0.08, 'rgba(0, 229, 255, 0.06)');
      sweepGrad.addColorStop(0.15, 'rgba(0, 229, 255, 0)');
      sweepGrad.addColorStop(1, 'rgba(0, 229, 255, 0)');
      ctx.beginPath();
      ctx.arc(centerX, centerY, scanLen, 0, Math.PI * 2);
      ctx.fillStyle = sweepGrad;
      ctx.fill();

      // Draw drone dots
      drones.forEach(drone => {
        if (drone.lat == null || drone.lng == null) return;
        // Only draw if within China bounds (roughly)
        if (drone.lng < CHINA_BOUNDS.minLng - 5 || drone.lng > CHINA_BOUNDS.maxLng + 5) return;
        if (drone.lat < CHINA_BOUNDS.minLat - 5 || drone.lat > CHINA_BOUNDS.maxLat + 5) return;

        const { x, y } = mapToCanvas(drone.lng, drone.lat, size, size);

        // Determine color based on status
        let dotColor: string;
        let glowColor: string;
        if (!drone.onlineStatus) {
          dotColor = '#64748b';
          glowColor = 'rgba(100, 116, 139, 0.3)';
        } else if (drone.armed) {
          dotColor = '#22c55e';
          glowColor = 'rgba(34, 197, 94, 0.4)';
        } else {
          dotColor = '#3b82f6';
          glowColor = 'rgba(59, 130, 246, 0.4)';
        }

        // Glow
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = glowColor;
        ctx.fill();

        // Dot
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = dotColor;
        ctx.fill();

        // Pulse for flying drones
        if (drone.armed) {
          const pulse = 3 + Math.sin(Date.now() / 300 + x) * 2;
          ctx.beginPath();
          ctx.arc(x, y, pulse, 0, Math.PI * 2);
          ctx.strokeStyle = `${dotColor}40`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      });

      // Corner grid lines for aesthetics
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.08)';
      ctx.lineWidth = 0.5;
      // Horizontal grid
      for (let i = 1; i < 4; i++) {
        const y = (size / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
      }
      // Vertical grid
      for (let i = 1; i < 4; i++) {
        const x = (size / 4) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size);
        ctx.stroke();
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [drones, size, mapToCanvas]);

  return (
    <div className="flex flex-col items-center p-2">
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size }}
        className="rounded"
      />
      {/* Legend */}
      <div className="flex items-center gap-3 mt-2 text-[9px] text-slate-400">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />飞行
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />在线
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-slate-500 inline-block" />离线
        </span>
      </div>
    </div>
  );
}

export default HoloChinaRadar;
