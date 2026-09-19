/**
 * 任务卡片：展示任务名、状态、航点数、创建时间、执行次数，
 * 并提供指派 / 执行 / 中止 / 修改 / 删除入口。
 */
import { Badge } from '@/components/ui/badge';
import {
  Clock,
  MapPin,
  Play,
  Repeat,
  Square,
  Trash2,
  Users,
  Pencil,
} from 'lucide-react';
import {
  TASK_STATUS,
  TASK_STATUS_COLOR,
  TASK_STATUS_TEXT,
  type TaskDetail,
} from '@/types/task';

interface TaskCardProps {
  task: TaskDetail;
  busy?: boolean;
  onAssign: (task: TaskDetail) => void;
  onExecute: (task: TaskDetail) => void;
  onAbort: (task: TaskDetail) => void;
  onEdit: (task: TaskDetail) => void;
  onDelete: (task: TaskDetail) => void;
  onOpenDetail: (task: TaskDetail) => void;
}

/** 后端返回的是 ISO 时间串，这里只截到分钟，卡片空间有限 */
function formatTime(raw?: string | null): string {
  if (!raw) return '-';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function TaskCard({
  task,
  busy = false,
  onAssign,
  onExecute,
  onAbort,
  onEdit,
  onDelete,
  onOpenDetail,
}: TaskCardProps) {
  const executing = task.status === TASK_STATUS.EXECUTING;
  const assignedCount = task.drones?.length ?? 0;
  const progress = Math.round((task.progress ?? 0) * 100) / 100;

  return (
    <div
      onClick={() => onOpenDetail(task)}
      className="rounded border border-[rgba(0,240,255,0.12)] bg-[rgba(0,240,255,0.04)] p-2 cursor-pointer hover:border-[rgba(0,240,255,0.3)] transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="text-xs font-bold text-white truncate" title={task.taskName}>
          {task.taskName}
        </div>
        <Badge
          className={`text-[9px] px-1 py-0 border shrink-0 ${
            TASK_STATUS_COLOR[task.status] ?? TASK_STATUS_COLOR[0]
          }`}
        >
          {task.statusText || TASK_STATUS_TEXT[task.status] || '未知'}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-slate-400 mb-1.5">
        <span className="flex items-center gap-1">
          <MapPin className="w-2.5 h-2.5" />
          航点 {task.waypointCount ?? task.waypoints?.length ?? 0}
        </span>
        <span className="flex items-center gap-1">
          <Repeat className="w-2.5 h-2.5" />
          已执行 {task.execCount ?? 0} 次
        </span>
        <span className="flex items-center gap-1">
          <Users className="w-2.5 h-2.5" />
          已指派 {assignedCount} 架
        </span>
        <span className="flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" />
          {formatTime(task.createdAt)}
        </span>
      </div>

      {executing && (
        <div className="mb-1.5">
          <div className="h-1 rounded bg-slate-700 overflow-hidden">
            <div
              className="h-full bg-cyan-400 transition-all"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
          <div className="text-[9px] text-cyan-300 mt-0.5">执行进度 {progress}%</div>
        </div>
      )}

      {/* 按钮区：阻止冒泡，避免点按钮时又打开详情 */}
      <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
        <button
          disabled={busy || executing}
          onClick={() => onAssign(task)}
          className="flex items-center px-1.5 py-0.5 rounded text-[10px] bg-blue-600/80 text-white hover:bg-blue-600 disabled:opacity-40"
        >
          <Users className="w-2.5 h-2.5 mr-0.5" />指派
        </button>
        {executing ? (
          <button
            disabled={busy}
            onClick={() => onAbort(task)}
            className="flex items-center px-1.5 py-0.5 rounded text-[10px] bg-orange-600/80 text-white hover:bg-orange-600 disabled:opacity-40"
          >
            <Square className="w-2.5 h-2.5 mr-0.5" />中止
          </button>
        ) : (
          <button
            disabled={busy || assignedCount === 0}
            onClick={() => onExecute(task)}
            title={assignedCount === 0 ? '请先指派无人机' : '下发航点任务'}
            className="flex items-center px-1.5 py-0.5 rounded text-[10px] bg-emerald-600/80 text-white hover:bg-emerald-600 disabled:opacity-40"
          >
            <Play className="w-2.5 h-2.5 mr-0.5" />执行
          </button>
        )}
        <button
          disabled={busy || executing}
          onClick={() => onEdit(task)}
          className="flex items-center px-1.5 py-0.5 rounded text-[10px] bg-slate-600/80 text-white hover:bg-slate-600 disabled:opacity-40"
        >
          <Pencil className="w-2.5 h-2.5 mr-0.5" />修改
        </button>
        <button
          disabled={busy || executing}
          onClick={() => onDelete(task)}
          className="flex items-center px-1.5 py-0.5 rounded text-[10px] bg-red-600/80 text-white hover:bg-red-600 disabled:opacity-40"
        >
          <Trash2 className="w-2.5 h-2.5 mr-0.5" />删除
        </button>
      </div>
    </div>
  );
}
