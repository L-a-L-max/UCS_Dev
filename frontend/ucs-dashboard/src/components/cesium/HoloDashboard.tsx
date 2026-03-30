/**
 * Holographic Dashboard - Phase 7 (React Dialog + Pure % Layout)
 * Issue 6: Pure percentage-based layout with CSS calc() - no pixel Math.max()
 * Issue 7: window.open() popups replaced with React Dialog components
 * Console panel: 4 tabs (removed team), rally points CRUD with dialog.
 * Multi-select support throughout.
 */
import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { lazy, Suspense } from 'react';
import type { MapDrone, MapRallyPoint } from '../MapPanel';
import { HoloPanel } from './HoloPanel';
import { HoloDroneStatsPanel } from './HoloDroneStatsPanel';
import { HoloLogPanel, type LogEntry } from './HoloLogPanel';
import { HoloDroneControlPanel } from './HoloDroneControlPanel';
import { HoloChinaRadar } from './HoloChinaRadar';
import { HoloMemberPanel, type HoloTeamMember } from './HoloMemberPanel';
import { HoloWeatherPanel, type HoloWeatherInfo } from './HoloWeatherPanel';
import { HoloHUD } from './HoloHUD';

const CesiumMapPanel = lazy(() => import('./CesiumMapPanel'));

export type { HoloTeamMember } from './HoloMemberPanel';
export type { HoloWeatherInfo } from './HoloWeatherPanel';

export interface HoloTeam {
  teamId: string;
  teamName: string;
  leader: string;
  memberCount: number;
  droneCount?: number;
  description?: string;
}

export interface HoloDashboardProps {
  drones: MapDrone[];
  selectedDroneId?: string | null;
  selectedDroneIds?: Set<string>;
  logs?: LogEntry[];
  members?: HoloTeamMember[];
  weather?: HoloWeatherInfo | null;
  teams?: HoloTeam[];
  teamMembers?: Record<string, Array<{ userId: string; username: string; realName: string; role: string }>>;
  rallyPoints?: MapRallyPoint[];
  registeredUsers?: Array<{ userId: number; username: string; realName: string; role: string }>;
  logPage?: number;
  logTotalPages?: number;
  logFilter?: string;
  logLoading?: boolean;
  onDroneClick?: (uavId: string) => void;
  onDroneToggleSelect?: (uavId: string) => void;
  onMapClick?: (lat: number, lon: number) => void;
  onMapClickCommand?: (command: string, lat: number, lng: number) => void;
  onCommand?: (command: string, uavIds?: string[]) => void;
  onTransferPermission?: (uavIds: string[], toUserId?: number, toTeamId?: number, mode?: 'user' | 'team') => void;
  onFetchLogs?: (page: number, filter: string) => void;
  onTeamExpand?: (teamId: string) => void;
  onTeamFilter?: (teamId: string) => void;
  onRallyPointCreate?: (data: Partial<MapRallyPoint>) => void;
  onRallyPointEdit?: (rp: MapRallyPoint, data: Partial<MapRallyPoint>) => void;
  onRallyPointDelete?: (id: number) => void;
  onWeatherLocationChange?: (lat: number, lng: number) => void;
  consoleContent?: ReactNode;
  onClose?: () => void;
  className?: string;
}

export function HoloDashboard({
  drones, selectedDroneId, selectedDroneIds,
  logs = [], members = [], weather, teams = [], teamMembers = {}, rallyPoints = [],
  registeredUsers = [],
  logPage = 0, logTotalPages = 0, logFilter = 'ALL', logLoading = false,
  onDroneClick, onDroneToggleSelect, onMapClick, onMapClickCommand, onCommand,
  onTransferPermission, onFetchLogs, onTeamExpand, onTeamFilter,
  onRallyPointCreate, onRallyPointEdit, onRallyPointDelete,
  onWeatherLocationChange, consoleContent, onClose, className = '',
}: HoloDashboardProps) {
  // ===== Percentage-based layout constants =====
  // All dimensions use viewport percentages for responsive adaptation across different screen sizes.
  // Outer margin from browser edge: fixed 3px
  // Left/right side panels: 25% width each (adjustable)
  // Bottom panels: ~28% height
  // Panels between gaps: 3px
  const EDGE = '3px';       // outer margin from browser edge
  const GAP = '3px';        // gap between panels
  const SIDE_W = '25%';     // left & right side panel width
  const TITLE_H = '3.5%';   // title bar height (~3.5vh)
  const BOTTOM_H = '28%';   // bottom row height
  // Left column: top panel (stats) ~12% height, bottom panel (log) = BOTTOM_H, middle = rest
  const STAT_H = '12%';     // drone stats panel height
  // Right column: top panel (radar) ~28% height, bottom panel (weather) = BOTTOM_H, middle = rest
  const RADAR_H = '28%';

  const handleCommand = useCallback((cmd: string, uavIds?: string[]) => { onCommand?.(cmd, uavIds); }, [onCommand]);

  return (
    <div className={`fixed inset-0 z-50 overflow-hidden ${className}`}
      style={{ background: '#050a1e', fontFamily: '"Microsoft YaHei", sans-serif', userSelect: 'none' }}>
      {/* Cesium 3D Globe - full viewport background */}
      <div className="absolute inset-0 z-0">
        <Suspense fallback={<div className="w-full h-full flex items-center justify-center" style={{ background: '#050a1e' }}><div style={{ color: '#52a8ff' }} className="animate-pulse text-sm">Loading Cesium 3D Globe...</div></div>}>
          <CesiumMapPanel drones={drones} selectedDroneId={selectedDroneId} selectedDroneIds={selectedDroneIds}
            onDroneClick={onDroneClick} onMapClick={onMapClick} onMapClickCommand={onMapClickCommand} disableAutoFocus={true} />
        </Suspense>
      </div>
      <HoloHUD />
      {/* Title */}
      <div className="absolute z-[99]" style={{ top: '10px', left: '50%', transform: 'translateX(-50%)',
        fontSize: '22px', fontWeight: 'bold', color: '#ffffff',
        textShadow: '0 0 10px rgba(82, 168, 255, 0.5)', letterSpacing: '2px', whiteSpace: 'nowrap' }}>
        无人机指挥控制平台
      </div>
      {/* Panel overlay layer */}
      <div className="absolute inset-0 z-10 pointer-events-none">

        {/* ===== LEFT COLUMN (25% width) ===== */}
        {/* Left top: Drone Stats */}
        <div className="absolute pointer-events-auto" style={{
          top: `calc(${TITLE_H} + ${GAP})`, left: EDGE, width: SIDE_W, height: STAT_H,
        }}>
          <HoloPanel title="无人机态势" delay={0.1} style={{ height: '100%', overflow: 'hidden' }}>
            <HoloDroneStatsPanel drones={drones} />
          </HoloPanel>
        </div>
        {/* Left middle: Console (fills between stats and log) */}
        <div className="absolute pointer-events-auto" style={{
          top: `calc(${TITLE_H} + ${GAP} + ${STAT_H} + ${GAP})`, left: EDGE, width: SIDE_W,
          bottom: `calc(${EDGE} + ${BOTTOM_H} + ${GAP})`,
          display: 'flex', flexDirection: 'column',
        }}>
          <HoloPanel title="管理控制台" delay={0.2} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <ConsolePanel drones={drones} selectedDroneId={selectedDroneId} selectedDroneIds={selectedDroneIds}
              onDroneClick={onDroneClick} onDroneToggleSelect={onDroneToggleSelect}
              teams={teams} registeredUsers={registeredUsers} rallyPoints={rallyPoints}
              logs={logs} logPage={logPage} logTotalPages={logTotalPages} logFilter={logFilter} logLoading={logLoading}
              onTransferPermission={onTransferPermission} onFetchLogs={onFetchLogs}
              onRallyPointCreate={onRallyPointCreate} onRallyPointEdit={onRallyPointEdit} onRallyPointDelete={onRallyPointDelete}
              consoleContent={consoleContent} />
          </HoloPanel>
        </div>
        {/* Left bottom: System Logs */}
        <div className="absolute pointer-events-auto" style={{
          left: EDGE, bottom: EDGE, width: SIDE_W, height: BOTTOM_H,
        }}>
          <HoloPanel title="系统日志" delay={0.5} style={{ height: '100%', overflow: 'hidden' }}>
            <HoloLogPanel logs={logs} maxVisible={3} />
          </HoloPanel>
        </div>

        {/* ===== BOTTOM CENTER: Drone Control ===== */}
        <div className="absolute pointer-events-auto" style={{
          bottom: EDGE,
          left: `calc(${EDGE} + ${SIDE_W} + ${GAP})`,
          right: `calc(${EDGE} + ${SIDE_W} + ${GAP})`,
          height: BOTTOM_H,
        }}>
          <HoloPanel delay={0.4} animated={false} style={{ height: '100%' }}>
            <HoloDroneControlPanel drones={drones} selectedDroneId={selectedDroneId} selectedDroneIds={selectedDroneIds} onCommand={handleCommand} />
          </HoloPanel>
        </div>

        {/* ===== RIGHT COLUMN (25% width) ===== */}
        {/* Right top: Radar */}
        <div className="absolute pointer-events-auto" style={{
          top: `calc(${TITLE_H} + ${GAP})`, right: EDGE, width: SIDE_W, height: RADAR_H,
        }}>
          <HoloPanel title="区域无人机态势" delay={0.3} style={{ height: '100%', overflow: 'hidden' }}>
            <HoloChinaRadar drones={drones} size={150} />
          </HoloPanel>
        </div>
        {/* Right middle: Member Status (fills between radar and weather) */}
        <div className="absolute pointer-events-auto" style={{
          top: `calc(${TITLE_H} + ${GAP} + ${RADAR_H} + ${GAP})`, right: EDGE, width: SIDE_W,
          bottom: `calc(${EDGE} + ${BOTTOM_H} + ${GAP})`,
          display: 'flex', flexDirection: 'column',
        }}>
          <HoloPanel title="成员在线状态" delay={0.35} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <HoloMemberPanel members={members} teams={teams} teamMembers={teamMembers} onTeamFilter={onTeamFilter} />
          </HoloPanel>
        </div>
        {/* Right bottom: Weather */}
        <div className="absolute pointer-events-auto" style={{
          right: EDGE, bottom: EDGE, width: SIDE_W, height: BOTTOM_H,
        }}>
          <HoloPanel title="实时气象" delay={0.45} style={{ height: '100%', overflow: 'hidden' }}>
            <HoloWeatherPanel weather={weather} drones={drones} selectedDroneId={selectedDroneId} selectedDroneIds={selectedDroneIds} onLocationChange={onWeatherLocationChange} />
          </HoloPanel>
        </div>

        {/* Exit button */}
        {onClose && (
          <div className="absolute pointer-events-auto z-20" style={{ top: GAP, right: `calc(${EDGE} + ${SIDE_W} + ${GAP})` }}>
            <button onClick={onClose} style={{ padding: '4px 12px', background: 'rgba(10, 20, 50, 0.9)',
              border: '1px solid rgba(82, 168, 255, 0.4)', borderRadius: '4px', color: '#52a8ff', fontSize: '12px',
              cursor: 'pointer', backdropFilter: 'blur(6px)', transition: 'all 0.2s' }}>
              退出全息模式
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Console Panel with 4 real functional tabs (removed team tab) =====
interface ConsolePanelProps {
  drones: MapDrone[];
  selectedDroneId?: string | null;
  selectedDroneIds?: Set<string>;
  onDroneClick?: (uavId: string) => void;
  onDroneToggleSelect?: (uavId: string) => void;
  teams: HoloTeam[];
  registeredUsers: Array<{ userId: number; username: string; realName: string; role: string }>;
  rallyPoints: MapRallyPoint[];
  logs: LogEntry[];
  logPage: number;
  logTotalPages: number;
  logFilter: string;
  logLoading: boolean;
  onTransferPermission?: (uavIds: string[], toUserId?: number, toTeamId?: number, mode?: 'user' | 'team') => void;
  onFetchLogs?: (page: number, filter: string) => void;
  onRallyPointCreate?: (data: Partial<MapRallyPoint>) => void;
  onRallyPointEdit?: (rp: MapRallyPoint, data: Partial<MapRallyPoint>) => void;
  onRallyPointDelete?: (id: number) => void;
  consoleContent?: ReactNode;
}

const TAB_ACTIVE = { background: 'rgba(60, 120, 220, 0.4)', border: '1px solid #52a8ff', color: '#fff' };
const TAB_INACTIVE = { background: 'rgba(20, 40, 80, 0.8)', border: '1px solid rgba(60, 120, 220, 0.4)', color: '#c0d8ff' };

// ===== Permission Transfer Dialog (React component, replaces window.open) =====
function PermissionTransferDialog({
  open, onOpenChange, drones, teams, registeredUsers, onTransferPermission,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drones: MapDrone[];
  teams: HoloTeam[];
  registeredUsers: Array<{ userId: number; username: string; realName: string; role: string }>;
  onTransferPermission?: (uavIds: string[], toUserId?: number, toTeamId?: number, mode?: 'user' | 'team') => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'team' | 'user'>('team');
  const [targetId, setTargetId] = useState('');

  const toggleDrone = (uavId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(uavId)) next.delete(uavId); else next.add(uavId);
      return next;
    });
  };

  const canSubmit = selectedIds.size > 0 && targetId !== '';

  const handleSubmit = () => {
    if (!canSubmit) return;
    const id = parseInt(targetId);
    if (isNaN(id)) return;
    onTransferPermission?.(
      Array.from(selectedIds),
      mode === 'user' ? id : undefined,
      mode === 'team' ? id : undefined,
      mode,
    );
    onOpenChange(false);
    setSelectedIds(new Set());
    setTargetId('');
  };

  if (!open) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}>
      <div style={{ background: DIALOG_BG, border: `1px solid ${DIALOG_BORDER}`, borderRadius: '10px', padding: '24px', width: '480px', maxHeight: '80vh', overflowY: 'auto',
        color: '#c0d8ff', fontFamily: "'Microsoft YaHei', sans-serif", boxShadow: '0 0 30px rgba(82,168,255,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ color: '#52a8ff', fontSize: '18px', margin: 0 }}>无人机权限转移</h2>
          <button onClick={() => onOpenChange(false)} style={{ background: 'none', border: 'none', color: '#a0cfff', fontSize: '20px', cursor: 'pointer', padding: '0 4px' }}>&times;</button>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', color: '#a0cfff', marginBottom: '8px' }}>选择需要转移的无人机（可多选）:</div>
          <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid rgba(60,120,220,0.4)', borderRadius: '6px', padding: '8px', background: 'rgba(20,40,80,0.5)' }}>
            {drones.map(d => {
              const checked = selectedIds.has(d.uavId);
              return (
                <div key={d.uavId} onClick={() => toggleDrone(d.uavId)}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                    background: checked ? 'rgba(82,168,255,0.2)' : 'transparent' }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleDrone(d.uavId)}
                    onClick={e => e.stopPropagation()} style={{ accentColor: '#52a8ff', width: '16px', height: '16px', cursor: 'pointer' }} />
                  <span>{d.uavId}</span>
                  <span style={{ fontSize: '11px', opacity: 0.7, marginLeft: 'auto' }}>
                    {d.onlineStatus ? (d.armed ? '飞行中' : '在线') : '离线'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', color: '#a0cfff', marginBottom: '8px' }}>转移目标:</div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            {(['team', 'user'] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setTargetId(''); }}
                style={{ flex: 1, padding: '8px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s',
                  border: mode === m ? '1px solid #52a8ff' : '1px solid rgba(60,120,220,0.4)',
                  background: mode === m ? 'rgba(60,120,220,0.4)' : 'rgba(20,40,80,0.8)',
                  color: mode === m ? '#fff' : '#c0d8ff' }}>
                {m === 'team' ? '转给团队' : '转给用户'}
              </button>
            ))}
          </div>
          <select value={targetId} onChange={e => setTargetId(e.target.value)}
            style={{ ...INPUT_STYLE, marginBottom: '12px' }}>
            <option value="">{mode === 'team' ? '选择目标团队...' : '选择目标用户...'}</option>
            {mode === 'team'
              ? teams.map(t => <option key={t.teamId} value={t.teamId}>{t.teamName} ({t.leader})</option>)
              : registeredUsers.filter(u => u.role !== 'OBSERVER').map(u => <option key={u.userId} value={u.userId}>{(u.realName || u.username)} ({u.role})</option>)
            }
          </select>
        </div>

        <button onClick={handleSubmit} disabled={!canSubmit}
          style={{ width: '100%', padding: '10px', borderRadius: '6px', fontSize: '14px', fontWeight: 600,
            border: '1px solid #52a8ff', color: '#fff', cursor: canSubmit ? 'pointer' : 'not-allowed', transition: 'all 0.2s',
            background: canSubmit ? '#52a8ff' : 'rgba(82,168,255,0.2)', opacity: canSubmit ? 1 : 0.5 }}>
          确认转移 ({selectedIds.size} 架)
        </button>
      </div>
    </div>
  );
}

// ===== Rally Point Dialog (React component, replaces window.open) =====
function RallyPointDialog({
  open, onOpenChange, editRp, onRallyPointCreate, onRallyPointEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editRp?: MapRallyPoint | null;
  onRallyPointCreate?: (data: Partial<MapRallyPoint>) => void;
  onRallyPointEdit?: (rp: MapRallyPoint, data: Partial<MapRallyPoint>) => void;
}) {
  const isEdit = !!editRp;
  const [name, setName] = useState(editRp?.name || '');
  const [lat, setLat] = useState(editRp?.latitude?.toString() || '');
  const [lng, setLng] = useState(editRp?.longitude?.toString() || '');
  const [capacity, setCapacity] = useState(editRp?.capacity?.toString() || '10');
  const [status, setStatus] = useState(editRp?.status?.toString() || '1');
  const [serviceType, setServiceType] = useState(editRp?.serviceType?.toString() || '0');

  // Reset form when editRp changes
  useEffect(() => {
    if (open) {
      setName(editRp?.name || '');
      setLat(editRp?.latitude?.toString() || '');
      setLng(editRp?.longitude?.toString() || '');
      setCapacity(editRp?.capacity?.toString() || '10');
      setStatus(editRp?.status?.toString() || '1');
      setServiceType(editRp?.serviceType?.toString() || '0');
    }
  }, [open, editRp]);

  const handleSubmit = () => {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    const capNum = parseInt(capacity);
    if (!name || isNaN(latNum) || isNaN(lngNum) || isNaN(capNum)) {
      alert('请填写所有必填字段');
      return;
    }
    const data = { name, latitude: latNum, longitude: lngNum, capacity: capNum, status: parseInt(status), serviceType: parseInt(serviceType), currentOccupancy: 0 };
    if (isEdit && editRp) {
      onRallyPointEdit?.(editRp, data);
    } else {
      onRallyPointCreate?.(data);
    }
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}>
      <div style={{ background: DIALOG_BG, border: `1px solid ${DIALOG_BORDER}`, borderRadius: '10px', padding: '24px', width: '440px', maxHeight: '80vh', overflowY: 'auto',
        color: '#c0d8ff', fontFamily: "'Microsoft YaHei', sans-serif", boxShadow: '0 0 30px rgba(82,168,255,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ color: '#52a8ff', fontSize: '18px', margin: 0 }}>{isEdit ? '编辑集结点' : '新增集结点'}</h2>
          <button onClick={() => onOpenChange(false)} style={{ background: 'none', border: 'none', color: '#a0cfff', fontSize: '20px', cursor: 'pointer', padding: '0 4px' }}>&times;</button>
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={LABEL_STYLE}>名称 *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="集结点名称" style={INPUT_STYLE} />
        </div>
        <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
          <div style={{ flex: 1 }}>
            <label style={LABEL_STYLE}>纬度 *</label>
            <input type="number" step="0.0001" value={lat} onChange={e => setLat(e.target.value)} placeholder="39.9042" style={INPUT_STYLE} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={LABEL_STYLE}>经度 *</label>
            <input type="number" step="0.0001" value={lng} onChange={e => setLng(e.target.value)} placeholder="116.4074" style={INPUT_STYLE} />
          </div>
        </div>
        <div style={{ marginBottom: '14px' }}>
          <label style={LABEL_STYLE}>容量</label>
          <input type="number" value={capacity} onChange={e => setCapacity(e.target.value)} style={INPUT_STYLE} />
        </div>
        <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
          <div style={{ flex: 1 }}>
            <label style={LABEL_STYLE}>状态</label>
            <select value={status} onChange={e => setStatus(e.target.value)} style={INPUT_STYLE}>
              <option value="0">禁用</option><option value="1">启用</option><option value="2">维护中</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={LABEL_STYLE}>服务类型</label>
            <select value={serviceType} onChange={e => setServiceType(e.target.value)} style={INPUT_STYLE}>
              <option value="0">停机</option><option value="1">充电</option><option value="2">维修</option><option value="3">补给</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button onClick={() => onOpenChange(false)}
            style={{ padding: '8px 20px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer',
              background: 'rgba(20,40,80,0.8)', border: '1px solid rgba(60,120,220,0.4)', color: '#a0cfff' }}>
            取消
          </button>
          <button onClick={handleSubmit}
            style={{ padding: '8px 20px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', fontWeight: 600,
              background: '#52a8ff', border: '1px solid #52a8ff', color: '#fff' }}>
            {isEdit ? '保存' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConsolePanel({
  drones, selectedDroneId, selectedDroneIds, onDroneClick, onDroneToggleSelect,
  teams, registeredUsers, rallyPoints,
  logs, logPage, logTotalPages, logFilter, logLoading,
  onTransferPermission, onFetchLogs,
  onRallyPointCreate, onRallyPointEdit, onRallyPointDelete, consoleContent,
}: ConsolePanelProps) {
  const [activeTab, setActiveTab] = useState('fleet');
  const [localLogFilter, setLocalLogFilter] = useState(logFilter);

  // Issue 7: React Dialog state (replaces window.open popups)
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [showRallyDialog, setShowRallyDialog] = useState(false);
  const [editingRallyPoint, setEditingRallyPoint] = useState<MapRallyPoint | null>(null);

  const tabs = [
    { key: 'fleet', label: '机队' }, { key: 'permission', label: '权限' },
    { key: 'log', label: '日志' }, { key: 'point', label: '集结点' },
  ];

  const SERVICE_LABELS: Record<number, string> = { 0: '停机', 1: '充电', 2: '维修', 3: '补给' };
  const STATUS_LABELS: Record<number, string> = { 0: '禁用', 1: '启用', 2: '维护中' };
  const STATUS_COLORS: Record<number, string> = { 0: '#64748b', 1: '#00ff7f', 2: '#ffd700' };

  const openRpDialog = useCallback((rp?: MapRallyPoint) => {
    setEditingRallyPoint(rp || null);
    setShowRallyDialog(true);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', flexWrap: 'nowrap', justifyContent: 'space-between' }}>
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => { setActiveTab(tab.key); if (tab.key === 'log') onFetchLogs?.(0, localLogFilter); }}
            style={{ flex: 1, padding: '4px 0', borderRadius: '4px', fontSize: '11px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
              ...(activeTab === tab.key ? TAB_ACTIVE : TAB_INACTIVE) }}>
            {tab.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', paddingRight: '2px' }}>
        {consoleContent ? consoleContent : (<>
          {activeTab === 'fleet' && (<div>
            {drones.length === 0 ? <div style={{ textAlign: 'center', color: '#a0cfff', fontSize: '12px', padding: '20px 0' }}>暂无无人机数据</div>
            : drones.map(drone => {
              const isSingleSel = drone.uavId === selectedDroneId;
              const isMultiSel = selectedDroneIds ? selectedDroneIds.has(drone.uavId) : false;
              const isSel = isSingleSel || isMultiSel;
              const isOn = drone.onlineStatus === true;
              const isArm = drone.armed === true;
              const sc = !isOn ? '#64748b' : isArm ? '#00ff7f' : '#3b82f6';
              const st = !isOn ? '离线' : isArm ? '飞行中' : '已解锁';
              return (<div key={drone.uavId} style={{
                padding: '8px 10px', marginBottom: '4px', borderRadius: '4px', cursor: 'pointer',
                background: isSel ? 'rgba(82,168,255,0.2)' : 'rgba(20,40,80,0.5)',
                border: '1px solid ' + (isSel ? '#52a8ff' : 'rgba(60,120,220,0.2)'), transition: 'all 0.15s',
                display: 'flex', alignItems: 'flex-start', gap: '8px',
              }}>
                <input type="checkbox" checked={isMultiSel}
                  onChange={() => { onDroneToggleSelect?.(drone.uavId); }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ accentColor: '#52a8ff', marginTop: '3px', cursor: 'pointer', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }} onClick={() => onDroneClick?.(drone.uavId)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ color: '#fff', fontSize: '12px', fontWeight: 600 }}>{drone.uavId}</span>
                    <span style={{ padding: '1px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 500,
                      background: sc + '33', color: sc, border: '1px solid ' + sc + '66' }}>{st}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#a0cfff' }}>
                    {drone.battery != null && <span>电量 {drone.battery.toFixed(0)}%</span>}
                    {drone.altitude != null && <span>高度 {drone.altitude.toFixed(1)}m</span>}
                    {drone.owner && <span>操作: {drone.owner}</span>}
                  </div>
                </div>
              </div>);
            })}
          </div>)}

          {activeTab === 'permission' && (<div>
            <div style={{ fontSize: '11px', color: '#a0cfff', marginBottom: '8px' }}>点击下方按钮进行权限转移操作:</div>
            <button onClick={() => setShowTransferDialog(true)}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600,
                background: '#52a8ff', border: '1px solid #52a8ff', color: '#fff', cursor: 'pointer', transition: 'all 0.2s' }}>
              权限转移
            </button>
            <div style={{ fontSize: '10px', color: '#64748b', marginTop: '6px', textAlign: 'center' }}>在弹窗中选择无人机和转移目标</div>
            <PermissionTransferDialog open={showTransferDialog} onOpenChange={setShowTransferDialog}
              drones={drones} teams={teams} registeredUsers={registeredUsers} onTransferPermission={onTransferPermission} />
          </div>)}

          {activeTab === 'log' && (<div>
            <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', flexWrap: 'wrap' }}>
              {['ALL', 'CONTROL_COMMAND', 'PERMISSION_TRANSFER', 'BATCH_CONTROL'].map(f => (
                <button key={f} onClick={() => {
                  setLocalLogFilter(f);
                  try { onFetchLogs?.(0, f); } catch { /* prevent crash */ }
                }}
                  style={{ padding: '2px 6px', borderRadius: '3px', fontSize: '10px', cursor: 'pointer',
                    ...(localLogFilter === f ? TAB_ACTIVE : TAB_INACTIVE) }}>
                  {f === 'ALL' ? '全部' : f === 'CONTROL_COMMAND' ? '控制' : f === 'PERMISSION_TRANSFER' ? '权限' : '批量'}
                </button>))}
            </div>
            {logLoading ? <div style={{ textAlign: 'center', color: '#52a8ff', fontSize: '11px', padding: '12px' }}>加载中...</div>
            : logs.length === 0 ? <div style={{ textAlign: 'center', color: '#a0cfff', fontSize: '11px', padding: '12px' }}>暂无日志</div>
            : logs.map(log => (<div key={log.id} style={{ padding: '6px 8px', marginBottom: '3px', borderRadius: '3px', fontSize: '11px',
              background: 'rgba(20,40,80,0.5)', borderLeft: '2px solid ' + (log.level === 'error' ? '#ff4d4f' : log.level === 'success' ? '#00ff7f' : '#52a8ff') }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                <span style={{ color: '#52a8ff', fontSize: '10px' }}>{log.time}</span>
                {log.result && (<span style={{ padding: '0 4px', borderRadius: '2px', fontSize: '9px',
                  background: log.result === 'SUCCESS' ? 'rgba(0,255,127,0.2)' : 'rgba(255,77,79,0.2)',
                  color: log.result === 'SUCCESS' ? '#00ff7f' : '#ff4d4f' }}>
                  {log.result === 'SUCCESS' ? '成功' : '失败'}</span>)}
              </div>
              <div style={{ color: '#c0d8ff' }}>{log.detail || log.message}</div>
              {log.operatorName && <div style={{ fontSize: '10px', color: '#a0cfff', marginTop: '2px' }}>操作员: {log.operatorName}</div>}
            </div>))}
            {logTotalPages > 1 && (<div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '8px', alignItems: 'center' }}>
              <button onClick={() => onFetchLogs?.(Math.max(0, logPage - 1), localLogFilter)} disabled={logPage === 0}
                style={{ padding: '2px 8px', fontSize: '10px', borderRadius: '3px', cursor: logPage > 0 ? 'pointer' : 'not-allowed', ...TAB_INACTIVE, opacity: logPage > 0 ? 1 : 0.5 }}>上一页</button>
              <span style={{ fontSize: '10px', color: '#a0cfff' }}>{logPage + 1} / {logTotalPages}</span>
              <button onClick={() => onFetchLogs?.(Math.min(logTotalPages - 1, logPage + 1), localLogFilter)} disabled={logPage >= logTotalPages - 1}
                style={{ padding: '2px 8px', fontSize: '10px', borderRadius: '3px', cursor: logPage < logTotalPages - 1 ? 'pointer' : 'not-allowed', ...TAB_INACTIVE, opacity: logPage < logTotalPages - 1 ? 1 : 0.5 }}>下一页</button>
            </div>)}
          </div>)}

          {activeTab === 'point' && (<div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', color: '#a0cfff' }}>集结点列表</span>
              <button onClick={() => openRpDialog()} style={{ padding: '2px 8px', borderRadius: '3px', fontSize: '10px', cursor: 'pointer',
                background: 'rgba(82,168,255,0.2)', border: '1px solid rgba(82,168,255,0.4)', color: '#52a8ff' }}>+ 新增</button>
            </div>
            {rallyPoints.length === 0 ? <div style={{ textAlign: 'center', color: '#a0cfff', fontSize: '12px', padding: '20px 0' }}>暂无集结点</div>
            : rallyPoints.map(rp => (<div key={rp.id} style={{ padding: '8px 10px', marginBottom: '4px', borderRadius: '4px',
              background: 'rgba(20,40,80,0.5)', border: '1px solid rgba(60,120,220,0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ color: '#fff', fontSize: '12px', fontWeight: 600 }}>{rp.name}</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <span style={{ padding: '1px 4px', borderRadius: '2px', fontSize: '9px',
                    background: (STATUS_COLORS[rp.status] || '#64748b') + '33', color: STATUS_COLORS[rp.status] || '#64748b' }}>{STATUS_LABELS[rp.status] || '未知'}</span>
                  <span style={{ padding: '1px 4px', borderRadius: '2px', fontSize: '9px', background: 'rgba(82,168,255,0.15)', color: '#a0cfff' }}>
                    {SERVICE_LABELS[rp.serviceType] || '未知'}</span>
                </div>
              </div>
              <div style={{ fontSize: '10px', color: '#a0cfff', marginBottom: '4px' }}>
                容量: {rp.currentOccupancy}/{rp.capacity} | 坐标: {rp.latitude.toFixed(4)}, {rp.longitude.toFixed(4)}
              </div>
              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                <button onClick={() => openRpDialog(rp)} style={{ padding: '1px 6px', borderRadius: '2px', fontSize: '9px', cursor: 'pointer',
                  background: 'rgba(82,168,255,0.15)', border: '1px solid rgba(82,168,255,0.3)', color: '#52a8ff' }}>编辑</button>
                <button onClick={() => onRallyPointDelete?.(rp.id)} style={{ padding: '1px 6px', borderRadius: '2px', fontSize: '9px', cursor: 'pointer',
                  background: 'rgba(255,77,79,0.15)', border: '1px solid rgba(255,77,79,0.3)', color: '#ff4d4f' }}>删除</button>
              </div>
            </div>))}
          </div>)}
        </>)}
      </div>
      <RallyPointDialog open={showRallyDialog} onOpenChange={setShowRallyDialog}
        editRp={editingRallyPoint} onRallyPointCreate={onRallyPointCreate} onRallyPointEdit={onRallyPointEdit} />
    </div>
  );
}

export default HoloDashboard;
