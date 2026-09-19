/**
 * 航点任务（路径预规划）相关类型。
 *
 * 与后端 com.ucs.dto.* 一一对应，字段名保持一致，避免在组件里做转换。
 */

/** 任务状态码，与后端 WaypointTaskService 的常量一致 */
export const TASK_STATUS = {
  PENDING: 0,
  EXECUTING: 1,
  PAUSED: 2,
  COMPLETED: 3,
  ABNORMAL: 4,
  ASSIGNED: 5,
} as const;

export const TASK_STATUS_TEXT: Record<number, string> = {
  0: '待执行',
  1: '执行中',
  2: '已暂停',
  3: '已完成',
  4: '异常',
  5: '已分配',
};

/** 状态对应的展示色（Tailwind class 片段） */
export const TASK_STATUS_COLOR: Record<number, string> = {
  0: 'text-slate-300 border-slate-400/40 bg-slate-500/10',
  1: 'text-cyan-300 border-cyan-400/40 bg-cyan-500/10',
  2: 'text-amber-300 border-amber-400/40 bg-amber-500/10',
  3: 'text-emerald-300 border-emerald-400/40 bg-emerald-500/10',
  4: 'text-red-300 border-red-400/40 bg-red-500/10',
  5: 'text-blue-300 border-blue-400/40 bg-blue-500/10',
};

/** 航点数量上限，与后端 MAX_WAYPOINTS 保持一致 */
export const MAX_WAYPOINTS = 256;

/** 单点超时保护取值范围（秒），与后端校验保持一致 */
export const MIN_WAYPOINT_TIMEOUT = 10;
export const MAX_WAYPOINT_TIMEOUT = 7200;
export const DEFAULT_WAYPOINT_TIMEOUT = 300;

/** 一次插入最多九个子点：4.1 ~ 4.9 */
export const MAX_INSERT_SUB_POINTS = 9;

export type WaypointItemType = 'NAV' | 'ACTION';

export interface Waypoint {
  id?: number;
  /** 执行序号，由后端在保存时按 displayLabel 升序重排为 0,1,2… */
  seq?: number;
  /**
   * 展示编号。删除中间点后其余点编号不变，插入点用 4.1 ~ 4.9。
   * 数值升序 == 执行顺序（4 < 4.1 < 4.9 < 5）。
   */
  displayLabel: number;
  itemType: WaypointItemType;
  latitude?: number | null;
  longitude?: number | null;
  /** 相对 Home 的高度（米） */
  altitude?: number | null;
  holdTime?: number | null;
  actionCommand?: string | null;
  actionParams?: string | null;
}

export interface AssignedDrone {
  droneId: number;
  uavId: string;
  droneSn?: string | null;
  status: number;
  statusText?: string | null;
  progress?: number | null;
  currentSeq?: number | null;
  errorMessage?: string | null;
  online?: boolean | null;
  lastUpdateTime?: string | null;
}

export interface TaskDetail {
  id: number;
  taskName: string;
  taskType?: string | null;
  description?: string | null;
  priority?: number | null;
  status: number;
  statusText?: string | null;
  execCount?: number | null;
  /** 单点超时保护（秒），操作人员可配置 */
  waypointTimeoutSec?: number | null;
  arrivalRadius?: number | null;
  arrivalAltTol?: number | null;
  onFinish?: string | null;
  createdBy?: number | null;
  createdByName?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  lastExecTime?: string | null;
  waypointCount?: number | null;
  progress?: number | null;
  waypoints?: Waypoint[] | null;
  drones?: AssignedDrone[] | null;
}

export interface TaskCreateRequest {
  taskName: string;
  taskType?: string;
  description?: string;
  priority?: number;
  /** 单点超时保护（秒） */
  waypointTimeoutSec?: number;
  arrivalRadius?: number;
  arrivalAltTol?: number;
  onFinish?: string;
  waypoints: Waypoint[];
}

export interface TaskExecuteRequest {
  /** 本次执行临时覆盖的单点超时（秒），不传则用任务里保存的值 */
  waypointTimeoutSec?: number;
  arrivalRadius?: number;
  arrivalAltTol?: number;
  onFinish?: string;
  /** true 时把本次覆盖的参数写回任务 */
  persistOverrides?: boolean;
}

export interface TaskProgress {
  taskId: number;
  status: number;
  statusText?: string;
  progress?: number;
  drones?: AssignedDrone[];
}

/** WebSocket /topic/task-progress 推送的消息 */
export interface TaskProgressMessage {
  type: 'task_progress';
  event: string;
  taskId: number;
  taskName?: string | null;
  uavId: string;
  droneId: number;
  status: number;
  statusText?: string;
  currentSeq?: number;
  totalWaypoints?: number;
  progress?: number;
  errorMessage?: string | null;
  timestamp: string;
}

/** WebSocket /topic/task-alert 推送的消息 */
export interface TaskAlertMessage {
  type: 'task_alert';
  event: string;
  taskId: number;
  uavId: string;
  reason?: string | null;
  timestamp: string;
}

export type TaskSort = 'time_desc' | 'time_asc';

/** 把展示编号格式化成界面上的文字：整数不带小数点，插入点保留一位 */
export function formatLabel(label: number): string {
  return Number.isInteger(label) ? String(label) : label.toFixed(1);
}
