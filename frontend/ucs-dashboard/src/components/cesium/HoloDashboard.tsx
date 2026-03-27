/**
 * Holographic Dashboard - Phase 6 (Bug Fixes & Full Functionality)
 * Fixed panel positioning: no overlaps, fixed sizes.
 * Console panel: 4 tabs (removed team), rally points CRUD with dialog.
 * Multi-select support throughout.
 */
import { useState, useCallback, type ReactNode } from 'react';
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
  onTransferPermission, onFetchLogs, onTeamExpand,
  onRallyPointCreate, onRallyPointEdit, onRallyPointDelete,
  onWeatherLocationChange, consoleContent, onClose, className = '',
}: HoloDashboardProps) {
  const LEFT_W = 320;
  const RIGHT_W = 310;
  const GAP = 12;
  const STAT_H = 90;
  const LOG_H = 140;
  const WEATHER_H = 180;
  const RADAR_H = 220;
  const CONTROL_H = 160;
  const TITLE_H = 40;

  const handleCommand = useCallback((cmd: string, uavIds?: string[]) => { onCommand?.(cmd, uavIds); }, [onCommand]);

  return (
    <div className={`fixed inset-0 z-50 overflow-hidden ${className}`}
      style={{ background: '#050a1e', fontFamily: '"Microsoft YaHei", sans-serif', userSelect: 'none' }}>
      <div className="absolute inset-0 z-0">
        <Suspense fallback={<div className="w-full h-full flex items-center justify-center" style={{ background: '#050a1e' }}><div style={{ color: '#52a8ff' }} className="animate-pulse text-sm">Loading Cesium 3D Globe...</div></div>}>
          <CesiumMapPanel drones={drones} selectedDroneId={selectedDroneId} selectedDroneIds={selectedDroneIds}
            onDroneClick={onDroneClick} onMapClick={onMapClick} onMapClickCommand={onMapClickCommand} disableAutoFocus={true} />
        </Suspense>
      </div>
      <HoloHUD />
      <div className="absolute z-[99]" style={{ top: '10px', left: '50%', transform: 'translateX(-50%)',
        fontSize: '22px', fontWeight: 'bold', color: '#ffffff',
        textShadow: '0 0 10px rgba(82, 168, 255, 0.5)', letterSpacing: '2px', whiteSpace: 'nowrap' }}>
        无人机指挥控制平台
      </div>
      <div className="absolute inset-0 z-10 pointer-events-none">
        <div className="absolute pointer-events-auto" style={{ top: TITLE_H + GAP, left: GAP, width: LEFT_W, height: STAT_H }}>
          <HoloPanel title="无人机态势" delay={0.1} style={{ height: '100%', overflow: 'hidden' }}>
            <HoloDroneStatsPanel drones={drones} />
          </HoloPanel>
        </div>
        <div className="absolute pointer-events-auto" style={{
          top: TITLE_H + GAP + STAT_H + GAP, left: GAP, width: LEFT_W,
          bottom: GAP + LOG_H + GAP, display: 'flex', flexDirection: 'column',
        }}>
          <HoloPanel title="管理控制台" delay={0.2} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <ConsolePanel drones={drones} selectedDroneId={selectedDroneId} selectedDroneIds={selectedDroneIds}
              onDroneClick={onDroneClick} onDroneToggleSelect={onDroneToggleSelect}
              teams={teams} teamMembers={teamMembers} registeredUsers={registeredUsers} rallyPoints={rallyPoints}
              logs={logs} logPage={logPage} logTotalPages={logTotalPages} logFilter={logFilter} logLoading={logLoading}
              onTransferPermission={onTransferPermission} onFetchLogs={onFetchLogs} onTeamExpand={onTeamExpand}
              onRallyPointCreate={onRallyPointCreate} onRallyPointEdit={onRallyPointEdit} onRallyPointDelete={onRallyPointDelete}
              consoleContent={consoleContent} />
          </HoloPanel>
        </div>
        <div className="absolute pointer-events-auto" style={{ left: GAP, bottom: GAP, width: LEFT_W, height: LOG_H }}>
          <HoloPanel title="系统日志" delay={0.5} style={{ height: '100%', overflow: 'hidden' }}>
            <HoloLogPanel logs={logs} maxVisible={3} />
          </HoloPanel>
        </div>
        <div className="absolute pointer-events-auto" style={{
          bottom: GAP, left: GAP + LEFT_W + GAP, right: GAP + RIGHT_W + GAP, height: CONTROL_H,
        }}>
          <HoloPanel delay={0.4} animated={false} style={{ height: '100%' }}>
            <HoloDroneControlPanel drones={drones} selectedDroneId={selectedDroneId} selectedDroneIds={selectedDroneIds} onCommand={handleCommand} />
          </HoloPanel>
        </div>
        <div className="absolute pointer-events-auto" style={{ top: TITLE_H + GAP, right: GAP, width: RIGHT_W, height: RADAR_H }}>
          <HoloPanel title="区域无人机态势" delay={0.3} style={{ height: '100%', overflow: 'hidden' }}>
            <HoloChinaRadar drones={drones} size={150} />
          </HoloPanel>
        </div>
        <div className="absolute pointer-events-auto" style={{
          top: TITLE_H + GAP + RADAR_H + GAP, right: GAP, width: RIGHT_W,
          bottom: GAP + WEATHER_H + GAP, display: 'flex', flexDirection: 'column',
        }}>
          <HoloPanel title="成员在线状态" delay={0.35} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <HoloMemberPanel members={members} teams={teams} />
          </HoloPanel>
        </div>
        <div className="absolute pointer-events-auto" style={{ right: GAP, bottom: GAP, width: RIGHT_W, height: WEATHER_H }}>
          <HoloPanel title="实时气象" delay={0.45} style={{ height: '100%', overflow: 'hidden' }}>
            <HoloWeatherPanel weather={weather} drones={drones} selectedDroneId={selectedDroneId} selectedDroneIds={selectedDroneIds} onLocationChange={onWeatherLocationChange} />
          </HoloPanel>
        </div>
        {onClose && (
          <div className="absolute pointer-events-auto z-20" style={{ top: GAP, right: GAP + RIGHT_W + GAP }}>
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
  teamMembers: Record<string, Array<{ userId: string; username: string; realName: string; role: string }>>;
  registeredUsers: Array<{ userId: number; username: string; realName: string; role: string }>;
  rallyPoints: MapRallyPoint[];
  logs: LogEntry[];
  logPage: number;
  logTotalPages: number;
  logFilter: string;
  logLoading: boolean;
  onTransferPermission?: (uavIds: string[], toUserId?: number, toTeamId?: number, mode?: 'user' | 'team') => void;
  onFetchLogs?: (page: number, filter: string) => void;
  onTeamExpand?: (teamId: string) => void;
  onRallyPointCreate?: (data: Partial<MapRallyPoint>) => void;
  onRallyPointEdit?: (rp: MapRallyPoint, data: Partial<MapRallyPoint>) => void;
  onRallyPointDelete?: (id: number) => void;
  consoleContent?: ReactNode;
}

const TAB_ACTIVE = { background: 'rgba(60, 120, 220, 0.4)', border: '1px solid #52a8ff', color: '#fff' };
const TAB_INACTIVE = { background: 'rgba(20, 40, 80, 0.8)', border: '1px solid rgba(60, 120, 220, 0.4)', color: '#c0d8ff' };

function ConsolePanel({
  drones, selectedDroneId, selectedDroneIds, onDroneClick, onDroneToggleSelect,
  teams, registeredUsers, rallyPoints,
  logs, logPage, logTotalPages, logFilter, logLoading,
  onTransferPermission, onFetchLogs,
  onRallyPointCreate, onRallyPointEdit, onRallyPointDelete, consoleContent,
}: ConsolePanelProps) {
  const [activeTab, setActiveTab] = useState('fleet');
  const [transferUavIds, setTransferUavIds] = useState<string[]>([]);
  const [transferMode, setTransferMode] = useState<'user' | 'team'>('team');
  const [transferTarget, setTransferTarget] = useState('');
  const [localLogFilter, setLocalLogFilter] = useState(logFilter);
  const [rpDialogOpen, setRpDialogOpen] = useState(false);
  const [rpEditTarget, setRpEditTarget] = useState<MapRallyPoint | null>(null);
  const [rpForm, setRpForm] = useState<{name: string; latitude: string; longitude: string; capacity: string; status: number; serviceType: number}>({
    name: '', latitude: '', longitude: '', capacity: '10', status: 1, serviceType: 0,
  });

  const tabs = [
    { key: 'fleet', label: '机队' }, { key: 'permission', label: '权限' },
    { key: 'log', label: '日志' }, { key: 'point', label: '集结点' },
  ];

  const toggleTransferDrone = (uavId: string) => {
    setTransferUavIds(prev => prev.includes(uavId) ? prev.filter(id => id !== uavId) : [...prev, uavId]);
  };

  const handleTransferSubmit = () => {
    if (transferUavIds.length === 0 || !transferTarget) return;
    const n = parseInt(transferTarget);
    if (isNaN(n)) return;
    onTransferPermission?.(transferUavIds, transferMode === 'user' ? n : undefined, transferMode === 'team' ? n : undefined, transferMode);
    setTransferUavIds([]);
    setTransferTarget('');
  };

  const SERVICE_LABELS: Record<number, string> = { 0: '停机', 1: '充电', 2: '维修', 3: '补给' };
  const STATUS_LABELS: Record<number, string> = { 0: '禁用', 1: '启用', 2: '维护中' };
  const STATUS_COLORS: Record<number, string> = { 0: '#64748b', 1: '#00ff7f', 2: '#ffd700' };

  const openRpCreate = () => {
    setRpEditTarget(null);
    setRpForm({ name: '', latitude: '', longitude: '', capacity: '10', status: 1, serviceType: 0 });
    setRpDialogOpen(true);
  };

  const openRpEditDialog = (rp: MapRallyPoint) => {
    setRpEditTarget(rp);
    setRpForm({ name: rp.name, latitude: String(rp.latitude), longitude: String(rp.longitude), capacity: String(rp.capacity), status: rp.status, serviceType: rp.serviceType });
    setRpDialogOpen(true);
  };

  const handleRpDialogSubmit = () => {
    const lat = parseFloat(rpForm.latitude);
    const lng = parseFloat(rpForm.longitude);
    const cap = parseInt(rpForm.capacity);
    if (!rpForm.name || isNaN(lat) || isNaN(lng) || isNaN(cap)) return;
    const data: Partial<MapRallyPoint> = { name: rpForm.name, latitude: lat, longitude: lng, capacity: cap, status: rpForm.status, serviceType: rpForm.serviceType, currentOccupancy: 0 };
    if (rpEditTarget) { onRallyPointEdit?.(rpEditTarget, data); } else { onRallyPointCreate?.(data); }
    setRpDialogOpen(false);
  };

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
            <div style={{ fontSize: '11px', color: '#a0cfff', marginBottom: '8px' }}>选择无人机进行权限转移:</div>
            <div style={{ maxHeight: '120px', overflowY: 'auto', marginBottom: '8px' }}>
              {drones.map(d => (<label key={d.uavId} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px',
                fontSize: '11px', color: '#c0d8ff', cursor: 'pointer', borderRadius: '3px',
                background: transferUavIds.includes(d.uavId) ? 'rgba(82,168,255,0.15)' : 'transparent' }}>
                <input type="checkbox" checked={transferUavIds.includes(d.uavId)} onChange={() => toggleTransferDrone(d.uavId)} style={{ accentColor: '#52a8ff' }} />
                {d.uavId}
                <span style={{ marginLeft: 'auto', fontSize: '10px', opacity: 0.7 }}>{d.onlineStatus ? (d.armed ? '飞行中' : '在线') : '离线'}</span>
              </label>))}
            </div>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
              {(['team', 'user'] as const).map(m => (<button key={m} onClick={() => setTransferMode(m)} style={{
                flex: 1, padding: '3px 0', borderRadius: '3px', fontSize: '10px', cursor: 'pointer',
                ...(transferMode === m ? TAB_ACTIVE : TAB_INACTIVE) }}>{m === 'team' ? '转给团队' : '转给用户'}</button>))}
            </div>
            <select value={transferTarget} onChange={e => setTransferTarget(e.target.value)} style={{
              width: '100%', padding: '4px 6px', background: 'rgba(20,40,80,0.8)',
              border: '1px solid rgba(60,120,220,0.4)', borderRadius: '4px', color: '#c0d8ff', fontSize: '11px', marginBottom: '6px' }}>
              <option value="">{transferMode === 'team' ? '选择目标团队...' : '选择目标用户...'}</option>
              {transferMode === 'team'
                ? teams.map(t => <option key={t.teamId} value={t.teamId}>{t.teamName} ({t.leader})</option>)
                : registeredUsers.filter(u => u.role !== 'OBSERVER').map(u => <option key={u.userId} value={u.userId}>{u.realName || u.username} ({u.role})</option>)}
            </select>
            <button onClick={handleTransferSubmit} disabled={transferUavIds.length === 0 || !transferTarget}
              style={{ width: '100%', padding: '6px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                background: transferUavIds.length > 0 && transferTarget ? '#52a8ff' : 'rgba(82,168,255,0.2)',
                border: '1px solid #52a8ff', color: '#fff',
                cursor: transferUavIds.length > 0 && transferTarget ? 'pointer' : 'not-allowed',
                opacity: transferUavIds.length > 0 && transferTarget ? 1 : 0.5 }}>
              确认转移 ({transferUavIds.length} 架)
            </button>
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
              <button onClick={openRpCreate} style={{ padding: '2px 8px', borderRadius: '3px', fontSize: '10px', cursor: 'pointer',
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
                <button onClick={() => openRpEditDialog(rp)} style={{ padding: '1px 6px', borderRadius: '2px', fontSize: '9px', cursor: 'pointer',
                  background: 'rgba(82,168,255,0.15)', border: '1px solid rgba(82,168,255,0.3)', color: '#52a8ff' }}>编辑</button>
                <button onClick={() => onRallyPointDelete?.(rp.id)} style={{ padding: '1px 6px', borderRadius: '2px', fontSize: '9px', cursor: 'pointer',
                  background: 'rgba(255,77,79,0.15)', border: '1px solid rgba(255,77,79,0.3)', color: '#ff4d4f' }}>删除</button>
              </div>
            </div>))}
          </div>)}
        </>)}
      </div>
      {rpDialogOpen && (
        <RallyPointDialog isEdit={rpEditTarget !== null} form={rpForm} onFormChange={setRpForm}
          onSubmit={handleRpDialogSubmit} onClose={() => setRpDialogOpen(false)} />
      )}
    </div>
  );
}

interface RpFormType {
  name: string; latitude: string; longitude: string; capacity: string; status: number; serviceType: number;
}

function RallyPointDialog({ isEdit, form, onFormChange, onSubmit, onClose }: {
  isEdit: boolean; form: RpFormType; onFormChange: (f: RpFormType) => void; onSubmit: () => void; onClose: () => void;
}) {
  const inputStyle = { width: '100%', padding: '4px 8px', background: 'rgba(20,40,80,0.8)',
    border: '1px solid rgba(60,120,220,0.4)', borderRadius: '4px', color: '#c0d8ff', fontSize: '11px' };
  const labelStyle = { fontSize: '11px', color: '#a0cfff', marginBottom: '2px', display: 'block' as const };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'rgba(10, 20, 50, 0.95)', border: '1px solid rgba(82,168,255,0.4)',
        borderRadius: '8px', padding: '16px', width: '300px', maxHeight: '80vh', overflowY: 'auto',
        boxShadow: '0 0 20px rgba(82,168,255,0.2)' }}>
        <div style={{ fontSize: '14px', color: '#fff', fontWeight: 600, marginBottom: '12px' }}>
          {isEdit ? '编辑集结点' : '新增集结点'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div><label style={labelStyle}>名称 *</label>
            <input style={inputStyle} value={form.name} onChange={e => onFormChange({ ...form, name: e.target.value })} placeholder="集结点名称" /></div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ flex: 1 }}><label style={labelStyle}>纬度 *</label>
              <input style={inputStyle} type="number" step="0.0001" value={form.latitude} onChange={e => onFormChange({ ...form, latitude: e.target.value })} placeholder="39.9042" /></div>
            <div style={{ flex: 1 }}><label style={labelStyle}>经度 *</label>
              <input style={inputStyle} type="number" step="0.0001" value={form.longitude} onChange={e => onFormChange({ ...form, longitude: e.target.value })} placeholder="116.4074" /></div>
          </div>
          <div><label style={labelStyle}>容量</label>
            <input style={inputStyle} type="number" value={form.capacity} onChange={e => onFormChange({ ...form, capacity: e.target.value })} /></div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ flex: 1 }}><label style={labelStyle}>状态</label>
              <select style={inputStyle} value={form.status} onChange={e => onFormChange({ ...form, status: parseInt(e.target.value) })}>
                <option value={0}>禁用</option><option value={1}>启用</option><option value={2}>维护中</option>
              </select></div>
            <div style={{ flex: 1 }}><label style={labelStyle}>服务类型</label>
              <select style={inputStyle} value={form.serviceType} onChange={e => onFormChange({ ...form, serviceType: parseInt(e.target.value) })}>
                <option value={0}>停机</option><option value={1}>充电</option><option value={2}>维修</option><option value={3}>补给</option>
              </select></div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '4px 12px', borderRadius: '4px', fontSize: '11px',
            background: 'rgba(20,40,80,0.8)', border: '1px solid rgba(60,120,220,0.4)', color: '#a0cfff', cursor: 'pointer' }}>取消</button>
          <button onClick={onSubmit} style={{ padding: '4px 12px', borderRadius: '4px', fontSize: '11px',
            background: '#52a8ff', border: '1px solid #52a8ff', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
            {isEdit ? '保存' : '创建'}</button>
        </div>
      </div>
    </div>
  );
}

export default HoloDashboard;
