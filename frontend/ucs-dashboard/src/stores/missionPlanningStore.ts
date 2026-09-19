import { create } from 'zustand';
import {
  MAX_INSERT_SUB_POINTS,
  MAX_WAYPOINTS,
  type Waypoint,
} from '@/types/task';

/**
 * 航点预规划的编辑态。
 *
 * 编号规则（需求原文）：
 *   - 新增点用下一个未使用的整数编号，计数器只增不减；
 *   - 删除中间点（比如 1~6 删掉 3）后，4/5/6 的编号保持不变，
 *     下一个新增点仍然从 7 开始；
 *   - 在第 5 点上「插入」，临时只展示 4 和 5，在两者之间新增的点
 *     依次编号 4.1 ~ 4.9，最多九个。
 *
 * 之所以用「数值编号 + 升序」而不是链表指针：编号的数值顺序天然
 * 就是执行顺序（4 < 4.1 < 4.9 < 5），提交时按编号升序排一遍即可，
 * 删除和插入都不需要重排其余点。
 */

export interface InsertModeState {
  active: boolean;
  /** 插入位置的前一个点的编号（比如在 5 上插入，这里是 4） */
  afterLabel: number;
  /** 插入位置的后一个点的编号，也就是被点击的那个点（比如 5） */
  beforeLabel: number | null;
  /** 下一个子点用的序号：1 表示 x.1，最多到 9 */
  subIndex: number;
}

const IDLE_INSERT: InsertModeState = {
  active: false,
  afterLabel: 0,
  beforeLabel: null,
  subIndex: 1,
};

/** 浮点编号比较用的容差，避免 4.1 !== 4.1000000000000005 */
const EPS = 1e-6;

const sameLabel = (a: number, b: number) => Math.abs(a - b) < EPS;

/** 把 x.1 这类编号规整到一位小数，消除浮点误差 */
const roundLabel = (value: number) => Math.round(value * 10) / 10;

interface MissionPlanningState {
  /** 规划模式：开启后地图点击不再弹飞控按钮，而是加点/选中/删除/插入 */
  isPlanningMode: boolean;
  /** 正在修改的任务 ID；为 null 表示新建 */
  editingTaskId: number | null;
  waypoints: Waypoint[];
  /** 下一个整数编号，删除时不回退 */
  nextLabel: number;
  insertMode: InsertModeState;
  /** 地图上被点中的航点编号（弹出「选中 / 删除 / 插入」时高亮用） */
  selectedLabel: number | null;
  /** 默认高度（米，相对 Home），新增点沿用上一次的设置 */
  defaultAltitude: number;

  enterPlanning: (taskId?: number | null) => void;
  exitPlanning: () => void;
  loadWaypoints: (waypoints: Waypoint[], taskId: number | null) => void;

  /** 新增一个航点，返回它的编号；超出上限或插入位已满时返回 null */
  addWaypoint: (lat: number, lon: number, alt?: number) => number | null;
  updateWaypoint: (label: number, patch: Partial<Waypoint>) => void;
  deleteWaypoint: (label: number) => void;

  /** 在被点击的航点之前插入：传第 5 点，新点编号就是 4.1 ~ 4.9 */
  beginInsert: (clickedLabel: number) => void;
  cancelInsert: () => void;
  finishInsert: () => void;

  setSelectedLabel: (label: number | null) => void;
  setDefaultAltitude: (alt: number) => void;

  /** 按编号升序排好的完整航点列表——这就是提交给后端的顺序 */
  getOrderedWaypoints: () => Waypoint[];
  /** 当前应该画在地图上的航点：插入态下只显示相邻两点和新插入的子点 */
  getVisibleWaypoints: () => Waypoint[];
}

const byLabel = (a: Waypoint, b: Waypoint) => a.displayLabel - b.displayLabel;

export const useMissionPlanningStore = create<MissionPlanningState>((set, get) => ({
  isPlanningMode: false,
  editingTaskId: null,
  waypoints: [],
  nextLabel: 1,
  insertMode: { ...IDLE_INSERT },
  selectedLabel: null,
  defaultAltitude: 30,

  enterPlanning: (taskId = null) =>
    set({
      isPlanningMode: true,
      editingTaskId: taskId ?? null,
      insertMode: { ...IDLE_INSERT },
      selectedLabel: null,
    }),

  exitPlanning: () =>
    set({
      isPlanningMode: false,
      editingTaskId: null,
      waypoints: [],
      nextLabel: 1,
      insertMode: { ...IDLE_INSERT },
      selectedLabel: null,
    }),

  loadWaypoints: (waypoints, taskId) => {
    const sorted = [...waypoints].sort(byLabel);
    const maxLabel = sorted.reduce((max, w) => Math.max(max, w.displayLabel), 0);
    set({
      waypoints: sorted,
      // 已有最大编号是 6 或 6.3 时，下一个新增点都从 7 开始
      nextLabel: Math.floor(maxLabel) + 1,
      editingTaskId: taskId,
      insertMode: { ...IDLE_INSERT },
      selectedLabel: null,
    });
  },

  addWaypoint: (lat, lon, alt) => {
    const state = get();
    if (state.waypoints.length >= MAX_WAYPOINTS) return null;

    const altitude = alt ?? state.defaultAltitude;
    let label: number;

    if (state.insertMode.active) {
      if (state.insertMode.subIndex > MAX_INSERT_SUB_POINTS) return null;
      label = roundLabel(state.insertMode.afterLabel + state.insertMode.subIndex * 0.1);
      // 理论上不会撞车，插入前已经算过 subIndex 的起点，这里只做兜底
      if (state.waypoints.some((w) => sameLabel(w.displayLabel, label))) return null;
      set({
        waypoints: [
          ...state.waypoints,
          { displayLabel: label, itemType: 'NAV', latitude: lat, longitude: lon, altitude, holdTime: 0 },
        ].sort(byLabel),
        insertMode: { ...state.insertMode, subIndex: state.insertMode.subIndex + 1 },
      });
      return label;
    }

    label = state.nextLabel;
    set({
      waypoints: [
        ...state.waypoints,
        { displayLabel: label, itemType: 'NAV', latitude: lat, longitude: lon, altitude, holdTime: 0 },
      ].sort(byLabel),
      // 计数器只增不减：删掉中间点后新增点仍然接着往下排
      nextLabel: state.nextLabel + 1,
    });
    return label;
  },

  updateWaypoint: (label, patch) =>
    set((state) => ({
      waypoints: state.waypoints.map((w) =>
        sameLabel(w.displayLabel, label) ? { ...w, ...patch } : w
      ),
    })),

  deleteWaypoint: (label) =>
    set((state) => ({
      // 只删这一个点，其余点编号一律不动，nextLabel 也不回退
      waypoints: state.waypoints.filter((w) => !sameLabel(w.displayLabel, label)),
      selectedLabel: state.selectedLabel !== null && sameLabel(state.selectedLabel, label)
        ? null
        : state.selectedLabel,
    })),

  beginInsert: (clickedLabel) => {
    const state = get();
    const ordered = [...state.waypoints].sort(byLabel);
    // 需求：在第 5 个航点上点「插入」，是往第 4 与第 5 之间插，新点编号 4.1 ~ 4.9。
    // 所以插入段的基准编号是「被点航点编号 - 1」，第 1 点上插入就落到 0.1 ~ 0.9，
    // 数值上仍然排在第 1 点前面，顺序不会乱。
    const base = Math.floor(clickedLabel) - 1;

    // 这一段里已经插过的子点数决定下一个子序号（4.1 已存在 → 从 4.2 开始）
    const usedSubPoints = ordered.filter(
      (w) => w.displayLabel > base + EPS && w.displayLabel < base + 1 - EPS
    ).length;

    set({
      insertMode: {
        active: true,
        afterLabel: base,
        beforeLabel: clickedLabel,
        subIndex: usedSubPoints + 1,
      },
      selectedLabel: null,
    });
  },

  cancelInsert: () => set({ insertMode: { ...IDLE_INSERT } }),

  finishInsert: () => set({ insertMode: { ...IDLE_INSERT }, selectedLabel: null }),

  setSelectedLabel: (label) => set({ selectedLabel: label }),

  setDefaultAltitude: (alt) => set({ defaultAltitude: alt }),

  getOrderedWaypoints: () => [...get().waypoints].sort(byLabel),

  getVisibleWaypoints: () => {
    const { waypoints, insertMode } = get();
    const ordered = [...waypoints].sort(byLabel);
    if (!insertMode.active) return ordered;

    const { afterLabel, beforeLabel } = insertMode;
    return ordered.filter((w) => {
      const l = w.displayLabel;
      if (sameLabel(l, afterLabel)) return true;                       // 前一个点，如 4
      if (beforeLabel !== null && sameLabel(l, beforeLabel)) return true; // 后一个点，如 5
      return l > afterLabel + EPS && l < afterLabel + 1 - EPS;         // 新插入的 4.1 ~ 4.9
    });
  },
}));
