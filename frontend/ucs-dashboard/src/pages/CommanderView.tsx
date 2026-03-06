import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Plane,
  Shield,
  FileText,
  Users,
  RefreshCw,
  LogOut,
  ArrowRightLeft,
  Battery,
  Activity,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelRightClose,
  PanelLeftOpen,
  PanelRightOpen,
} from 'lucide-react';
import {
  getFleetOverview,
  transferPermission,
  transferPermissionToTeam,
  getOperationLogs,
  getLogsByType,
  getCommanderTeams,
  getTeamMembers,
  getCommanderUsers,
  type DroneInfo,
  type OperationLog,
} from '@/services/api';
import MapPanel, { type MapDrone } from '@/components/MapPanel';

interface CommanderViewProps {
  token: string;
  username: string;
  onLogout: () => void;
}

export default function CommanderView({ token, username, onLogout }: CommanderViewProps) {
  // Fleet state
  const [drones, setDrones] = useState<DroneInfo[]>([]);
  const [loading, setLoading] = useState(false);

  // Permission transfer state
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [selectedUavIds, setSelectedUavIds] = useState<string[]>([]);
  const [toUserId, setToUserId] = useState('');
  const [toTeamId, setToTeamId] = useState('');
  const [transferMode, setTransferMode] = useState<'user' | 'team'>('team');
  const [transferReason, setTransferReason] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferResult, setTransferResult] = useState<{ success: boolean; message: string } | null>(null);

  // Operation logs state
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [logPage, setLogPage] = useState(0);
  const [logTotalPages, setLogTotalPages] = useState(0);
  const [logFilter, setLogFilter] = useState('ALL');
  const [logLoading, setLogLoading] = useState(false);

  // Active tab state
  const [activeTab, setActiveTab] = useState<'fleet' | 'permission' | 'logs' | 'teams'>('fleet');

  // Teams state
  const [teams, setTeams] = useState<Array<{ teamId: string; teamName: string; leader: string; memberCount: number; droneCount?: number; description?: string }>>([]);
  const [teamMembers, setTeamMembers] = useState<Record<string, Array<{ userId: string; username: string; realName: string; role: string; name?: string }>>>({});
  // 修复: 使用 Set 支持多个团队同时展开
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());

  // 可折叠面板状态
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);

  // 地图选中的无人机
  const [selectedMapDrone, setSelectedMapDrone] = useState<string | null>(null);

  // 注册用户列表（用于下拉选择）
  const [registeredUsers, setRegisteredUsers] = useState<Array<{ userId: number; username: string; realName: string; role: string }>>([]);

  // Fetch fleet data
  const fetchFleet = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getFleetOverview(token);
      if (res.code === 0 && res.data) {
        const data = res.data as unknown as Record<string, unknown>;
        setDrones(Array.isArray(data.drones) ? data.drones as DroneInfo[] : (Array.isArray(res.data) ? res.data : []));
      }
    } catch (err) {
      console.error('Failed to fetch fleet:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Fetch operation logs
  const fetchLogs = useCallback(async (page: number = 0, filter: string = 'ALL') => {
    setLogLoading(true);
    try {
      const res = filter === 'ALL'
        ? await getOperationLogs(token, page, 15)
        : await getLogsByType(token, filter, page, 15);
      if (res.code === 0 && res.data) {
        setLogs(res.data.content || []);
        setLogTotalPages(res.data.totalPages || 0);
        setLogPage(page);
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    } finally {
      setLogLoading(false);
    }
  }, [token]);

  // Fetch teams via commander API (fixes Issue #2: "暂无团队数据")
  const fetchTeams = useCallback(async () => {
    try {
      const res = await getCommanderTeams(token);
      if (res.code === 0 && res.data) {
        setTeams(Array.isArray(res.data) ? res.data : []);
      }
    } catch (err) {
      console.error('Failed to fetch teams:', err);
    }
  }, [token]);

  // Fetch team members
  const fetchMembers = useCallback(async (teamId: string) => {
    try {
      const res = await getTeamMembers(token, teamId);
      if (res.code === 0 && res.data) {
        // 后端TeamMemberDTO返回 name 字段，前端需要映射为 realName
        const mapped = (Array.isArray(res.data) ? res.data : []).map((m: Record<string, unknown>) => ({
          userId: (m.userId as string) || '',
          username: (m.name as string) || (m.username as string) || '',
          realName: (m.name as string) || (m.realName as string) || '',
          role: (m.role as string) || '',
        }));
        setTeamMembers(prev => ({ ...prev, [teamId]: mapped }));
      }
    } catch (err) {
      console.error('Failed to fetch team members:', err);
    }
  }, [token]);

  // 获取注册用户列表（下拉选择用）
  const fetchUsers = useCallback(async () => {
    try {
      const res = await getCommanderUsers(token);
      if (res.code === 0 && res.data) {
        setRegisteredUsers(Array.isArray(res.data) ? res.data : []);
      }
    } catch (err) { console.error(err); }
  }, [token]);

  useEffect(() => {
    fetchFleet();
    fetchLogs(0, 'ALL');
    fetchTeams();
    fetchUsers();
    const interval = setInterval(fetchFleet, 5000);
    return () => clearInterval(interval);
  }, [fetchFleet, fetchLogs, fetchTeams, fetchUsers]);

  // Toggle drone selection for permission transfer
  const toggleDroneSelection = (uavId: string) => {
    setSelectedUavIds(prev =>
      prev.includes(uavId)
        ? prev.filter(id => id !== uavId)
        : [...prev, uavId]
    );
  };

  // Handle permission transfer (supports both user and team targets)
  const handleTransfer = async () => {
    if (selectedUavIds.length === 0) return;
    if (transferMode === 'user' && !toUserId) return;
    if (transferMode === 'team' && !toTeamId) return;
    setTransferLoading(true);
    setTransferResult(null);
    try {
      let res;
      if (transferMode === 'team') {
        // Issue #4: Transfer to team (assigns to team leader)
        res = await transferPermissionToTeam(token, selectedUavIds, parseInt(toTeamId));
      } else {
        res = await transferPermission(token, {
          uavIds: selectedUavIds,
          toUserId: parseInt(toUserId),
          reason: transferReason || '指挥员操作',
        });
      }
      if (res.code === 0) {
        setTransferResult({ success: true, message: '权限转移成功' });
        setSelectedUavIds([]);
        setToUserId('');
        setToTeamId('');
        setTransferReason('');
        fetchFleet();
        fetchTeams();
        fetchLogs(0, logFilter);
      } else {
        setTransferResult({ success: false, message: res.msg || '权限转移失败' });
      }
    } catch {
      setTransferResult({ success: false, message: '网络错误' });
    } finally {
      setTransferLoading(false);
    }
  };

  // 修复: 支持多个团队同时展开
  const handleTeamExpand = (teamId: string) => {
    setExpandedTeams(prev => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
        if (!teamMembers[teamId]) fetchMembers(teamId);
      }
      return next;
    });
  };

  // Log type options
  const LOG_TYPES = [
    { value: 'ALL', label: '全部' },
    { value: 'CONTROL_COMMAND', label: '控制指令' },
    { value: 'PERMISSION_TRANSFER', label: '权限转移' },
    { value: 'BATCH_CONTROL', label: '批量控制' },
  ];

  const formatTime = (ts: string) => {
    if (!ts) return '-';
    try {
      return new Date(ts).toLocaleString('zh-CN');
    } catch {
      return ts;
    }
  };

  const getOperationBadgeColor = (type: string) => {
    switch (type) {
      case 'CONTROL_COMMAND': return 'bg-blue-600';
      case 'PERMISSION_TRANSFER': return 'bg-purple-600';
      case 'BATCH_CONTROL': return 'bg-cyan-600';
      default: return 'bg-slate-600';
    }
  };

  const getResultBadgeColor = (result: string) => {
    if (result === 'SUCCESS') return 'bg-green-600';
    if (result === 'FAILURE') return 'bg-red-600';
    return 'bg-slate-600';
  };

  // 将 DroneInfo 转换为 MapDrone 格式
  const mapDrones: MapDrone[] = drones.map(d => ({
    uavId: d.uavId, lat: d.lat, lng: d.lng, altitude: d.altitude,
    battery: d.battery, flightStatus: d.flightStatus, onlineStatus: d.onlineStatus,
    model: d.model, owner: d.owner, teamName: d.teamName, teamLeader: d.teamLeader,
  }));

  // 事件日志格式化为地图面板使用
  const eventLogsForMap = logs.slice(0, 20).map(log => ({
    id: log.id, time: formatTime(log.createdAt),
    detail: log.detail || log.operationType, result: log.result,
  }));

  return (
    <div className="h-screen bg-slate-900 text-white flex flex-col overflow-hidden">
      {/* 顶部栏 */}
      <header className="flex justify-between items-center px-4 py-2 bg-slate-800 border-b border-slate-700">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Shield className="w-6 h-6 text-amber-400" />
          指挥员控制台
          <Badge variant="outline" className="ml-2 text-amber-300 border-amber-500">{username}</Badge>
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setLeftPanelCollapsed(!leftPanelCollapsed)}
            className="bg-slate-700/50 border-slate-500/50 text-slate-100 hover:bg-slate-600/50"
            title={leftPanelCollapsed ? '展开左侧面板' : '收起左侧面板'}>
            {leftPanelCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRightPanelCollapsed(!rightPanelCollapsed)}
            className="bg-slate-700/50 border-slate-500/50 text-slate-100 hover:bg-slate-600/50"
            title={rightPanelCollapsed ? '展开右侧面板' : '收起右侧面板'}>
            {rightPanelCollapsed ? <PanelRightOpen className="w-4 h-4" /> : <PanelRightClose className="w-4 h-4" />}
          </Button>
          <Button variant="outline" size="sm" onClick={() => { fetchFleet(); fetchLogs(logPage, logFilter); fetchTeams(); }}
            disabled={loading} className="bg-slate-700/50 border-slate-500/50 text-slate-100 hover:bg-slate-600/50">
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />刷新
          </Button>
          <Button variant="outline" size="sm" onClick={onLogout}
            className="bg-slate-700/50 border-slate-500/50 text-slate-100 hover:bg-slate-600/50">
            <LogOut className="w-4 h-4 mr-1" />退出
          </Button>
        </div>
      </header>

      {/* 主体: 左右分栏布局 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧面板: 控制功能 (约1/3宽度) */}
        {!leftPanelCollapsed && (
          <div className="w-[420px] min-w-[320px] bg-slate-900 border-r border-slate-700 flex flex-col">
            {/* Tab 切换 */}
            <div className="flex gap-0.5 bg-slate-800 border-b border-slate-700 p-1">
              <button onClick={() => setActiveTab('fleet')}
                className={`flex items-center px-2 py-1 rounded text-xs transition-colors ${activeTab === 'fleet' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
                <Plane className="w-3 h-3 mr-1" />机队
              </button>
              <button onClick={() => setActiveTab('permission')}
                className={`flex items-center px-2 py-1 rounded text-xs transition-colors ${activeTab === 'permission' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
                <ArrowRightLeft className="w-3 h-3 mr-1" />权限
              </button>
              <button onClick={() => setActiveTab('logs')}
                className={`flex items-center px-2 py-1 rounded text-xs transition-colors ${activeTab === 'logs' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
                <FileText className="w-3 h-3 mr-1" />日志
              </button>
              <button onClick={() => setActiveTab('teams')}
                className={`flex items-center px-2 py-1 rounded text-xs transition-colors ${activeTab === 'teams' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
                <Users className="w-3 h-3 mr-1" />团队
              </button>
            </div>

            {/* Tab 内容 */}
            <div className="flex-1 overflow-auto p-3">
              {/* 机队总览 */}
              {activeTab === 'fleet' && (
                <div className="flex flex-col h-full">
                  {/* 统计卡片 - 始终固定显示 */}
                  <div className="grid grid-cols-4 gap-1.5 mb-2 flex-shrink-0">
                    <Card className="bg-slate-800 border-slate-700"><CardContent className="p-1.5 text-center">
                      <div className="text-base font-bold text-blue-400">{drones.length}</div>
                      <div className="text-[9px] text-slate-400">总数</div>
                    </CardContent></Card>
                    <Card className="bg-slate-800 border-slate-700"><CardContent className="p-1.5 text-center">
                      <div className="text-base font-bold text-green-400">{drones.filter(d => d.flightStatus === 'FLYING').length}</div>
                      <div className="text-[9px] text-slate-400">飞行中</div>
                    </CardContent></Card>
                    <Card className="bg-slate-800 border-slate-700"><CardContent className="p-1.5 text-center">
                      <div className="text-base font-bold text-cyan-400">{drones.filter(d => d.onlineStatus === true).length}</div>
                      <div className="text-[9px] text-slate-400">在线</div>
                    </CardContent></Card>
                    <Card className="bg-slate-800 border-slate-700"><CardContent className="p-1.5 text-center">
                      <div className="text-base font-bold text-red-400">{drones.filter(d => (d.battery || 0) < 20).length}</div>
                      <div className="text-[9px] text-slate-400">低电量</div>
                    </CardContent></Card>
                  </div>
                  {/* 无人机列表（在线优先排序）- 独立滚动区域 */}
                  <div className="flex-1 overflow-y-auto space-y-1 scrollbar-thin" style={{ scrollbarWidth: 'thin', scrollbarColor: '#475569 #1e293b' }}>
                    {[...drones].sort((a, b) => {
                      const aO = a.onlineStatus === true ? 1 : 0, bO = b.onlineStatus === true ? 1 : 0;
                      if (aO !== bO) return bO - aO;
                      const aF = a.flightStatus === 'FLYING' ? 1 : 0, bF = b.flightStatus === 'FLYING' ? 1 : 0;
                      return bF - aF;
                    }).map(drone => (
                      <div key={drone.uavId}
                        className={`p-2 rounded text-xs cursor-pointer transition-all ${selectedMapDrone === drone.uavId ? 'bg-blue-900/50 border border-blue-500' : 'bg-slate-800 border border-slate-700 hover:border-slate-500'}`}
                        onClick={() => setSelectedMapDrone(drone.uavId)}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="font-bold text-blue-300">{drone.uavId}</span>
                          <div className="flex items-center gap-1">
                            <Badge className={`text-[10px] px-1 py-0 ${drone.flightStatus === 'FLYING' ? 'bg-green-600' : drone.onlineStatus === true ? 'bg-blue-600' : 'bg-slate-600'}`}>
                              {drone.flightStatus === 'FLYING' ? '飞行中' : drone.onlineStatus === true ? '在线' : '离线'}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-slate-400">
                          <span className="flex items-center gap-0.5"><Battery className="w-2.5 h-2.5" />{drone.battery != null ? `${drone.battery}%` : 'N/A'}</span>
                          <span>{drone.altitude != null ? `${drone.altitude}m` : ''}</span>
                          <span className="text-slate-500">{drone.teamName || ''}</span>
                          {drone.teamLeader && <span className="text-slate-500">队长:{drone.teamLeader}</span>}
                          <Button size="sm" variant="outline"
                            className="text-[9px] h-4 px-1 py-0 bg-purple-700/30 border-purple-600/50 text-purple-300 hover:bg-purple-600 ml-auto"
                            onClick={e => {
                              e.stopPropagation();
                              setSelectedUavIds([drone.uavId]);
                              setActiveTab('permission');
                            }}>
                            <ArrowRightLeft className="w-2 h-2 mr-0.5" />转接
                          </Button>
                        </div>
                      </div>
                    ))}
                    {drones.length === 0 && <div className="text-center text-slate-500 py-4 text-xs">暂无无人机数据</div>}
                  </div>
                </div>
              )}

              {/* 权限管理 */}
              {activeTab === 'permission' && (
                <div className="space-y-3">
                  <Card className="bg-slate-800 border-slate-700">
                    <CardHeader className="pb-2 px-3 pt-3">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <ArrowRightLeft className="w-4 h-4 text-purple-400" />控制权限转移
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-3">
                      <p className="text-xs text-slate-400 mb-3">选择无人机，指定目标队伍或用户。转移至队伍时自动分配给队长。</p>
                      <div className="mb-3">
                        <label className="text-xs text-slate-300 mb-1 block">选择无人机</label>
                        <div className="flex flex-wrap gap-1">
                          {drones.map(drone => (
                            <Button key={drone.uavId} size="sm"
                              variant={selectedUavIds.includes(drone.uavId) ? 'default' : 'outline'}
                              className={`text-xs h-6 px-2 ${selectedUavIds.includes(drone.uavId) ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'}`}
                              onClick={() => toggleDroneSelection(drone.uavId)}>{drone.uavId}</Button>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-1 mb-3">
                        <Button size="sm" variant={transferMode === 'team' ? 'default' : 'outline'}
                          className={`text-xs h-7 ${transferMode === 'team' ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}`}
                          onClick={() => setTransferMode('team')}>转移至队伍</Button>
                        <Button size="sm" variant={transferMode === 'user' ? 'default' : 'outline'}
                          className={`text-xs h-7 ${transferMode === 'user' ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}`}
                          onClick={() => setTransferMode('user')}>转移至个人</Button>
                      </div>
                      <div className="space-y-2 mb-3">
                        {transferMode === 'team' ? (
                          <div>
                            <label className="text-xs text-slate-300 mb-1 block">目标队伍</label>
                            <select value={toTeamId} onChange={e => setToTeamId(e.target.value)}
                              className="w-full rounded-md bg-slate-700 border-slate-600 text-white px-2 py-1.5 text-xs">
                              <option value="">选择队伍...</option>
                              {teams.map(team => (
                                <option key={team.teamId} value={team.teamId.replace('T', '')}>{team.teamName} ({team.leader || '无队长'})</option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div>
                            <label className="text-xs text-slate-300 mb-1 block">目标用户</label>
                            <select value={toUserId} onChange={e => setToUserId(e.target.value)}
                              className="w-full rounded-md bg-slate-700 border-slate-600 text-white px-2 py-1.5 text-xs">
                              <option value="">选择用户...</option>
                              {registeredUsers.map(user => (
                                <option key={user.userId} value={user.userId}>{user.realName || user.username} ({user.role || '无角色'})</option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div>
                          <label className="text-xs text-slate-300 mb-1 block">转移原因</label>
                          <Input value={transferReason} onChange={e => setTransferReason(e.target.value)}
                            placeholder="输入转移原因" className="bg-slate-700 border-slate-600 text-white text-xs h-8" />
                        </div>
                      </div>
                      <Button onClick={() => setTransferDialogOpen(true)}
                        disabled={selectedUavIds.length === 0 || (transferMode === 'user' ? !toUserId : !toTeamId)}
                        className="bg-purple-600 hover:bg-purple-700 text-xs h-8 w-full">
                        <ArrowRightLeft className="w-3 h-3 mr-1" />
                        确认转移 ({selectedUavIds.length} 架)
                      </Button>
                      {transferResult && (
                        <div className={`mt-2 p-2 rounded text-xs ${transferResult.success ? 'bg-green-900/30 border border-green-700' : 'bg-red-900/30 border border-red-700'}`}>
                          <div className="flex items-center gap-1">
                            {transferResult.success ? <Activity className="w-3 h-3 text-green-400" /> : <AlertTriangle className="w-3 h-3 text-red-400" />}
                            <span className={transferResult.success ? 'text-green-300' : 'text-red-300'}>{transferResult.message}</span>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* 操作日志 */}
              {activeTab === 'logs' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-1 mb-2">
                    {LOG_TYPES.map(lt => (
                      <Button key={lt.value} size="sm" variant={logFilter === lt.value ? 'default' : 'outline'}
                        className={`text-xs h-6 ${logFilter === lt.value ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'}`}
                        onClick={() => { setLogFilter(lt.value); fetchLogs(0, lt.value); }}>{lt.label}</Button>
                    ))}
                  </div>
                  <div className="space-y-1">
                    {logs.map(log => (
                      <div key={log.id} className="p-2 rounded bg-slate-800 border border-slate-700 text-xs">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-slate-500">{formatTime(log.createdAt)}</span>
                          <Badge className={`${getResultBadgeColor(log.result)} text-[10px] px-1 py-0`}>
                            {log.result === 'SUCCESS' ? '成功' : log.result === 'FAILURE' ? '失败' : log.result || '-'}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={`${getOperationBadgeColor(log.operationType)} text-[10px] px-1 py-0`}>{log.operationType}</Badge>
                          <span className="text-slate-300">{log.username || '-'}</span>
                          {log.targetUavId && <span className="text-blue-300 font-mono">{log.targetUavId}</span>}
                        </div>
                        {log.detail && <div className="text-slate-400 mt-0.5 truncate">{log.detail}</div>}
                      </div>
                    ))}
                    {logs.length === 0 && <div className="text-center text-slate-500 py-4 text-xs">{logLoading ? '加载中...' : '暂无操作日志'}</div>}
                  </div>
                  {logTotalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 pt-2">
                      <Button size="sm" variant="outline" disabled={logPage === 0} onClick={() => fetchLogs(logPage - 1, logFilter)}
                        className="bg-slate-700 border-slate-600 text-slate-300 h-6 text-xs"><ChevronLeft className="w-3 h-3" /></Button>
                      <span className="text-xs text-slate-400">{logPage + 1} / {logTotalPages}</span>
                      <Button size="sm" variant="outline" disabled={logPage >= logTotalPages - 1} onClick={() => fetchLogs(logPage + 1, logFilter)}
                        className="bg-slate-700 border-slate-600 text-slate-300 h-6 text-xs"><ChevronRight className="w-3 h-3" /></Button>
                    </div>
                  )}
                </div>
              )}

              {/* 团队管理 */}
              {activeTab === 'teams' && (
                <div className="space-y-2">
                  {teams.map(team => (
                    <Card key={team.teamId} className="bg-slate-800 border-slate-700">
                      <CardHeader className="pb-1 px-3 pt-2 cursor-pointer" onClick={() => handleTeamExpand(team.teamId)}>
                        <CardTitle className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1"><Users className="w-3 h-3 text-blue-400" />{team.teamName}</div>
                          <Badge variant="outline" className="text-slate-400 border-slate-600 text-[10px]">{team.memberCount} 人</Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-3 pb-2">
                        <div className="text-xs text-slate-400 mb-1">
                          队长: <span className="text-slate-300">{team.leader}</span>
                          {team.droneCount != null && <span className="ml-2">无人机: {team.droneCount}</span>}
                        </div>
                        {expandedTeams.has(team.teamId) && teamMembers[team.teamId] && (
                          <div className="space-y-0.5 mt-1 pt-1 border-t border-slate-700">
                            {teamMembers[team.teamId].map(member => (
                              <div key={member.userId} className="flex items-center justify-between text-[11px] p-1 rounded bg-slate-700/50">
                                <span className="text-slate-300">{member.realName || member.username}</span>
                                <Badge className="bg-slate-600 text-[10px] px-1 py-0">{member.role}</Badge>
                              </div>
                            ))}
                            {teamMembers[team.teamId].length === 0 && <div className="text-center text-slate-500 py-1 text-[10px]">暂无成员</div>}
                          </div>
                        )}
                        <Button size="sm" variant="ghost" className="w-full mt-1 text-[10px] text-slate-400 hover:text-white h-5"
                          onClick={() => handleTeamExpand(team.teamId)}>
                          {expandedTeams.has(team.teamId) ? '收起成员' : '展开成员'}
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                  {teams.length === 0 && <div className="text-center text-slate-500 py-4 text-xs">暂无团队数据</div>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 右侧面板: 地图视图 (约2/3宽度) */}
        {!rightPanelCollapsed && (
          <div className="flex-1 h-full">
            <MapPanel drones={mapDrones} selectedDroneId={selectedMapDrone} onDroneClick={setSelectedMapDrone}
              showDroneList={leftPanelCollapsed} showEventLog={true} eventLogs={eventLogsForMap} />
          </div>
        )}

        {/* 两侧都收起时显示提示 */}
        {leftPanelCollapsed && rightPanelCollapsed && (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            <div className="text-center">
              <Shield className="w-16 h-16 mx-auto mb-4 opacity-20" />
              <p>左右面板均已收起</p>
              <p className="text-xs mt-1">点击顶部按钮展开面板</p>
            </div>
          </div>
        )}
      </div>

      {/* 确认对话框 */}
      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">确认权限转移</DialogTitle>
            <DialogDescription className="text-slate-400">
              {transferMode === 'team'
                ? `将以下无人机的控制权转移给队伍 (ID: ${toTeamId})`
                : `将以下无人机的控制权转移给用户: ${registeredUsers.find(u => u.userId.toString() === toUserId)?.realName || toUserId}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {selectedUavIds.map(id => (<Badge key={id} className="bg-purple-600">{id}</Badge>))}
            </div>
            {transferReason && <p className="text-sm text-slate-400">原因: {transferReason}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferDialogOpen(false)}
              className="bg-slate-700 border-slate-600 text-slate-300">取消</Button>
            <Button onClick={() => { setTransferDialogOpen(false); handleTransfer(); }}
              disabled={transferLoading} className="bg-purple-600 hover:bg-purple-700">
              {transferLoading ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : null}
              确认转移
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
