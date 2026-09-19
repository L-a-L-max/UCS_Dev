/**
 * 任务详情：航点明细 + 每架无人机的执行进度。
 *
 * 进度以 WebSocket 推送为主（父组件收到 /topic/task-progress 后递增 refreshSignal），
 * 这里再挂一个 3 秒轮询兜底，断线时也不至于看不到进度。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { getTaskDetail, getTaskProgress } from '@/services/api';
import {
  TASK_STATUS,
  TASK_STATUS_COLOR,
  TASK_STATUS_TEXT,
  formatLabel,
  type TaskDetail,
} from '@/types/task';

interface TaskDetailDialogProps {
  open: boolean;
  token: string;
  taskId: number | null;
  /** 父组件收到进度推送后递增，触发这里重新拉一次 */
  refreshSignal?: number;
  onClose: () => void;
}

export default function TaskDetailDialog({
  open,
  token,
  taskId,
  refreshSignal = 0,
  onClose,
}: TaskDetailDialogProps) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (taskId == null) return;
    setLoading(true);
    try {
      const res = await getTaskDetail(token, taskId);
      if (res.code === 0 && res.data) {
        setDetail(res.data);
        setError(null);
      } else {
        setError(res.msg || '加载任务详情失败');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络异常');
    } finally {
      setLoading(false);
    }
  }, [token, taskId]);

  useEffect(() => {
    if (!open || taskId == null) return;
    loadDetail();
  }, [open, taskId, refreshSignal, loadDetail]);

  // 执行中才轮询，只拉进度不拉全量航点
  useEffect(() => {
    if (!open || taskId == null) return;
    if (detail?.status !== TASK_STATUS.EXECUTING) return;
    const timer = setInterval(async () => {
      try {
        const res = await getTaskProgress(token, taskId);
        if (res.code === 0 && res.data) {
          setDetail((prev) =>
            prev
              ? {
                  ...prev,
                  status: res.data.status,
                  statusText: res.data.statusText ?? prev.statusText,
                  progress: res.data.progress ?? prev.progress,
                  drones: res.data.drones ?? prev.drones,
                }
              : prev
          );
        }
      } catch {
        // 轮询失败静默重试，下一拍再说
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [open, taskId, token, detail?.status]);

  const waypoints = detail?.waypoints ?? [];
  const drones = detail?.drones ?? [];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            {detail?.taskName ?? '任务详情'}
            {detail && (
              <Badge
                className={`text-[9px] px-1 py-0 border ${
                  TASK_STATUS_COLOR[detail.status] ?? TASK_STATUS_COLOR[0]
                }`}
              >
                {detail.statusText || TASK_STATUS_TEXT[detail.status] || '未知'}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-400">
            {detail ? (
              <>
                航点 {waypoints.length} 个 · 已执行 {detail.execCount ?? 0} 次 · 单点超时{' '}
                {detail.waypointTimeoutSec ?? '-'} 秒 · 到点半径 {detail.arrivalRadius ?? '-'} 米
              </>
            ) : loading ? (
              '加载中...'
            ) : (
              error || ''
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 max-h-[420px]">
          {/* 各机进度 */}
          <div className="space-y-1.5 overflow-y-auto pr-1">
            <div className="text-[11px] text-slate-400 sticky top-0 bg-slate-900 pb-1">
              执行情况（{drones.length} 架）
            </div>
            {drones.length === 0 ? (
              <div className="text-[11px] text-slate-500 py-3 text-center">尚未指派无人机</div>
            ) : (
              drones.map((d) => {
                const pct = Math.min(100, Math.max(0, Math.round(d.progress ?? 0)));
                return (
                  <div
                    key={d.droneId}
                    className="rounded border border-slate-700 bg-slate-800/50 p-1.5"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-mono text-white">{d.uavId}</span>
                      <span className="flex items-center gap-1.5">
                        <span
                          className={`text-[10px] ${d.online ? 'text-green-400' : 'text-slate-500'}`}
                        >
                          {d.online ? '在线' : '离线'}
                        </span>
                        <Badge
                          className={`text-[9px] px-1 py-0 border ${
                            TASK_STATUS_COLOR[d.status] ?? TASK_STATUS_COLOR[0]
                          }`}
                        >
                          {d.statusText || TASK_STATUS_TEXT[d.status] || '未知'}
                        </Badge>
                      </span>
                    </div>
                    <div className="h-1 rounded bg-slate-700 overflow-hidden">
                      <div
                        className="h-full bg-cyan-400 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[10px] text-slate-400">
                        {d.currentSeq != null && d.currentSeq >= 0
                          ? `第 ${d.currentSeq + 1} / ${waypoints.length} 点`
                          : '未开始'}
                      </span>
                      <span className="text-[10px] text-cyan-300">{pct}%</span>
                    </div>
                    {d.errorMessage && (
                      <div className="text-[10px] text-red-300 mt-0.5 break-all">
                        {d.errorMessage}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* 航点明细 */}
          <div className="space-y-1 overflow-y-auto pr-1">
            <div className="text-[11px] text-slate-400 sticky top-0 bg-slate-900 pb-1">
              航点明细（按编号升序执行）
            </div>
            {waypoints.length === 0 ? (
              <div className="text-[11px] text-slate-500 py-3 text-center">暂无航点</div>
            ) : (
              waypoints.map((w) => (
                <div
                  key={`${w.seq ?? w.displayLabel}`}
                  className="flex items-center gap-2 rounded border border-slate-700 bg-slate-800/50 px-1.5 py-1 text-[10px]"
                >
                  <span
                    className={`font-mono font-bold ${
                      Number.isInteger(w.displayLabel) ? 'text-cyan-300' : 'text-violet-300'
                    }`}
                  >
                    #{formatLabel(w.displayLabel)}
                  </span>
                  {w.itemType === 'ACTION' ? (
                    <span className="text-amber-300">动作 {w.actionCommand}</span>
                  ) : (
                    <span className="text-slate-300 font-mono">
                      {w.latitude?.toFixed(6)}, {w.longitude?.toFixed(6)} @{' '}
                      {(w.altitude ?? 0).toFixed(1)}m
                    </span>
                  )}
                  {w.holdTime != null && w.holdTime > 0 && (
                    <span className="text-slate-500">停留 {w.holdTime}s</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
