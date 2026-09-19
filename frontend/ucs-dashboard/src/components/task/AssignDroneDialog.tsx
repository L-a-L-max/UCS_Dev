/**
 * 指派无人机：复选当前用户名下的无人机，确定后任务状态变为「已分配」。
 * 一次提交覆盖原有指派结果，所以打开时会用任务已指派的机号预勾选。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckSquare, Square, AlertTriangle } from 'lucide-react';
import { assignTaskDrones } from '@/services/api';
import type { TaskDetail } from '@/types/task';

export interface AssignableDrone {
  uavId: string;
  online?: boolean;
  model?: string;
  /** 当前控制人，仅作提示；有没有控制权最终由后端按既有权限规则判定 */
  controlOwner?: string;
}

interface AssignDroneDialogProps {
  open: boolean;
  token: string;
  task: TaskDetail | null;
  /** 可指派的无人机：调用方传入当前用户有控制权的那些 */
  drones: AssignableDrone[];
  onClose: () => void;
  onAssigned: (task: TaskDetail) => void;
}

export default function AssignDroneDialog({
  open,
  token,
  task,
  drones,
  onClose,
  onAssigned,
}: AssignDroneDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alreadyAssigned = useMemo(
    () => new Set((task?.drones ?? []).map((d) => d.uavId)),
    [task]
  );

  // 每次打开都按任务当前的指派结果重置勾选
  useEffect(() => {
    if (!open) return;
    setSelected(new Set(alreadyAssigned));
    setError(null);
  }, [open, alreadyAssigned]);

  const toggle = (uavId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uavId)) next.delete(uavId);
      else next.add(uavId);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (!task) return;
    if (selected.size === 0) {
      setError('请至少选择一架无人机');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await assignTaskDrones(token, task.id, Array.from(selected));
      if (res.code === 0 && res.data) {
        onAssigned(res.data);
        onClose();
        return;
      }
      setError(res.msg || '指派失败');
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络异常，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">指派无人机</DialogTitle>
          <DialogDescription className="text-xs text-slate-400">
            {task ? `任务「${task.taskName}」` : ''}
            ：勾选执行本任务的无人机，确定后任务状态变为「已分配」
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[300px] overflow-y-auto space-y-1">
          {drones.length === 0 ? (
            <div className="text-center text-xs text-slate-500 py-6">
              没有可指派的无人机
            </div>
          ) : (
            drones.map((d) => {
              const checked = selected.has(d.uavId);
              return (
                <button
                  key={d.uavId}
                  onClick={() => toggle(d.uavId)}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded border text-xs transition-colors ${
                    checked
                      ? 'bg-blue-900/40 border-blue-500 text-white'
                      : 'bg-slate-800/60 border-slate-600 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {checked ? (
                      <CheckSquare className="w-3.5 h-3.5 text-blue-400" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-slate-500" />
                    )}
                    <span className="font-mono">{d.uavId}</span>
                    {d.model && <span className="text-[10px] text-slate-500">{d.model}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    {d.controlOwner && (
                      <span className="text-[10px] text-slate-500">控制人 {d.controlOwner}</span>
                    )}
                    {alreadyAssigned.has(d.uavId) && (
                      <span className="text-[10px] text-blue-300">已指派</span>
                    )}
                    <span
                      className={`text-[10px] ${d.online ? 'text-green-400' : 'text-slate-500'}`}
                    >
                      {d.online ? '在线' : '离线'}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        {error && (
          <div className="flex items-start gap-1.5 rounded border border-red-500/40 bg-red-900/30 px-2 py-1.5 text-[11px] text-red-200">
            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter>
          <Button
            size="sm"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
            className="h-7 text-xs bg-slate-800 border-slate-600 text-slate-200"
          >
            取消
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={submitting}
            className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
          >
            {submitting ? '提交中...' : `确定（已选 ${selected.size} 架）`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
