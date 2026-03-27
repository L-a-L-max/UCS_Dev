/**
 * Holographic Dashboard - Phase 4 (HTML Prototype Migration)
 * 
 * Layout matches HTML prototype exactly:
 * - Cesium globe fills 100vw x 100vh as background
 * - Top center title
 * - 7 floating panels with responsive positioning
 * - Arc clip-path SVG for bottom control panel
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
  consoleContent?: ReactNode;
  logs?: LogEntry[];
  members?: HoloTeamMember[];
  weather?: HoloWeatherInfo | null;
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
  const { width, height } = useContainerSize(containerRef);

  // Responsive scaling factor based on viewport
  const scaleX = width / 1920;
  const scaleY = height / 1080;
  const scale = Math.min(scaleX, scaleY, 1);

  // Panel dimensions (responsive from prototype fixed values)
  const gap = Math.max(12, Math.round(12 * scale));
  const leftPanelWidth = Math.max(240, Math.round(320 * scaleX));
  const rightPanelWidth = Math.max(230, Math.round(310 * scaleX));
  const bottomHeight = Math.max(120, Math.round(160 * scaleY));
  const radarHeight = Math.max(160, Math.round(200 * scaleY));
  const statHeight = Math.max(70, Math.round(85 * scaleY));
  const radarSize = Math.max(120, Math.round(160 * Math.min(scaleX, scaleY)));

  // Console panel: from below stats to above logs
  const consoleTop = gap + statHeight + gap;
  const consoleBottom = gap + bottomHeight + gap;

  // Member panel: from below radar to above weather
  const memberTop = gap + radarHeight + gap;
  const memberBottom = gap + bottomHeight + gap;

  // Bottom control panel: between left and right panels
  const controlLeft = gap + leftPanelWidth + gap;
  const controlRight = gap + rightPanelWidth + gap;

  const handleCommand = useCallback((cmd: string, uavIds?: string[]) => {
    onCommand?.(cmd, uavIds);
  }, [onCommand]);

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 z-50 overflow-hidden ${className}`}
      style={{ background: '#050a1e', fontFamily: '"Microsoft YaHei", sans-serif', userSelect: 'none' }}
    >
      {/* SVG clip-path definition for arc top */}
      <svg width="0" height="0" style={{ position: 'absolute', zIndex: -1 }}>
        <defs>
          <clipPath id="arcTopClip" clipPathUnits="objectBoundingBox">
            <path d="M 0,0 Q 0.5,0.24 1,0 L 1,1 L 0,1 Z" />
          </clipPath>
        </defs>
      </svg>

      {/* Layer 0: Cesium 3D Globe */}
      <div className="absolute inset-0 z-0">
        <Suspense
          fallback={
            <div className="w-full h-full flex items-center justify-center" style={{ background: '#050a1e' }}>
              <div style={{ color: '#52a8ff' }} className="animate-pulse text-sm">
                Loading Cesium 3D Globe...
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

      {/* Layer 1: HUD Overlay */}
      <HoloHUD />

      {/* Layer 2: Top Title */}
      <div
        className="absolute z-[99]"
        style={{
          top: '15px',
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: Math.max(16, Math.round(22 * scale)) + 'px',
          fontWeight: 'bold',
          color: '#ffffff',
          textShadow: '0 0 10px rgba(82, 168, 255, 0.5)',
          letterSpacing: '2px',
          whiteSpace: 'nowrap',
        }}
      >
        无人机指挥控制平台
      </div>

      {/* Layer 3: All 7 Floating Panels */}
      <div className="absolute inset-0 z-10 pointer-events-none">

        {/* Panel 1: Top-Left Drone Stats */}
        <div
          className="absolute pointer-events-auto"
          style={{ top: gap, left: gap, width: leftPanelWidth }}
        >
          <HoloPanel title="无人机态势" delay={0.1}>
            <HoloDroneStatsPanel drones={drones} />
          </HoloPanel>
        </div>

        {/* Panel 2: Left Control Console */}
        <div
          className="absolute pointer-events-auto"
          style={{
            top: consoleTop, left: gap, width: leftPanelWidth,
            bottom: consoleBottom, display: 'flex', flexDirection: 'column',
          }}
        >
          <HoloPanel title="管理控制台" delay={0.2} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <ConsolePanel consoleContent={consoleContent} />
          </HoloPanel>
        </div>

        {/* Panel 3: Bottom-Left Log */}
        <div
          className="absolute pointer-events-auto"
          style={{ left: gap, bottom: gap, width: leftPanelWidth, height: bottomHeight }}
        >
          <HoloPanel title="系统日志" delay={0.5}>
            <HoloLogPanel logs={logs} maxVisible={4} />
          </HoloPanel>
        </div>

        {/* Panel 4: Bottom Center Drone Control (arc clip-path) */}
        <div
          className="absolute pointer-events-auto"
          style={{
            bottom: gap, left: controlLeft, right: controlRight,
            height: bottomHeight, clipPath: 'url(#arcTopClip)',
          }}
        >
          <HoloPanel delay={0.4} animated={false} style={{ height: '100%' }}>
            <HoloDroneControlPanel
              drones={drones}
              selectedDroneId={selectedDroneId}
              selectedDroneIds={selectedDroneIds}
              onCommand={handleCommand}
            />
          </HoloPanel>
        </div>

        {/* Panel 5: Top-Right Radar */}
        <div
          className="absolute pointer-events-auto"
          style={{ top: gap, right: gap, width: rightPanelWidth }}
        >
          <HoloPanel title="区域无人机态势" delay={0.3}>
            <HoloChinaRadar drones={drones} size={radarSize} />
          </HoloPanel>
        </div>

        {/* Panel 6: Right Member Status */}
        <div
          className="absolute pointer-events-auto"
          style={{ top: memberTop, right: gap, width: rightPanelWidth, bottom: memberBottom }}
        >
          <HoloPanel title="成员在线状态" delay={0.35} style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <HoloMemberPanel members={members} />
          </HoloPanel>
        </div>

        {/* Panel 7: Bottom-Right Weather */}
        <div
          className="absolute pointer-events-auto"
          style={{ right: gap, bottom: gap, width: rightPanelWidth, height: bottomHeight }}
        >
          <HoloPanel title="实时气象" delay={0.45}>
            <HoloWeatherPanel weather={weather} />
          </HoloPanel>
        </div>

        {/* Exit Button */}
        {onClose && (
          <div
            className="absolute pointer-events-auto z-20"
            style={{ top: gap, right: gap + rightPanelWidth + gap }}
          >
            <button
              onClick={onClose}
              style={{
                padding: '4px 12px',
                background: 'rgba(10, 20, 50, 0.9)',
                border: '1px solid rgba(82, 168, 255, 0.4)',
                borderRadius: '4px',
                color: '#52a8ff',
                fontSize: '12px',
                cursor: 'pointer',
                backdropFilter: 'blur(6px)',
                transition: 'all 0.2s',
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

/** Console panel with tabs matching HTML prototype */
function ConsolePanel({ consoleContent }: { consoleContent?: ReactNode }) {
  const [activeTab, setActiveTab] = useState('all');

  const tabs = [
    { key: 'all', icon: '✈', label: '机队' },
    { key: 'permission', icon: '🔐', label: '权限' },
    { key: 'log', icon: '📋', label: '日志' },
    { key: 'team', icon: '👥', label: '团队' },
    { key: 'point', icon: '📍', label: '集结点' },
  ];

  const tabContent: Record<string, string[]> = {
    all: ['📋 机队管理', '🔐 权限管理', '📜 日志详情', '📍 集结点设置', '🛠 设备状态', '📶 通信监测', '⚙ 系统配置'],
    permission: ['🔐 权限管理', '👤 用户管理', '🎚 角色配置'],
    log: ['📜 日志详情', '📊 统计分析', '⚠ 异常记录'],
    team: ['👥 团队管理', '📋 成员列表', '📊 绩效统计'],
    point: ['📍 集结点设置', '🗺 区域划分', '🎯 航点管理'],
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'nowrap', justifyContent: 'space-between' }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              flex: 1,
              padding: '5px 0',
              background: activeTab === tab.key ? 'rgba(60, 120, 220, 0.4)' : 'rgba(20, 40, 80, 0.8)',
              border: `1px solid ${activeTab === tab.key ? '#52a8ff' : 'rgba(60, 120, 220, 0.4)'}`,
              borderRadius: '4px',
              fontSize: '12px',
              cursor: 'pointer',
              color: activeTab === tab.key ? '#fff' : '#c0d8ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              transition: 'all 0.2s',
            }}
          >
            <span>{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
        {consoleContent || (
          <div>
            {(tabContent[activeTab] || []).map((item, i) => (
              <div
                key={i}
                style={{
                  padding: '10px 12px',
                  marginBottom: '6px',
                  background: 'rgba(20, 40, 80, 0.6)',
                  borderRadius: '4px',
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  border: '1px solid transparent',
                  transition: 'all 0.2s',
                  color: '#c0d8ff',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLDivElement).style.background = 'rgba(60, 120, 220, 0.2)';
                  (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(82, 168, 255, 0.3)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLDivElement).style.background = 'rgba(20, 40, 80, 0.6)';
                  (e.currentTarget as HTMLDivElement).style.borderColor = 'transparent';
                }}
              >
                {item}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default HoloDashboard;
