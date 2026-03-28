/**
 * Holographic Dashboard - Phase 6 (Bug Fixes & Full Functionality)
 * Fixed panel positioning: no overlaps, fixed sizes.
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
              teams={teams} teamMembers={teamMembers} registeredUsers={registeredUsers} rallyPoints={rallyPoints}
              logs={logs} logPage={logPage} logTotalPages={logTotalPages} logFilter={logFilter} logLoading={logLoading}
              onTransferPermission={onTransferPermission} onFetchLogs={onFetchLogs} onTeamExpand={onTeamExpand}
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

// ===== Helper: Generate popup window HTML for permission transfer =====
function buildPermissionTransferPopupHtml(
  dronesJson: string, teamsJson: string, usersJson: string,
): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>权限转移</title>
<style>
  body { margin:0; padding:20px; background:#0a1428; color:#c0d8ff; font-family:'Microsoft YaHei',sans-serif; }
  h2 { color:#52a8ff; margin-bottom:16px; font-size:18px; }
  .section { margin-bottom:16px; }
  .section-title { font-size:13px; color:#a0cfff; margin-bottom:8px; }
  .drone-list { max-height:200px; overflow-y:auto; border:1px solid rgba(60,120,220,0.4); border-radius:6px; padding:8px; background:rgba(20,40,80,0.5); }
  .drone-item { display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:4px; cursor:pointer; font-size:13px; }
  .drone-item:hover { background:rgba(82,168,255,0.1); }
  .drone-item.selected { background:rgba(82,168,255,0.2); }
  input[type=checkbox] { accent-color:#52a8ff; width:16px; height:16px; cursor:pointer; }
  .mode-btns { display:flex; gap:8px; margin-bottom:12px; }
  .mode-btn { flex:1; padding:8px; border-radius:6px; font-size:13px; cursor:pointer; text-align:center; border:1px solid rgba(60,120,220,0.4); background:rgba(20,40,80,0.8); color:#c0d8ff; transition:all 0.2s; }
  .mode-btn.active { background:rgba(60,120,220,0.4); border-color:#52a8ff; color:#fff; }
  select { width:100%; padding:8px 12px; background:rgba(20,40,80,0.8); border:1px solid rgba(60,120,220,0.4); border-radius:6px; color:#c0d8ff; font-size:13px; margin-bottom:12px; }
  .submit-btn { width:100%; padding:10px; border-radius:6px; font-size:14px; font-weight:600; border:1px solid #52a8ff; color:#fff; cursor:pointer; transition:all 0.2s; }
  .submit-btn.enabled { background:#52a8ff; }
  .submit-btn.disabled { background:rgba(82,168,255,0.2); cursor:not-allowed; opacity:0.5; }
  .status { font-size:11px; opacity:0.7; margin-left:auto; }
</style></head><body>
<h2>无人机权限转移</h2>
<div class="section"><div class="section-title">选择需要转移的无人机（可多选）:</div>
<div class="drone-list" id="droneList"></div></div>
<div class="section"><div class="section-title">转移目标:</div>
<div class="mode-btns"><div class="mode-btn active" id="btnTeam" onclick="setMode('team')">转给团队</div>
<div class="mode-btn" id="btnUser" onclick="setMode('user')">转给用户</div></div>
<select id="targetSelect"><option value="">请选择...</option></select></div>
<button class="submit-btn disabled" id="submitBtn" onclick="doSubmit()">确认转移</button>
<script>
var drones=${dronesJson};
var teams=${teamsJson};
var users=${usersJson};
var selectedIds=new Set();
var mode='team';
function renderDrones(){var el=document.getElementById('droneList');el.innerHTML='';
drones.forEach(function(d){var div=document.createElement('div');div.className='drone-item'+(selectedIds.has(d.uavId)?' selected':'');
var cb=document.createElement('input');cb.type='checkbox';cb.checked=selectedIds.has(d.uavId);
cb.onchange=function(){if(selectedIds.has(d.uavId))selectedIds.delete(d.uavId);else selectedIds.add(d.uavId);renderDrones();updateBtn();};
div.appendChild(cb);var sp=document.createElement('span');sp.textContent=d.uavId;div.appendChild(sp);
var st=document.createElement('span');st.className='status';st.textContent=d.onlineStatus?(d.armed?'飞行中':'在线'):'离线';div.appendChild(st);
div.onclick=function(e){if(e.target!==cb){cb.checked=!cb.checked;if(selectedIds.has(d.uavId))selectedIds.delete(d.uavId);else selectedIds.add(d.uavId);renderDrones();updateBtn();}};
el.appendChild(div);});}
function setMode(m){mode=m;document.getElementById('btnTeam').className='mode-btn'+(m==='team'?' active':'');
document.getElementById('btnUser').className='mode-btn'+(m==='user'?' active':'');renderTarget();}
function renderTarget(){var sel=document.getElementById('targetSelect');sel.innerHTML='<option value="">'+(mode==='team'?'选择目标团队...':'选择目标用户...')+'</option>';
var items=mode==='team'?teams:users.filter(function(u){return u.role!=='OBSERVER';});
items.forEach(function(item){var opt=document.createElement('option');
opt.value=mode==='team'?item.teamId:item.userId;
opt.textContent=mode==='team'?(item.teamName+' ('+item.leader+')'):(item.realName||item.username)+' ('+item.role+')';sel.appendChild(opt);});}
function updateBtn(){var btn=document.getElementById('submitBtn');var target=document.getElementById('targetSelect').value;
if(selectedIds.size>0&&target){btn.className='submit-btn enabled';btn.textContent='确认转移 ('+selectedIds.size+' 架)';}else{btn.className='submit-btn disabled';btn.textContent='确认转移 ('+selectedIds.size+' 架)';}}
document.getElementById('targetSelect').onchange=updateBtn;
function doSubmit(){var target=document.getElementById('targetSelect').value;
if(selectedIds.size===0||!target)return;var n=parseInt(target);if(isNaN(n))return;
window.opener.postMessage({type:'permissionTransfer',uavIds:Array.from(selectedIds),mode:mode,targetId:n},'*');window.close();}
renderDrones();renderTarget();
</script></body></html>`;
}

// ===== Helper: Generate popup window HTML for rally point create/edit =====
function buildRallyPointPopupHtml(isEdit: boolean, rpData?: { name: string; latitude: number; longitude: number; capacity: number; status: number; serviceType: number; id?: number }): string {
  const d = rpData || { name: '', latitude: '', longitude: '', capacity: 10, status: 1, serviceType: 0 };
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${isEdit ? '编辑集结点' : '新增集结点'}</title>
<style>
  body { margin:0; padding:20px; background:#0a1428; color:#c0d8ff; font-family:'Microsoft YaHei',sans-serif; }
  h2 { color:#52a8ff; margin-bottom:16px; font-size:18px; }
  .form-group { margin-bottom:14px; }
  label { display:block; font-size:13px; color:#a0cfff; margin-bottom:4px; }
  input, select { width:100%; padding:8px 12px; background:rgba(20,40,80,0.8); border:1px solid rgba(60,120,220,0.4); border-radius:6px; color:#c0d8ff; font-size:13px; box-sizing:border-box; }
  .row { display:flex; gap:12px; }
  .row > div { flex:1; }
  .btn-row { display:flex; gap:12px; margin-top:20px; justify-content:flex-end; }
  .btn { padding:8px 20px; border-radius:6px; font-size:13px; cursor:pointer; border:1px solid; transition:all 0.2s; }
  .btn-cancel { background:rgba(20,40,80,0.8); border-color:rgba(60,120,220,0.4); color:#a0cfff; }
  .btn-submit { background:#52a8ff; border-color:#52a8ff; color:#fff; font-weight:600; }
</style></head><body>
<h2>${isEdit ? '编辑集结点' : '新增集结点'}</h2>
<div class="form-group"><label>名称 *</label><input id="rpName" value="${d.name}" placeholder="集结点名称"></div>
<div class="row"><div class="form-group"><label>纬度 *</label><input id="rpLat" type="number" step="0.0001" value="${d.latitude}" placeholder="39.9042"></div>
<div class="form-group"><label>经度 *</label><input id="rpLng" type="number" step="0.0001" value="${d.longitude}" placeholder="116.4074"></div></div>
<div class="form-group"><label>容量</label><input id="rpCap" type="number" value="${d.capacity}"></div>
<div class="row"><div class="form-group"><label>状态</label><select id="rpStatus">
<option value="0"${d.status===0?' selected':''}>禁用</option><option value="1"${d.status===1?' selected':''}>启用</option><option value="2"${d.status===2?' selected':''}>维护中</option></select></div>
<div class="form-group"><label>服务类型</label><select id="rpService">
<option value="0"${d.serviceType===0?' selected':''}>停机</option><option value="1"${d.serviceType===1?' selected':''}>充电</option><option value="2"${d.serviceType===2?' selected':''}>维修</option><option value="3"${d.serviceType===3?' selected':''}>补给</option></select></div></div>
<div class="btn-row"><button class="btn btn-cancel" onclick="window.close()">取消</button>
<button class="btn btn-submit" onclick="doSubmit()">${isEdit ? '保存' : '创建'}</button></div>
<script>
function doSubmit(){
  var name=document.getElementById('rpName').value;
  var lat=parseFloat(document.getElementById('rpLat').value);
  var lng=parseFloat(document.getElementById('rpLng').value);
  var cap=parseInt(document.getElementById('rpCap').value);
  if(!name||isNaN(lat)||isNaN(lng)||isNaN(cap)){alert('请填写所有必填字段');return;}
  window.opener.postMessage({type:'rallyPoint',isEdit:${isEdit},${isEdit && rpData?.id != null ? `editId:${rpData.id},` : ''}
    data:{name:name,latitude:lat,longitude:lng,capacity:cap,status:parseInt(document.getElementById('rpStatus').value),serviceType:parseInt(document.getElementById('rpService').value),currentOccupancy:0}},'*');
  window.close();
}
</script></body></html>`;
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

  const tabs = [
    { key: 'fleet', label: '机队' }, { key: 'permission', label: '权限' },
    { key: 'log', label: '日志' }, { key: 'point', label: '集结点' },
  ];

  const SERVICE_LABELS: Record<number, string> = { 0: '停机', 1: '充电', 2: '维修', 3: '补给' };
  const STATUS_LABELS: Record<number, string> = { 0: '禁用', 1: '启用', 2: '维护中' };
  const STATUS_COLORS: Record<number, string> = { 0: '#64748b', 1: '#00ff7f', 2: '#ffd700' };

  // Refs to keep latest callback references for postMessage listener
  const onTransferPermissionRef = useRef(onTransferPermission);
  const onRallyPointCreateRef = useRef(onRallyPointCreate);
  const onRallyPointEditRef = useRef(onRallyPointEdit);
  const rallyPointsRef = useRef(rallyPoints);
  useEffect(() => { onTransferPermissionRef.current = onTransferPermission; }, [onTransferPermission]);
  useEffect(() => { onRallyPointCreateRef.current = onRallyPointCreate; }, [onRallyPointCreate]);
  useEffect(() => { onRallyPointEditRef.current = onRallyPointEdit; }, [onRallyPointEdit]);
  useEffect(() => { rallyPointsRef.current = rallyPoints; }, [rallyPoints]);

  // Listen for postMessage from popup windows
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'permissionTransfer') {
        const { uavIds, mode, targetId } = msg;
        onTransferPermissionRef.current?.(
          uavIds,
          mode === 'user' ? targetId : undefined,
          mode === 'team' ? targetId : undefined,
          mode,
        );
      } else if (msg.type === 'rallyPoint') {
        if (msg.isEdit && msg.editId != null) {
          const rp = rallyPointsRef.current.find(r => r.id === msg.editId);
          if (rp) onRallyPointEditRef.current?.(rp, msg.data);
        } else {
          onRallyPointCreateRef.current?.(msg.data);
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Open permission transfer popup
  const openTransferPopup = useCallback(() => {
    const dronesData = drones.map(d => ({ uavId: d.uavId, onlineStatus: d.onlineStatus, armed: d.armed }));
    const teamsData = teams.map(t => ({ teamId: t.teamId, teamName: t.teamName, leader: t.leader }));
    const usersData = registeredUsers.map(u => ({ userId: u.userId, username: u.username, realName: u.realName, role: u.role }));
    const html = buildPermissionTransferPopupHtml(
      JSON.stringify(dronesData), JSON.stringify(teamsData), JSON.stringify(usersData),
    );
    const popup = window.open('', '_blank', 'width=520,height=600,scrollbars=yes,resizable=yes');
    if (popup) { popup.document.write(html); popup.document.close(); }
  }, [drones, teams, registeredUsers]);

  // Open rally point popup (create or edit)
  const openRpPopup = useCallback((rp?: MapRallyPoint) => {
    const isEdit = !!rp;
    const rpData = rp ? { name: rp.name, latitude: rp.latitude, longitude: rp.longitude, capacity: rp.capacity, status: rp.status, serviceType: rp.serviceType, id: rp.id } : undefined;
    const html = buildRallyPointPopupHtml(isEdit, rpData);
    const popup = window.open('', '_blank', 'width=480,height=500,scrollbars=yes,resizable=yes');
    if (popup) { popup.document.write(html); popup.document.close(); }
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
            <div style={{ fontSize: '11px', color: '#a0cfff', marginBottom: '8px' }}>点击下方按钮在新窗口中进行权限转移操作:</div>
            <button onClick={openTransferPopup}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600,
                background: '#52a8ff', border: '1px solid #52a8ff', color: '#fff', cursor: 'pointer', transition: 'all 0.2s' }}>
              打开权限转移窗口
            </button>
            <div style={{ fontSize: '10px', color: '#64748b', marginTop: '6px', textAlign: 'center' }}>将在新浏览器窗口中选择无人机和转移目标</div>
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
              <button onClick={() => openRpPopup()} style={{ padding: '2px 8px', borderRadius: '3px', fontSize: '10px', cursor: 'pointer',
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
                <button onClick={() => openRpPopup(rp)} style={{ padding: '1px 6px', borderRadius: '2px', fontSize: '9px', cursor: 'pointer',
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
