import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
// Using simple state-based tabs instead of Radix UI Tabs for better compatibility
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
} from 'lucide-react';
import {
  getFleetOverview,
  transferPermission,
  transferPermissionToTeam,
  getOperationLogs,
  getLogsByType,
  getCommanderTeams,
  getTeamMembers,
  type DroneInfo,
  type OperationLog,
} from '@/services/api';

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
  const [teamMembers, setTeamMembers] = useState<Record<string, Array<{ userId: string; username: string; realName: string; role: string }>>>({});
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);

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
        setTeamMembers(prev => ({ ...prev, [teamId]: res.data }));
      }
    } catch (err) {
      console.error('Failed to fetch team members:', err);
    }
  }, [token]);

  useEffect(() => {
    fetchFleet();
    fetchLogs(0, 'ALL');
    fetchTeams();
    const interval = setInterval(fetchFleet, 5000);
    return () => clearInterval(interval);
  }, [fetchFleet, fetchLogs, fetchTeams]);

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

  const handleTeamExpand = (teamId: string) => {
    if (expandedTeam === teamId) {
      setExpandedTeam(null);
    } else {
      setExpandedTeam(teamId);
      if (!teamMembers[teamId]) {
        fetchMembers(teamId);
      }
    }
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

  return (
    <div className="h-screen bg-slate-900 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex justify-between items-center px-4 py-2 bg-slate-800 border-b border-slate-700">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Shield className="w-6 h-6 text-amber-400" />
          指挥员控制台
          <Badge variant="outline" className="ml-2 text-amber-300 border-amber-500">
            {username}
          </Badge>
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { fetchFleet(); fetchLogs(logPage, logFilter); }}
            disabled={loading} className="bg-slate-700/50 border-slate-500/50 text-slate-100 hover:bg-slate-600/50">
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />刷新
          </Button>
          <Button variant="outline" size="sm" onClick={onLogout}
            className="bg-slate-700/50 border-slate-500/50 text-slate-100 hover:bg-slate-600/50">
            <LogOut className="w-4 h-4 mr-1" />退出
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden p-4">
        <div className="h-full flex flex-col">
          <div className="flex gap-1 bg-slate-800 border border-slate-700 rounded-md p-1 w-fit">
            <button onClick={() => setActiveTab('fleet')}
              className={`flex items-center px-3 py-1.5 rounded text-sm transition-colors ${activeTab === 'fleet' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700/50'}`}>
              <Plane className="w-4 h-4 mr-1" />机队总览
            </button>
            <button onClick={() => setActiveTab('permission')}
              className={`flex items-center px-3 py-1.5 rounded text-sm transition-colors ${activeTab === 'permission' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700/50'}`}>
              <ArrowRightLeft className="w-4 h-4 mr-1" />权限管理
            </button>
            <button onClick={() => setActiveTab('logs')}
              className={`flex items-center px-3 py-1.5 rounded text-sm transition-colors ${activeTab === 'logs' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700/50'}`}>
              <FileText className="w-4 h-4 mr-1" />操作日志
            </button>
            <button onClick={() => setActiveTab('teams')}
              className={`flex items-center px-3 py-1.5 rounded text-sm transition-colors ${activeTab === 'teams' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700/50'}`}>
              <Users className="w-4 h-4 mr-1" />团队管理
            </button>
          </div>

          {/* Fleet Overview */}
          {activeTab === 'fleet' && <div className="flex-1 overflow-auto mt-3">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-blue-400">{drones.length}</div>
                  <div className="text-xs text-slate-400">无人机总数</div>
                </CardContent>
              </Card>
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-green-400">
                    {drones.filter(d => d.flightStatus === 'FLYING').length}
                  </div>
                  <div className="text-xs text-slate-400">飞行中</div>
                </CardContent>
              </Card>
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-cyan-400">
                    {drones.filter(d => d.onlineStatus).length}
                  </div>
                  <div className="text-xs text-slate-400">在线</div>
                </CardContent>
              </Card>
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-red-400">
                    {drones.filter(d => (d.battery || 0) < 20).length}
                  </div>
                  <div className="text-xs text-slate-400">低电量</div>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700 hover:bg-slate-700/50">
                      <TableHead className="text-slate-400">UAV ID</TableHead>
                      <TableHead className="text-slate-400">型号</TableHead>
                      <TableHead className="text-slate-400">飞行状态</TableHead>
                      <TableHead className="text-slate-400">电量</TableHead>
                      <TableHead className="text-slate-400">高度</TableHead>
                      <TableHead className="text-slate-400">位置</TableHead>
                      <TableHead className="text-slate-400">归属人</TableHead>
                      <TableHead className="text-slate-400">控制员</TableHead>
                      <TableHead className="text-slate-400">团队</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drones.map(drone => (
                      <TableRow key={drone.uavId} className="border-slate-700 hover:bg-slate-700/50">
                        <TableCell className="font-bold text-blue-300">{drone.uavId}</TableCell>
                        <TableCell className="text-slate-300">{drone.model || '-'}</TableCell>
                        <TableCell>
                          <Badge className={drone.flightStatus === 'FLYING' ? 'bg-green-600' : 'bg-slate-600'}>
                            {drone.flightStatus === 'FLYING' ? '飞行中' : '待机'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Battery className={`w-3 h-3 ${(drone.battery || 0) < 20 ? 'text-red-400' : 'text-green-400'}`} />
                            <span className={(drone.battery || 0) < 20 ? 'text-red-400' : 'text-slate-300'}>
                              {drone.battery != null ? `${drone.battery}%` : 'N/A'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-300">{drone.altitude != null ? `${drone.altitude}m` : '-'}</TableCell>
                        <TableCell className="text-slate-400 text-xs font-mono">
                          {drone.lat?.toFixed(4)}, {drone.lng?.toFixed(4)}
                        </TableCell>
                        <TableCell className="text-slate-300">{(drone as unknown as Record<string, unknown>).ownerName as string || drone.owner || '-'}</TableCell>
                        <TableCell className="text-slate-300">{(drone as unknown as Record<string, unknown>).controllerName as string || '-'}</TableCell>
                        <TableCell className="text-slate-300">{drone.teamName || '-'}</TableCell>
                      </TableRow>
                    ))}
                    {drones.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-slate-500 py-8">
                          暂无无人机数据
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>}

          {/* Permission Management */}
          {activeTab === 'permission' && <div className="flex-1 overflow-auto mt-3">
            <Card className="bg-slate-800 border-slate-700 mb-4">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ArrowRightLeft className="w-5 h-5 text-purple-400" />
                  控制权限转移
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-4">
                  选择需要转移控制权的无人机，然后指定目标队伍或用户。转移至队伍时，控制权自动分配给队长。
                </p>

                {/* Drone selection */}
                <div className="mb-4">
                  <label className="text-sm text-slate-300 mb-2 block">选择无人机 (可多选)</label>
                  <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
                    {drones.map(drone => (
                      <Button
                        key={drone.uavId}
                        size="sm"
                        variant={selectedUavIds.includes(drone.uavId) ? 'default' : 'outline'}
                        className={
                          selectedUavIds.includes(drone.uavId)
                            ? 'bg-purple-600 hover:bg-purple-700 text-white'
                            : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
                        }
                        onClick={() => toggleDroneSelection(drone.uavId)}
                      >
                        {drone.uavId}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Transfer mode toggle */}
                <div className="flex gap-2 mb-4">
                  <Button size="sm"
                    variant={transferMode === 'team' ? 'default' : 'outline'}
                    className={transferMode === 'team' ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}
                    onClick={() => setTransferMode('team')}>
                    转移至队伍
                  </Button>
                  <Button size="sm"
                    variant={transferMode === 'user' ? 'default' : 'outline'}
                    className={transferMode === 'user' ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}
                    onClick={() => setTransferMode('user')}>
                    转移至个人
                  </Button>
                </div>

                {/* Transfer form */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  {transferMode === 'team' ? (
                    <div>
                      <label className="text-sm text-slate-300 mb-1 block">目标队伍</label>
                      <select
                        value={toTeamId}
                        onChange={e => setToTeamId(e.target.value)}
                        className="w-full rounded-md bg-slate-700 border-slate-600 text-white px-3 py-2 text-sm"
                      >
                        <option value="">选择队伍...</option>
                        {teams.map(team => (
                          <option key={team.teamId} value={team.teamId.replace('T', '')}>
                            {team.teamName} ({team.leader || '无队长'})
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="text-sm text-slate-300 mb-1 block">目标用户ID</label>
                      <Input
                        type="number"
                        value={toUserId}
                        onChange={e => setToUserId(e.target.value)}
                        placeholder="输入用户ID"
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                  )}
                  <div className="md:col-span-2">
                    <label className="text-sm text-slate-300 mb-1 block">转移原因</label>
                    <Input
                      value={transferReason}
                      onChange={e => setTransferReason(e.target.value)}
                      placeholder="输入转移原因"
                      className="bg-slate-700 border-slate-600 text-white"
                    />
                  </div>
                </div>

                <Button
                  onClick={() => setTransferDialogOpen(true)}
                  disabled={selectedUavIds.length === 0 || (transferMode === 'user' ? !toUserId : !toTeamId)}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  <ArrowRightLeft className="w-4 h-4 mr-1" />
                  确认转移 ({selectedUavIds.length} 架) → {transferMode === 'team' ? '队伍' : '个人'}
                </Button>

                {transferResult && (
                  <div className={`mt-3 p-3 rounded ${transferResult.success ? 'bg-green-900/30 border border-green-700' : 'bg-red-900/30 border border-red-700'}`}>
                    <div className="flex items-center gap-2">
                      {transferResult.success ? (
                        <Activity className="w-4 h-4 text-green-400" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                      )}
                      <span className={transferResult.success ? 'text-green-300' : 'text-red-300'}>
                        {transferResult.message}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Confirm Dialog */}
            <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
              <DialogContent className="bg-slate-800 border-slate-700 text-white">
                <DialogHeader>
                  <DialogTitle className="text-white">确认权限转移</DialogTitle>
                  <DialogDescription className="text-slate-400">
                    {transferMode === 'team'
                      ? `将以下无人机的控制权转移给队伍 (ID: ${toTeamId})`
                      : `将以下无人机的控制权转移给用户 ID: ${toUserId}`}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {selectedUavIds.map(id => (
                      <Badge key={id} className="bg-purple-600">{id}</Badge>
                    ))}
                  </div>
                  {transferReason && (
                    <p className="text-sm text-slate-400">原因: {transferReason}</p>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setTransferDialogOpen(false)}
                    className="bg-slate-700 border-slate-600 text-slate-300">
                    取消
                  </Button>
                  <Button onClick={() => { setTransferDialogOpen(false); handleTransfer(); }}
                    disabled={transferLoading}
                    className="bg-purple-600 hover:bg-purple-700">
                    {transferLoading ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : null}
                    确认转移
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>}

          {/* Operation Logs */}
          {activeTab === 'logs' && <div className="flex-1 overflow-auto mt-3">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-400" />
                    操作日志
                  </div>
                  <div className="flex gap-2">
                    {LOG_TYPES.map(lt => (
                      <Button
                        key={lt.value}
                        size="sm"
                        variant={logFilter === lt.value ? 'default' : 'outline'}
                        className={
                          logFilter === lt.value
                            ? 'bg-blue-600 hover:bg-blue-700 text-white text-xs'
                            : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600 text-xs'
                        }
                        onClick={() => { setLogFilter(lt.value); fetchLogs(0, lt.value); }}
                      >
                        {lt.label}
                      </Button>
                    ))}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700 hover:bg-slate-700/50">
                      <TableHead className="text-slate-400">时间</TableHead>
                      <TableHead className="text-slate-400">操作类型</TableHead>
                      <TableHead className="text-slate-400">操作人</TableHead>
                      <TableHead className="text-slate-400">目标无人机</TableHead>
                      <TableHead className="text-slate-400">详情</TableHead>
                      <TableHead className="text-slate-400">结果</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map(log => (
                      <TableRow key={log.id} className="border-slate-700 hover:bg-slate-700/50">
                        <TableCell className="text-slate-400 text-xs">{formatTime(log.createdAt)}</TableCell>
                        <TableCell>
                          <Badge className={getOperationBadgeColor(log.operationType)}>
                            {log.operationType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-300">{log.username || '-'}</TableCell>
                        <TableCell className="text-blue-300 font-mono">{log.targetUavId || '-'}</TableCell>
                        <TableCell className="text-slate-400 text-xs max-w-[200px] truncate">{log.detail || '-'}</TableCell>
                        <TableCell>
                          <Badge className={getResultBadgeColor(log.result)}>
                            {log.result || '-'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {logs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-slate-500 py-8">
                          {logLoading ? '加载中...' : '暂无操作日志'}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>

                {/* Pagination */}
                {logTotalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 p-3 border-t border-slate-700">
                    <Button size="sm" variant="outline" disabled={logPage === 0}
                      onClick={() => fetchLogs(logPage - 1, logFilter)}
                      className="bg-slate-700 border-slate-600 text-slate-300">
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-sm text-slate-400">
                      {logPage + 1} / {logTotalPages}
                    </span>
                    <Button size="sm" variant="outline" disabled={logPage >= logTotalPages - 1}
                      onClick={() => fetchLogs(logPage + 1, logFilter)}
                      className="bg-slate-700 border-slate-600 text-slate-300">
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>}

          {/* Teams */}
          {activeTab === 'teams' && <div className="flex-1 overflow-auto mt-3">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {teams.map(team => (
                <Card key={team.teamId} className="bg-slate-800 border-slate-700">
                  <CardHeader className="pb-2 cursor-pointer" onClick={() => handleTeamExpand(team.teamId)}>
                    <CardTitle className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-blue-400" />
                        {team.teamName}
                      </div>
                      <Badge variant="outline" className="text-slate-400 border-slate-600">
                        {team.memberCount} 人
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm text-slate-400 mb-2">
                      队长: <span className="text-slate-300">{team.leader}</span>
                    </div>
                    {expandedTeam === team.teamId && teamMembers[team.teamId] && (
                      <div className="space-y-1 mt-2 pt-2 border-t border-slate-700">
                        {teamMembers[team.teamId].map(member => (
                          <div key={member.userId} className="flex items-center justify-between text-xs p-1.5 rounded bg-slate-700/50">
                            <span className="text-slate-300">{member.realName || member.username}</span>
                            <Badge className="bg-slate-600 text-xs">{member.role}</Badge>
                          </div>
                        ))}
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full mt-2 text-xs text-slate-400 hover:text-white"
                      onClick={() => handleTeamExpand(team.teamId)}
                    >
                      {expandedTeam === team.teamId ? '收起' : '展开成员'}
                    </Button>
                  </CardContent>
                </Card>
              ))}
              {teams.length === 0 && (
                <Card className="bg-slate-800 border-slate-700 col-span-3">
                  <CardContent className="p-8 text-center text-slate-500">
                    暂无团队数据
                  </CardContent>
                </Card>
              )}
            </div>
          </div>}
        </div>
      </div>
    </div>
  );
}
