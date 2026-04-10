import { useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';

/**
 * Phase 2: DroneLayer — GPU-based Symbol Layer rendering
 *
 * Replaces DOM Marker approach with MapLibre GL Symbol Layer.
 * Benefits:
 * - GPU-rendered (supports 100k+ drones)
 * - Built-in clustering
 * - No DOM overhead per marker
 */

export interface DroneFeature {
  uavId: string;
  lat: number;
  lng: number;
  altitude: number;
  heading: number;
  flightStatus: string;
  battery?: number;
  onlineStatus: boolean;
  armed?: boolean;
}

interface DroneLayerProps {
  map: maplibregl.Map | null;
  drones: DroneFeature[];
  selectedDroneId?: string | null;
  clusterEnabled?: boolean;
  onDroneClick?: (uavId: string) => void;
}

const SOURCE_ID = 'drone-symbol-source';
const LAYER_ID = 'drone-symbol-layer';
const CLUSTER_LAYER_ID = 'drone-cluster-layer';
const CLUSTER_COUNT_LAYER_ID = 'drone-cluster-count-layer';
const UNCLUSTERED_LAYER_ID = 'drone-unclustered-layer';

// Create drone icon as SDF image for dynamic coloring
function createDroneIcon(size: number = 48): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;
  const scale = size / 48;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5 * scale;

  // Central body
  ctx.beginPath();
  ctx.arc(cx, cy, 4 * scale, 0, Math.PI * 2);
  ctx.fill();

  // Arms
  const armLength = 14 * scale;
  const angles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
  for (const angle of angles) {
    const ex = cx + Math.cos(angle) * armLength;
    const ey = cy + Math.sin(angle) * armLength;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    // Rotor circle
    ctx.beginPath();
    ctx.arc(ex, ey, 5 * scale, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Direction indicator (triangle pointing up)
  ctx.beginPath();
  ctx.moveTo(cx, cy - 18 * scale);
  ctx.lineTo(cx - 3 * scale, cy - 12 * scale);
  ctx.lineTo(cx + 3 * scale, cy - 12 * scale);
  ctx.closePath();
  ctx.fill();

  return ctx.getImageData(0, 0, size, size);
}

export function DroneLayer({
  map,
  drones,
  selectedDroneId,
  clusterEnabled = true,
  onDroneClick,
}: DroneLayerProps) {
  const initializedRef = useRef(false);
  const onDroneClickRef = useRef(onDroneClick);
  onDroneClickRef.current = onDroneClick;

  // Initialize source and layers
  const initializeLayers = useCallback(() => {
    if (!map || initializedRef.current) return;
    if (!map.isStyleLoaded()) return;

    // Add drone icon image
    if (!map.hasImage('drone-icon')) {
      const iconData = createDroneIcon(48);
      map.addImage('drone-icon', iconData, { sdf: true });
    }

    // Add GeoJSON source with clustering
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: clusterEnabled,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });
    }

    // Cluster circles layer
    if (!map.getLayer(CLUSTER_LAYER_ID)) {
      map.addLayer({
        id: CLUSTER_LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step',
            ['get', 'point_count'],
            'rgba(0, 240, 255, 0.6)',   // < 10: cyan
            10, 'rgba(160, 32, 240, 0.6)', // 10-50: purple
            50, 'rgba(255, 59, 92, 0.6)',  // 50+: red
          ],
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            16, 10, 20, 50, 28,
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(0, 240, 255, 0.3)',
        },
      });
    }

    // Cluster count labels
    if (!map.getLayer(CLUSTER_COUNT_LAYER_ID)) {
      map.addLayer({
        id: CLUSTER_COUNT_LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Open Sans Bold'],
          'text-size': 12,
        },
        paint: {
          'text-color': '#ffffff',
        },
      });
    }

    // Individual drone symbols
    if (!map.getLayer(UNCLUSTERED_LAYER_ID)) {
      map.addLayer({
        id: UNCLUSTERED_LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        layout: {
          'icon-image': 'drone-icon',
          'icon-size': 0.7,
          'icon-rotation-alignment': 'map',
          'icon-rotate': ['get', 'heading'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-color': [
            'case',
            ['==', ['get', 'selected'], true], '#FFB800',  // Selected: amber
            ['==', ['get', 'flightStatus'], 'FLYING'], '#00F0FF', // Flying: cyan
            '#94A3B8', // Idle: gray
          ],
          'icon-halo-color': [
            'case',
            ['==', ['get', 'selected'], true], 'rgba(255, 184, 0, 0.4)',
            ['==', ['get', 'flightStatus'], 'FLYING'], 'rgba(0, 240, 255, 0.3)',
            'rgba(148, 163, 184, 0.2)',
          ],
          'icon-halo-width': 3,
        },
      });
    }

    // Click handler for individual drones
    map.on('click', UNCLUSTERED_LAYER_ID, (e) => {
      if (e.features && e.features.length > 0) {
        const uavId = e.features[0].properties?.uavId;
        if (uavId) onDroneClickRef.current?.(uavId);
      }
    });

    // Click handler for clusters - zoom in
    map.on('click', CLUSTER_LAYER_ID, (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [CLUSTER_LAYER_ID] });
      if (!features.length) return;
      const clusterId = features[0].properties?.cluster_id;
      const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource;
      // @ts-expect-error getClusterExpansionZoom is available on clustered GeoJSON sources
      source.getClusterExpansionZoom(clusterId, (err: Error | null, zoom: number) => {
        if (err) return;
        const geometry = features[0].geometry;
        if (geometry.type === 'Point') {
          map.easeTo({
            center: geometry.coordinates as [number, number],
            zoom,
          });
        }
      });
    });

    // Cursor changes
    map.on('mouseenter', UNCLUSTERED_LAYER_ID, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', UNCLUSTERED_LAYER_ID, () => {
      map.getCanvas().style.cursor = '';
    });
    map.on('mouseenter', CLUSTER_LAYER_ID, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', CLUSTER_LAYER_ID, () => {
      map.getCanvas().style.cursor = '';
    });

    initializedRef.current = true;
  }, [map, clusterEnabled]);

  // Initialize on map load
  useEffect(() => {
    if (!map) return;

    if (map.isStyleLoaded()) {
      initializeLayers();
    } else {
      map.on('load', initializeLayers);
      return () => {
        map.off('load', initializeLayers);
      };
    }
  }, [map, initializeLayers]);

  // Update drone data
  useEffect(() => {
    if (!map || !initializedRef.current) return;

    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource;
    if (!source) return;

    const features: GeoJSON.Feature[] = drones
      .filter((d) => d.lat && d.lng)
      .map((drone) => ({
        type: 'Feature',
        properties: {
          uavId: drone.uavId,
          heading: drone.heading || 0,
          flightStatus: drone.flightStatus || 'IDLE',
          battery: drone.battery ?? -1,
          altitude: drone.altitude || 0,
          onlineStatus: drone.onlineStatus,
          armed: drone.armed || false,
          selected: drone.uavId === selectedDroneId,
        },
        geometry: {
          type: 'Point',
          coordinates: [drone.lng, drone.lat],
        },
      }));

    source.setData({
      type: 'FeatureCollection',
      features,
    });
  }, [map, drones, selectedDroneId]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (!map) return;
      try {
        if (map.getLayer(CLUSTER_COUNT_LAYER_ID)) map.removeLayer(CLUSTER_COUNT_LAYER_ID);
        if (map.getLayer(CLUSTER_LAYER_ID)) map.removeLayer(CLUSTER_LAYER_ID);
        if (map.getLayer(UNCLUSTERED_LAYER_ID)) map.removeLayer(UNCLUSTERED_LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        // Map may already be destroyed
      }
      initializedRef.current = false;
    };
  }, [map]);

  return null; // This is a data-only component, no DOM output
}

// Also export LAYER_ID for external use (e.g. popups)
export { LAYER_ID, UNCLUSTERED_LAYER_ID, SOURCE_ID };
export default DroneLayer;
