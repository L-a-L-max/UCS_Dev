import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
// Using simple state-based tabs instead of Radix UI Tabs for better compatibility
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

  return (
    <div className="h-screen bg-slate-900 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex justify-between items-center px-4 py-2 bg-slate-800 border-b border-slate-700">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Users className="w-6 h-6 text-green-400" />
          队长管理面板
          <Badge variant="outline" className="ml-2 text-green-300 border-green-500">{username}</Badge>
        </h1>
        <div className="flex items-center gap-2">
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

      <div className="flex-1 overflow-hidden p-4">
        <div className="h-full flex flex-col">
          <div className="flex gap-1 bg-slate-800 border border-slate-700 rounded-md p-1 w-fit">
            <button onClick={() => setActiveTab('drones')}
              className={`flex items-center px-3 py-1.5 rounded text-sm transition-colors ${activeTab === 'drones' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700/50'}`}>
              <Plane className="w-4 h-4 mr-1" />队伍无人机
            </button>
            <button onClick={() => setActiveTab('members')}
              className={`flex items-center px-3 py-1.5 rounded text-sm transition-colors ${activeTab === 'members' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700/50'}`}>
              <Users className="w-4 h-4 mr-1" />队伍成员
            </button>
            <button onClick={() => setActiveTab('logs')}
              className={`flex items-center px-3 py-1.5 rounded text-sm transition-colors ${activeTab === 'logs' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700/50'}`}>
              <FileText className="w-4 h-4 mr-1" />操作日志
            </button>
          </div>

          {/* Drones Tab */}
          {activeTab === 'drones' && <div className="flex-1 overflow-auto mt-3">
            {/* Command feedback */}
            {commandFeedback && (
              <div className={`mb-3 p-3 rounded ${commandFeedback.success ? 'bg-green-900/30 border border-green-700' : 'bg-red-900/30 border border-red-700'}`}>
                <span className={commandFeedback.success ? 'text-green-300' : 'text-red-300'}>
                  [{commandFeedback.uavId}] {commandFeedback.message}
                </span>
              </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-3 text-center">
                  <div className="text-xl font-bold text-blue-400">{drones.length}</div>
                  <div className="text-xs text-slate-400">无人机数</div>
                </CardContent>
              </Card>
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-3 text-center">
                  <div className="text-xl font-bold text-green-400">{drones.filter(d => d.flightStatus === 'FLYING').length}</div>
                  <div className="text-xs text-slate-400">飞行中</div>
                </CardContent>
              </Card>
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-3 text-center">
                  <div className="text-xl font-bold text-cyan-400">{drones.filter(d => d.onlineStatus).length}</div>
                  <div className="text-xs text-slate-400">在线</div>
                </CardContent>
              </Card>
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-3 text-center">
                  <div className="text-xl font-bold text-red-400">{drones.filter(d => (d.battery || 0) < 20).length}</div>
                  <div className="text-xs text-slate-400">低电量</div>
                </CardContent>
              </Card>
            </div>

            {/* Drone table with quick commands */}
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700 hover:bg-slate-700/50">
                      <TableHead className="text-slate-400">UAV ID</TableHead>
                      <TableHead className="text-slate-400">状态</TableHead>
                      <TableHead className="text-slate-400">电量</TableHead>
                      <TableHead className="text-slate-400">高度</TableHead>
                      <TableHead className="text-slate-400">操作员</TableHead>
                      <TableHead className="text-slate-400">快捷指令</TableHead>
                      <TableHead className="text-slate-400">转移</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drones.map(drone => (
                      <TableRow key={drone.uavId} className="border-slate-700 hover:bg-slate-700/50">
                        <TableCell className="font-bold text-blue-300">{drone.uavId}</TableCell>
                        <TableCell>
                          <Badge className={drone.flightStatus === 'FLYING' ? 'bg-green-600' : 'bg-slate-600'}>
                            {drone.flightStatus === 'FLYING' ? '飞行中' : '待机'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Battery className={`w-3 h-3 ${(drone.battery || 0) < 20 ? 'text-red-400' : 'text-green-400'}`} />
                            {drone.battery != null ? `${drone.battery}%` : 'N/A'}
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-300">{drone.altitude != null ? `${drone.altitude}m` : '-'}</TableCell>
                        <TableCell className="text-slate-300">{drone.owner || '-'}</TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {COMMANDS.map(cmd => (
                              <Button key={cmd.type} size="sm" variant="outline"
                                className="text-xs h-6 px-2 bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600"
                                onClick={() => handleQuickCommand(drone.uavId, cmd.type)}>
                                {cmd.label}
                              </Button>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline"
                            className="text-xs h-6 px-2 bg-purple-700/50 border-purple-600 text-purple-300 hover:bg-purple-600"
                            onClick={() => { setTransferUavId(drone.uavId); setTransferDialogOpen(true); }}>
                            <ArrowRightLeft className="w-3 h-3 mr-1" />转移
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {drones.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-slate-500 py-8">暂无数据</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>}

          {/* Members Tab */}
          {activeTab === 'members' && <div className="flex-1 overflow-auto mt-3">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-green-400" />
                    {teamInfo?.teamName || '我的队伍'}
                  </div>
                  <Badge variant="outline" className="text-slate-400 border-slate-600">{members.length} 人</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {teamInfo && (
                  <div className="text-sm text-slate-400 mb-3">队长: <span className="text-slate-300">{teamInfo.leader}</span></div>
                )}
                <div className="space-y-1">
                  {members.map(member => (
                    <div key={member.userId} className="flex items-center justify-between text-sm p-2.5 rounded bg-slate-700/50">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300">{member.realName || member.username}</span>
                        <span className="text-xs text-slate-500">ID: {member.userId}</span>
                      </div>
                      <Badge className="bg-slate-600 text-xs">{member.role}</Badge>
                    </div>
                  ))}
                  {members.length === 0 && (
                    <div className="text-center text-slate-500 py-4">暂无成员数据</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>}

          {/* Logs Tab */}
          {activeTab === 'logs' && <div className="flex-1 overflow-auto mt-3">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-400" />操作日志
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700">
                      <TableHead className="text-slate-400">时间</TableHead>
                      <TableHead className="text-slate-400">类型</TableHead>
                      <TableHead className="text-slate-400">操作人</TableHead>
                      <TableHead className="text-slate-400">目标</TableHead>
                      <TableHead className="text-slate-400">详情</TableHead>
                      <TableHead className="text-slate-400">结果</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map(log => (
                      <TableRow key={log.id} className="border-slate-700 hover:bg-slate-700/50">
                        <TableCell className="text-slate-400 text-xs">{formatTime(log.createdAt)}</TableCell>
                        <TableCell><Badge className="bg-blue-600 text-xs">{log.operationType}</Badge></TableCell>
                        <TableCell className="text-slate-300">{log.username || '-'}</TableCell>
                        <TableCell className="text-blue-300 font-mono text-xs">{log.targetUavId || '-'}</TableCell>
                        <TableCell className="text-slate-400 text-xs max-w-[200px] truncate">{log.detail || '-'}</TableCell>
                        <TableCell>
                          <Badge className={log.result === 'SUCCESS' ? 'bg-green-600' : 'bg-red-600'}>{log.result || '-'}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {logs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-slate-500 py-8">暂无日志</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                {logTotalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 p-3 border-t border-slate-700">
                    <Button size="sm" variant="outline" disabled={logPage === 0} onClick={() => fetchLogs(logPage - 1)}
                      className="bg-slate-700 border-slate-600 text-slate-300">
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-sm text-slate-400">{logPage + 1} / {logTotalPages}</span>
                    <Button size="sm" variant="outline" disabled={logPage >= logTotalPages - 1} onClick={() => fetchLogs(logPage + 1)}
                      className="bg-slate-700 border-slate-600 text-slate-300">
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>}
        </div>
      </div>

      {/* Transfer Dialog */}
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
