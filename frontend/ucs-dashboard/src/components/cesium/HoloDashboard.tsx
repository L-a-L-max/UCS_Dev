/**
 * Holographic Dashboard - Full-viewport 3D holographic interface
 * 
 * Layout: Cesium globe fills 100vw×100vh as background.
 * 7 floating panels positioned with absolute positioning over the globe.
 * 
 * Panels:
 * 1. Left Console (控制台) - main control functions by role
 * 2. Top-Left Drone Stats (无人机统计) - drone count/status statistics
 * 3. Bottom-Left Log (日志) - scrolling log, max 4 visible
 * 4. Bottom Center Drone Control (无人机控制) - flight controls + info
 * 5. Top-Right Radar (雷达) - China map silhouette with drone positions
 * 6. Right Member Log (成员日志) - member online status
 * 7. Bottom-Right Weather (天气信息) - weather conditions
 */
import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { lazy, Suspense } from 'react';
import type { MapDrone } from '../MapPanel';
import { HoloPanel } from './HoloPanel';
import { HoloDroneStatsPanel } from './HoloDroneStatsPanel';
import { HoloLogPanel, type LogEntry } from './HoloLogPanel';
import { HoloDroneControlPanel } from './HoloDroneControlPanel';
import { HoloChinaRadar } from './HoloChinaRadar';
import { HoloMemberPanel } from './HoloMemberPanel';
import { HoloWeatherPanel } from './HoloWeatherPanel';
import { HoloHUD } from './HoloHUD';

// Lazy load CesiumMapPanel to avoid loading Cesium when not needed
const CesiumMapPanel = lazy(() => import('./CesiumMapPanel'));

/** Team member type for member panel */
export interface HoloTeamMember {
  userId: string;
  username: string;
  realName?: string;
  role: string;
  online?: boolean;
}

/** Weather data for weather panel */
export interface HoloWeatherInfo {
  temperature?: number;
  humidity?: number;
  windSpeed?: number;
  windDirection?: string;
  visibility?: number;
  condition?: string;
  description?: string;
}

export interface HoloDashboardProps {
  drones: MapDrone[];
  selectedDroneId?: string | null;
  selectedDroneIds?: Set<string>;
  onDroneClick?: (uavId: string) => void;
  onMapClick?: (lat: number, lon: number) => void;
  onCommand?: (command: string, uavIds?: string[]) => void;
  /** Content for the left console panel (role-specific tabs) */
  consoleContent?: ReactNode;
  /** Log entries for the bottom-left log panel */
  logs?: LogEntry[];
  /** Team members for the right member panel */
  members?: HoloTeamMember[];
  /** Weather data for the bottom-right panel */
  weather?: HoloWeatherInfo | null;
  /** Callback to close holographic mode */
  onClose?: () => void;
  className?: string;
}

/** Hook to track container dimensions for responsive layout */
function useContainerSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 1200, height: 800 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

export function HoloDashboard({
  drones,
  selectedDroneId,
  selectedDroneIds,
  onDroneClick,
  onMapClick,
  onCommand,
  consoleContent,
  logs = [],
  members = [],
  weather,
  onClose,
  className = '',
}: HoloDashboardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [consoleCollapsed, setConsoleCollapsed] = useState(false);
  const [memberCollapsed, setMemberCollapsed] = useState(false);

  const { width, height } = useContainerSize(containerRef);

  // Responsive breakpoints
  const isCompact = width < 768;
  const isMedium = width >= 768 && width < 1200;

  // Dynamic sizing
  const gap = isCompact ? 8 : 12;
  const consolePanelWidth = isCompact ? Math.min(width * 0.6, 280) : Math.min(width * 0.22, 340);
  const rightPanelWidth = isCompact ? Math.min(width * 0.5, 240) : Math.min(width * 0.18, 260);
  const radarSize = isCompact ? Math.min(width * 0.35, 140) : isMedium ? Math.min(width * 0.16, 180) : Math.min(width * 0.14, 200);
  const statsWidth = isCompact ? Math.min(width * 0.45, 200) : Math.min(width * 0.17, 240);
  const logWidth = isCompact ? Math.min(width * 0.55, 260) : Math.min(width * 0.2, 300);
  const controlPanelWidth = isCompact ? width - gap * 2 : Math.min(width * 0.45, 600);
  const weatherWidth = isCompact ? Math.min(width * 0.5, 220) : Math.min(width * 0.17, 240);

  const handleCommand = useCallback((cmd: string, uavIds?: string[]) => {
    onCommand?.(cmd, uavIds);
  }, [onCommand]);

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 z-50 bg-[#0a0f1a] overflow-hidden ${className}`}
    >
      {/* Layer 0: Cesium 3D Globe (full viewport background) */}
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

      {/* Layer 2: All 7 Floating Panels */}
      <div className="absolute inset-0 z-10 pointer-events-none">

        {/* ===== Panel 1: Left Console (控制台) ===== */}
        <div
          className="absolute pointer-events-auto"
          style={{
            top: gap + 40,
            left: gap,
            width: consoleCollapsed ? 'auto' : consolePanelWidth,
            maxHeight: height - gap * 2 - 80 - 160,
          }}
        >
          <HoloPanel
            title="控制台"
            tilt="none"
            glow="cyan"
            delay={0.2}
            collapsible
            collapsed={consoleCollapsed}
            onToggle={() => setConsoleCollapsed(!consoleCollapsed)}
          >
            <div className="overflow-y-auto" style={{ maxHeight: height * 0.55 }}>
              {consoleContent || (
                <div className="p-4 text-center text-slate-500 text-xs font-mono">
                  控制台功能加载中...
                </div>
              )}
            </div>
          </HoloPanel>
        </div>

        {/* ===== Panel 2: Top-Left Drone Stats (无人机统计) ===== */}
        <div
          className="absolute pointer-events-auto"
          style={{
            top: gap,
            left: gap + (consoleCollapsed ? 50 : consolePanelWidth) + gap,
            width: statsWidth,
          }}
        >
          <HoloPanel
            title="无人机统计"
            tilt="none"
            glow="cyan"
            delay={0.1}
          >
            <HoloDroneStatsPanel drones={drones} />
          </HoloPanel>
        </div>

        {/* ===== Panel 3: Bottom-Left Log (日志) ===== */}
        <div
          className="absolute pointer-events-auto"
          style={{
            bottom: gap + 80,
            left: gap,
            width: logWidth,
          }}
        >
          <HoloPanel
            title="日志"
            tilt="none"
            glow="cyan"
            delay={0.5}
          >
            <HoloLogPanel logs={logs} maxVisible={4} />
          </HoloPanel>
        </div>

        {/* ===== Panel 4: Bottom Center Drone Control (无人机控制) ===== */}
        <div
          className="absolute pointer-events-auto left-1/2"
          style={{
            bottom: gap,
            transform: 'translateX(-50%)',
            width: controlPanelWidth,
          }}
        >
          <HoloPanel
            title="无人机控制"
            tilt="none"
            glow="cyan"
            delay={0.4}
          >
            <HoloDroneControlPanel
              drones={drones}
              selectedDroneId={selectedDroneId}
              selectedDroneIds={selectedDroneIds}
              onCommand={handleCommand}
            />
          </HoloPanel>
        </div>

        {/* ===== Panel 5: Top-Right Radar (雷达扫描) ===== */}
        <div
          className="absolute pointer-events-auto"
          style={{
            top: gap,
            right: gap,
            width: radarSize + 24,
          }}
        >
          <HoloPanel
            title="雷达扫描"
            tilt="none"
            glow="cyan"
            delay={0.3}
          >
            <HoloChinaRadar drones={drones} size={radarSize} />
          </HoloPanel>
        </div>

        {/* ===== Panel 6: Right Member Log (成员日志) ===== */}
        <div
          className="absolute pointer-events-auto"
          style={{
            top: gap + radarSize + 80,
            right: gap,
            width: memberCollapsed ? 'auto' : rightPanelWidth,
            maxHeight: height - radarSize - gap * 3 - 160,
          }}
        >
          <HoloPanel
            title="成员日志"
            tilt="none"
            glow="cyan"
            delay={0.35}
            collapsible
            collapsed={memberCollapsed}
            onToggle={() => setMemberCollapsed(!memberCollapsed)}
          >
            <HoloMemberPanel members={members} />
          </HoloPanel>
        </div>

        {/* ===== Panel 7: Bottom-Right Weather (天气信息) ===== */}
        <div
          className="absolute pointer-events-auto"
          style={{
            bottom: gap + 80,
            right: gap,
            width: weatherWidth,
          }}
        >
          <HoloPanel
            title="天气信息"
            tilt="none"
            glow="cyan"
            delay={0.45}
          >
            <HoloWeatherPanel weather={weather} />
          </HoloPanel>
        </div>

        {/* ===== Exit Button (top center) ===== */}
        {onClose && (
          <div className="absolute top-2 pointer-events-auto z-20" style={{ left: '50%', transform: 'translateX(-50%)' }}>
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-mono transition-all
                hover:scale-105 active:scale-95"
              style={{
                background: 'rgba(10, 20, 40, 0.7)',
                border: '1px solid rgba(0, 229, 255, 0.3)',
                color: '#00e5ff',
                backdropFilter: 'blur(8px)',
              }}
            >
              ✕ 退出全息模式
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default HoloDashboard;
