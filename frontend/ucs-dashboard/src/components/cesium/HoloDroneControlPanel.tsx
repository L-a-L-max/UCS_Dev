/**
 * Holographic Drone Control Panel - Phase 6
 * Bottom center: left/right button layout with multi-select display
 * Left: takeoff, land, hover | Right: set home, return, goto
 * Center: multi-select info display + takeoff height setting
 */
import { useState } from 'react';
import type { MapDrone } from '../MapPanel';

interface HoloDroneControlPanelProps {
  drones: MapDrone[];
  selectedDroneId?: string | null;
  selectedDroneIds?: Set<string>;
  onCommand?: (command: string, uavIds?: string[], params?: string) => void;
}

export function HoloDroneControlPanel({
  drones, selectedDroneId, selectedDroneIds, onCommand,
}: HoloDroneControlPanelProps) {
  const selectedDrones = drones.filter(d => {
    if (selectedDroneIds && selectedDroneIds.size > 0) return selectedDroneIds.has(d.uavId);
    if (selectedDroneId) return d.uavId === selectedDroneId;
    return false;
  });

  const hasDrones = drones.length > 0;
  const hasSelection = selectedDrones.length > 0;
  const pool = hasSelection ? selectedDrones : drones;

  // Takeoff altitude state (user-configurable, default 5m)
  const [takeoffAlt, setTakeoffAlt] = useState('5');
  const [showAltInput, setShowAltInput] = useState(false);

  const handleCmd = (cmd: string) => {
    const ids = selectedDrones.map(d => d.uavId);
    if (cmd === 'TAKEOFF') {
      const alt = parseFloat(takeoffAlt) || 5;
      onCommand?.(cmd, ids.length > 0 ? ids : undefined, JSON.stringify({ altitude: alt }));
    } else {
      onCommand?.(cmd, ids.length > 0 ? ids : undefined);
    }
  };

  const flyingCount = pool.filter(d => d.armed).length;
  const onlineCount = pool.filter(d => d.onlineStatus).length;
  const offlineCount = pool.length - onlineCount;
  const maxAlt = pool.reduce((m, d) => Math.max(m, d.altitude ?? 0), 0);
  const minAlt = pool.filter(d => d.altitude != null).reduce((m, d) => Math.min(m, d.altitude ?? Infinity), Infinity);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', height: '100%' }}>
      {/* Left: Basic Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <ControlBtn label="起飞" icon="takeoff" onClick={() => handleCmd('TAKEOFF')} disabled={!hasDrones} />
          <button
            onClick={() => setShowAltInput(!showAltInput)}
            title="设置起飞高度"
            style={{
              width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: showAltInput ? '#52a8ff' : 'rgba(20, 40, 80, 0.8)',
              border: '1px solid #52a8ff', borderRadius: '4px',
              color: showAltInput ? '#050a1e' : '#52a8ff', fontSize: '12px', fontWeight: 700,
              cursor: 'pointer', transition: 'all 0.2s', padding: 0,
            }}
          >
            H
          </button>
        </div>
        {showAltInput && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            background: 'rgba(10, 20, 50, 0.9)', border: '1px solid #52a8ff',
            borderRadius: '4px', padding: '4px 6px',
          }}>
            <label style={{ fontSize: '10px', color: '#a0cfff', whiteSpace: 'nowrap' }}>高度</label>
            <input
              type="number"
              min="1"
              max="500"
              step="1"
              value={takeoffAlt}
              onChange={e => setTakeoffAlt(e.target.value)}
              style={{
                width: '48px', height: '22px', background: 'rgba(0,0,0,0.4)',
                border: '1px solid #3b82f6', borderRadius: '3px',
                color: '#fff', fontSize: '11px', textAlign: 'center',
                outline: 'none', padding: '0 2px',
              }}
            />
            <span style={{ fontSize: '10px', color: '#a0cfff' }}>m</span>
          </div>
        )}
        <ControlBtn label="降落" icon="land" onClick={() => handleCmd('LAND')} disabled={!hasDrones} />
        <ControlBtn label="悬停" icon="hover" onClick={() => handleCmd('HOVER')} disabled={!hasDrones} />
      </div>

      {/* Center: Drone info */}
      <div style={{ textAlign: 'center', flex: 1, padding: '0 16px' }}>
        {hasSelection ? (
          <>
            <div style={{ fontSize: '14px', color: '#52a8ff', marginBottom: '4px', fontWeight: 600 }}>
              已选中 {selectedDrones.length} 架无人机
            </div>
            {selectedDrones.length === 1 ? (
              <div style={{ fontSize: '11px', color: '#c0d8ff', lineHeight: 1.6 }}>
                <div>ID: <b style={{ color: '#fff' }}>{selectedDrones[0].uavId}</b></div>
                <div>操作员: {selectedDrones[0].owner || '未分配'}</div>
                <div>坐标: {selectedDrones[0].lat?.toFixed(4) ?? '--'}, {selectedDrones[0].lng?.toFixed(4) ?? '--'}</div>
                <div>高度: {selectedDrones[0].altitude?.toFixed(1) ?? '--'}m</div>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', fontSize: '11px', color: '#c0d8ff' }}>
                <span>飞行 <b style={{ color: '#00ff7f' }}>{flyingCount}</b></span>
                <span>在线 <b style={{ color: '#3b82f6' }}>{onlineCount - flyingCount}</b></span>
                <span>离线 <b style={{ color: '#64748b' }}>{offlineCount}</b></span>
                <span>高度 <b style={{ color: '#a0cfff' }}>
                  {minAlt === Infinity ? '0' : minAlt.toFixed(0)}-{maxAlt.toFixed(0)}m
                </b></span>
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ fontSize: '13px', color: '#a0cfff', marginBottom: '4px' }}>
              无人机集群 · {drones.length} 架
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>点击左侧机队列表选择无人机</div>
          </>
        )}
      </div>

      {/* Right: Navigation Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <ControlBtn label="标记Home" icon="home" onClick={() => handleCmd('SET_HOME')} disabled={!hasDrones} />
        <ControlBtn label="返航" icon="return" onClick={() => handleCmd('RETURN')} disabled={!hasDrones} />
        <ControlBtn label="前往" icon="goto" onClick={() => handleCmd('GOTO')} disabled={!hasDrones} />
      </div>
    </div>
  );
}

function ControlBtn({ label, icon, onClick, disabled, color }: {
  label: string; icon: string; onClick: () => void; disabled?: boolean; color?: string;
}) {
  const btnColor = color || '#52a8ff';
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        width: '88px', height: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
        background: 'rgba(20, 40, 80, 0.8)', border: `1px solid ${btnColor}`,
        borderRadius: '4px', color: '#fff', fontSize: '12px', fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer', transition: 'all 0.2s', opacity: disabled ? 0.3 : 1,
      }}
      onMouseEnter={e => { if (!disabled) { (e.currentTarget).style.background = btnColor; (e.currentTarget).style.color = '#050a1e'; } }}
      onMouseLeave={e => { (e.currentTarget).style.background = 'rgba(20, 40, 80, 0.8)'; (e.currentTarget).style.color = '#fff'; }}
    >
      <CmdIcon name={icon} />
      {label}
    </button>
  );
}

function CmdIcon({ name }: { name: string }) {
  const s = { width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'takeoff': return <svg {...s} viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>;
    case 'land': return <svg {...s} viewBox="0 0 24 24"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>;
    case 'return': return <svg {...s} viewBox="0 0 24 24"><path d="M3 12a9 9 0 109-9"/><polyline points="3 3 3 12 12 12"/></svg>;
    case 'hover': return <svg {...s} viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>;
    case 'home': return <svg {...s} viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
    case 'goto': return <svg {...s} viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>;
    default: return null;
  }
}

export default HoloDroneControlPanel;
