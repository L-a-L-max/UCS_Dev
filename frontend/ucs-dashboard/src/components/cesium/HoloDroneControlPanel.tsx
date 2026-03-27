/**
 * Holographic Drone Control Panel - Phase 5
 * Bottom center: 3-column layout with real API commands
 * No emoji - uses SVG icons and clean text labels
 */
import type { MapDrone } from '../MapPanel';

interface HoloDroneControlPanelProps {
  drones: MapDrone[];
  selectedDroneId?: string | null;
  selectedDroneIds?: Set<string>;
  onCommand?: (command: string, uavIds?: string[]) => void;
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

  const handleCmd = (cmd: string) => {
    const ids = selectedDrones.map(d => d.uavId);
    onCommand?.(cmd, ids.length > 0 ? ids : undefined);
  };

  const avgBattery = pool.length > 0
    ? Math.round(pool.reduce((s, d) => s + (d.battery ?? 0), 0) / pool.length) : 0;
  const onlineCount = pool.filter(d => d.onlineStatus).length;
  const flyingCount = pool.filter(d => d.armed).length;
  const maxAlt = pool.reduce((m, d) => Math.max(m, d.altitude ?? 0), 0);
  const minAlt = pool.filter(d => d.altitude != null).reduce((m, d) => Math.min(m, d.altitude ?? Infinity), Infinity);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 20px', height: '100%' }}>
      {/* Left: Basic Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <ControlBtn label="起飞" icon="takeoff" onClick={() => handleCmd('TAKEOFF')} disabled={!hasDrones} />
        <ControlBtn label="降落" icon="land" onClick={() => handleCmd('LAND')} disabled={!hasDrones} />
        <ControlBtn label="返航" icon="return" onClick={() => handleCmd('RETURN')} disabled={!hasDrones} />
      </div>

      {/* Center: Drone info */}
      <div style={{ textAlign: 'center', flex: 1, padding: '0 20px' }}>
        <div style={{ fontSize: '15px', color: '#52a8ff', marginBottom: '6px', fontWeight: 600 }}>
          {hasSelection ? `已选 ${selectedDrones.length} 架 · ${selectedDrones.map(d => d.uavId).join(', ')}` : `无人机集群 · ${drones.length} 架`}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', fontSize: '12px', color: '#c0d8ff' }}>
          <span>在线 <b style={{ color: '#00ff7f' }}>{onlineCount}</b></span>
          <span>飞行 <b style={{ color: '#52a8ff' }}>{flyingCount}</b></span>
          <span>电量 <b style={{ color: avgBattery < 20 ? '#ff4d4f' : '#a0cfff' }}>{avgBattery}%</b></span>
          <span>高度 <b style={{ color: '#a0cfff' }}>
            {minAlt === Infinity ? '0' : minAlt.toFixed(0)}-{maxAlt.toFixed(0)}m
          </b></span>
        </div>
        <div style={{ fontSize: '11px', color: '#a0cfff', marginTop: '4px' }}>
          模式: {hasSelection ? '手动控制' : '集群自主'}
        </div>
      </div>

      {/* Right: Advanced Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <ControlBtn label="悬停" icon="hover" onClick={() => handleCmd('HOVER')} disabled={!hasDrones} />
        <ControlBtn label="解锁" icon="arm" onClick={() => handleCmd('ARM')} disabled={!hasDrones} />
        <ControlBtn label="锁定" icon="disarm" onClick={() => handleCmd('DISARM')} disabled={!hasDrones} color="#ff4d4f" />
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
    case 'arm': return <svg {...s} viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
    case 'disarm': return <svg {...s} viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>;
    default: return null;
  }
}

export default HoloDroneControlPanel;
