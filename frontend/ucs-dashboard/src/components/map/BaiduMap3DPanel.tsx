/**
 * Baidu Map 3D Real-Scene Panel
 *
 * Uses Baidu Maps JSAPI GL (BMapGL) for immersive 3D real-scene map rendering.
 * Supports drone markers, click-to-show-coordinates, real-time position sync,
 * drone focus/locate/follow, and map-click command menu (GOTO, ORBIT, RTH, MARK_HOME).
 */
import { useEffect, useRef, useCallback, useState, useImperativeHandle, forwardRef } from 'react';
import type { MapDrone } from '../MapPanel';

/** Public handle exposed via ref for parent components */
export interface BaiduMap3DPanelHandle {
  focusOnDrones: () => void;
}

const BAIDU_MAP_AK = import.meta.env.VITE_BAIDU_MAP_AK || 'nGb4GqLhx9IMrTkm3xlZKg6dv2J2pXnu';

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

/** Dynamically load Baidu Maps GL script */
function loadBMapGL(ak: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).BMapGL) {
      resolve();
      return;
    }
    // Set global callback
    const cbName = '__bmap_gl_init_' + Date.now();
    (window as any)[cbName] = () => {
      delete (window as any)[cbName];
      resolve();
    };
    const script = document.createElement('script');
    script.src = `https://api.map.baidu.com/api?type=webgl&v=1.0&ak=${ak}&callback=${cbName}`;
    script.onerror = () => reject(new Error('百度地图GL脚本加载失败'));
    document.head.appendChild(script);
  });
}

/** Create an SVG drone icon as a data-URI */
function createDroneSvgUri(color: string, heading: number = 0): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
    <g transform="rotate(${heading} 18 18)">
      <circle cx="18" cy="18" r="3" fill="${color}"/>
      <line x1="18" y1="18" x2="8" y2="8" stroke="${color}" stroke-width="1.5"/>
      <circle cx="8" cy="8" r="4" fill="none" stroke="${color}" stroke-width="1.5"/>
      <line x1="18" y1="18" x2="28" y2="8" stroke="${color}" stroke-width="1.5"/>
      <circle cx="28" cy="8" r="4" fill="none" stroke="${color}" stroke-width="1.5"/>
      <line x1="18" y1="18" x2="8" y2="28" stroke="${color}" stroke-width="1.5"/>
      <circle cx="8" cy="28" r="4" fill="none" stroke="${color}" stroke-width="1.5"/>
      <line x1="18" y1="18" x2="28" y2="28" stroke="${color}" stroke-width="1.5"/>
      <circle cx="28" cy="28" r="4" fill="none" stroke="${color}" stroke-width="1.5"/>
      <polygon points="18,4 15,11 21,11" fill="${color}"/>
    </g>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
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
  center = [105, 30],
  zoom = 6,
  pitch = 60,
}: BaiduMap3DPanelProps, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const droneMarkersRef = useRef<Map<string, any>>(new Map());
  const droneLabelMarkersRef = useRef<Map<string, any>>(new Map());
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const dronesRef = useRef(drones);
  dronesRef.current = drones;

  const popupOverlayRef = useRef<HTMLDivElement>(null);
  const popupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popupDroneIdRef = useRef<string | null>(null);

  const blinkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const blinkStateRef = useRef(true);

  const selectedDroneIdRef = useRef(selectedDroneId);
  const selectedDroneIdsRef = useRef(selectedDroneIds);
  const onDroneClickRef = useRef(onDroneClick);
  const onMapClickRef = useRef(onMapClick);
  const onMapClickCommandRef = useRef(onMapClickCommand);
  const hasDroneSelectedRef = useRef(hasDroneSelected);
  const onFollowExitRef = useRef(onFollowExit);
  useEffect(() => { selectedDroneIdRef.current = selectedDroneId; }, [selectedDroneId]);
  useEffect(() => { selectedDroneIdsRef.current = selectedDroneIds; }, [selectedDroneIds]);
  useEffect(() => { onDroneClickRef.current = onDroneClick; }, [onDroneClick]);
  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);
  useEffect(() => { onMapClickCommandRef.current = onMapClickCommand; }, [onMapClickCommand]);
  useEffect(() => { hasDroneSelectedRef.current = hasDroneSelected; }, [hasDroneSelected]);
  useEffect(() => { onFollowExitRef.current = onFollowExit; }, [onFollowExit]);

  // Selection blink animation
  useEffect(() => {
    if (blinkTimerRef.current) clearInterval(blinkTimerRef.current);
    const hasSelection = selectedDroneId != null || (selectedDroneIds && selectedDroneIds.size > 0);
    if (hasSelection) {
      blinkTimerRef.current = setInterval(() => {
        blinkStateRef.current = !blinkStateRef.current;
        droneMarkersRef.current.forEach((marker, id) => {
          const isSelected = selectedDroneIdsRef.current
            ? selectedDroneIdsRef.current.has(id)
            : id === selectedDroneIdRef.current;
          if (isSelected) {
            const icon = marker.getIcon();
            if (icon) {
              const size = blinkStateRef.current ? 36 : 24;
              icon.setImageSize(new (window as any).BMapGL.Size(size, size));
              icon.setAnchor(new (window as any).BMapGL.Size(size / 2, size / 2));
              marker.setIcon(icon);
            }
          }
        });
      }, 500);
    }
    return () => {
      if (blinkTimerRef.current) clearInterval(blinkTimerRef.current);
    };
  }, [selectedDroneId, selectedDroneIds]);

  const closePopup = useCallback(() => {
    const overlay = popupOverlayRef.current;
    if (overlay) {
      overlay.style.display = 'none';
      overlay.innerHTML = '';
    }
    if (popupTimerRef.current) {
      clearTimeout(popupTimerRef.current);
      popupTimerRef.current = null;
    }
    popupDroneIdRef.current = null;
  }, []);

  const showDronePopup = useCallback((drone: MapDrone, screenX: number, screenY: number) => {
    const overlay = popupOverlayRef.current;
    if (!overlay) return;
    closePopup();

    const statusColor = getDroneMarkerColor(drone, false);
    const statusText = getDroneStatusText(drone);
    const altitude = drone.altitude != null ? `${drone.altitude.toFixed(1)}m` : 'N/A';
    const battery = drone.battery != null ? `${drone.battery.toFixed(0)}%` : 'N/A';
    const lat = drone.lat != null ? drone.lat.toFixed(6) : 'N/A';
    const lng = drone.lng != null ? drone.lng.toFixed(6) : 'N/A';

    overlay.innerHTML = `<div style="
      background:rgba(10,15,31,0.95); backdrop-filter:blur(8px);
      border:1px solid ${statusColor}; border-radius:8px;
      padding:10px 14px; color:#c0d8ff; font-size:12px;
      font-family:'Microsoft YaHei',monospace; min-width:200px;
      box-shadow:0 0 12px rgba(82,168,255,0.3);
    ">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <span style="font-weight:bold;font-size:14px;color:#fff;">${drone.uavId}</span>
        <span style="padding:2px 8px;border-radius:4px;font-size:10px;
          background:${statusColor}33;color:${statusColor};border:1px solid ${statusColor}66;">
          ${statusText}
        </span>
      </div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:11px;">
        <span style="color:#52a8ff;">高度:</span><span>${altitude}</span>
        <span style="color:#52a8ff;">电量:</span><span>${battery}</span>
        <span style="color:#52a8ff;">纬度:</span><span>${lat}</span>
        <span style="color:#52a8ff;">经度:</span><span>${lng}</span>
        ${drone.owner ? `<span style="color:#52a8ff;">操控者:</span><span>${drone.owner}</span>` : ''}
        ${drone.teamName ? `<span style="color:#52a8ff;">队伍:</span><span>${drone.teamName}</span>` : ''}
        ${drone.model ? `<span style="color:#52a8ff;">型号:</span><span>${drone.model}</span>` : ''}
      </div>
    </div>`;

    const containerRect = containerRef.current?.getBoundingClientRect();
    if (containerRect) {
      const left = Math.min(screenX - containerRect.left + 10, containerRect.width - 220);
      const top = Math.min(screenY - containerRect.top - 10, containerRect.height - 200);
      overlay.style.left = `${Math.max(0, left)}px`;
      overlay.style.top = `${Math.max(0, top)}px`;
    }
    overlay.style.display = 'block';
    popupDroneIdRef.current = drone.uavId;

    if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
    popupTimerRef.current = setTimeout(closePopup, 5000);
  }, [closePopup]);

  const showMapClickMenu = useCallback((lat: number, lng: number, screenX: number, screenY: number) => {
    const overlay = popupOverlayRef.current;
    if (!overlay) return;
    closePopup();

    overlay.innerHTML = `<div style="
      background:rgba(10,15,31,0.95); backdrop-filter:blur(8px);
      border:1px solid #334155; border-radius:8px;
      padding:10px 14px; color:#c0d8ff; font-size:12px;
      font-family:'Microsoft YaHei',monospace; min-width:200px;
      box-shadow:0 0 12px rgba(82,168,255,0.3);
    ">
      <div style="background:#0f172a;border:1px solid #334155;border-radius:4px;padding:5px 8px;text-align:center;margin-bottom:8px;font-family:monospace;">
        <span style="font-weight:bold;font-size:12px;color:#38bdf8;">${lat.toFixed(6)}</span>
        <span style="color:#64748b;margin:0 3px;">,</span>
        <span style="font-weight:bold;font-size:12px;color:#38bdf8;">${lng.toFixed(6)}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;">
        <button data-cmd="GOTO" style="background:#0891b2;border:none;color:white;padding:5px 0;border-radius:4px;font-size:10px;font-weight:bold;cursor:pointer;">前往</button>
        <button data-cmd="ORBIT" style="background:#6366f1;border:none;color:white;padding:5px 0;border-radius:4px;font-size:10px;font-weight:bold;cursor:pointer;">盘旋</button>
        <button data-cmd="MARK_HOME" style="background:#0d9488;border:none;color:white;padding:5px 0;border-radius:4px;font-size:10px;font-weight:bold;cursor:pointer;">设为Home</button>
      </div>
    </div>`;

    overlay.querySelectorAll('button[data-cmd]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const cmd = (ev.currentTarget as HTMLElement).getAttribute('data-cmd');
        if (cmd) onMapClickCommandRef.current?.(cmd, lat, lng);
        closePopup();
      });
      (btn as HTMLElement).addEventListener('mouseenter', () => {
        (btn as HTMLElement).style.opacity = '0.8';
      });
      (btn as HTMLElement).addEventListener('mouseleave', () => {
        (btn as HTMLElement).style.opacity = '1';
      });
    });

    const containerRect = containerRef.current?.getBoundingClientRect();
    if (containerRect) {
      const left = Math.min(screenX - containerRect.left + 10, containerRect.width - 220);
      const top = Math.min(screenY - containerRect.top - 10, containerRect.height - 200);
      overlay.style.left = `${Math.max(0, left)}px`;
      overlay.style.top = `${Math.max(0, top)}px`;
    }
    overlay.style.display = 'block';
  }, [closePopup]);

  // Initialize Baidu Map GL
  useEffect(() => {
    let destroyed = false;

    async function init() {
      try {
        await loadBMapGL(BAIDU_MAP_AK);
      } catch (err: any) {
        setLoadError(err?.message || '百度地图加载失败');
        return;
      }
      if (destroyed || !containerRef.current) return;

      const BMapGL = (window as any).BMapGL;
      const map = new BMapGL.Map(containerRef.current, {
        enableRotate: true,
        enableTilt: true,
        enableKeyboard: true,
        enableScrollWheelZoom: true,
        enableContinuousZoom: true,
      });

      // Set initial view
      map.centerAndZoom(new BMapGL.Point(center[0], center[1]), zoom);
      map.setTilt(pitch);
      map.setHeading(0);

      // Switch to Earth/Satellite mode for real-scene 3D
      map.setMapType(window.BMAP_EARTH_MAP);

      // Enable 3D building rendering
      map.setDisplayOptions({
        indoor: true,
        poi: true,
        skyColors: ['rgba(5, 5, 30, 0.5)', 'rgba(5, 5, 50, 1.0)'],
      });

      // Map click handler
      map.addEventListener('click', (e: any) => {
        const point = e.latlng || e.point;
        if (!point) return;
        const lat = point.lat;
        const lng = point.lng;
        onMapClickRef.current?.(lat, lng);
        if (hasDroneSelectedRef.current) {
          // Get pixel position for popup
          const pixel = map.pointToPixel(point);
          const containerRect = containerRef.current?.getBoundingClientRect();
          if (containerRect) {
            showMapClickMenu(lat, lng, pixel.x + containerRect.left, pixel.y + containerRect.top);
          }
        }
      });

      // Exit follow mode on drag
      map.addEventListener('dragstart', () => {
        onFollowExitRef.current?.();
      });

      mapRef.current = map;
      setMapReady(true);
    }

    init();

    return () => {
      destroyed = true;
      if (blinkTimerRef.current) clearInterval(blinkTimerRef.current);
      if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
      // Remove all markers
      droneMarkersRef.current.forEach(marker => {
        mapRef.current?.removeOverlay(marker);
      });
      droneMarkersRef.current.clear();
      droneLabelMarkersRef.current.forEach(label => {
        mapRef.current?.removeOverlay(label);
      });
      droneLabelMarkersRef.current.clear();
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update drone markers
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const BMapGL = (window as any).BMapGL;
    const map = mapRef.current;
    const currentIds = new Set(drones.map(d => d.uavId));

    // Remove markers for drones that no longer exist
    droneMarkersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        map.removeOverlay(marker);
        droneMarkersRef.current.delete(id);
      }
    });
    droneLabelMarkersRef.current.forEach((label, id) => {
      if (!currentIds.has(id)) {
        map.removeOverlay(label);
        droneLabelMarkersRef.current.delete(id);
      }
    });

    for (const drone of drones) {
      if (drone.lat == null || drone.lng == null) continue;
      const isSelected = selectedDroneIds
        ? selectedDroneIds.has(drone.uavId)
        : drone.uavId === selectedDroneId;
      const color = getDroneMarkerColor(drone, isSelected);
      const point = new BMapGL.Point(drone.lng, drone.lat);
      const heading = drone.heading ?? 0;

      const existingMarker = droneMarkersRef.current.get(drone.uavId);
      if (existingMarker) {
        // Update position
        existingMarker.setPosition(point);
        // Update icon
        const iconSize = isSelected && !blinkStateRef.current ? 24 : 36;
        const icon = new BMapGL.Icon(
          createDroneSvgUri(color, heading),
          new BMapGL.Size(iconSize, iconSize),
          { anchor: new BMapGL.Size(iconSize / 2, iconSize / 2) }
        );
        existingMarker.setIcon(icon);
      } else {
        // Create new marker
        const icon = new BMapGL.Icon(
          createDroneSvgUri(color, heading),
          new BMapGL.Size(36, 36),
          { anchor: new BMapGL.Size(18, 18) }
        );
        const marker = new BMapGL.Marker(point, { icon, enableDragging: false });
        marker.addEventListener('click', (ev: any) => {
          onDroneClickRef.current?.(drone.uavId);
          // Show drone info popup
          const d = dronesRef.current.find(dd => dd.uavId === drone.uavId);
          if (d) {
            const pixel = map.pointToPixel(new BMapGL.Point(d.lng, d.lat));
            const containerRect = containerRef.current?.getBoundingClientRect();
            if (containerRect) {
              showDronePopup(d, pixel.x + containerRect.left, pixel.y + containerRect.top);
            }
          }
          if (ev.domEvent) ev.domEvent.stopPropagation();
        });
        map.addOverlay(marker);
        droneMarkersRef.current.set(drone.uavId, marker);
      }

      // Update or create label
      const statusText = getDroneStatusText(drone);
      const labelContent = `<div style="
        background:rgba(10,15,31,0.85);border:1px solid ${color};border-radius:4px;
        padding:2px 6px;color:${color};font-size:10px;white-space:nowrap;
        font-family:'Microsoft YaHei',monospace;pointer-events:none;
        text-shadow:0 0 4px ${color};
      ">${drone.uavId} ${statusText}${drone.altitude != null ? ' ' + drone.altitude.toFixed(0) + 'm' : ''}</div>`;

      const existingLabel = droneLabelMarkersRef.current.get(drone.uavId);
      if (existingLabel) {
        existingLabel.setPosition(point);
        existingLabel.setContent(labelContent);
      } else {
        const label = new BMapGL.Label(labelContent, {
          position: point,
          offset: new BMapGL.Size(20, -10),
        });
        label.setStyle({
          border: 'none',
          background: 'transparent',
          padding: '0',
        });
        map.addOverlay(label);
        droneLabelMarkersRef.current.set(drone.uavId, label);
      }
    }

    // Update drone info popup position if it's open
    if (popupDroneIdRef.current && popupOverlayRef.current?.style.display !== 'none') {
      const d = drones.find(dd => dd.uavId === popupDroneIdRef.current);
      if (d && d.lat != null && d.lng != null) {
        const pixel = map.pointToPixel(new BMapGL.Point(d.lng, d.lat));
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (containerRect) {
          const left = Math.min(pixel.x + 10, containerRect.width - 220);
          const top = Math.min(pixel.y - 10, containerRect.height - 200);
          popupOverlayRef.current!.style.left = `${Math.max(0, left)}px`;
          popupOverlayRef.current!.style.top = `${Math.max(0, top)}px`;
        }
      }
    }
  }, [drones, selectedDroneId, selectedDroneIds, mapReady, showDronePopup]);

  // Focus on all drones
  const focusOnDrones = useCallback(() => {
    if (!mapRef.current) return;
    const BMapGL = (window as any).BMapGL;
    const validDrones = drones.filter(d => d.lat != null && d.lng != null);
    if (validDrones.length === 0) return;

    if (validDrones.length === 1) {
      mapRef.current.flyTo(new BMapGL.Point(validDrones[0].lng, validDrones[0].lat), 16);
    } else {
      const points = validDrones.map(d => new BMapGL.Point(d.lng, d.lat));
      const viewport = mapRef.current.getViewport(points);
      mapRef.current.flyTo(viewport.center, viewport.zoom);
    }
  }, [drones]);

  useImperativeHandle(ref, () => ({ focusOnDrones: () => focusOnDrones() }), [focusOnDrones]);

  // Locate drone
  useEffect(() => {
    if (!locateDroneId || !mapRef.current || locateDroneCounter === 0) return;
    const BMapGL = (window as any).BMapGL;
    const drone = drones.find(d => d.uavId === locateDroneId);
    if (!drone || drone.lat == null || drone.lng == null) return;
    mapRef.current.flyTo(new BMapGL.Point(drone.lng, drone.lat), Math.max(mapRef.current.getZoom(), 16));
  }, [locateDroneCounter, locateDroneId, drones]);

  // Follow mode
  useEffect(() => {
    if (!followDroneId || !mapRef.current) return;
    const BMapGL = (window as any).BMapGL;
    const drone = drones.find(d => d.uavId === followDroneId);
    if (!drone || drone.lat == null || drone.lng == null) return;
    mapRef.current.panTo(new BMapGL.Point(drone.lng, drone.lat));
  }, [followDroneId, drones]);

  return (
    <div className={`relative w-full h-full ${className}`}>
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />

      {/* Popup overlay for drone info and map click menus */}
      <div ref={popupOverlayRef} style={{
        position: 'absolute', display: 'none', zIndex: 100,
        pointerEvents: 'auto', maxWidth: '300px',
      }} />

      {loadError && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 bg-red-900/90 backdrop-blur-sm rounded-lg px-4 py-2 text-white text-xs flex items-center gap-2 max-w-xs shadow-lg border border-red-700">
          <span className="font-semibold">地图加载失败:</span>
          <span>{loadError}</span>
        </div>
      )}

      {/* Focus button */}
      {mapReady && (
        <button
          className="absolute bottom-6 right-6 z-10 bg-slate-800/80 border border-slate-600 text-white rounded px-3 py-1.5 text-xs hover:bg-slate-700/80 transition-colors"
          onClick={focusOnDrones}
        >
          聚焦无人机
        </button>
      )}

      {/* Stats overlay */}
      <div className="absolute bottom-6 left-2 z-10 bg-slate-800/80 rounded px-2 py-1 text-xs text-slate-300">
        实景3D | 共 {drones.length} 架 | 在线 {drones.filter(d => d.onlineStatus === true).length} | 飞行中 {drones.filter(d => d.flightStatus === 'FLYING').length}
      </div>
    </div>
  );
});

export default BaiduMap3DPanel;
