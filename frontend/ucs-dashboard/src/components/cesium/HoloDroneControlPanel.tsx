/**
 * Holographic Drone Control Panel - Phase 4
 * Bottom center: 3-column layout (left btns | center info | right btns)
 * With arc clip-path on top matching HTML prototype
 */
import type { MapDrone } from '../MapPanel';

interface HoloDroneControlPanelProps {
  drones: MapDrone[];
  selectedDroneId?: string | null;
  selectedDroneIds?: Set<string>;
  onCommand?: (command: string, uavIds?: string[]) => void;
}

export function HoloDroneControlPanel({
  drones,
  selectedDroneId,
  selectedDroneIds,
  onCommand,
}: HoloDroneControlPanelProps) {
  const selectedDrones = drones.filter(d => {
    if (selectedDroneIds && selectedDroneIds.size > 0) return selectedDroneIds.has(d.uavId);
    if (selectedDroneId) return d.uavId === selectedDroneId;
    return false;
  });

  const hasDrones = drones.length > 0;
  const hasSelection = selectedDrones.length > 0;

  const handleCmd = (cmd: string) => {
    const ids = selectedDrones.map(d => d.uavId);
    onCommand?.(cmd, ids.length > 0 ? ids : undefined);
  };

  const avgBattery = hasSelection
    ? Math.round(selectedDrones.reduce((s, d) => s + (d.battery ?? 0), 0) / selectedDrones.length)
    : drones.length > 0
    ? Math.round(drones.reduce((s, d) => s + (d.battery ?? 0), 0) / drones.length)
    : 0;

  const onlineCount = (hasSelection ? selectedDrones : drones).filter(d => d.onlineStatus).length;
  const flyingCount = (hasSelection ? selectedDrones : drones).filter(d => d.armed).length;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 20px' }}>
      {/* Left: Basic Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <ControlBtn label="🚀 起飞" onClick={() => handleCmd('takeoff')} disabled={!hasDrones} />
        <ControlBtn label="🛬 降落" onClick={() => handleCmd('land')} disabled={!hasDrones} />
        <ControlBtn label="↩ 返航" onClick={() => handleCmd('return')} disabled={!hasDrones} />
      </div>

      {/* Center: Drone info */}
      <div style={{ textAlign: 'center', flex: 1, padding: '0 20px' }}>
        <div style={{ fontSize: '16px', color: '#52a8ff', marginBottom: '8px' }}>
          {hasSelection ? `已选 ${selectedDrones.length} 架` : '无人机集群状态'}
        </div>
        <div style={{ fontSize: '13px', color: '#c0d8ff', lineHeight: 1.6 }}>
          在线：{onlineCount} 台 | 飞行中：{flyingCount} 台
        </div>
        <div style={{ fontSize: '13px', color: '#c0d8ff', lineHeight: 1.6 }}>
          高度：0-120m | 续航：平均 {avgBattery}%
        </div>
        <div style={{ fontSize: '13px', color: '#c0d8ff', lineHeight: 1.6 }}>
          模式：{hasSelection ? '手动控制' : '集群自主飞行'}
        </div>
      </div>

      {/* Right: Advanced Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <ControlBtn label="📍 标记 Home" onClick={() => handleCmd('markHome')} disabled={!hasDrones} />
        <ControlBtn label="🔄 盘旋模式" onClick={() => handleCmd('hover')} disabled={!hasDrones} />
        <ControlBtn label="🛰 高级设置" onClick={() => handleCmd('settings')} disabled={!hasDrones} />
      </div>
    </div>
  );
}

function ControlBtn({ label, onClick, disabled }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '90px',
        height: '36px',
        background: 'rgba(20, 40, 80, 0.8)',
        border: '1px solid #52a8ff',
        borderRadius: '4px',
        color: '#fff',
        fontSize: '13px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 0.2s',
        opacity: disabled ? 0.3 : 1,
      }}
      onMouseEnter={e => {
        if (!disabled) {
          (e.target as HTMLButtonElement).style.background = '#52a8ff';
          (e.target as HTMLButtonElement).style.color = '#050a1e';
        }
      }}
      onMouseLeave={e => {
        (e.target as HTMLButtonElement).style.background = 'rgba(20, 40, 80, 0.8)';
        (e.target as HTMLButtonElement).style.color = '#fff';
      }}
    >
      {label}
    </button>
  );
}

export default HoloDroneControlPanel;
