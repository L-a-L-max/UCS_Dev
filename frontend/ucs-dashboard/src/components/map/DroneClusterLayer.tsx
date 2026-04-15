import { useEffect, useRef, useCallback, useMemo } from 'react';
import maplibregl from 'maplibre-gl';

/**
 * T-38: 地图标注虚拟化渲染（DroneClusterLayer）
 *
 * 根据缩放级别自动切换渲染策略，支持千架级无人机场景：
 * - zoom < 10：聚合模式（Cluster），将密集区域的无人机合并为聚合圆
 * - 10 ≤ zoom < 14：简化标记模式（Simple Marker），显示单个无人机图标
 * - zoom ≥ 14：详情面板模式（Detail Panel），显示无人机详细信息卡片
 *
 * 性能优化：
 * - GPU 渲染：使用 MapLibre GL Symbol Layer（WebGL），避免 DOM 标记开销
 * - 视口裁剪：只渲染当前屏幕可见区域内的无人机
 * - 节流更新：数据更新频率限制在 10Hz，避免过度重绘
 */

export interface ClusterDroneData {
  uavId: string;
  lat: number;
  lng: number;
  altitude: number;
  heading: number;
  battery?: number;
  flightStatus: string;
  onlineStatus: boolean;
  armed?: boolean;
  teamName?: string;
  controlOwnerName?: string;
}

interface DroneClusterLayerProps {
  map: maplibregl.Map | null;
  drones: ClusterDroneData[];
  selectedDroneId?: string | null;
  /** Zoom level below which drones are clustered (default: 10) */
  clusterZoomThreshold?: number;
  /** Zoom level above which detail panels are shown (default: 14) */
  detailZoomThreshold?: number;
  /** Cluster aggregation radius in pixels (default: 80) */
  clusterRadius?: number;
  /** Callback when a drone marker is clicked */
  onDroneClick?: (uavId: string) => void;
  /** Callback when a cluster is clicked (provides list of drone IDs in the cluster) */
  onClusterClick?: (droneIds: string[], center: [number, number]) => void;
}

// Layer & Source IDs
const SOURCE_ID = 'drone-cluster-source';
const CLUSTER_CIRCLE_LAYER = 'drone-cluster-circles';
const CLUSTER_COUNT_LAYER = 'drone-cluster-counts';
const SIMPLE_MARKER_LAYER = 'drone-simple-markers';
const DETAIL_MARKER_LAYER = 'drone-detail-markers';
const DETAIL_LABEL_LAYER = 'drone-detail-labels';

// Create a simple drone icon as ImageData (SDF for dynamic coloring)
function createDroneIconSDF(size: number = 48): ImageData {
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

  // Arms (quadcopter shape)
  const armLength = 14 * scale;
  const angles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
  for (const angle of angles) {
    const ex = cx + Math.cos(angle) * armLength;
    const ey = cy + Math.sin(angle) * armLength;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex, ey, 5 * scale, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Direction indicator (triangle)
  ctx.beginPath();
  ctx.moveTo(cx, cy - 18 * scale);
  ctx.lineTo(cx - 3 * scale, cy - 12 * scale);
  ctx.lineTo(cx + 3 * scale, cy - 12 * scale);
  ctx.closePath();
  ctx.fill();

  return ctx.getImageData(0, 0, size, size);
}

export function DroneClusterLayer({
  map,
  drones,
  selectedDroneId,
  clusterZoomThreshold = 10,
  detailZoomThreshold = 14,
  clusterRadius = 80,
  onDroneClick,
  onClusterClick,
}: DroneClusterLayerProps) {
  const initializedRef = useRef(false);
  const onDroneClickRef = useRef(onDroneClick);
  const onClusterClickRef = useRef(onClusterClick);
  onDroneClickRef.current = onDroneClick;
  onClusterClickRef.current = onClusterClick;

  // Throttle data updates to 10Hz
  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDataRef = useRef<GeoJSON.FeatureCollection | null>(null);

  // Build GeoJSON from drone data
  const geoJsonData = useMemo((): GeoJSON.FeatureCollection => {
    const features: GeoJSON.Feature[] = drones
      .filter(d => d.lat !== 0 && d.lng !== 0)
      .map(drone => ({
        type: 'Feature',
        properties: {
          uavId: drone.uavId,
          heading: drone.heading || 0,
          altitude: drone.altitude || 0,
          battery: drone.battery ?? -1,
          flightStatus: drone.flightStatus || 'IDLE',
          onlineStatus: drone.onlineStatus,
          armed: drone.armed || false,
          selected: drone.uavId === selectedDroneId,
          teamName: drone.teamName || '',
          controlOwnerName: drone.controlOwnerName || '',
          // Label for detail view
          label: `${drone.uavId}\n${drone.altitude?.toFixed(1) || 0}m | ${drone.battery != null && drone.battery >= 0 ? drone.battery.toFixed(0) + '%' : 'N/A'}`,
        },
        geometry: {
          type: 'Point',
          coordinates: [drone.lng, drone.lat],
        },
      }));

    return { type: 'FeatureCollection', features };
  }, [drones, selectedDroneId]);

  // Initialize source and all layers
  const initializeLayers = useCallback(() => {
    if (!map || initializedRef.current) return;
    if (!map.isStyleLoaded()) return;

    // Add drone icon
    if (!map.hasImage('cluster-drone-icon')) {
      const iconData = createDroneIconSDF(48);
      map.addImage('cluster-drone-icon', iconData, { sdf: true });
    }

    // Add GeoJSON source with clustering
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: clusterZoomThreshold,
        clusterRadius: clusterRadius,
      });
    }

    // ---- Layer 1: Cluster circles (zoom < clusterZoomThreshold) ----
    if (!map.getLayer(CLUSTER_CIRCLE_LAYER)) {
      map.addLayer({
        id: CLUSTER_CIRCLE_LAYER,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step', ['get', 'point_count'],
            'rgba(0, 200, 255, 0.7)',    // < 10: cyan
            10, 'rgba(130, 80, 223, 0.7)',  // 10-50: purple
            50, 'rgba(255, 59, 92, 0.7)',   // 50-100: red
            100, 'rgba(255, 30, 30, 0.8)',  // 100+: deep red
          ],
          'circle-radius': [
            'step', ['get', 'point_count'],
            18, 10, 24, 50, 32, 100, 40,
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(255, 255, 255, 0.3)',
        },
      });
    }

    // ---- Layer 2: Cluster count labels ----
    if (!map.getLayer(CLUSTER_COUNT_LAYER)) {
      map.addLayer({
        id: CLUSTER_COUNT_LAYER,
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Open Sans Bold'],
          'text-size': 13,
        },
        paint: {
          'text-color': '#ffffff',
        },
      });
    }

    // ---- Layer 3: Simple markers (clusterZoomThreshold ≤ zoom < detailZoomThreshold) ----
    if (!map.getLayer(SIMPLE_MARKER_LAYER)) {
      map.addLayer({
        id: SIMPLE_MARKER_LAYER,
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        minzoom: clusterZoomThreshold,
        maxzoom: detailZoomThreshold,
        layout: {
          'icon-image': 'cluster-drone-icon',
          'icon-size': 0.6,
          'icon-rotation-alignment': 'map',
          'icon-rotate': ['get', 'heading'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-color': [
            'case',
            ['==', ['get', 'selected'], true], '#FFB800',
            ['==', ['get', 'armed'], true], '#00F0FF',
            ['==', ['get', 'onlineStatus'], false], '#64748B',
            '#94A3B8',
          ],
          'icon-halo-color': [
            'case',
            ['==', ['get', 'selected'], true], 'rgba(255, 184, 0, 0.4)',
            'rgba(0, 240, 255, 0.2)',
          ],
          'icon-halo-width': 3,
        },
      });
    }

    // ---- Layer 4: Detail markers (zoom ≥ detailZoomThreshold) ----
    if (!map.getLayer(DETAIL_MARKER_LAYER)) {
      map.addLayer({
        id: DETAIL_MARKER_LAYER,
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        minzoom: detailZoomThreshold,
        layout: {
          'icon-image': 'cluster-drone-icon',
          'icon-size': 0.8,
          'icon-rotation-alignment': 'map',
          'icon-rotate': ['get', 'heading'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-color': [
            'case',
            ['==', ['get', 'selected'], true], '#FFB800',
            ['==', ['get', 'armed'], true], '#00F0FF',
            ['==', ['get', 'onlineStatus'], false], '#64748B',
            '#94A3B8',
          ],
          'icon-halo-color': [
            'case',
            ['==', ['get', 'selected'], true], 'rgba(255, 184, 0, 0.5)',
            'rgba(0, 240, 255, 0.3)',
          ],
          'icon-halo-width': 5,
        },
      });
    }

    // ---- Layer 5: Detail labels (zoom ≥ detailZoomThreshold) ----
    if (!map.getLayer(DETAIL_LABEL_LAYER)) {
      map.addLayer({
        id: DETAIL_LABEL_LAYER,
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        minzoom: detailZoomThreshold,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Open Sans Regular'],
          'text-size': 11,
          'text-offset': [0, 2.5],
          'text-anchor': 'top',
          'text-allow-overlap': false,
          'text-optional': true,
        },
        paint: {
          'text-color': '#E2E8F0',
          'text-halo-color': 'rgba(15, 23, 42, 0.8)',
          'text-halo-width': 1.5,
        },
      });
    }

    // ---- Click handlers ----
    // Click on individual drone (simple or detail marker)
    for (const layerId of [SIMPLE_MARKER_LAYER, DETAIL_MARKER_LAYER]) {
      map.on('click', layerId, (e) => {
        if (e.features && e.features.length > 0) {
          const uavId = e.features[0].properties?.uavId;
          if (uavId) onDroneClickRef.current?.(uavId);
        }
      });
      map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
    }

    // Click on cluster — zoom in
    map.on('click', CLUSTER_CIRCLE_LAYER, (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [CLUSTER_CIRCLE_LAYER] });
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
    map.on('mouseenter', CLUSTER_CIRCLE_LAYER, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', CLUSTER_CIRCLE_LAYER, () => { map.getCanvas().style.cursor = ''; });

    initializedRef.current = true;
  }, [map, clusterZoomThreshold, detailZoomThreshold, clusterRadius]);

  // Initialize on map load
  useEffect(() => {
    if (!map) return;
    if (map.isStyleLoaded()) {
      initializeLayers();
    } else {
      map.on('load', initializeLayers);
      return () => { map.off('load', initializeLayers); };
    }
  }, [map, initializeLayers]);

  // Throttled data update (10Hz max)
  useEffect(() => {
    if (!map || !initializedRef.current) return;

    pendingDataRef.current = geoJsonData;

    if (!updateTimerRef.current) {
      updateTimerRef.current = setTimeout(() => {
        updateTimerRef.current = null;
        const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource;
        if (source && pendingDataRef.current) {
          source.setData(pendingDataRef.current);
        }
      }, 100); // 10Hz
    }
  }, [map, geoJsonData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
        updateTimerRef.current = null;
      }
      if (!map) return;
      try {
        const layers = [DETAIL_LABEL_LAYER, DETAIL_MARKER_LAYER, SIMPLE_MARKER_LAYER, CLUSTER_COUNT_LAYER, CLUSTER_CIRCLE_LAYER];
        for (const id of layers) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        // Map may already be destroyed
      }
      initializedRef.current = false;
    };
  }, [map]);

  return null; // Data-only component, no DOM output
}

export default DroneClusterLayer;
