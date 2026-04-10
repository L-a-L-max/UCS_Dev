import { create } from 'zustand';

export interface DroneData {
  uavId: string;
  lat: number;
  lng: number;
  altitude: number;
  battery?: number;
  flightStatus: string;
  onlineStatus: boolean;
  model?: string;
  owner?: string;
  teamName?: string;
  teamLeader?: string;
  controlOwnerName?: string;
  taskStatus?: string;
  currentTask?: string;
  heading?: number;
  armed?: boolean;
  groundSpeed?: number;
  verticalSpeed?: number;
}

interface DroneState {
  drones: DroneData[];
  selectedDroneId: string | null;
  trackingDroneId: string | null;

  // Actions
  setDrones: (drones: DroneData[]) => void;
  updateDrone: (uavId: string, update: Partial<DroneData>) => void;
  updateDronesFromTelemetry: (telemetryDrones: DroneData[]) => void;
  setSelectedDroneId: (id: string | null) => void;
  setTrackingDroneId: (id: string | null) => void;

  // Selectors (computed)
  getOnlineDrones: () => DroneData[];
  getFlyingDrones: () => DroneData[];
  getLowBatteryDrones: () => DroneData[];
}

export const useDroneStore = create<DroneState>((set, get) => ({
  drones: [],
  selectedDroneId: null,
  trackingDroneId: null,

  setDrones: (drones) => set({ drones }),

  updateDrone: (uavId, update) =>
    set((state) => ({
      drones: state.drones.map((d) =>
        d.uavId === uavId ? { ...d, ...update } : d
      ),
    })),

  updateDronesFromTelemetry: (telemetryDrones) =>
    set((state) => {
      const droneMap = new Map(state.drones.map((d) => [d.uavId, d]));
      let changed = false;

      telemetryDrones.forEach((td) => {
        const existing = droneMap.get(td.uavId);
        if (existing) {
          // Update in place
          const updated = { ...existing };
          if (td.lat !== existing.lat || td.lng !== existing.lng) {
            updated.lat = td.lat;
            updated.lng = td.lng;
            changed = true;
          }
          if (td.altitude !== existing.altitude) { updated.altitude = td.altitude; changed = true; }
          if (td.battery != null && td.battery !== existing.battery) { updated.battery = td.battery; changed = true; }
          if (td.onlineStatus !== existing.onlineStatus) { updated.onlineStatus = td.onlineStatus; changed = true; }
          if (td.flightStatus && td.flightStatus !== existing.flightStatus) { updated.flightStatus = td.flightStatus; changed = true; }
          if (td.heading != null && td.heading !== existing.heading) { updated.heading = td.heading; changed = true; }
          if (td.armed != null && td.armed !== existing.armed) { updated.armed = td.armed; changed = true; }
          if (changed) droneMap.set(td.uavId, updated);
        } else {
          droneMap.set(td.uavId, td);
          changed = true;
        }
      });

      if (!changed) return state;
      return { drones: Array.from(droneMap.values()).sort((a, b) => a.uavId.localeCompare(b.uavId)) };
    }),

  setSelectedDroneId: (id) => set({ selectedDroneId: id }),
  setTrackingDroneId: (id) => set({ trackingDroneId: id }),

  getOnlineDrones: () => get().drones.filter((d) => d.onlineStatus),
  getFlyingDrones: () => get().drones.filter((d) => d.flightStatus === 'FLYING'),
  getLowBatteryDrones: () => get().drones.filter((d) => (d.battery ?? 100) < 20),
}));
