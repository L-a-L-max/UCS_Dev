/**
 * Holographic Drone Control Panel - Phase 6
 * Bottom center: left/right button layout with multi-select display
 * Left: takeoff, land, hover | Right: set home, return, goto
 * Center: multi-select info display
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

  const flyingCount = pool.filter(d => d.armed).length;
  const onlineCount = pool.filter(d => d.onlineStatus).length;
  const offlineCount = pool.length - onlineCount;
  const maxAlt = pool.reduce((m, d) => Math.max(m, d.altitude ?? 0), 0);
  const minAlt = pool.filter(d => d.altitude != null).reduce((m, d) => Math.min(m, d.altitude ?? Infinity), Infinity);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', height: '100%' }}>
      {/* Left: Basic Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <ControlBtn label="\u8d77\u98de" icon="takeoff" onClick={() => handleCmd('TAKEOFF')} disabled={!hasDrones} />
        <ControlBtn label="\u964d\u843d" icon="land" onClick={() => handleCmd('LAND')} disabled={!hasDrones} />
        <ControlBtn label="\u60ac\u505c" icon="hover" onClick={() => handleCmd('HOVER')} disabled={!hasDrones} />
      </div>

      {/* Center: Drone info */}
      <div style={{ textAlign: 'center', flex: 1, padding: '0 16px' }}>
        {hasSelection ? (
          <>
            <div style={{ fontSize: '14px', color: '#52a8ff', marginBottom: '4px', fontWeight: 600 }}>
              \u5df2\u9009\u4e2d {selectedDrones.length} \u67b6\u65e0\u4eba\u673a
            </div>
            {selectedDrones.length === 1 ? (
              <div style={{ fontSize: '11px', color: '#c0d8ff', lineHeight: 1.6 }}>
                <div>ID: <b style={{ color: '#fff' }}>{selectedDrones[0].uavId}</b></div>
                <div>\u64cd\u4f5c\u5458: {selectedDrones[0].owner || '\u672a\u5206\u914d'}</div>
                <div>\u5750\u6807: {selectedDrones[0].lat?.toFixed(4) ?? '--'}, {selectedDrones[0].lng?.toFixed(4) ?? '--'}</div>
                <div>\u9ad8\u5ea6: {selectedDrones[0].altitude?.toFixed(1) ?? '--'}m</div>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', fontSize: '11px', color: '#c0d8ff' }}>
                <span>\u98de\u884c <b style={{ color: '#00ff7f' }}>{flyingCount}</b></span>
                <span>\u5728\u7ebf <b style={{ color: '#3b82f6' }}>{onlineCount - flyingCount}</b></span>
                <span>\u79bb\u7ebf <b style={{ color: '#64748b' }}>{offlineCount}</b></span>
                <span>\u9ad8\u5ea6 <b style={{ color: '#a0cfff' }}>
                  {minAlt === Infinity ? '0' : minAlt.toFixed(0)}-{maxAlt.toFixed(0)}m
                </b></span>
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ fontSize: '13px', color: '#a0cfff', marginBottom: '4px' }}>
              \u65e0\u4eba\u673a\u96c6\u7fa4 \u00b7 {drones.length} \u67b6
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>\u70b9\u51fb\u5de6\u4fa7\u673a\u961f\u5217\u8868\u9009\u62e9\u65e0\u4eba\u673a</div>
          </>
        )}
      </div>

      {/* Right: Navigation Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <ControlBtn label="\u6807\u8bb0Home" icon="home" onClick={() => handleCmd('SET_HOME')} disabled={!hasDrones} />
        <ControlBtn label="\u8fd4\u822a" icon="return" onClick={() => handleCmd('RETURN')} disabled={!hasDrones} />
        <ControlBtn label="\u524d\u5f80" icon="goto" onClick={() => handleCmd('GOTO')} disabled={!hasDrones} />
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
