/**
 * 航点配置界面（路径预规划）。
 *
 * 两种录入方式共用同一份 store：
 *   1. 在右侧地图上点选（MapPanel 的规划模式负责落点）；
 *   2. 在这个面板里手动填经纬度和高度。
 * 两边都写 missionPlanningStore，所以列表和地图标记天然同步。
 *
 * 编号规则见 missionPlanningStore 的注释：删除不重排、插入用 4.1 ~ 4.9。
 * 提交时按编号升序排一遍，交给后端重排 seq。
 */
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MapPin, Plus, Trash2, X, CornerDownRight, Check, AlertTriangle } from 'lucide-react';
import { useMissionPlanningStore } from '@/stores/missionPlanningStore';
import {
  DEFAULT_WAYPOINT_TIMEOUT,
  MAX_INSERT_SUB_POINTS,
  MAX_WAYPOINT_TIMEOUT,
  MAX_WAYPOINTS,
  MIN_WAYPOINT_TIMEOUT,
  formatLabel,
  type TaskCreateRequest,
  type TaskDetail,
} from '@/types/task';
import { createTask, updateTask } from '@/services/api';

interface WaypointPlannerPanelProps {
  token: string;
  /** 修改任务时传入原任务，用于回填名称和执行参数 */
  initialTask?: TaskDetail | null;
  /** 已有任务名，用于本地重名预校验（不含正在修改的这个任务自己） */
  existingNames: string[];
  onSaved: (task: TaskDetail) => void;
  onClose: () => void;
}

const ON_FINISH_OPTIONS = [
  { value: 'HOLD', label: '悬停' },
  { value: 'RTL', label: '返航' },
  { value: 'LAND', label: '降落' },
];

export default function WaypointPlannerPanel({
  token,
  initialTask = null,
  existingNames,
  onSaved,
  onClose,
}: WaypointPlannerPanelProps) {
  const waypoints = useMissionPlanningStore((s) => s.waypoints);
  const insertMode = useMissionPlanningStore((s) => s.insertMode);
  const selectedLabel = useMissionPlanningStore((s) => s.selectedLabel);
  const defaultAltitude = useMissionPlanningStore((s) => s.defaultAltitude);
  const editingTaskId = useMissionPlanningStore((s) => s.editingTaskId);

  const addWaypoint = useMissionPlanningStore((s) => s.addWaypoint);
  const updateWaypoint = useMissionPlanningStore((s) => s.updateWaypoint);
  const deleteWaypoint = useMissionPlanningStore((s) => s.deleteWaypoint);
  const beginInsert = useMissionPlanningStore((s) => s.beginInsert);
  const cancelInsert = useMissionPlanningStore((s) => s.cancelInsert);
  const finishInsert = useMissionPlanningStore((s) => s.finishInsert);
  const setSelectedLabel = useMissionPlanningStore((s) => s.setSelectedLabel);
  const setDefaultAltitude = useMissionPlanningStore((s) => s.setDefaultAltitude);

  const [taskName, setTaskName] = useState(initialTask?.taskName ?? '');
  const [description, setDescription] = useState(initialTask?.description ?? '');
  // 单点超时保护：操作人员可配置
  const [timeoutSec, setTimeoutSec] = useState(
    String(initialTask?.waypointTimeoutSec ?? DEFAULT_WAYPOINT_TIMEOUT)
  );
  const [arrivalRadius, setArrivalRadius] = useState(
    String(initialTask?.arrivalRadius ?? 2)
  );
  const [arrivalAltTol, setArrivalAltTol] = useState(
    String(initialTask?.arrivalAltTol ?? 2)
  );
  const [onFinish, setOnFinish] = useState(initialTask?.onFinish ?? 'HOLD');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // 手动录入
  const [manualLat, setManualLat] = useState('');
  const [manualLon, setManualLon] = useState('');
  const [manualAlt, setManualAlt] = useState(String(defaultAltitude));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 插入态下只显示相邻两点和新插入的子点（需求：临时只展示 4 和 5）
  const visible = useMemo(() => {
    const store = useMissionPlanningStore.getState();
    return store.getVisibleWaypoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypoints, insertMode]);

  const navCount = waypoints.filter((w) => w.itemType === 'NAV').length;

  // 换任务时把默认高度同步到手动录入框
  useEffect(() => {
    setManualAlt(String(defaultAltitude));
  }, [defaultAltitude]);

  const insertRemaining = Math.max(0, MAX_INSERT_SUB_POINTS - (insertMode.subIndex - 1));

  const handleManualAdd = () => {
    setError(null);
    const lat = Number(manualLat);
    const lon = Number(manualLon);
    const alt = Number(manualAlt);
    if (!manualLat.trim() || !manualLon.trim() || Number.isNaN(lat) || Number.isNaN(lon)) {
      setError('请填写合法的经纬度');
      return;
    }
    if (lat < -90 || lat > 90) {
      setError('纬度需在 -90 ~ 90 之间');
      return;
    }
    if (lon < -180 || lon > 180) {
      setError('经度需在 -180 ~ 180 之间');
      return;
    }
    if (Number.isNaN(alt)) {
      setError('请填写合法的高度');
      return;
    }
    if (waypoints.length >= MAX_WAYPOINTS) {
      setError(`航点数量已达上限 ${MAX_WAYPOINTS} 个`);
      return;
    }
    if (insertMode.active && insertRemaining <= 0) {
      setError(`两点之间最多只能插入 ${MAX_INSERT_SUB_POINTS} 个航点`);
      return;
    }
    const label = addWaypoint(lat, lon, alt);
    if (label == null) {
      setError('无法添加航点');
      return;
    }
    setDefaultAltitude(alt);
    setManualLat('');
    setManualLon('');
  };

  /** 行内修改经纬度/高度：空值或非法值先不写回 store，等用户填完 */
  const handleRowChange = (label: number, field: 'latitude' | 'longitude' | 'altitude', raw: string) => {
    const value = Number(raw);
    if (raw.trim() === '' || Number.isNaN(value)) return;
    updateWaypoint(label, { [field]: value });
  };

  const validateBeforeSave = (): string | null => {
    const name = taskName.trim();
    if (!name) return '请填写任务名称';
    // 重名校验：后端也会查一遍（返回 409），这里先拦一次给出更快的反馈
    if (existingNames.some((n) => n.trim() === name)) {
      return `任务名称「${name}」已存在，请修改后再创建`;
    }
    if (navCount < 1) return '至少需要一个航点';
    if (waypoints.length > MAX_WAYPOINTS) return `航点数量不能超过 ${MAX_WAYPOINTS} 个`;
    const timeout = Number(timeoutSec);
    if (Number.isNaN(timeout) || timeout < MIN_WAYPOINT_TIMEOUT || timeout > MAX_WAYPOINT_TIMEOUT) {
      return `单点超时需在 ${MIN_WAYPOINT_TIMEOUT} ~ ${MAX_WAYPOINT_TIMEOUT} 秒之间`;
    }
    const radius = Number(arrivalRadius);
    if (Number.isNaN(radius) || radius < 0.5 || radius > 100) {
      return '到点判定半径需在 0.5 ~ 100 米之间';
    }
    const altTol = Number(arrivalAltTol);
    if (Number.isNaN(altTol) || altTol < 0.5 || altTol > 100) {
      return '到点高度容差需在 0.5 ~ 100 米之间';
    }
    const bad = waypoints.find(
      (w) => w.itemType === 'NAV' && (w.latitude == null || w.longitude == null)
    );
    if (bad) return `航点 ${formatLabel(bad.displayLabel)} 缺少经纬度`;
    return null;
  };

  const handleSave = async () => {
    setError(null);
    // 插入没结束就提交容易漏点，先提示用户收尾
    if (insertMode.active) {
      setError('请先点击「完成插入」再保存任务');
      return;
    }
    const problem = validateBeforeSave();
    if (problem) {
      setError(problem);
      return;
    }
    // 按编号升序提交，用户中途删过点也不影响顺序
    const ordered = useMissionPlanningStore.getState().getOrderedWaypoints();
    const request: TaskCreateRequest = {
      taskName: taskName.trim(),
      description: description.trim() || undefined,
      waypointTimeoutSec: Number(timeoutSec),
      arrivalRadius: Number(arrivalRadius),
      arrivalAltTol: Number(arrivalAltTol),
      onFinish,
      waypoints: ordered,
    };
    setSaving(true);
    try {
      const res = editingTaskId
        ? await updateTask(token, editingTaskId, request)
        : await createTask(token, request);
      if (res.code === 0 && res.data) {
        onSaved(res.data);
        return;
      }
      // 409 = 重名，后端 msg 里已经带了改名提示
      setError(res.msg || (editingTaskId ? '保存失败' : '创建任务失败'));
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络异常，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="absolute top-2 right-2 bottom-2 z-30 w-[340px] flex flex-col bg-[rgba(13,21,38,0.95)] backdrop-blur-md border border-[rgba(0,240,255,0.2)] rounded-lg shadow-2xl">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[rgba(0,240,255,0.12)]">
        <div className="flex items-center gap-1.5 text-sm font-bold text-neon-cyan">
          <MapPin className="w-4 h-4" />
          {editingTaskId ? '修改任务航点' : '新建航点任务'}
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white" title="关闭">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* 任务基本信息 */}
        <div className="space-y-1.5">
          <label className="text-[11px] text-slate-400">任务名称（不可与已有任务重名）</label>
          <Input
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
            placeholder="例如：园区巡检-A 线"
            className="h-7 text-xs bg-slate-800/60 border-slate-600 text-white"
          />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="任务说明（可选）"
            className="h-7 text-xs bg-slate-800/60 border-slate-600 text-white"
          />
        </div>

        {/* 单点超时保护：操作人员可配置 */}
        <div className="space-y-1.5">
          <label className="text-[11px] text-slate-400">
            单点超时保护（秒，{MIN_WAYPOINT_TIMEOUT} ~ {MAX_WAYPOINT_TIMEOUT}）
          </label>
          <Input
            type="number"
            min={MIN_WAYPOINT_TIMEOUT}
            max={MAX_WAYPOINT_TIMEOUT}
            value={timeoutSec}
            onChange={(e) => setTimeoutSec(e.target.value)}
            className="h-7 text-xs bg-slate-800/60 border-slate-600 text-white"
          />
          <div className="text-[10px] text-slate-500">
            单个航点超过这个时长还没到点即判定异常，无人机原地悬停并上报
          </div>
        </div>

        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-[11px] text-neon-cyan hover:underline"
        >
          {showAdvanced ? '收起执行参数' : '展开执行参数'}
        </button>

        {showAdvanced && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-slate-400">到点半径(m)</label>
              <Input
                type="number"
                step="0.5"
                value={arrivalRadius}
                onChange={(e) => setArrivalRadius(e.target.value)}
                className="h-7 text-xs bg-slate-800/60 border-slate-600 text-white"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400">高度容差(m)</label>
              <Input
                type="number"
                step="0.5"
                value={arrivalAltTol}
                onChange={(e) => setArrivalAltTol(e.target.value)}
                className="h-7 text-xs bg-slate-800/60 border-slate-600 text-white"
              />
            </div>
            <div className="col-span-2">
              <label className="text-[11px] text-slate-400">任务结束动作</label>
              <div className="flex gap-1 mt-1">
                {ON_FINISH_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setOnFinish(opt.value)}
                    className={`flex-1 py-1 rounded text-[11px] border transition-colors ${
                      onFinish === opt.value
                        ? 'bg-[rgba(0,240,255,0.15)] text-neon-cyan border-[rgba(0,240,255,0.3)]'
                        : 'bg-slate-800/60 text-slate-400 border-slate-600 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 插入模式提示 */}
        {insertMode.active && (
          <div className="rounded border border-violet-500/40 bg-violet-900/30 p-2 space-y-1.5">
            <div className="text-[11px] text-violet-200 leading-relaxed">
              正在向航点 {formatLabel(insertMode.afterLabel)}
              {insertMode.beforeLabel !== null ? ` 与 ${formatLabel(insertMode.beforeLabel)}` : ''}
              {' '}之间插入，新点编号 {formatLabel(insertMode.afterLabel)}.
              {Math.min(insertMode.subIndex, MAX_INSERT_SUB_POINTS)} 起，还可插 {insertRemaining} 个
            </div>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                onClick={finishInsert}
                className="h-6 flex-1 text-[11px] bg-violet-600 hover:bg-violet-700"
              >
                <Check className="w-3 h-3 mr-1" />完成插入
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={cancelInsert}
                className="h-6 flex-1 text-[11px] bg-slate-800/60 border-slate-600 text-slate-200"
              >
                取消插入
              </Button>
            </div>
          </div>
        )}

        {/* 手动录入 */}
        <div className="rounded border border-slate-600/60 bg-slate-800/40 p-2 space-y-1.5">
          <div className="text-[11px] text-slate-300">手动添加航点</div>
          <div className="grid grid-cols-3 gap-1.5">
            <Input
              value={manualLat}
              onChange={(e) => setManualLat(e.target.value)}
              placeholder="纬度"
              className="h-7 text-[11px] bg-slate-900/60 border-slate-600 text-white"
            />
            <Input
              value={manualLon}
              onChange={(e) => setManualLon(e.target.value)}
              placeholder="经度"
              className="h-7 text-[11px] bg-slate-900/60 border-slate-600 text-white"
            />
            <Input
              value={manualAlt}
              onChange={(e) => setManualAlt(e.target.value)}
              placeholder="高度"
              className="h-7 text-[11px] bg-slate-900/60 border-slate-600 text-white"
            />
          </div>
          <Button
            size="sm"
            onClick={handleManualAdd}
            className="h-6 w-full text-[11px] bg-cyan-700 hover:bg-cyan-600"
          >
            <Plus className="w-3 h-3 mr-1" />添加
          </Button>
          <div className="text-[10px] text-slate-500">也可直接在左侧地图上点选，两边实时同步</div>
        </div>

        {/* 航点列表 */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>
              航点列表（{waypoints.length}/{MAX_WAYPOINTS}）
            </span>
            {insertMode.active && <span className="text-violet-300">插入态：仅显示相邻点</span>}
          </div>
          {visible.length === 0 ? (
            <div className="text-center text-[11px] text-slate-500 py-4">
              还没有航点，点击地图或手动填写经纬度
            </div>
          ) : (
            visible.map((w) => {
              const isSub = !Number.isInteger(w.displayLabel);
              const isSelected =
                selectedLabel !== null && Math.abs(selectedLabel - w.displayLabel) < 1e-6;
              return (
                <div
                  key={w.displayLabel}
                  onClick={() => setSelectedLabel(w.displayLabel)}
                  className={`rounded border p-1.5 cursor-pointer transition-colors ${
                    isSelected
                      ? 'border-amber-500/60 bg-amber-900/20'
                      : isSub
                        ? 'border-violet-500/40 bg-violet-900/15 hover:border-violet-400/60'
                        : 'border-slate-600/60 bg-slate-800/40 hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-[11px] font-bold font-mono ${
                        isSub ? 'text-violet-300' : 'text-cyan-300'
                      }`}
                    >
                      #{formatLabel(w.displayLabel)}
                    </span>
                    <div className="flex items-center gap-1">
                      {/* 插入只对整数编号开放，且插入态下不再嵌套 */}
                      {!isSub && !insertMode.active && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            beginInsert(w.displayLabel);
                          }}
                          className="text-violet-300 hover:text-violet-200"
                          title="在该点之前插入航点"
                        >
                          <CornerDownRight className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteWaypoint(w.displayLabel);
                        }}
                        className="text-red-400 hover:text-red-300"
                        title="删除该点（其余点编号不变）"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    <Input
                      defaultValue={w.latitude != null ? String(w.latitude) : ''}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => handleRowChange(w.displayLabel, 'latitude', e.target.value)}
                      className="h-6 text-[10px] bg-slate-900/60 border-slate-600 text-white px-1"
                    />
                    <Input
                      defaultValue={w.longitude != null ? String(w.longitude) : ''}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => handleRowChange(w.displayLabel, 'longitude', e.target.value)}
                      className="h-6 text-[10px] bg-slate-900/60 border-slate-600 text-white px-1"
                    />
                    <Input
                      defaultValue={w.altitude != null ? String(w.altitude) : ''}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => handleRowChange(w.displayLabel, 'altitude', e.target.value)}
                      className="h-6 text-[10px] bg-slate-900/60 border-slate-600 text-white px-1"
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 底部操作区 */}
      <div className="border-t border-[rgba(0,240,255,0.12)] p-2 space-y-2">
        {error && (
          <div className="flex items-start gap-1.5 rounded border border-red-500/40 bg-red-900/30 px-2 py-1.5 text-[11px] text-red-200">
            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <div className="flex gap-1.5">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="h-7 flex-1 text-xs bg-cyan-700 hover:bg-cyan-600"
          >
            {saving ? '提交中...' : editingTaskId ? '保存修改' : '创建任务'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onClose}
            disabled={saving}
            className="h-7 flex-1 text-xs bg-slate-800/60 border-slate-600 text-slate-200"
          >
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}
