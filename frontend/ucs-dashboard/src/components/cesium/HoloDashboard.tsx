/**
 * Holographic Dashboard - Phase 5 (Full Functional Migration)
 * All 7 panels display REAL data from CommanderView.
 * Console panel implements real drone list, permissions, logs, rally points.
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
  onMapClick?: (lat: number, lon: number) => void;
  onMapClickCommand?: (command: string, lat: number, lng: number) => void;
  onCommand?: (command: string, uavIds?: string[]) => void;
  onTransferPermission?: (uavIds: string[], toUserId?: number, toTeamId?: number, mode?: 'user' | 'team') => void;
  onFetchLogs?: (page: number, filter: string) => void;
  onTeamExpand?: (teamId: string) => void;
  onRallyPointCreate?: () => void;
  onRallyPointEdit?: (rp: MapRallyPoint) => void;
  onRallyPointDelete?: (id: number) => void;
  onWeatherLocationChange?: (lat: number, lng: number) => void;
  consoleContent?: ReactNode;
  onClose?: () => void;
  className?: string;
}

function useContainerSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 1200, height: 800 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => { const rect = el.getBoundingClientRect(); setSize({ width: rect.width, height: rect.height }); };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export function HoloDashboard({
  drones, selectedDroneId, selectedDroneIds,
  logs = [], members = [], weather, teams = [], teamMembers = {}, rallyPoints = [],
  registeredUsers = [],
  logPage = 0, logTotalPages = 0, logFilter = 'ALL', logLoading = false,
  onDroneClick, onMapClick, onMapClickCommand, onCommand,
  onTransferPermission, onFetchLogs, onTeamExpand,
  onRallyPointCreate, onRallyPointEdit, onRallyPointDelete,
  onWeatherLocationChange, consoleContent, onClose, className = '',
}: HoloDashboardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { width, height } = useContainerSize(containerRef);
  const scaleX = width / 1920;
  const scaleY = height / 1080;
  const scale = Math.min(scaleX, scaleY, 1);

  const gap = Math.max(12, Math.round(12 * scale));
  const leftPanelWidth = Math.max(240, Math.round(320 * scaleX));
  const rightPanelWidth = Math.max(230, Math.round(310 * scaleX));
  const bottomHeight = Math.max(120, Math.round(160 * scaleY));
  const radarHeight = Math.max(160, Math.round(200 * scaleY));
  const statHeight = Math.max(70, Math.round(85 * scaleY));
  const radarSize = Math.max(120, Math.round(160 * Math.min(scaleX, scaleY)));

  const consoleTop = gap + statHeight + gap;
  const consoleBottom = gap + bottomHeight + gap;
  const memberTop = gap + radarHeight + gap;
  const memberBottom = gap + bottomHeight + gap;
  const controlLeft = gap + leftPanelWidth + gap;
  const controlRight = gap + rightPanelWidth + gap;

  const handleCommand = useCallback((cmd: string, uavIds?: string[]) => { onCommand?.(cmd, uavIds); }, [onCommand]);

  return (
    <div ref={containerRef} className={`fixed inset-0 z-50 overflow-hidden ${className}`}
      style={{ background: '#050a1e', fontFamily: '"Microsoft YaHei", sans-serif', userSelect: 'none' }}>
      <svg width="0" height="0" style={{ position: 'absolute', zIndex: -1 }}>
        <defs><clipPath id="arcTopClip" clipPathUnits="objectBoundingBox"><path d="M 0,0 Q 0.5,0.24 1,0 L 1,1 L 0,1 Z" /></clipPath></defs>
      </svg>

      <div className="absolute inset-0 z-0">
        <Suspense fallback={<div className="w-full h-full flex items-center justify-center" style={{ background: '#050a1e' }}><div style={{ color: '#52a8ff' }} className="animate-pulse text-sm">Loading Cesium 3D Globe...</div></div>}>
          <CesiumMapPanel drones={drones} selectedDroneId={selectedDroneId} selectedDroneIds={selectedDroneIds}
            onDroneClick={onDroneClick} onMapClick={onMapClick} onMapClickCommand={onMapClickCommand} disableAutoFocus={true} />
        </Suspense>
      </div>

      <HoloHUD />

      <div className="absolute z-[99]" style={{ top: '15px', left: '50%', transform: 'translateX(-50%)',
        fontSize: Math.max(16, Math.round(22 * scale)) + 'px', fontWeight: 'bold', color: '#ffffff',
        textShadow: '0 0 10px rgba(82, 168, 255, 0.5)', letterSpacing: '2px', whiteSpace: 'nowrap' }}>
        无人机指挥控制平台
      </div>

      <div className="absolute inset-0 z-10 pointer-events-none">
        {/* Panel 1: Drone Stats */}
        <div className="absolute pointer-events-auto" style={{ top: gap, left: gap, width: leftPanelWidth }}>
          <HoloPanel title="无人机态势" delay={0.1}><HoloDroneStatsPanel drones={drones} /></HoloPanel>
        </div>

        {/* Panel 2: Console */}
        <div className="absolute pointer-events-auto" style={{ top: consoleTop, left: gap, width: leftPanelWidth, bottom: consoleBottom, display: 'flex', flexDirection: 'column' }}>
          <HoloPanel title="管理控制台" delay={0.2} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <ConsolePanel drones={drones} selectedDroneId={selectedDroneId} onDroneClick={onDroneClick}
              teams={teams} teamMembers={teamMembers} registeredUsers={registeredUsers} rallyPoints={rallyPoints}
              logs={logs} logPage={logPage} logTotalPages={logTotalPages} logFilter={logFilter} logLoading={logLoading}
              onTransferPermission={onTransferPermission} onFetchLogs={onFetchLogs} onTeamExpand={onTeamExpand}
              onRallyPointCreate={onRallyPointCreate} onRallyPointEdit={onRallyPointEdit} onRallyPointDelete={onRallyPointDelete}
              consoleContent={consoleContent} />
          </HoloPanel>
        </div>

        {/* Panel 3: System Logs */}
        <div className="absolute pointer-events-auto" style={{ left: gap, bottom: gap, width: leftPanelWidth, height: bottomHeight }}>
          <HoloPanel title="系统日志" delay={0.5}><HoloLogPanel logs={logs} maxVisible={4} /></HoloPanel>
        </div>

        {/* Panel 4: Drone Control */}
        <div className="absolute pointer-events-auto" style={{ bottom: gap, left: controlLeft, right: controlRight, height: bottomHeight, clipPath: 'url(#arcTopClip)' }}>
          <HoloPanel delay={0.4} animated={false} style={{ height: '100%' }}>
            <HoloDroneControlPanel drones={drones} selectedDroneId={selectedDroneId} selectedDroneIds={selectedDroneIds} onCommand={handleCommand} />
          </HoloPanel>
        </div>

        {/* Panel 5: Radar */}
        <div className="absolute pointer-events-auto" style={{ top: gap, right: gap, width: rightPanelWidth }}>
          <HoloPanel title="区域无人机态势" delay={0.3}><HoloChinaRadar drones={drones} size={radarSize} /></HoloPanel>
        </div>

        {/* Panel 6: Member Status */}
        <div className="absolute pointer-events-auto" style={{ top: memberTop, right: gap, width: rightPanelWidth, bottom: memberBottom }}>
          <HoloPanel title="成员在线状态" delay={0.35} style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <HoloMemberPanel members={members} teams={teams} />
          </HoloPanel>
        </div>

        {/* Panel 7: Weather */}
        <div className="absolute pointer-events-auto" style={{ right: gap, bottom: gap, width: rightPanelWidth, height: bottomHeight }}>
          <HoloPanel title="实时气象" delay={0.45}><HoloWeatherPanel weather={weather} drones={drones} onLocationChange={onWeatherLocationChange} /></HoloPanel>
        </div>

        {onClose && (
          <div className="absolute pointer-events-auto z-20" style={{ top: gap, right: gap + rightPanelWidth + gap }}>
            <button onClick={onClose} style={{ padding: '4px 12px', background: 'rgba(10, 20, 50, 0.9)',
              border: '1px solid rgba(82, 168, 255, 0.4)', borderRadius: '4px', color: '#52a8ff', fontSize: '12px',
              cursor: 'pointer', backdropFilter: 'blur(6px)', transition: 'all 0.2s' }}>
              ✕ 退出全息模式
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Console Panel with 5 real functional tabs =====
interface ConsolePanelProps {
  drones: MapDrone[];
  selectedDroneId?: string | null;
  onDroneClick?: (uavId: string) => void;
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
  onRallyPointCreate?: () => void;
  onRallyPointEdit?: (rp: MapRallyPoint) => void;
  onRallyPointDelete?: (id: number) => void;
  consoleContent?: ReactNode;
}

const TAB_ACTIVE = { background: 'rgba(60, 120, 220, 0.4)', border: '1px solid #52a8ff', color: '#fff' };
const TAB_INACTIVE = { background: 'rgba(20, 40, 80, 0.8)', border: '1px solid rgba(60, 120, 220, 0.4)', color: '#c0d8ff' };

function ConsolePanel({
  drones, selectedDroneId, onDroneClick, teams, teamMembers, registeredUsers, rallyPoints,
  logs, logPage, logTotalPages, logFilter, logLoading,
  onTransferPermission, onFetchLogs, onTeamExpand,
  onRallyPointCreate, onRallyPointEdit, onRallyPointDelete, consoleContent,
}: ConsolePanelProps) {
  const [activeTab, setActiveTab] = useState('fleet');
  const [transferUavIds, setTransferUavIds] = useState<string[]>([]);
  const [transferMode, setTransferMode] = useState<'user' | 'team'>('team');
  const [transferTarget, setTransferTarget] = useState('');
  const [localLogFilter, setLocalLogFilter] = useState(logFilter);
  const [expandedTeamIds, setExpandedTeamIds] = useState<Set<string>>(new Set());

  const tabs = [
    { key: 'fleet', label: '机队' }, { key: 'permission', label: '权限' },
    { key: 'log', label: '日志' }, { key: 'team', label: '团队' }, { key: 'point', label: '集结点' },
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

  const handleTeamToggle = (teamId: string) => {
    setExpandedTeamIds(prev => {
      const next = new Set(prev);
      if (next.has(teamId)) { next.delete(teamId); } else { next.add(teamId); onTeamExpand?.(teamId); }
      return next;
    });
  };

  const SERVICE_LABELS: Record<number, string> = { 0: '停机', 1: '充电', 2: '维修', 3: '补给' };
  const STATUS_LABELS: Record<number, string> = { 0: '禁用', 1: '启用', 2: '维护中' };
  const STATUS_COLORS: Record<number, string> = { 0: '#64748b', 1: '#00ff7f', 2: '#ffd700' };

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
              const isSel = drone.uavId === selectedDroneId;
              const isOn = drone.onlineStatus === true;
              const isArm = drone.armed === true;
              const sc = !isOn ? '#64748b' : isArm ? '#22c55e' : '#3b82f6';
              const st = !isOn ? '离线' : isArm ? '飞行中' : '在线';
              return (<div key={drone.uavId} onClick={() => onDroneClick?.(drone.uavId)} style={{
                padding: '8px 10px', marginBottom: '4px', borderRadius: '4px', cursor: 'pointer',
                background: isSel ? 'rgba(82,168,255,0.2)' : 'rgba(20,40,80,0.5)',
                border: `1px solid ${isSel ? '#52a8ff' : 'rgba(60,120,220,0.2)'}`, transition: 'all 0.15s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ color: '#fff', fontSize: '12px', fontWeight: 600 }}>{drone.uavId}</span>
                  <span style={{ padding: '1px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 500,
                    background: sc + '33', color: sc, border: `1px solid ${sc}66` }}>{st}</span>
                </div>
                <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#a0cfff' }}>
                  {drone.battery != null && <span>电量 {drone.battery.toFixed(0)}%</span>}
                  {drone.altitude != null && <span>高度 {drone.altitude.toFixed(1)}m</span>}
                  {drone.owner && <span>操作: {drone.owner}</span>}
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
                : registeredUsers.map(u => <option key={u.userId} value={u.userId}>{u.realName || u.username} ({u.role})</option>)}
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
                <button key={f} onClick={() => { setLocalLogFilter(f); onFetchLogs?.(0, f); }}
                  style={{ padding: '2px 6px', borderRadius: '3px', fontSize: '10px', cursor: 'pointer',
                    ...(localLogFilter === f ? TAB_ACTIVE : TAB_INACTIVE) }}>
                  {f === 'ALL' ? '全部' : f === 'CONTROL_COMMAND' ? '控制' : f === 'PERMISSION_TRANSFER' ? '权限' : '批量'}
                </button>))}
            </div>
            {logLoading ? <div style={{ textAlign: 'center', color: '#52a8ff', fontSize: '11px', padding: '12px' }}>加载中...</div>
            : logs.length === 0 ? <div style={{ textAlign: 'center', color: '#a0cfff', fontSize: '11px', padding: '12px' }}>暂无日志</div>
            : logs.map(log => (<div key={log.id} style={{ padding: '6px 8px', marginBottom: '3px', borderRadius: '3px', fontSize: '11px',
              background: 'rgba(20,40,80,0.5)', borderLeft: `2px solid ${log.level === 'error' ? '#ff4d4f' : log.level === 'success' ? '#00ff7f' : '#52a8ff'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                <span style={{ color: '#52a8ff', fontSize: '10px' }}>{log.time}</span>
                {log.result && (<span style={{ padding: '0 4px', borderRadius: '2px', fontSize: '9px',
                  background: log.result === 'SUCCESS' ? 'rgba(0,255,127,0.2)' : 'rgba(255,77,79,0.2)',
                  color: log.result === 'SUCCESS' ? '#00ff7f' : '#ff4d4f' }}>
                  {log.result === 'SUCCESS' ? '成功' : '失败'}</span>)}
              </div>
              <div style={{ color: '#c0d8ff' }}>{log.detail}</div>
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

          {activeTab === 'team' && (<div>
            {teams.length === 0 ? <div style={{ textAlign: 'center', color: '#a0cfff', fontSize: '12px', padding: '20px 0' }}>暂无团队数据</div>
            : teams.map(team => (<div key={team.teamId} style={{ marginBottom: '6px' }}>
              <div onClick={() => handleTeamToggle(team.teamId)} style={{ padding: '8px 10px', borderRadius: '4px', cursor: 'pointer',
                background: 'rgba(20,40,80,0.5)', border: '1px solid rgba(60,120,220,0.2)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><span style={{ color: '#fff', fontSize: '12px', fontWeight: 600 }}>{team.teamName}</span>
                  <span style={{ color: '#a0cfff', fontSize: '10px', marginLeft: '8px' }}>队长: {team.leader}</span></div>
                <div style={{ display: 'flex', gap: '8px', fontSize: '10px', color: '#a0cfff' }}>
                  <span>{team.memberCount}人</span>
                  {team.droneCount != null && <span>{team.droneCount}机</span>}
                  <span style={{ color: '#52a8ff' }}>{expandedTeamIds.has(team.teamId) ? '▼' : '▶'}</span>
                </div>
              </div>
              {expandedTeamIds.has(team.teamId) && (<div style={{ paddingLeft: '12px', marginTop: '4px' }}>
                {(teamMembers[team.teamId] || []).length === 0
                  ? <div style={{ fontSize: '10px', color: '#a0cfff', padding: '4px 0' }}>加载中...</div>
                  : (teamMembers[team.teamId] || []).map(member => (
                    <div key={member.userId} style={{ padding: '4px 8px', fontSize: '11px', color: '#c0d8ff',
                      borderLeft: '2px solid rgba(82,168,255,0.3)', marginBottom: '2px' }}>
                      {member.realName || member.username}
                      <span style={{ color: '#a0cfff', fontSize: '10px', marginLeft: '6px' }}>({member.role})</span>
                    </div>))}
              </div>)}
            </div>))}
          </div>)}

          {activeTab === 'point' && (<div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', color: '#a0cfff' }}>集结点列表</span>
              <button onClick={() => onRallyPointCreate?.()} style={{ padding: '2px 8px', borderRadius: '3px', fontSize: '10px', cursor: 'pointer',
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
                <button onClick={() => onRallyPointEdit?.(rp)} style={{ padding: '1px 6px', borderRadius: '2px', fontSize: '9px', cursor: 'pointer',
                  background: 'rgba(82,168,255,0.15)', border: '1px solid rgba(82,168,255,0.3)', color: '#52a8ff' }}>编辑</button>
                <button onClick={() => onRallyPointDelete?.(rp.id)} style={{ padding: '1px 6px', borderRadius: '2px', fontSize: '9px', cursor: 'pointer',
                  background: 'rgba(255,77,79,0.15)', border: '1px solid rgba(255,77,79,0.3)', color: '#ff4d4f' }}>删除</button>
              </div>
            </div>))}
          </div>)}
        </>)}
      </div>
    </div>
  );
}

export default HoloDashboard;
