import { create } from 'zustand';

interface UIState {
  // Sidebar
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;

  // Map controls
  showHeatmap: boolean;
  selectedHeatmapLayers: Set<string>;
  selectedFlightStatus: Set<string>;

  // Panels
  showLocationSelector: boolean;
  showTileSelector: boolean;
  activeTab: string;

  // Actions
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  setActiveTab: (tab: string) => void;
  toggleHeatmapLayer: (layer: string) => void;
  toggleFlightStatus: (status: string) => void;
  setShowLocationSelector: (show: boolean) => void;
  setShowTileSelector: (show: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
  showHeatmap: false,
  selectedHeatmapLayers: new Set<string>(),
  selectedFlightStatus: new Set<string>(['flying', 'idle']),
  showLocationSelector: false,
  showTileSelector: false,
  activeTab: 'drones',

  toggleLeftPanel: () => set((state) => ({ leftPanelCollapsed: !state.leftPanelCollapsed })),
  toggleRightPanel: () => set((state) => ({ rightPanelCollapsed: !state.rightPanelCollapsed })),
  setActiveTab: (tab) => set({ activeTab: tab }),

  toggleHeatmapLayer: (layer) =>
    set((state) => {
      const newSet = new Set(state.selectedHeatmapLayers);
      if (newSet.has(layer)) newSet.delete(layer);
      else newSet.add(layer);
      return { selectedHeatmapLayers: newSet };
    }),

  toggleFlightStatus: (status) =>
    set((state) => {
      const newSet = new Set(state.selectedFlightStatus);
      if (newSet.has(status)) newSet.delete(status);
      else newSet.add(status);
      return { selectedFlightStatus: newSet };
    }),

  setShowLocationSelector: (show) => set({ showLocationSelector: show }),
  setShowTileSelector: (show) => set({ showTileSelector: show }),
}));
