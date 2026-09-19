/**
 * 任务列表面板：队长 / 队员界面左侧「任务」标签页的内容。
 *
 * 展示当前用户创建成功的所有任务，支持按创建时间排序，
 * 并提供添加、指派、执行、中止、修改、删除入口。
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, RefreshCw, ArrowDownWideNarrow, ArrowUpWideNarrow, AlertTriangle } from 'lucide-react';
import {
  abortTask,
  deleteTask,
  executeTask,
  getTaskDetail,
  listTasks,
} from '@/services/api';
import { useMissionPlanningStore } from '@/stores/missionPlanningStore';
import { TASK_STATUS, type TaskDetail, type TaskSort } from '@/types/task';
import TaskCard from './TaskCard';
import AssignDroneDialog, { type AssignableDrone } from './AssignDroneDialog';
import TaskDetailDialog from './TaskDetailDialog';

interface TaskListPanelProps {
  token: string;
  /** 可指派的无人机：当前用户有控制权的那些 */
  drones: AssignableDrone[];
  /** 打开航点规划面板。task 为 null 表示新建；otherNames 用于重名预校验 */
  onPlanTask: (task: TaskDetail | null, otherNames: string[]) => void;
  /** 规划面板保存后父组件递增，触发列表刷新 */
  refreshSignal?: number;
  /** 收到任务进度推送后父组件递增，触发列表刷新 */
  progressSignal?: number;
}

export default function TaskListPanel({
  token,
  drones,
  onPlanTask,
  refreshSignal = 0,
  progressSignal = 0,
}: TaskListPanelProps) {
  const [tasks, setTasks] = useState<TaskDetail[]>([]);
  const [sort, setSort] = useState<TaskSort>('time_desc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<number | null>(null);

  const [assignTask, setAssignTask] = useState<TaskDetail | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<number | null>(null);

  const enterPlanning = useMissionPlanningStore((s) => s.enterPlanning);
  const exitPlanning = useMissionPlanningStore((s) => s.exitPlanning);
  const loadWaypoints = useMissionPlanningStore((s) => s.loadWaypoints);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listTasks(token, sort);
      if (res.code === 0) {
        setTasks(res.data ?? []);
        setError(null);
      } else {
        setError(res.msg || '加载任务列表失败');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络异常');
    } finally {
      setLoading(false);
    }
  }, [token, sort]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks, refreshSignal, progressSignal]);

  const otherNames = (excludeId?: number) =>
    tasks.filter((t) => t.id !== excludeId).map((t) => t.taskName);

  /** 新建任务：清空上一次的编辑态再进规划模式 */
  const handleAdd = () => {
    exitPlanning();
    enterPlanning(null);
    onPlanTask(null, otherNames());
  };

  /** 修改任务：先拉全量航点回填，再进规划模式 */
  const handleEdit = async (task: TaskDetail) => {
    setBusyTaskId(task.id);
    setError(null);
    try {
      const res = await getTaskDetail(token, task.id);
      if (res.code !== 0 || !res.data) {
        setError(res.msg || '加载任务航点失败');
        return;
      }
      exitPlanning();
      enterPlanning(res.data.id);
      loadWaypoints(res.data.waypoints ?? [], res.data.id);
      onPlanTask(res.data, otherNames(task.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络异常');
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleExecute = async (task: TaskDetail) => {
    setBusyTaskId(task.id);
    setError(null);
    try {
      // 执行参数沿用任务里保存的配置（含操作人员配置的单点超时）
      const res = await executeTask(token, task.id);
      if (res.code !== 0) {
        setError(res.msg || '下发任务失败');
      }
      await fetchTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络异常');
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleAbort = async (task: TaskDetail) => {
    if (!confirm(`确定中止任务「${task.taskName}」？无人机将原地悬停。`)) return;
    setBusyTaskId(task.id);
    setError(null);
    try {
      const res = await abortTask(token, task.id);
      if (res.code !== 0) {
        setError(res.msg || '中止任务失败');
      }
      await fetchTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络异常');
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleDelete = async (task: TaskDetail) => {
    if (!confirm(`确定删除任务「${task.taskName}」？航点将一并删除。`)) return;
    setBusyTaskId(task.id);
    setError(null);
    try {
      const res = await deleteTask(token, task.id);
      if (res.code !== 0) {
        setError(res.msg || '删除任务失败');
      }
      await fetchTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络异常');
    } finally {
      setBusyTaskId(null);
    }
  };

  const executingCount = tasks.filter((t) => t.status === TASK_STATUS.EXECUTING).length;

  return (
    <div className="space-y-2">
      {/* 工具条 */}
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          onClick={handleAdd}
          className="h-6 flex-1 text-[11px] bg-cyan-700 hover:bg-cyan-600"
        >
          <Plus className="w-3 h-3 mr-1" />添加任务
        </Button>
        <button
          onClick={() => setSort(sort === 'time_desc' ? 'time_asc' : 'time_desc')}
          title={sort === 'time_desc' ? '当前：创建时间倒序' : '当前：创建时间正序'}
          className="h-6 px-1.5 rounded border border-slate-600 bg-slate-800/60 text-slate-300 hover:text-white"
        >
          {sort === 'time_desc' ? (
            <ArrowDownWideNarrow className="w-3 h-3" />
          ) : (
            <ArrowUpWideNarrow className="w-3 h-3" />
          )}
        </button>
        <button
          onClick={fetchTasks}
          title="刷新任务列表"
          className="h-6 px-1.5 rounded border border-slate-600 bg-slate-800/60 text-slate-300 hover:text-white"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span>共 {tasks.length} 个任务</span>
        {executingCount > 0 && <span className="text-cyan-300">{executingCount} 个执行中</span>}
      </div>

      {error && (
        <div className="flex items-start gap-1.5 rounded border border-red-500/40 bg-red-900/30 px-2 py-1.5 text-[11px] text-red-200">
          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {tasks.length === 0 && !loading ? (
        <div className="text-center text-[11px] text-slate-500 py-6">
          还没有任务，点击「添加任务」开始规划航点
        </div>
      ) : (
        <div className="space-y-1.5">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              busy={busyTaskId === task.id}
              onAssign={setAssignTask}
              onExecute={handleExecute}
              onAbort={handleAbort}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onOpenDetail={(t) => setDetailTaskId(t.id)}
            />
          ))}
        </div>
      )}

      <AssignDroneDialog
        open={assignTask !== null}
        token={token}
        task={assignTask}
        drones={drones}
        onClose={() => setAssignTask(null)}
        onAssigned={() => fetchTasks()}
      />

      <TaskDetailDialog
        open={detailTaskId !== null}
        token={token}
        taskId={detailTaskId}
        refreshSignal={progressSignal}
        onClose={() => setDetailTaskId(null)}
      />
    </div>
  );
}
