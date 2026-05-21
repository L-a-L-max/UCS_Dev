/**
 * Baidu Map 3D Real-Scene Panel
 *
 * Uses Baidu Maps JSAPI Three (mapvthree) for immersive 3D real-scene map rendering
 * with satellite imagery and 3D vector buildings.
 * Supports drone markers via DOMOverlay, click-to-show-coordinates,
 * real-time position sync, drone focus/locate/follow, and map-click
 * command menu (GOTO, ORBIT, RTH, MARK_HOME).
 */
import { useEffect, useRef, useCallback, useState, useImperativeHandle, forwardRef } from 'react';
import type { MapDrone } from '../MapPanel';
import * as mapvthree from '@baidumap/mapv-three';

export interface BaiduMap3DPanelHandle {
  focusOnDrones: () => void;
}

const BAIDU_MAP_AK = import.meta.env.VITE_BAIDU_MAP_AK || 'nGb4GqLhx9IMrTkm3xlZKg6dv2J2pXnu';

const OBLIQUE_3DTILES_URLS = [
  'https://t.hangzhoumap.gov.cn/3dtile/atzx/tileset.json',
  'https://t.hangzhoumap.gov.cn/3dtile/xxsd/tileset.json',
];
const CUSTOM_3DTILES_URL = import.meta.env.VITE_3DTILES_URL as string | undefined;

interface BaiduMap3DPanelProps {
  drones: MapDrone[];
  selectedDroneId?: string | null;
  selectedDroneIds?: Set<string>;
  onDroneClick?: (uavId: string) => void;
  onMapClick?: (lat: number, lon: number) => void;
  onMapClickCommand?: (command: string, lat: number, lng: number) => void;
  hasDroneSelected?: boolean;
  locateDroneId?: string | null;
  locateDroneCounter?: number;
  followDroneId?: string | null;
  onFollowExit?: () => void;
  className?: string;
  center?: [number, number]; // [lng, lat]
  zoom?: number;
  pitch?: number;
}

function getDroneStatusText(drone: MapDrone): string {
  if (!drone.onlineStatus) return '离线';
  if (drone.armed) return '飞行中';
  return '在线';
}

function getDroneMarkerColor(drone: MapDrone, isSelected: boolean): string {
  if (isSelected) return '#f59e0b';
  if (!drone.onlineStatus) return '#64748b';
  if (drone.armed) return '#22c55e';
  return '#3b82f6';
}

function createDroneMarkerHTML(drone: MapDrone, color: string, heading: number): string {
  return `<div style="display:flex;flex-direction:column;align-items:center;cursor:pointer;pointer-events:auto;" data-drone-id="${drone.uavId}">
    <svg width="36" height="36" viewBox="0 0 36 36" style="transform:rotate(${heading}deg);filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));">
      <polygon points="18,2 28,30 18,24 8,30" fill="${color}" stroke="white" stroke-width="1.5" opacity="0.95"/>
    </svg>
    <div style="background:rgba(15,23,42,0.85);color:white;font-size:10px;padding:1px 6px;border-radius:3px;margin-top:-4px;white-space:nowrap;border:1px solid ${color};pointer-events:none;">
      ${drone.uavId}
    </div>
  </div>`;
}

const BaiduMap3DPanel = forwardRef<BaiduMap3DPanelHandle, BaiduMap3DPanelProps>(function BaiduMap3DPanel({
  drones,
  selectedDroneId,
  selectedDroneIds,
  onDroneClick,
  onMapClick,
  onMapClickCommand,
  hasDroneSelected = false,
  locateDroneId,
  locateDroneCounter = 0,
  followDroneId,
  onFollowExit,
  className = '',
  center = [120.2130, 30.2130],
  zoom = 6,
  pitch = 60,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<mapvthree.Engine | null>(null);
  const droneOverlaysRef = useRef<Map<string, mapvthree.DOMOverlay>>(new Map());
  const popupRef = useRef<mapvthree.Popup | null>(null);
  const mapClickOverlayRef = useRef<mapvthree.DOMOverlay | null>(null);
  const blinkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const blinkStateRef = useRef(true);
  const popupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userDragHandlerRef = useRef<(() => void) | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [engineReady, setEngineReady] = useState(false);

  // Stable refs for callbacks
  const dronesRef = useRef(drones);
  dronesRef.current = drones;
  const onDroneClickRef = useRef(onDroneClick);
  onDroneClickRef.current = onDroneClick;
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const onMapClickCommandRef = useRef(onMapClickCommand);
  onMapClickCommandRef.current = onMapClickCommand;
  const hasDroneSelectedRef = useRef(hasDroneSelected);
  hasDroneSelectedRef.current = hasDroneSelected;
  const onFollowExitRef = useRef(onFollowExit);
  onFollowExitRef.current = onFollowExit;

  // Close any existing popup
  const closePopup = useCallback(() => {
    if (popupRef.current && engineRef.current) {
      engineRef.current.remove(popupRef.current);
      popupRef.current.dispose();
      popupRef.current = null;
    }
    if (mapClickOverlayRef.current && engineRef.current) {
      engineRef.current.remove(mapClickOverlayRef.current);
      mapClickOverlayRef.current.dispose();
      mapClickOverlayRef.current = null;
    }
    if (popupTimerRef.current) {
      clearTimeout(popupTimerRef.current);
      popupTimerRef.current = null;
    }
  }, []);

  // Show drone info popup
  const showDronePopup = useCallback((drone: MapDrone) => {
    if (!engineRef.current) return;
    closePopup();
    const statusText = getDroneStatusText(drone);
    const content = `
      <div style="font-size:11px;line-height:1.6;min-width:160px;">
        <div style="font-weight:600;margin-bottom:4px;color:#60a5fa;">无人机 ${drone.uavId}</div>
        <div>状态: <span style="color:${drone.armed ? '#4ade80' : drone.onlineStatus ? '#60a5fa' : '#94a3b8'}">${statusText}</span></div>
        <div>经度: ${drone.lng?.toFixed(6) ?? '-'}</div>
        <div>纬度: ${drone.lat?.toFixed(6) ?? '-'}</div>
        <div>高度: ${drone.altitude?.toFixed(1) ?? '-'} m</div>
        ${drone.battery != null ? `<div>电量: ${drone.battery}%</div>` : ''}
        ${drone.model ? `<div>型号: ${drone.model}</div>` : ''}
      </div>`;
    const popup = new mapvthree.Popup({
      point: [drone.lng, drone.lat, (drone.altitude ?? 0) + 20],
      title: `无人机 ${drone.uavId}`,
      content,
      offset: [0, -40],
    });
    popup.className = 'baidu-drone-popup';
    engineRef.current.add(popup);
    popupRef.current = popup;
    popupTimerRef.current = setTimeout(() => closePopup(), 5000);
  }, [closePopup]);

  // Show map click coordinate menu
  const showMapClickMenu = useCallback((lat: number, lng: number) => {
    if (!engineRef.current) return;
    closePopup();
    const menuHTML = `
      <div style="background:rgba(15,23,42,0.95);border:1px solid rgba(100,116,139,0.5);border-radius:8px;padding:8px;color:white;font-size:11px;min-width:150px;backdrop-filter:blur(8px);">
        <div style="color:#94a3b8;margin-bottom:6px;">
          ${lat.toFixed(6)}, ${lng.toFixed(6)}
        </div>
        <div style="display:flex;flex-direction:column;gap:3px;">
          <button data-cmd="GOTO" style="background:#3b82f6;border:none;color:white;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:10px;">前往此处</button>
          <button data-cmd="ORBIT" style="background:#8b5cf6;border:none;color:white;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:10px;">盘旋此处</button>
          <button data-cmd="MARK_HOME" style="background:#f59e0b;border:none;color:white;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:10px;">设为Home</button>
        </div>
      </div>`;
    const overlay = new mapvthree.DOMOverlay({
      point: [lng, lat, 0],
      dom: menuHTML,
      offset: [10, -10],
    });
    overlay.stopPropagation = true;
    engineRef.current.add(overlay);
    mapClickOverlayRef.current = overlay;

    // Attach command button handlers
    setTimeout(() => {
      const el = overlay.dom;
      if (!el) return;
      el.querySelectorAll('button[data-cmd]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const cmd = (e.currentTarget as HTMLElement).getAttribute('data-cmd');
          if (cmd) onMapClickCommandRef.current?.(cmd, lat, lng);
          closePopup();
        });
      });
    }, 50);
    popupTimerRef.current = setTimeout(() => closePopup(), 8000);
  }, [closePopup]);

  // Initialize engine
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    // Configure Baidu Map AK
    mapvthree.BaiduMapConfig.ak = BAIDU_MAP_AK;

    try {
      const engine = new mapvthree.Engine(containerRef.current, {
        rendering: {
          sky: new mapvthree.DynamicSky(),
          enableAnimationLoop: true,
        },
        map: {
          center: [center[0], center[1], 200],
          pitch,
          heading: 0,
          range: 1500,
          projection: 'ECEF',
          provider: null,
        },
      });

      if (destroyed) {
        engine.dispose();
        return;
      }

      // MapView: Bing satellite imagery base
      engine.add(new mapvthree.MapView({
        imageryProvider: new mapvthree.BingImageryTileProvider({
          style: mapvthree.mapViewConstants.BING_MAP_STYLE_AERIAL,
        }),
      }));

      // Load oblique photogrammetry 3D Tiles for real-scene city rendering
      const tileUrls = CUSTOM_3DTILES_URL ? [CUSTOM_3DTILES_URL] : OBLIQUE_3DTILES_URLS;
      for (const url of tileUrls) {
        engine.add(new mapvthree.Default3DTiles({
          url,
          errorTarget: 16,
          forceUnlit: true,
        }));
      }

      // Map click handler
      engine.map.addEventListener('click', (e: { point?: number[] }) => {
        if (!e.point) return;
        const [lng, lat] = e.point;
        onMapClickRef.current?.(lat, lng);
        if (hasDroneSelectedRef.current) {
          showMapClickMenu(lat, lng);
        }
      });

      // Exit follow on user interaction (drag/scroll)
      const container = containerRef.current;
      const handleUserDrag = () => { onFollowExitRef.current?.(); };
      userDragHandlerRef.current = handleUserDrag;
      container.addEventListener('pointerdown', handleUserDrag);
      container.addEventListener('wheel', handleUserDrag);

      engineRef.current = engine;
      setEngineReady(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '引擎初始化失败';
      setLoadError(msg);
    }

    return () => {
      destroyed = true;
      if (blinkTimerRef.current) clearInterval(blinkTimerRef.current);
      if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
      // Remove DOM listeners
      const cont = containerRef.current;
      const handler = userDragHandlerRef.current;
      if (cont && handler) {
        cont.removeEventListener('pointerdown', handler);
        cont.removeEventListener('wheel', handler);
      }
      // Remove overlays
      droneOverlaysRef.current.forEach(overlay => {
        engineRef.current?.remove(overlay);
        overlay.dispose();
      });
      droneOverlaysRef.current.clear();
      if (popupRef.current) {
        engineRef.current?.remove(popupRef.current);
        popupRef.current.dispose();
        popupRef.current = null;
      }
      if (mapClickOverlayRef.current) {
        engineRef.current?.remove(mapClickOverlayRef.current);
        mapClickOverlayRef.current.dispose();
        mapClickOverlayRef.current = null;
      }
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Blink selected drones
  useEffect(() => {
    if (blinkTimerRef.current) clearInterval(blinkTimerRef.current);
    blinkTimerRef.current = setInterval(() => {
      blinkStateRef.current = !blinkStateRef.current;
    }, 500);
    return () => {
      if (blinkTimerRef.current) clearInterval(blinkTimerRef.current);
    };
  }, []);

  // Update drone overlays
  useEffect(() => {
    if (!engineReady || !engineRef.current) return;
    const engine = engineRef.current;
    const currentIds = new Set(drones.map(d => d.uavId));

    // Remove overlays for drones that no longer exist
    droneOverlaysRef.current.forEach((overlay, id) => {
      if (!currentIds.has(id)) {
        engine.remove(overlay);
        overlay.dispose();
        droneOverlaysRef.current.delete(id);
      }
    });

    for (const drone of drones) {
      if (drone.lat == null || drone.lng == null) continue;
      const isSelected = selectedDroneIds
        ? selectedDroneIds.has(drone.uavId)
        : drone.uavId === selectedDroneId;
      const color = getDroneMarkerColor(drone, isSelected);
      const heading = drone.heading ?? 0;
      const alt = drone.altitude ?? 0;
      const html = createDroneMarkerHTML(drone, color, heading);

      const existingOverlay = droneOverlaysRef.current.get(drone.uavId);
      if (existingOverlay) {
        existingOverlay.point = [drone.lng, drone.lat, alt];
        existingOverlay.dom = html;
        // Blink effect: toggle visibility for selected drones
        if (isSelected) {
          existingOverlay.visible = blinkStateRef.current;
        } else {
          existingOverlay.visible = true;
        }
      } else {
        const overlay = new mapvthree.DOMOverlay({
          point: [drone.lng, drone.lat, alt],
          dom: html,
          offset: [0, -18],
        });
        overlay.stopPropagation = true;

        // Click handler on DOMOverlay dom
        const el = overlay.dom;
        if (el) {
          el.style.cursor = 'pointer';
          el.addEventListener('click', () => {
            onDroneClickRef.current?.(drone.uavId);
            const d = dronesRef.current.find(dd => dd.uavId === drone.uavId);
            if (d) showDronePopup(d);
          });
        }

        engine.add(overlay);
        droneOverlaysRef.current.set(drone.uavId, overlay);
      }
    }

    engine.requestRender();
  }, [drones, selectedDroneId, selectedDroneIds, engineReady, showDronePopup]);

  // Focus on all drones
  const focusOnDrones = useCallback(() => {
    if (!engineRef.current || drones.length === 0) return;
    const validDrones = drones.filter(d => d.lat != null && d.lng != null);
    if (validDrones.length === 0) return;

    if (validDrones.length === 1) {
      const d = validDrones[0];
      engineRef.current.map.flyTo([d.lng, d.lat, 0], {
        range: 2000,
        pitch: 60,
        heading: 0,
        duration: 1500,
      });
      return;
    }

    // Calculate center of all drones
    let sumLng = 0, sumLat = 0;
    for (const d of validDrones) {
      sumLng += d.lng;
      sumLat += d.lat;
    }
    const cLng = sumLng / validDrones.length;
    const cLat = sumLat / validDrones.length;

    // Calculate range based on spread
    let maxDist = 0;
    for (const d of validDrones) {
      const dist = Math.sqrt(Math.pow(d.lng - cLng, 2) + Math.pow(d.lat - cLat, 2));
      if (dist > maxDist) maxDist = dist;
    }
    // Convert degrees to approximate meters, add padding
    const rangeMeters = Math.max(2000, maxDist * 111000 * 2.5);

    engineRef.current.map.flyTo([cLng, cLat, 0], {
      range: rangeMeters,
      pitch: 60,
      heading: 0,
      duration: 1500,
    });
  }, [drones]);

  useImperativeHandle(ref, () => ({ focusOnDrones: () => focusOnDrones() }), [focusOnDrones]);

  // Locate drone
  useEffect(() => {
    if (!locateDroneId || !engineRef.current || locateDroneCounter === 0) return;
    const drone = drones.find(d => d.uavId === locateDroneId);
    if (!drone || drone.lat == null || drone.lng == null) return;
    engineRef.current.map.flyTo([drone.lng, drone.lat, 0], {
      range: 1000,
      pitch: 60,
      duration: 1500,
    });
  }, [locateDroneCounter, locateDroneId, drones]);

  // Follow mode
  useEffect(() => {
    if (!followDroneId || !engineRef.current) return;
    const drone = drones.find(d => d.uavId === followDroneId);
    if (!drone || drone.lat == null || drone.lng == null) return;
    engineRef.current.map.setCenter([drone.lng, drone.lat]);
  }, [followDroneId, drones]);

  return (
    <div className={`relative w-full h-full ${className}`}>
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />

      {loadError && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 bg-red-900/90 backdrop-blur-sm rounded-lg px-4 py-2 text-white text-xs flex items-center gap-2 max-w-xs shadow-lg border border-red-700">
          <span className="font-semibold">地图加载失败:</span>
          <span>{loadError}</span>
        </div>
      )}

      {/* Stats overlay */}
      <div className="absolute bottom-6 left-2 z-10 bg-slate-800/80 rounded px-2 py-1 text-xs text-slate-300">
        实景3D | 共 {drones.length} 架 | 在线 {drones.filter(d => d.onlineStatus === true).length} | 飞行中 {drones.filter(d => d.flightStatus === 'FLYING').length}
      </div>
    </div>
  );
});

export default BaiduMap3DPanel;
