/**
 * CesiumJS 3D Globe Map Panel - Phase 5
 * Optimized: no grid overlay, retina tiles, smooth camera, drone popups, QGC click menu
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import * as Cesium from 'cesium';
import type { MapDrone } from '../MapPanel';

const CESIUM_ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN || '';

export interface CesiumMapPanelProps {
  drones: MapDrone[];
  selectedDroneId?: string | null;
  selectedDroneIds?: Set<string>;
  onDroneClick?: (uavId: string) => void;
  onMapClick?: (lat: number, lon: number) => void;
  onMapClickCommand?: (command: string, lat: number, lng: number) => void;
  className?: string;
  center?: [number, number];
  zoom?: number;
  pitch?: number;
  disableAutoFocus?: boolean;
}

function getDroneColor(drone: MapDrone, isSelected: boolean): Cesium.Color {
  if (isSelected) return Cesium.Color.fromCssColorString('#f59e0b');
  if (!drone.onlineStatus) return Cesium.Color.fromCssColorString('#64748b');
  if (drone.armed) return Cesium.Color.fromCssColorString('#22c55e');
  return Cesium.Color.fromCssColorString('#3b82f6');
}

function getDroneStatusText(drone: MapDrone): string {
  if (!drone.onlineStatus) return '离线';
  if (drone.armed) return '已解锁';
  return '未解锁';
}

export default function CesiumMapPanel({
  drones, selectedDroneId, selectedDroneIds, onDroneClick, onMapClick,
  onMapClickCommand, className = '', center = [104.0, 35.0],
  zoom = 22000000, pitch = 90, disableAutoFocus = true,
}: CesiumMapPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const droneEntitiesRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const dronesRef = useRef(drones);
  dronesRef.current = drones;
  const popupOverlayRef = useRef<HTMLDivElement | null>(null);
  const openPopupDroneRef = useRef<string | null>(null);

  const onDroneClickRef = useRef(onDroneClick);
  const onMapClickRef = useRef(onMapClick);
  const onMapClickCommandRef = useRef(onMapClickCommand);
  const selectedDroneIdRef = useRef(selectedDroneId);
  const selectedDroneIdsRef = useRef(selectedDroneIds);
  useEffect(() => { onDroneClickRef.current = onDroneClick; }, [onDroneClick]);
  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);
  useEffect(() => { onMapClickCommandRef.current = onMapClickCommand; }, [onMapClickCommand]);
  useEffect(() => { selectedDroneIdRef.current = selectedDroneId; }, [selectedDroneId]);
  useEffect(() => { selectedDroneIdsRef.current = selectedDroneIds; }, [selectedDroneIds]);

  const closePopup = useCallback(() => {
    if (popupOverlayRef.current) popupOverlayRef.current.style.display = 'none';
    openPopupDroneRef.current = null;
  }, []);

  const showDronePopup = useCallback((drone: MapDrone) => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !popupOverlayRef.current) return;
    const overlay = popupOverlayRef.current;
    const isOnline = drone.onlineStatus === true;
    const isArmed = drone.armed === true;
    const statusColor = !isOnline ? '#64748b' : isArmed ? '#22c55e' : '#3b82f6';
    const statusText = getDroneStatusText(drone);
    overlay.innerHTML = '<div style="background:linear-gradient(135deg,rgba(10,20,50,0.95),rgba(30,60,140,0.9));padding:12px;border-radius:8px;min-width:200px;color:white;font-family:system-ui,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.3);border:1px solid rgba(82,168,255,0.4);">'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;border-bottom:1px solid rgba(82,168,255,0.3);padding-bottom:8px;">'
      + '<svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>'
      + '<h3 style="margin:0;font-size:14px;font-weight:bold;">' + drone.uavId + '</h3>'
      + '<span style="margin-left:auto;background:' + statusColor + ';padding:2px 8px;border-radius:4px;font-size:11px;">' + statusText + '</span></div>'
      + '<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:12px;">'
      + (drone.battery != null ? '<span style="opacity:0.8;">电量</span><span>' + drone.battery.toFixed(1) + '%</span>' : '')
      + '<span style="opacity:0.8;">高度</span><span>' + (drone.altitude != null ? drone.altitude.toFixed(2) + 'm' : 'N/A') + '</span>'
      + '<span style="opacity:0.8;">位置</span><span>' + (drone.lat?.toFixed(4) ?? 'N/A') + ', ' + (drone.lng?.toFixed(4) ?? 'N/A') + '</span>'
      + (drone.owner ? '<span style="opacity:0.8;">操作员</span><span>' + drone.owner + '</span>' : '')
      + (drone.teamName ? '<span style="opacity:0.8;">所属小队</span><span>' + drone.teamName + '</span>' : '')
      + (drone.teamLeader ? '<span style="opacity:0.8;">队长</span><span>' + drone.teamLeader + '</span>' : '')
      + '</div>'
      + '<div style="display:flex;justify-content:flex-end;margin-top:8px;padding-top:6px;border-top:1px solid rgba(82,168,255,0.2);">'
      + '<button data-action="close" style="background:rgba(82,168,255,0.2);border:1px solid rgba(82,168,255,0.4);color:#a0cfff;padding:3px 10px;border-radius:4px;font-size:11px;cursor:pointer;">关闭</button></div></div>';
    overlay.style.display = 'block';
    openPopupDroneRef.current = drone.uavId;
    const closeBtn = overlay.querySelector('[data-action="close"]');
    if (closeBtn) closeBtn.addEventListener('click', closePopup);
    const entity = droneEntitiesRef.current.get(drone.uavId);
    if (entity && entity.position) {
      const pos = entity.position.getValue(viewer.clock.currentTime);
      if (pos) {
        const screenPos = Cesium.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, pos);
        if (screenPos) {
          overlay.style.left = screenPos.x + 'px';
          overlay.style.top = (screenPos.y - 20) + 'px';
          overlay.style.transform = 'translate(-50%, -100%)';
        }
      }
    }
  }, [closePopup]);

  const showMapClickMenu = useCallback((lat: number, lng: number, screenX: number, screenY: number) => {
    if (!popupOverlayRef.current) return;
    const overlay = popupOverlayRef.current;
    overlay.innerHTML = '<div style="background:rgba(10,20,50,0.95);padding:10px;border-radius:8px;color:white;font-size:11px;min-width:180px;border:1px solid rgba(82,168,255,0.4);">'
      + '<div style="background:rgba(5,10,30,0.8);border:1px solid rgba(82,168,255,0.3);border-radius:4px;padding:5px 8px;text-align:center;margin-bottom:8px;font-family:monospace;">'
      + '<span style="font-weight:bold;font-size:12px;color:#52a8ff;">' + lat.toFixed(6) + '</span>'
      + '<span style="color:#64748b;margin:0 3px;">,</span>'
      + '<span style="font-weight:bold;font-size:12px;color:#52a8ff;">' + lng.toFixed(6) + '</span></div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;">'
      + '<button data-cmd="GOTO" style="background:#0891b2;border:none;color:white;padding:5px 0;border-radius:4px;font-size:10px;font-weight:bold;cursor:pointer;">前往</button>'
      + '<button data-cmd="ORBIT" style="background:#6366f1;border:none;color:white;padding:5px 0;border-radius:4px;font-size:10px;font-weight:bold;cursor:pointer;">盘旋</button>'
      + '<button data-cmd="MARK_HOME" style="background:#0d9488;border:none;color:white;padding:5px 0;border-radius:4px;font-size:10px;font-weight:bold;cursor:pointer;">设为Home</button></div></div>';
    overlay.style.display = 'block';
    overlay.style.left = screenX + 'px';
    overlay.style.top = screenY + 'px';
    overlay.style.transform = 'translate(-50%, -100%)';
    openPopupDroneRef.current = '__map_click__';
    overlay.querySelectorAll('button[data-cmd]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const cmd = (ev.currentTarget as HTMLElement).getAttribute('data-cmd');
        if (cmd) onMapClickCommandRef.current?.(cmd, lat, lng);
        closePopup();
      });
    });
  }, [closePopup]);

  // Initialize Cesium Viewer
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    // Set Ion token
    if (CESIUM_ION_TOKEN) {
      Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;
    }

    try {
      // Gaode vector tile - scale=2 for retina/higher resolution tiles
      const gaodeProvider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=2&style=8&x={x}&y={y}&z={z}',
        subdomains: ['1', '2', '3', '4'],
        minimumLevel: 1,
        maximumLevel: 18,
      });

      const viewer = new Cesium.Viewer(containerRef.current, {
        terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        baseLayerPicker: false, geocoder: false, homeButton: false,
        sceneModePicker: false, selectionIndicator: false, timeline: false,
        animation: false, fullscreenButton: false, vrButton: false,
        navigationHelpButton: false, infoBox: false,
        creditContainer: document.createElement('div'),
        msaaSamples: 4,
        requestRenderMode: false,
        maximumRenderTimeChange: Infinity,
        targetFrameRate: 60,
      });

      viewerRef.current = viewer;

      // Remove ALL default imagery, add only Gaode - NO grid overlay (per feedback: dims the map)
      viewer.imageryLayers.removeAll();
      viewer.imageryLayers.addImageryProvider(gaodeProvider);

      // Atmosphere
      if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
      viewer.scene.fog.enabled = false;
      viewer.scene.globe.showGroundAtmosphere = true;

      // Dark space background
      viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#050a1e');
      if (viewer.scene.skyBox) viewer.scene.skyBox.show = true;
      if (viewer.scene.sun) viewer.scene.sun.show = true;
      if (viewer.scene.moon) viewer.scene.moon.show = false;

      viewer.scene.globe.enableLighting = true;
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#050a1e');

      // Performance: optimize tile loading for clearer tiles
      viewer.scene.globe.maximumScreenSpaceError = 1.5;
      viewer.scene.globe.tileCacheSize = 1000;
      viewer.scene.globe.preloadSiblings = true;
      viewer.scene.globe.preloadAncestors = true;

      // Fly to initial view - top-down globe view centered on China
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(center[0], center[1], zoom),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-pitch),
          roll: 0,
        },
        duration: 2.5,
      });

      // Click handler with drone popup and QGC menu
      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((click: { position: Cesium.Cartesian2 }) => {
        const picked = viewer.scene.pick(click.position);
        if (Cesium.defined(picked) && picked.id && picked.id.properties) {
          const uavId = picked.id.properties.uavId?.getValue();
          if (uavId) {
            onDroneClickRef.current?.(uavId);
            const drone = dronesRef.current.find(d => d.uavId === uavId);
            if (drone) showDronePopup(drone);
            return;
          }
        }
        const cartesian = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
        if (cartesian) {
          const carto = Cesium.Cartographic.fromCartesian(cartesian);
          const lat = Cesium.Math.toDegrees(carto.latitude);
          const lon = Cesium.Math.toDegrees(carto.longitude);
          onMapClickRef.current?.(lat, lon);
          const hasSelected = selectedDroneIdRef.current || (selectedDroneIdsRef.current && selectedDroneIdsRef.current.size > 0);
          if (hasSelected) {
            const screenPos = Cesium.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, cartesian);
            if (screenPos) showMapClickMenu(lat, lon, screenPos.x, screenPos.y);
          } else { closePopup(); }
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      // Update popup position on camera move
      viewer.scene.preRender.addEventListener(() => {
        if (!openPopupDroneRef.current || openPopupDroneRef.current === '__map_click__') return;
        const overlay = popupOverlayRef.current;
        if (!overlay || overlay.style.display === 'none') return;
        const entity = droneEntitiesRef.current.get(openPopupDroneRef.current);
        if (!entity || !entity.position) return;
        const pos = entity.position.getValue(viewer.clock.currentTime);
        if (!pos) return;
        const screenPos = Cesium.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, pos);
        if (screenPos) {
          overlay.style.left = screenPos.x + 'px';
          overlay.style.top = (screenPos.y - 20) + 'px';
        }
      });

      if (!destroyed) {
        setMapReady(true);
      }
    } catch (err) {
      if (!destroyed) {
        console.error('Cesium init error:', err);
        setLoadError((err as Error).message || 'CesiumJS 加载失败');
      }
    }

    return () => {
      destroyed = true;
      droneEntitiesRef.current.clear();
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update drone entities
  const updateDroneEntities = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const currentIds = new Set(drones.map(d => d.uavId));

    // Remove entities for drones that no longer exist
    droneEntitiesRef.current.forEach((entity, id) => {
      if (!currentIds.has(id)) {
        viewer.entities.remove(entity);
        droneEntitiesRef.current.delete(id);
      }
    });

    // Add or update drone entities
    drones.forEach(drone => {
      if (drone.lat == null || drone.lng == null) return;

      const isSelected = selectedDroneIds
        ? selectedDroneIds.has(drone.uavId)
        : drone.uavId === selectedDroneId;
      const color = getDroneColor(drone, isSelected);
      const altitude = (drone.altitude ?? 0) + 50; // Minimum altitude for visibility

      const position = Cesium.Cartesian3.fromDegrees(drone.lng, drone.lat, altitude);

      const existing = droneEntitiesRef.current.get(drone.uavId);
      if (existing) {
        // Update existing entity
        existing.position = new Cesium.ConstantPositionProperty(position);

        // Update point
        if (existing.point) {
          existing.point.color = new Cesium.ConstantProperty(color);
          existing.point.pixelSize = new Cesium.ConstantProperty(isSelected ? 14 : 10);
          existing.point.outlineColor = new Cesium.ConstantProperty(
            isSelected ? Cesium.Color.WHITE : color.withAlpha(0.5)
          );
          existing.point.outlineWidth = new Cesium.ConstantProperty(isSelected ? 3 : 2);
        }

        // Update label
        if (existing.label) {
          const battery = drone.battery != null ? `${drone.battery.toFixed(0)}%` : 'N/A';
          existing.label.text = new Cesium.ConstantProperty(
            `${drone.uavId}\n${altitude.toFixed(1)}m | ${battery}`
          );
          existing.label.fillColor = new Cesium.ConstantProperty(color);
        }

        // Update polyline (vertical line to ground)
        if (existing.polyline) {
          existing.polyline.positions = new Cesium.ConstantProperty([
            Cesium.Cartesian3.fromDegrees(drone.lng, drone.lat, 0),
            position,
          ]);
          existing.polyline.material = new Cesium.ColorMaterialProperty(color.withAlpha(0.3));
        }

        // Update ellipse (ground shadow)
        if (existing.ellipse) {
          existing.ellipse.material = new Cesium.ColorMaterialProperty(color.withAlpha(0.15));
          existing.ellipse.outlineColor = new Cesium.ConstantProperty(color.withAlpha(0.4));
        }
      } else {
        // Create new drone entity
        const battery = drone.battery != null ? `${drone.battery.toFixed(0)}%` : 'N/A';

        const entity = viewer.entities.add({
          position,
          properties: {
            uavId: drone.uavId,
          },
          // Drone point marker
          point: {
            pixelSize: isSelected ? 14 : 10,
            color,
            outlineColor: isSelected ? Cesium.Color.WHITE : color.withAlpha(0.5),
            outlineWidth: isSelected ? 3 : 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: Cesium.HeightReference.NONE,
          },
          // Label
          label: {
            text: `${drone.uavId}\n${altitude.toFixed(1)}m | ${battery}`,
            font: '11px monospace',
            fillColor: color,
            outlineColor: Cesium.Color.fromCssColorString('rgba(10, 15, 31, 0.9)'),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -18),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString('rgba(10, 15, 31, 0.85)'),
            backgroundPadding: new Cesium.Cartesian2(6, 4),
          },
          // Vertical line from drone to ground
          polyline: {
            positions: [
              Cesium.Cartesian3.fromDegrees(drone.lng, drone.lat, 0),
              position,
            ],
            width: 1,
            material: new Cesium.ColorMaterialProperty(color.withAlpha(0.3)),
          },
          // Ground shadow ellipse
          ellipse: {
            semiMajorAxis: 30,
            semiMinorAxis: 30,
            height: 0,
            material: new Cesium.ColorMaterialProperty(color.withAlpha(0.15)),
            outline: true,
            outlineColor: color.withAlpha(0.4),
            outlineWidth: 1,
          },
        });

        droneEntitiesRef.current.set(drone.uavId, entity);
      }
    });
  }, [drones, selectedDroneId, selectedDroneIds, showDronePopup]);

  useEffect(() => { if (mapReady) updateDroneEntities(); }, [drones, selectedDroneId, selectedDroneIds, mapReady, updateDroneEntities]);

  // Focus on drones - only triggered externally or when disableAutoFocus=false
  const focusOnDrones = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || drones.length === 0) return;
    const valid = drones.filter(d => d.lat != null && d.lng != null);
    if (valid.length === 0) return;
    if (valid.length === 1) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(valid[0].lng, valid[0].lat, 5000),
        orientation: { heading: Cesium.Math.toRadians(0), pitch: Cesium.Math.toRadians(-45), roll: 0 },
        duration: 1.5,
      });
    } else {
      const rect = Cesium.Rectangle.fromCartographicArray(valid.map(d => Cesium.Cartographic.fromDegrees(d.lng, d.lat)));
      viewer.camera.flyTo({ destination: rect, duration: 1.5 });
    }
  }, [drones]);

  // Only auto-focus when explicitly enabled (disableAutoFocus=false)
  useEffect(() => {
    if (!disableAutoFocus && mapReady && drones.length > 0) {
      const timer = setTimeout(focusOnDrones, 1000);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, drones.length > 0, disableAutoFocus]);

  // Expose focusOnDrones on container element for external use
  useEffect(() => {
    const el = containerRef.current;
    if (el) (el as unknown as Record<string, unknown>).__focusOnDrones = focusOnDrones;
  }, [focusOnDrones]);

  if (loadError) {
    return (
      <div className={`relative w-full h-full flex items-center justify-center bg-[#0a0f1a] ${className}`}>
        <div className="text-center p-6">
          <div className="text-red-400 text-lg mb-2">Cesium 加载失败</div>
          <div className="text-slate-400 text-sm">{loadError}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative w-full h-full ${className}`}>
      <div ref={containerRef} className="w-full h-full" style={{ background: '#0a0f1a' }} />
      <div ref={popupOverlayRef} style={{ position: 'absolute', display: 'none', zIndex: 100, pointerEvents: 'auto', maxWidth: '300px' }} />
      {!mapReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0f1a]">
          <div className="animate-pulse text-sm" style={{ color: '#52a8ff' }}>正在初始化 Cesium 3D 地球...</div>
        </div>
      )}
    </div>
  );
}
