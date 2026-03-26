import { create } from 'zustand';

interface ViewportState {
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  } | null;
  zoomLevel: number;
  center: { lat: number; lng: number };

  setBounds: (bounds: ViewportState['bounds']) => void;
  setZoomLevel: (zoom: number) => void;
  setCenter: (center: { lat: number; lng: number }) => void;
  isInViewport: (lat: number, lng: number) => boolean;
}

export const useViewportStore = create<ViewportState>((set, get) => ({
  bounds: null,
  zoomLevel: 3,
  center: { lat: 30, lng: 105 },

  setBounds: (bounds) => set({ bounds }),
  setZoomLevel: (zoom) => set({ zoomLevel: zoom }),
  setCenter: (center) => set({ center }),

  isInViewport: (lat, lng) => {
    const { bounds } = get();
    if (!bounds) return true; // No bounds means show everything
    return (
      lat >= bounds.minLat &&
      lat <= bounds.maxLat &&
      lng >= bounds.minLon &&
      lng <= bounds.maxLon
    );
  },
}));
