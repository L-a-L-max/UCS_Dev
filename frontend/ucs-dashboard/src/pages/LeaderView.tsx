import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Plane,
  Users,
  Battery,
  RefreshCw,
  LogOut,
  FileText,
  ChevronLeft,
  ChevronRight,
  ArrowRightLeft,
  AlertTriangle,
  Activity,
  PanelLeftClose,
  PanelLeftOpen,
  Eye,
  EyeOff,
  MapPin,
  Navigation,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Lock,
  Unlock,
  Pause,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  getLeaderTeamDrones,
  getLeaderTeamMembers,
  getLeaderTeamLogs,
  getLeaderTeamInfo,
  leaderTransferDrone,
  sendControlCommand,
  type DroneInfo,
  type OperationLog,
} from '@/services/api';
import MapPanel, { type MapDrone } from '@/components/MapPanel';

interface LeaderViewProps {
  token: string;
  username: string;
  onLogout: () => void;
}

const COMMANDS = [
  { type: 'ARM', label: '解锁' },
  { type: 'DISARM', label: '锁定' },
  { type: 'TAKEOFF', label: '起飞' },
  { type: 'LAND', label: '降落' },
  { type: 'RTL', label: '返航' },
  { type: 'HOLD', label: '悬停' },
];

export default function LeaderView({ token, username, onLogout }: LeaderViewProps) {
  const [drones, setDrones] = useState<DroneInfo[]>([]);
  const [teamInfo, setTeamInfo] = useState<{ teamId: string; teamName: string; leader: string; memberCount: number } | null>(null);
  const [members, setMembers] = useState<Array<{ userId: string; username: string; realName: string; role: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [logPage, setLogPage] = useState(0);
  const [logTotalPages, setLogTotalPages] = useState(0);
  const [commandFeedback, setCommandFeedback] = useState<{ uavId: string; message: string; success: boolean } | null>(null);
  const [activeTab, setActiveTab] = useState<'drones' | 'members' | 'logs'>('drones');
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [selectedMapDrone, setSelectedMapDrone] = useState<string | null>(null);

  // 详情控制面板状态（点击无人机显示/隐藏，可通过按钮一直隐藏）
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [detailPanelEnabled, setDetailPanelEnabled] = useState(true);

  // Transfer state
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferUavId, setTransferUavId] = useState('');
  const [transferToUserId, setTransferToUserId] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferResult, setTransferResult] = useState<{ success: boolean; message: string } | null>(null);

  // Fetch team drones (Issue #7: team-scoped)
  const fetchDrones = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getLeaderTeamDrones(token);
      if (res.code === 0 && res.data) {
        setDrones(Array.isArray(res.data) ? res.data as unknown as DroneInfo[] : []);
      }
    } catch (err) {
      console.error('Failed to fetch team drones:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Fetch team info and members
  const fetchTeamInfo = useCallback(async () => {
    try {
      const [infoRes, membersRes] = await Promise.all([
        getLeaderTeamInfo(token),
        getLeaderTeamMembers(token),
      ]);
      if (infoRes.code === 0 && infoRes.data) {
        setTeamInfo(infoRes.data);
      }
      if (membersRes.code === 0 && membersRes.data) {
        const memberList = Array.isArray(membersRes.data) ? membersRes.data : [];
        setMembers(memberList.map(m => ({
          userId: m.userId,
          username: m.name || m.userId,
          realName: m.name || '',
          role: m.role,
        })));
      }
    } catch (err) {
      console.error('Failed to fetch team info:', err);
    }
  }, [token]);

  // Fetch team-scoped logs (Issue #7)
  const fetchLogs = useCallback(async (page: number = 0) => {
    try {
      const res = await getLeaderTeamLogs(token, page, 10);
      if (res.code === 0 && res.data) {
        setLogs(res.data.content || []);
        setLogTotalPages(res.data.totalPages || 0);
        setLogPage(page);
      }
    } catch (err) {
      console.error('Failed to fetch team logs:', err);
    }
  }, [token]);

  useEffect(() => {
    fetchDrones();
    fetchTeamInfo();
    fetchLogs();
    const interval = setInterval(fetchDrones, 5000);
    return () => clearInterval(interval);
  }, [fetchDrones, fetchTeamInfo, fetchLogs]);

  // Handle intra-team drone transfer (Issue #7)
  const handleTeamTransfer = async () => {
    if (!transferUavId || !transferToUserId) return;
    setTransferLoading(true);
    setTransferResult(null);
    try {
      const res = await leaderTransferDrone(token, [transferUavId], parseInt(transferToUserId));
      if (res.code === 0) {
        setTransferResult({ success: true, message: '队内控制权转移成功' });
        setTransferUavId('');
        setTransferToUserId('');
        setTransferDialogOpen(false);
        fetchDrones();
        fetchLogs();
      } else {
        setTransferResult({ success: false, message: res.msg || '转移失败' });
      }
    } catch {
      setTransferResult({ success: false, message: '网络错误' });
    } finally {
      setTransferLoading(false);
    }
  };

  const handleQuickCommand = async (uavId: string, commandType: string) => {
    setCommandFeedback(null);
    try {
      const params = commandType === 'TAKEOFF' ? '{"altitude":50}' : '{}';
      const res = await sendControlCommand(token, {
        uavId,
        commandType,
        params,
        confirmed: true,
      });
      if (res.code === 0) {
        setCommandFeedback({ uavId, message: `${commandType} 指令已发送`, success: true });
      } else {
        setCommandFeedback({ uavId, message: res.msg || '指令发送失败', success: false });
      }
    } catch {
      setCommandFeedback({ uavId, message: '网络错误', success: false });
    }
    setTimeout(() => setCommandFeedback(null), 3000);
  };

  const formatTime = (ts: string) => {
    if (!ts) return '-';
    try { return new Date(ts).toLocaleString('zh-CN'); } catch { return ts; }
  };

  // 将 DroneInfo 转换为 MapDrone 格式
  const mapDrones: MapDrone[] = drones.map(d => ({
    uavId: d.uavId, lat: d.lat, lng: d.lng, altitude: d.altitude,
    battery: d.battery, flightStatus: d.flightStatus, onlineStatus: d.onlineStatus,
    model: d.model, owner: d.owner, teamName: d.teamName,
  }));

  return (
    <div className="h-screen bg-slate-900 text-white flex flex-col overflow-hidden">
      {/* 顶部栏 */}
      <header className="flex justify-between items-center px-4 py-2 bg-slate-800 border-b border-slate-700">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Users className="w-6 h-6 text-green-400" />
          队长管理面板
          <Badge variant="outline" className="ml-2 text-green-300 border-green-500">{username}</Badge>
        </h1>
        <div className="flex items-center gap-2">
          {/* 显示/隐藏详情控制面板的勾选按钮 */}
          <Button variant="outline" size="sm"
            onClick={() => {
              setDetailPanelEnabled(!detailPanelEnabled);
              if (detailPanelEnabled) setShowDetailPanel(false);
            }}
            className={`text-xs ${detailPanelEnabled ? 'bg-green-600/30 border-green-500 text-green-300' : 'bg-slate-700/50 border-slate-500/50 text-slate-400'}`}
            title={detailPanelEnabled ? '禁用详情面板' : '启用详情面板'}>
            {detailPanelEnabled ? <Eye className="w-4 h-4 mr-1" /> : <EyeOff className="w-4 h-4 mr-1" />}
            详情面板
          </Button>
          <Button variant="outline" size="sm" onClick={() => setLeftPanelCollapsed(!leftPanelCollapsed)}
            className="bg-slate-700/50 border-slate-500/50 text-slate-100 hover:bg-slate-600/50"
            title={leftPanelCollapsed ? '展开控制面板' : '收起控制面板'}>
            {leftPanelCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </Button>
          <Button variant="outline" size="sm" onClick={() => { fetchDrones(); fetchTeamInfo(); fetchLogs(); }} disabled={loading}
            className="bg-slate-700/50 border-slate-500/50 text-slate-100 hover:bg-slate-600/50">
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />刷新
          </Button>
          <Button variant="outline" size="sm" onClick={onLogout}
            className="bg-slate-700/50 border-slate-500/50 text-slate-100 hover:bg-slate-600/50">
            <LogOut className="w-4 h-4 mr-1" />退出
          </Button>
        </div>
      </header>

      {/* 主体: 左右分栏 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧面板: 控制功能 */}
        {!leftPanelCollapsed && (
          <div className="w-[420px] min-w-[320px] bg-slate-900 border-r border-slate-700 flex flex-col">
            {/* Tab 切换 */}
            <div className="flex gap-0.5 bg-slate-800 border-b border-slate-700 p-1">
              <button onClick={() => setActiveTab('drones')}
                className={`flex items-center px-2 py-1 rounded text-xs transition-colors ${activeTab === 'drones' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
                <Plane className="w-3 h-3 mr-1" />无人机
              </button>
              <button onClick={() => setActiveTab('members')}
                className={`flex items-center px-2 py-1 rounded text-xs transition-colors ${activeTab === 'members' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
                <Users className="w-3 h-3 mr-1" />成员
              </button>
              <button onClick={() => setActiveTab('logs')}
                className={`flex items-center px-2 py-1 rounded text-xs transition-colors ${activeTab === 'logs' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
                <FileText className="w-3 h-3 mr-1" />日志
              </button>
            </div>

            {/* Tab 内容 */}
            <div className="flex-1 overflow-auto p-3">
              {/* 无人机 Tab */}
              {activeTab === 'drones' && (
                <div className="space-y-3">
                  {/* 指令反馈 */}
                  {commandFeedback && (
                    <div className={`p-2 rounded text-xs ${commandFeedback.success ? 'bg-green-900/30 border border-green-700' : 'bg-red-900/30 border border-red-700'}`}>
                      <span className={commandFeedback.success ? 'text-green-300' : 'text-red-300'}>
                        [{commandFeedback.uavId}] {commandFeedback.message}
                      </span>
                    </div>
                  )}
                  {/* 统计 */}
                  <div className="grid grid-cols-2 gap-2">
                    <Card className="bg-slate-800 border-slate-700"><CardContent className="p-2 text-center">
                      <div className="text-lg font-bold text-blue-400">{drones.length}</div>
                      <div className="text-[10px] text-slate-400">无人机数</div>
                    </CardContent></Card>
                    <Card className="bg-slate-800 border-slate-700"><CardContent className="p-2 text-center">
                      <div className="text-lg font-bold text-green-400">{drones.filter(d => d.flightStatus === 'FLYING').length}</div>
                      <div className="text-[10px] text-slate-400">飞行中</div>
                    </CardContent></Card>
                    <Card className="bg-slate-800 border-slate-700"><CardContent className="p-2 text-center">
                      <div className="text-lg font-bold text-cyan-400">{drones.filter(d => d.onlineStatus).length}</div>
                      <div className="text-[10px] text-slate-400">在线</div>
                    </CardContent></Card>
                    <Card className="bg-slate-800 border-slate-700"><CardContent className="p-2 text-center">
                      <div className="text-lg font-bold text-red-400">{drones.filter(d => (d.battery || 0) < 20).length}</div>
                      <div className="text-[10px] text-slate-400">低电量</div>
                    </CardContent></Card>
                  </div>
                  {/* 无人机列表（在线优先） */}
                  <div className="space-y-1">
                    {[...drones].sort((a, b) => {
                      const aO = a.onlineStatus ? 1 : 0, bO = b.onlineStatus ? 1 : 0;
                      if (aO !== bO) return bO - aO;
                      const aF = a.flightStatus === 'FLYING' ? 1 : 0, bF = b.flightStatus === 'FLYING' ? 1 : 0;
                      return bF - aF;
                    }).map(drone => (
                      <div key={drone.uavId}
                        className={`p-2 rounded text-xs cursor-pointer transition-all ${selectedMapDrone === drone.uavId ? 'bg-blue-900/50 border border-blue-500' : 'bg-slate-800 border border-slate-700 hover:border-slate-500'}`}
                        onClick={() => {
                          if (selectedMapDrone === drone.uavId) {
                            // 再次点击同一架无人机，关闭详情面板
                            setShowDetailPanel(false);
                            setSelectedMapDrone(null);
                          } else {
                            setSelectedMapDrone(drone.uavId);
                            if (detailPanelEnabled) setShowDetailPanel(true);
                          }
                        }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-blue-300">{drone.uavId}</span>
                          <Badge className={`text-[10px] px-1 py-0 ${drone.flightStatus === 'FLYING' ? 'bg-green-600' : drone.onlineStatus ? 'bg-blue-600' : 'bg-slate-600'}`}>
                            {drone.flightStatus === 'FLYING' ? '飞行中' : drone.onlineStatus ? '在线' : '离线'}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-slate-400 mb-1">
                          <span className="flex items-center gap-0.5"><Battery className="w-2.5 h-2.5" />{drone.battery != null ? `${drone.battery}%` : 'N/A'}</span>
                          <span>{drone.altitude != null ? `${drone.altitude}m` : ''}</span>
                          <span className="text-slate-500">{drone.owner || ''}</span>
                        </div>
                        {/* 快捷指令 + 转移 */}
                        <div className="flex flex-wrap gap-0.5 mt-1">
                          {COMMANDS.map(cmd => (
                            <Button key={cmd.type} size="sm" variant="outline"
                              className="text-[10px] h-5 px-1.5 bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600"
                              onClick={e => { e.stopPropagation(); handleQuickCommand(drone.uavId, cmd.type); }}>{cmd.label}</Button>
                          ))}
                          <Button size="sm" variant="outline"
                            className="text-[10px] h-5 px-1.5 bg-purple-700/50 border-purple-600 text-purple-300 hover:bg-purple-600"
                            onClick={e => { e.stopPropagation(); setTransferUavId(drone.uavId); setTransferDialogOpen(true); }}>
                            <ArrowRightLeft className="w-2.5 h-2.5 mr-0.5" />转移
                          </Button>
                        </div>
                      </div>
                    ))}
                    {drones.length === 0 && <div className="text-center text-slate-500 py-4 text-xs">暂无数据</div>}
                  </div>
                </div>
              )}

              {/* 成员 Tab */}
              {activeTab === 'members' && (
                <div className="space-y-3">
                  <Card className="bg-slate-800 border-slate-700">
                    <CardHeader className="pb-2 px-3 pt-3">
                      <CardTitle className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1"><Users className="w-3 h-3 text-green-400" />{teamInfo?.teamName || '我的队伍'}</div>
                        <Badge variant="outline" className="text-slate-400 border-slate-600 text-[10px]">{members.length} 人</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-3">
                      {teamInfo && <div className="text-xs text-slate-400 mb-2">队长: <span className="text-slate-300">{teamInfo.leader}</span></div>}
                      <div className="space-y-0.5">
                        {members.map(member => (
                          <div key={member.userId} className="flex items-center justify-between text-[11px] p-1.5 rounded bg-slate-700/50">
                            <div className="flex items-center gap-1">
                              <span className="text-slate-300">{member.realName || member.username}</span>
                              <span className="text-[10px] text-slate-500">ID:{member.userId}</span>
                            </div>
                            <Badge className="bg-slate-600 text-[10px] px-1 py-0">{member.role}</Badge>
                          </div>
                        ))}
                        {members.length === 0 && <div className="text-center text-slate-500 py-3 text-xs">暂无成员数据</div>}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* 日志 Tab */}
              {activeTab === 'logs' && (
                <div className="space-y-2">
                  {logs.map(log => (
                    <div key={log.id} className="p-2 rounded bg-slate-800 border border-slate-700 text-xs">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-slate-500">{formatTime(log.createdAt)}</span>
                        <Badge className={`text-[10px] px-1 py-0 ${log.result === 'SUCCESS' ? 'bg-green-600' : 'bg-red-600'}`}>
                          {log.result === 'SUCCESS' ? '成功' : log.result === 'FAILURE' ? '失败' : log.result || '-'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-blue-600 text-[10px] px-1 py-0">{log.operationType}</Badge>
                        <span className="text-slate-300">{log.username || '-'}</span>
                        {log.targetUavId && <span className="text-blue-300 font-mono">{log.targetUavId}</span>}
                      </div>
                      {log.detail && <div className="text-slate-400 mt-0.5 truncate">{log.detail}</div>}
                    </div>
                  ))}
                  {logs.length === 0 && <div className="text-center text-slate-500 py-4 text-xs">暂无日志</div>}
                  {logTotalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 pt-2">
                      <Button size="sm" variant="outline" disabled={logPage === 0} onClick={() => fetchLogs(logPage - 1)}
                        className="bg-slate-700 border-slate-600 text-slate-300 h-6 text-xs"><ChevronLeft className="w-3 h-3" /></Button>
                      <span className="text-xs text-slate-400">{logPage + 1} / {logTotalPages}</span>
                      <Button size="sm" variant="outline" disabled={logPage >= logTotalPages - 1} onClick={() => fetchLogs(logPage + 1)}
                        className="bg-slate-700 border-slate-600 text-slate-300 h-6 text-xs"><ChevronRight className="w-3 h-3" /></Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 中间: 详情控制面板（点击无人机显示，再次点击关闭） */}
        {showDetailPanel && selectedMapDrone && (() => {
          const drone = drones.find(d => d.uavId === selectedMapDrone);
          if (!drone) return null;
          return (
            <div className="w-[280px] min-w-[240px] bg-slate-900 border-r border-slate-700 overflow-y-auto p-3 space-y-3">
              {/* 无人机状态 */}
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-2 px-3 pt-3">
                  <CardTitle className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1">
                      <Activity className="w-3 h-3 text-green-400" />{drone.uavId} 详情
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setShowDetailPanel(false)}
                      className="bg-slate-700 border-slate-600 hover:bg-slate-600 text-xs h-5 px-1.5">关闭</Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-slate-700/50 rounded p-2 text-center">
                      <div className="text-[10px] text-slate-400 mb-0.5">飞行状态</div>
                      <Badge className={`text-[10px] ${drone.flightStatus === 'FLYING' ? 'bg-green-600' : 'bg-slate-600'}`}>
                        {drone.flightStatus === 'FLYING' ? '飞行中' : '待机'}
                      </Badge>
                    </div>
                    <div className="bg-slate-700/50 rounded p-2 text-center">
                      <div className="text-[10px] text-slate-400 mb-0.5">电量</div>
                      <div className="text-sm font-bold flex items-center justify-center gap-0.5">
                        <Battery className={`w-3 h-3 ${(drone.battery || 0) < 20 ? 'text-red-400' : 'text-green-400'}`} />
                        {drone.battery != null ? `${drone.battery}%` : 'N/A'}
                      </div>
                    </div>
                    <div className="bg-slate-700/50 rounded p-2 text-center">
                      <div className="text-[10px] text-slate-400 mb-0.5">高度</div>
                      <div className="text-sm font-bold">{drone.altitude != null ? `${drone.altitude}m` : 'N/A'}</div>
                    </div>
                    <div className="bg-slate-700/50 rounded p-2 text-center">
                      <div className="text-[10px] text-slate-400 mb-0.5">位置</div>
                      <div className="text-[10px] font-mono">
                        <MapPin className="w-2.5 h-2.5 inline mr-0.5" />
                        {drone.lat?.toFixed(4)}, {drone.lng?.toFixed(4)}
                      </div>
                    </div>
                  </div>
                  {drone.owner && <div className="text-[10px] text-slate-400 mt-2">控制员: <span className="text-slate-300">{drone.owner}</span></div>}
                  {drone.model && <div className="text-[10px] text-slate-400">机型: <span className="text-slate-300">{drone.model}</span></div>}
                </CardContent>
              </Card>

              {/* 控制指令 */}
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-2 px-3 pt-3">
                  <CardTitle className="flex items-center gap-1 text-xs">
                    <Navigation className="w-3 h-3 text-green-400" />控制指令
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <div className="grid grid-cols-3 gap-1">
                    {[
                      { type: 'ARM', label: '解锁', icon: Unlock, color: 'bg-green-600 hover:bg-green-700' },
                      { type: 'DISARM', label: '锁定', icon: Lock, color: 'bg-slate-600 hover:bg-slate-700' },
                      { type: 'TAKEOFF', label: '起飞', icon: ArrowUp, color: 'bg-blue-600 hover:bg-blue-700' },
                      { type: 'LAND', label: '降落', icon: ArrowDown, color: 'bg-amber-600 hover:bg-amber-700' },
                      { type: 'RTL', label: '返航', icon: RotateCcw, color: 'bg-purple-600 hover:bg-purple-700' },
                      { type: 'HOLD', label: '悬停', icon: Pause, color: 'bg-orange-600 hover:bg-orange-700' },
                    ].map(cmd => {
                      const Icon = cmd.icon;
                      return (
                        <Button key={cmd.type}
                          className={`h-auto py-1.5 flex flex-col items-center gap-0.5 ${cmd.color} text-white text-[10px]`}
                          onClick={() => handleQuickCommand(drone.uavId, cmd.type)}>
                          <Icon className="w-3.5 h-3.5" />
                          <span className="font-bold">{cmd.label}</span>
                        </Button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* 转移按钮 */}
              <Button variant="outline" className="w-full text-xs bg-purple-700/30 border-purple-600 text-purple-300 hover:bg-purple-600"
                onClick={() => { setTransferUavId(drone.uavId); setTransferDialogOpen(true); }}>
                <ArrowRightLeft className="w-3 h-3 mr-1" />转移控制权
              </Button>
            </div>
          );
        })()}

        {/* 右侧面板: 地图视图 */}
        <div className="flex-1 h-full">
          <MapPanel drones={mapDrones} selectedDroneId={selectedMapDrone} onDroneClick={(id) => {
            if (selectedMapDrone === id) {
              setShowDetailPanel(false);
              setSelectedMapDrone(null);
            } else {
              setSelectedMapDrone(id);
              if (detailPanelEnabled) setShowDetailPanel(true);
            }
          }}
            showDroneList={leftPanelCollapsed} showEventLog={false} />
        </div>
      </div>

      {/* 转移对话框 */}
      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">队内控制权转移</DialogTitle>
            <DialogDescription className="text-slate-400">
              将无人机 {transferUavId} 的控制权转移给队内成员
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-slate-300 mb-1 block">目标成员</label>
              <select
                value={transferToUserId}
                onChange={e => setTransferToUserId(e.target.value)}
                className="w-full rounded-md bg-slate-700 border-slate-600 text-white px-3 py-2 text-sm"
              >
                <option value="">选择队内成员...</option>
                {members.map(m => (
                  <option key={m.userId} value={m.userId}>
                    {m.realName || m.username} ({m.role})
                  </option>
                ))}
              </select>
            </div>
            {transferResult && (
              <div className={`p-2 rounded ${transferResult.success ? 'bg-green-900/30 border border-green-700' : 'bg-red-900/30 border border-red-700'}`}>
                <div className="flex items-center gap-2 text-sm">
                  {transferResult.success
                    ? <Activity className="w-4 h-4 text-green-400" />
                    : <AlertTriangle className="w-4 h-4 text-red-400" />}
                  <span className={transferResult.success ? 'text-green-300' : 'text-red-300'}>{transferResult.message}</span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setTransferDialogOpen(false); setTransferResult(null); }}
              className="bg-slate-700 border-slate-600 text-slate-300">取消</Button>
            <Button onClick={handleTeamTransfer} disabled={transferLoading || !transferToUserId}
              className="bg-purple-600 hover:bg-purple-700">
              {transferLoading ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : null}
              确认转移
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
