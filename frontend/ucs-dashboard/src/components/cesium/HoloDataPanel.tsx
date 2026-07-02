/**
 * Holographic Data Instruments Panel
 * 
 * Right-side floating panel with real-time data gauges:
 * - Battery status
 * - Signal strength waveform
 * - Flight status overview
 */
import { useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { MapDrone } from '../MapPanel';
import { HoloEnergyGauge } from './HoloEnergyGauge';

interface HoloDataPanelProps {
  drones: MapDrone[];
  selectedDroneId?: string | null;
  className?: string;
}

/** Signal strength waveform mini canvas */
function SignalWaveform({ value, className = '' }: { value: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(0);
  const frameRef = useRef(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    phaseRef.current += 0.05;
    const amplitude = (value / 100) * (h / 3);
    const frequency = 0.05 + (value / 100) * 0.05;

    // Draw waveform
    ctx.strokeStyle = value > 50
      ? 'rgba(0, 255, 255, 0.7)'
      : value > 20
      ? 'rgba(255, 170, 68, 0.7)'
      : 'rgba(255, 68, 68, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const noise = value < 30 ? (Math.random() - 0.5) * 4 : 0;
      const y = h / 2 + Math.sin(x * frequency + phaseRef.current) * amplitude + noise;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Center line
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.1)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    frameRef.current = requestAnimationFrame(draw);
  }, [value]);

  useEffect(() => {
    frameRef.current = requestAnimationFrame(draw);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      width={120}
      height={32}
      className={className}
      style={{ width: 120, height: 32 }}
    />
  );
}

export function HoloDataPanel({
  drones,
  selectedDroneId,
  className = '',
}: HoloDataPanelProps) {
  const selectedDrone = drones.find(d => d.uavId === selectedDroneId);
  const avgBattery = drones.length > 0
    ? drones.reduce((sum, d) => sum + (d.battery ?? 0), 0) / drones.length
    : 0;
  const flyingCount = drones.filter(d => d.flightStatus === 'FLYING').length;
  const onlineCount = drones.filter(d => d.onlineStatus !== false).length;

  return (
    <div className={cn('flex flex-col gap-3 p-3', className)}>
      {/* Selected drone detail */}
      {selectedDrone ? (
        <motion.div
          key={selectedDrone.uavId}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="space-y-3"
        >
          <div className="text-center">
            <div className="text-cyan-400 text-xs font-bold tracking-wider">
              {selectedDrone.uavId}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              {selectedDrone.model || 'Unknown Model'}
            </div>
          </div>

          {/* Battery gauge */}
          <div className="flex justify-center">
            <HoloEnergyGauge
              value={selectedDrone.battery ?? 0}
              label="电量"
              size={72}
              thickness={5}
            />
          </div>

          {/* Signal waveform */}
          <div className="space-y-1">
            <div className="text-[10px] text-cyan-400/60 uppercase tracking-wider text-center">
              信号强度
            </div>
            <div className="flex justify-center">
              <SignalWaveform value={75} />
            </div>
          </div>

          {/* Telemetry data */}
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <DataItem
              label="高度"
              value={selectedDrone.altitude != null ? `${selectedDrone.altitude.toFixed(1)}m` : '--'}
            />
            <DataItem
              label="航向"
              value={selectedDrone.heading != null ? `${selectedDrone.heading.toFixed(0)}°` : '--'}
            />
            <DataItem
              label="纬度"
              value={selectedDrone.lat?.toFixed(6) ?? '--'}
            />
            <DataItem
              label="经度"
              value={selectedDrone.lng?.toFixed(6) ?? '--'}
            />
          </div>
        </motion.div>
      ) : (
        /* Fleet overview when no drone selected */
        <div className="space-y-3">
          <div className="text-center text-[10px] text-cyan-400/60 uppercase tracking-wider">
            舰队概览
          </div>

          <div className="flex justify-center">
            <HoloEnergyGauge
              value={avgBattery}
              label="平均电量"
              size={72}
              thickness={5}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <DataItem label="总计" value={`${drones.length}`} />
            <DataItem label="在线" value={`${onlineCount}`} />
            <DataItem label="飞行中" value={`${flyingCount}`} />
            <DataItem label="平均电量" value={`${avgBattery.toFixed(0)}%`} />
          </div>
        </div>
      )}
    </div>
  );
}

function DataItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-cyan-500/5 rounded-md px-2 py-1.5 border border-cyan-500/10">
      <div className="text-cyan-400/50 text-[9px] uppercase tracking-wider">{label}</div>
      <div className="text-white font-mono text-xs mt-0.5">{value}</div>
    </div>
  );
}

export default HoloDataPanel;
