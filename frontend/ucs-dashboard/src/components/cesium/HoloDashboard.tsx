/**
 * Holographic Dashboard - Main layout combining Cesium globe with all holo panels
 * 
 * Layout structure:
 * - Center: Cesium 3D Globe (full screen background)
 * - Left floating: Fleet management panel
 * - Right floating: Data instruments panel  
 * - Top-right: Radar display
 * - Bottom center: Arc command bar
 * - Full overlay: HUD decorative elements
 */
import { useState, useCallback } from 'react';
import { lazy, Suspense } from 'react';
import { 
  Plane, 
  RotateCcw, 
  Focus, 
  AlertOctagon, 
  Crosshair,
  Zap,
} from 'lucide-react';
import type { MapDrone } from '../MapPanel';
import { HoloPanel } from './HoloPanel';
import { HoloFleetPanel } from './HoloFleetPanel';
import { HoloDataPanel } from './HoloDataPanel';
import { HoloRadar } from './HoloRadar';
import { HoloCommandBar } from './HoloCommandBar';
import { HoloHUD } from './HoloHUD';

// Lazy load CesiumMapPanel to avoid loading Cesium when not needed
const CesiumMapPanel = lazy(() => import('./CesiumMapPanel'));

interface HoloDashboardProps {
  drones: MapDrone[];
  selectedDroneId?: string | null;
  selectedDroneIds?: Set<string>;
  onDroneClick?: (uavId: string) => void;
  onMapClick?: (lat: number, lon: number) => void;
  onCommand?: (command: string) => void;
  className?: string;
}

export function HoloDashboard({
  drones,
  selectedDroneId,
  selectedDroneIds,
  onDroneClick,
  onMapClick,
  onCommand,
  className = '',
}: HoloDashboardProps) {
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);

  const handleCommand = useCallback((cmd: string) => {
    onCommand?.(cmd);
  }, [onCommand]);

  // Calculate radar center from drone positions
  const validDrones = drones.filter(d => d.lat != null && d.lng != null);
  const radarCenter = validDrones.length > 0
    ? {
        lng: validDrones.reduce((s, d) => s + d.lng, 0) / validDrones.length,
        lat: validDrones.reduce((s, d) => s + d.lat, 0) / validDrones.length,
      }
    : { lng: 116.4, lat: 39.9 };

  const commandButtons = [
    {
      id: 'takeoff',
      label: '起飞',
      icon: <Plane className="w-4 h-4" />,
      color: 'green' as const,
      onClick: () => handleCommand('takeoff'),
    },
    {
      id: 'return',
      label: '返航',
      icon: <RotateCcw className="w-4 h-4" />,
      color: 'cyan' as const,
      onClick: () => handleCommand('return'),
    },
    {
      id: 'focus',
      label: '聚焦',
      icon: <Focus className="w-4 h-4" />,
      color: 'cyan' as const,
      onClick: () => handleCommand('focus'),
    },
    {
      id: 'hover',
      label: '悬停',
      icon: <Crosshair className="w-4 h-4" />,
      color: 'amber' as const,
      onClick: () => handleCommand('hover'),
    },
    {
      id: 'emergency',
      label: '紧急',
      icon: <AlertOctagon className="w-4 h-4" />,
      color: 'magenta' as const,
      onClick: () => handleCommand('emergency'),
    },
    {
      id: 'charge',
      label: '充电',
      icon: <Zap className="w-4 h-4" />,
      color: 'amber' as const,
      onClick: () => handleCommand('charge'),
    },
  ];

  return (
    <div className={`relative w-full h-full bg-[#0a0f1a] overflow-hidden ${className}`}>
      {/* Layer 0: Cesium 3D Globe (full background) */}
      <div className="absolute inset-0 z-0">
        <Suspense
          fallback={
            <div className="w-full h-full flex items-center justify-center bg-[#0a0f1a]">
              <div className="text-cyan-400 animate-pulse text-sm font-mono">
                :: INITIALIZING CESIUM 3D GLOBE ::
              </div>
            </div>
          }
        >
          <CesiumMapPanel
            drones={drones}
            selectedDroneId={selectedDroneId}
            selectedDroneIds={selectedDroneIds}
            onDroneClick={onDroneClick}
            onMapClick={onMapClick}
          />
        </Suspense>
      </div>

      {/* Layer 1: HUD Overlay (scanlines, vignette, corners, crosshair) */}
      <HoloHUD />

      {/* Layer 2: Floating Panels */}
      <div className="absolute inset-0 z-10 pointer-events-none">
        {/* Left floating panel - Fleet Management */}
        <div className="absolute top-4 left-4 w-[260px] pointer-events-auto">
          <HoloPanel
            title="舰队管理"
            tilt="left"
            glow="cyan"
            delay={0.2}
            collapsible
            collapsed={leftPanelCollapsed}
            onToggle={() => setLeftPanelCollapsed(!leftPanelCollapsed)}
          >
            <HoloFleetPanel
              drones={drones}
              selectedDroneId={selectedDroneId}
              onDroneClick={onDroneClick}
            />
          </HoloPanel>
        </div>

        {/* Right floating panel - Data Instruments */}
        <div className="absolute top-4 right-4 w-[220px] pointer-events-auto">
          {/* Radar at top-right */}
          <HoloPanel
            title="雷达扫描"
            tilt="right"
            glow="cyan"
            delay={0.3}
          >
            <div className="flex justify-center p-3">
              <HoloRadar
                drones={drones}
                centerLng={radarCenter.lng}
                centerLat={radarCenter.lat}
                radius={2}
                size={180}
              />
            </div>
          </HoloPanel>

          {/* Data panel below radar */}
          <div className="mt-3">
            <HoloPanel
              title="实时数据"
              tilt="right"
              glow="cyan"
              delay={0.4}
              collapsible
              collapsed={rightPanelCollapsed}
              onToggle={() => setRightPanelCollapsed(!rightPanelCollapsed)}
            >
              <HoloDataPanel
                drones={drones}
                selectedDroneId={selectedDroneId}
              />
            </HoloPanel>
          </div>
        </div>

        {/* Bottom center - Arc Command Bar */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 pointer-events-auto">
          <HoloCommandBar buttons={commandButtons} />
        </div>
      </div>
    </div>
  );
}

export default HoloDashboard;
