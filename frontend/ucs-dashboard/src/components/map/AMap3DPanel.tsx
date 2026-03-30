/**
 * AMap 3D Map Panel - Phase 7 Enhanced
 * 
 * Uses AMap JS API v2 with viewMode:'3D' for full 3D map rendering.
 * Drones are rendered as 3D cone models via AMap.GLCustomLayer + Three.js,
 * with accurate altitude representation.
 * 
 * Phase 7 enhancements:
 * - Issue 1: Drone focus/zoom with smooth animation
 * - Issue 2: Real-time position sync, selection blink animation, reduced model size
 * - Issue 3: Map click popup with lat/lng/alt + control buttons (GOTO, ORBIT, RTH, MARK_HOME)
 * - Issue 4: Drone click info popup with auto-close after 5 seconds
 * - Issue 5: Altitude information display in all popups and labels
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import AMapLoader from '@amap/amap-jsapi-loader';
import * as THREE from 'three';
import type { MapDrone } from '../MapPanel';

// AMap credentials from environment variables
const AMAP_KEY = import.meta.env.VITE_AMAP_KEY || '';
const AMAP_SECRET = import.meta.env.VITE_AMAP_SECRET || '';

// Security config MUST be set at module level, BEFORE AMapLoader.load() is called.
(window as Record<string, unknown>)._AMapSecurityConfig = {
  securityJsCode: AMAP_SECRET,
};

interface AMap3DPanelProps {
  drones: MapDrone[];
  selectedDroneId?: string | null;
  selectedDroneIds?: Set<string>;
  onDroneClick?: (uavId: string) => void;
  onMapClick?: (lat: number, lon: number) => void;
  /** Map click command callback for control buttons (GOTO, ORBIT, RTH, MARK_HOME) */
  onMapClickCommand?: (command: string, lat: number, lng: number) => void;
  /** Whether a drone is currently selected (controls map click menu visibility) */
  hasDroneSelected?: boolean;
  className?: string;
  /** Center coordinates [lng, lat] */
  center?: [number, number];
  /** Initial zoom level */
  zoom?: number;
  /** Initial pitch angle */
  pitch?: number;
}

// Drone 3D model colors based on state
function getDroneColor(drone: MapDrone, isSelected: boolean): number {
  if (isSelected) return 0xf59e0b; // amber for selected
  if (!drone.onlineStatus) return 0x64748b; // gray for offline
  if (drone.armed) return 0x22c55e; // green for armed/flying
  return 0x3b82f6; // blue for online/disarmed
}

function getDroneStatusText(drone: MapDrone): string {
  if (!drone.onlineStatus) return '离线';
  if (drone.armed) return '飞行中';
  return '在线';
}

// Scale altitude for visual representation (meters to scene units)
// AMap customCoords uses a specific scale factor
const ALTITUDE_SCALE = 1.0;

export default function AMap3DPanel({
  drones,
  selectedDroneId,
  selectedDroneIds,
  onDroneClick,
  onMapClick,
  onMapClickCommand,
  hasDroneSelected = false,
  className = '',
  center = [105, 30],
  zoom = 4,
  pitch = 50,
}: AMap3DPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const AMapRef = useRef<any>(null);
  const glLayerRef = useRef<any>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const customCoordsRef = useRef<any>(null);
  const droneModelsRef = useRef<Map<string, THREE.Group>>(new Map());
  const labelMarkersRef = useRef<Map<string, any>>(new Map());
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const dronesRef = useRef(drones);
  dronesRef.current = drones;

  // Popup overlay refs
  const popupOverlayRef = useRef<HTMLDivElement>(null);
  const popupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Selection blink animation ref
  const blinkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const blinkStateRef = useRef(true);

  const selectedDroneIdRef = useRef(selectedDroneId);
  const selectedDroneIdsRef = useRef(selectedDroneIds);
  const onDroneClickRef = useRef(onDroneClick);
  const onMapClickRef = useRef(onMapClick);
  const onMapClickCommandRef = useRef(onMapClickCommand);
  const hasDroneSelectedRef = useRef(hasDroneSelected);
  useEffect(() => { selectedDroneIdRef.current = selectedDroneId; }, [selectedDroneId]);
  useEffect(() => { selectedDroneIdsRef.current = selectedDroneIds; }, [selectedDroneIds]);
  useEffect(() => { onDroneClickRef.current = onDroneClick; }, [onDroneClick]);
  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);
  useEffect(() => { onMapClickCommandRef.current = onMapClickCommand; }, [onMapClickCommand]);
  useEffect(() => { hasDroneSelectedRef.current = hasDroneSelected; }, [hasDroneSelected]);

  // Issue 2: Selection blink animation - toggle visibility every 500ms for selected drones
  useEffect(() => {
    if (blinkTimerRef.current) clearInterval(blinkTimerRef.current);
    const hasSelection = selectedDroneId != null || (selectedDroneIds && selectedDroneIds.size > 0);
    if (hasSelection) {
      blinkTimerRef.current = setInterval(() => {
        blinkStateRef.current = !blinkStateRef.current;
        droneModelsRef.current.forEach((model, id) => {
          const isSelected = selectedDroneIdsRef.current
            ? selectedDroneIdsRef.current.has(id)
            : id === selectedDroneIdRef.current;
          if (isSelected) {
            const scale = blinkStateRef.current ? 0.35 : 0.25;
            model.scale.set(scale, scale, scale);
            model.traverse((child) => {
              if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshPhongMaterial) {
                if (child.material.emissiveIntensity > 0) {
                  child.material.emissiveIntensity = blinkStateRef.current ? 0.6 : 0.2;
                }
              }
            });
          }
        });
        mapRef.current?.render();
      }, 500);
    }
    return () => {
      if (blinkTimerRef.current) clearInterval(blinkTimerRef.current);
    };
  }, [selectedDroneId, selectedDroneIds]);

  // Close popup helper
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
  }, []);

  // Issue 4: Show drone info popup when clicking on drone
  const showDronePopup = useCallback((drone: MapDrone, screenX: number, screenY: number) => {
    const overlay = popupOverlayRef.current;
    if (!overlay) return;
    closePopup();

    const statusColor = !drone.onlineStatus ? '#64748b' : drone.armed ? '#22c55e' : '#3b82f6';
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

    // Auto-close after 5 seconds
    popupTimerRef.current = setTimeout(closePopup, 5000);
    overlay.onmouseenter = () => {
      if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
    };
    overlay.onmouseleave = () => {
      popupTimerRef.current = setTimeout(closePopup, 2000);
    };
  }, [closePopup]);

  // Issue 3: Show map click menu with lat/lng/alt and control buttons
  const showMapClickMenu = useCallback((lat: number, lng: number, screenX: number, screenY: number) => {
    const overlay = popupOverlayRef.current;
    if (!overlay) return;
    closePopup();

    const buttons = [
      { label: '前往', cmd: 'GOTO', color: '#52a8ff' },
      { label: '盘旋', cmd: 'ORBIT', color: '#a855f7' },
      { label: '返航', cmd: 'RTH', color: '#f59e0b' },
      { label: '标记Home', cmd: 'MARK_HOME', color: '#22c55e' },
    ];

    overlay.innerHTML = `<div style="
      background:rgba(10,15,31,0.95); backdrop-filter:blur(8px);
      border:1px solid rgba(82,168,255,0.5); border-radius:8px;
      padding:10px 14px; color:#c0d8ff; font-size:12px;
      font-family:'Microsoft YaHei',monospace; min-width:180px;
      box-shadow:0 0 12px rgba(82,168,255,0.3);
    ">
      <div style="margin-bottom:8px;font-size:11px;color:#a0cfff;">
        <div>纬度: ${lat.toFixed(6)}</div>
        <div>经度: ${lng.toFixed(6)}</div>
        <div>海拔: 地面</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
        ${buttons.map(b => `<button data-cmd="${b.cmd}" style="
          padding:6px 4px;border-radius:4px;font-size:11px;cursor:pointer;
          background:${b.color}22;border:1px solid ${b.color}66;color:${b.color};
          transition:all 0.15s;font-family:inherit;
        " onmouseover="this.style.background='${b.color}44'" onmouseout="this.style.background='${b.color}22'">
          ${b.label}
        </button>`).join('')}
      </div>
    </div>`;

    const containerRect = containerRef.current?.getBoundingClientRect();
    if (containerRect) {
      const left = Math.min(screenX - containerRect.left + 10, containerRect.width - 200);
      const top = Math.min(screenY - containerRect.top - 10, containerRect.height - 180);
      overlay.style.left = `${Math.max(0, left)}px`;
      overlay.style.top = `${Math.max(0, top)}px`;
    }
    overlay.style.display = 'block';

    overlay.querySelectorAll('button[data-cmd]').forEach(btn => {
      (btn as HTMLButtonElement).addEventListener('click', () => {
        const cmd = btn.getAttribute('data-cmd');
        if (cmd) {
          onMapClickCommandRef.current?.(cmd, lat, lng);
        }
        closePopup();
      });
    });

    popupTimerRef.current = setTimeout(closePopup, 8000);
  }, [closePopup]);

  // Create a simple 3D drone model (cone body + rotor arms)
  const createDroneModel = useCallback((color: number): THREE.Group => {
    const group = new THREE.Group();

    // Body - cone pointing upward
    const bodyGeom = new THREE.ConeGeometry(6, 16, 6);
    const bodyMat = new THREE.MeshPhongMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.9,
    });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.rotation.x = Math.PI;
    body.position.y = 8;
    group.add(body);

    // Rotor arms - 4 thin cylinders in X pattern
    const armGeom = new THREE.CylinderGeometry(0.8, 0.8, 18, 6);
    const armMat = new THREE.MeshPhongMaterial({ color: 0xcccccc });
    
    const arm1 = new THREE.Mesh(armGeom, armMat);
    arm1.rotation.z = Math.PI / 2;
    arm1.position.y = 14;
    group.add(arm1);

    const arm2 = new THREE.Mesh(armGeom, armMat);
    arm2.rotation.z = Math.PI / 2;
    arm2.rotation.y = Math.PI / 2;
    arm2.position.y = 14;
    group.add(arm2);

    // Rotors - 4 small discs at arm tips
    const rotorGeom = new THREE.CircleGeometry(4, 12);
    const rotorMat = new THREE.MeshPhongMaterial({
      color: 0x88ccff,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    });

    const rotorPositions = [
      [9, 15, 0],
      [-9, 15, 0],
      [0, 15, 9],
      [0, 15, -9],
    ];
    rotorPositions.forEach(([x, y, z]) => {
      const rotor = new THREE.Mesh(rotorGeom, rotorMat);
      rotor.rotation.x = -Math.PI / 2;
      rotor.position.set(x, y, z);
      group.add(rotor);
    });

    // Issue 2: Reduced model size (was 0.5, now 0.3)
    group.scale.set(0.3, 0.3, 0.3);

    return group;
  }, []);

  // Initialize AMap
  useEffect(() => {
    if (!containerRef.current) return;

    let destroyed = false;

    // Wait for container to have non-zero dimensions before initializing.
    // During React Suspense transitions, the container may momentarily have 0 size.
    // AMap won't auto-repaint if initialized in a 0-size container.
    const waitForContainer = (): Promise<HTMLDivElement> => {
      return new Promise((resolve, reject) => {
        const el = containerRef.current;
        if (!el) { reject(new Error('Container not found')); return; }
        if (el.offsetWidth > 0 && el.offsetHeight > 0) { resolve(el); return; }
        let attempts = 0;
        const maxAttempts = 50; // 50 * 50ms = 2.5s max wait
        const timer = setInterval(() => {
          if (destroyed) { clearInterval(timer); reject(new Error('Destroyed')); return; }
          attempts++;
          if (el.offsetWidth > 0 && el.offsetHeight > 0) {
            clearInterval(timer);
            resolve(el);
          } else if (attempts >= maxAttempts) {
            clearInterval(timer);
            // Fallback: proceed anyway, map may need a resize later
            console.warn('AMap3DPanel: container still has 0 size after wait, proceeding anyway');
            resolve(el);
          }
        }, 50);
      });
    };

    waitForContainer().then((containerEl) => {
      if (destroyed) return;
      return AMapLoader.load({
        key: AMAP_KEY,
        version: '2.0',
        plugins: ['AMap.ControlBar', 'AMap.ToolBar', 'AMap.Scale'],
      }).then((AMap: any) => {
        if (destroyed) return;
        AMapRef.current = AMap;

        const map = new AMap.Map(containerEl, {
        viewMode: '3D',
        pitch,
        zoom,
        center,
        rotation: 0,
        rotateEnable: true,
        pitchEnable: true,
        zooms: [2, 20],
        // mapStyle: 'amap://styles/dark', // Disabled: may fail without Key permission for custom styles
        terrain: true,
      });
      mapRef.current = map;

      // Add control plugins
      AMap.plugin(['AMap.ControlBar', 'AMap.ToolBar', 'AMap.Scale'], () => {
        map.addControl(new AMap.ControlBar({
          position: { right: '10px', top: '10px' },
        }));
        map.addControl(new AMap.ToolBar({
          position: { right: '40px', top: '110px' },
        }));
        map.addControl(new AMap.Scale());
      });

      // Issue 3: Map click handler - show popup with lat/lng/alt and control buttons
      map.on('click', (e: any) => {
        const lat = e.lnglat.getLat();
        const lng = e.lnglat.getLng();
        onMapClickRef.current?.(lat, lng);
        if (hasDroneSelectedRef.current) {
          const pixel = e.pixel;
          const containerRect = containerRef.current?.getBoundingClientRect();
          if (pixel && containerRect) {
            showMapClickMenu(lat, lng, pixel.x + containerRect.left, pixel.y + containerRect.top);
          }
        }
      });

      // Initialize Three.js GL custom layer for 3D drones
      const customCoords = map.customCoords;
      customCoordsRef.current = customCoords;
      customCoords.setCenter(center);

      const glLayer = new AMap.GLCustomLayer({
        zIndex: 120,
        init: (gl: WebGLRenderingContext | WebGL2RenderingContext) => {
          const camera = new THREE.PerspectiveCamera(
            60,
            containerRef.current!.offsetWidth / containerRef.current!.offsetHeight,
            1,
            1 << 30,
          );
          cameraRef.current = camera;

          // THREE.js r163+ requires WebGL 2. AMap's GLCustomLayer may pass a WebGL 1
          // context, causing "WebGL 1 is not supported since r163" error.
          // Fix: If the context is WebGL 1, obtain a WebGL 2 context from the same canvas.
          let glContext: WebGL2RenderingContext | WebGLRenderingContext = gl;
          if (gl && gl.canvas && !(gl instanceof WebGL2RenderingContext)) {
            const gl2 = (gl.canvas as HTMLCanvasElement).getContext('webgl2', {
              antialias: true,
              alpha: true,
              premultipliedAlpha: true,
              preserveDrawingBuffer: true,
            });
            if (gl2) {
              glContext = gl2;
              console.info('[AMap3D] Upgraded WebGL 1 context to WebGL 2 for THREE.js r163+ compatibility');
            } else {
              console.warn('[AMap3D] Browser does not support WebGL 2. THREE.js r163+ rendering may fail.');
            }
          }

          const renderer = new THREE.WebGLRenderer({
            context: glContext as WebGL2RenderingContext,
            antialias: true,
          });
          renderer.autoClear = false;
          renderer.setPixelRatio(window.devicePixelRatio);
          rendererRef.current = renderer;

          const scene = new THREE.Scene();
          sceneRef.current = scene;

          // Ambient light
          const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
          scene.add(ambientLight);

          // Directional light (sun-like)
          const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
          dirLight.position.set(1, 1, 1);
          scene.add(dirLight);

          // Add initial drone models
          updateDroneModels();
        },
        render: () => {
          if (!rendererRef.current || !sceneRef.current || !cameraRef.current || !customCoordsRef.current) return;

          rendererRef.current.resetState();
          customCoordsRef.current.setCenter(center);

          const cameraParams = customCoordsRef.current.getCameraParams();
          const camera = cameraRef.current;

          camera.near = cameraParams.near;
          camera.far = cameraParams.far;
          camera.fov = cameraParams.fov;
          camera.position.set(...(cameraParams.position as [number, number, number]));
          camera.up.set(...(cameraParams.up as [number, number, number]));
          camera.lookAt(...(cameraParams.lookAt as [number, number, number]));
          camera.updateProjectionMatrix();

          rendererRef.current.render(sceneRef.current, camera);
        },
      });
      glLayerRef.current = glLayer;
      map.add(glLayer);

      setMapReady(true);
      });
    }).catch((err: Error) => {
      if (!destroyed) {
        console.error('AMap load error:', err);
        setLoadError(err.message || '高德地图加载失败');
      }
    });

    return () => {
      destroyed = true;
      labelMarkersRef.current.forEach(m => m.remove?.());
      labelMarkersRef.current.clear();
      droneModelsRef.current.clear();
      if (blinkTimerRef.current) clearInterval(blinkTimerRef.current);
      if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update 3D drone models when drones change
  const updateDroneModels = useCallback(() => {
    if (!sceneRef.current || !customCoordsRef.current) return;

    const scene = sceneRef.current;
    const currentIds = new Set(drones.map(d => d.uavId));

    // Remove models for drones that no longer exist
    droneModelsRef.current.forEach((model, id) => {
      if (!currentIds.has(id)) {
        scene.remove(model);
        // Dispose geometry and materials
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (child.material instanceof THREE.Material) {
              child.material.dispose();
            }
          }
        });
        droneModelsRef.current.delete(id);
      }
    });

    // Remove label markers for removed drones
    labelMarkersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove?.();
        labelMarkersRef.current.delete(id);
      }
    });

    // Add or update drone models
    drones.forEach(drone => {
      if (drone.lat == null || drone.lng == null) return;

      const isSelected = selectedDroneIds
        ? selectedDroneIds.has(drone.uavId)
        : drone.uavId === selectedDroneId;
      const color = getDroneColor(drone, isSelected);
      const altitude = (drone.altitude ?? 0) * ALTITUDE_SCALE;

      // Convert lng/lat/alt to scene coordinates
      const data = customCoordsRef.current.lngLatsToCoords([
        [drone.lng, drone.lat, altitude],
      ]);

      const existing = droneModelsRef.current.get(drone.uavId);
      if (existing) {
        // Update position
        if (data && data[0]) {
          existing.position.set(data[0][0], data[0][1], data[0][2] || 0);
        }

        // Update rotation (heading)
        const heading = drone.heading ?? 0;
        existing.rotation.y = -heading * (Math.PI / 180);

        // Update color
        existing.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshPhongMaterial) {
            if (child.material.emissiveIntensity > 0) {
              child.material.color.setHex(color);
              child.material.emissive.setHex(color);
            }
          }
        });

        // Update scale - normal size (blink animation handles selected scale separately)
        if (!isSelected) {
          existing.scale.set(0.3, 0.3, 0.3);
        }
      } else {
        // Create new model
        const model = createDroneModel(color);
        if (data && data[0]) {
          model.position.set(data[0][0], data[0][1], data[0][2] || 0);
        }
        const heading = drone.heading ?? 0;
        model.rotation.y = -heading * (Math.PI / 180);
        model.userData = { uavId: drone.uavId };
        scene.add(model);
        droneModelsRef.current.set(drone.uavId, model);
      }

      // Update label markers (HTML overlay via AMap Marker)
      updateLabelMarker(drone, isSelected);
    });

    // Trigger map re-render to show changes
    mapRef.current?.render();
  }, [drones, selectedDroneId, selectedDroneIds, createDroneModel]);

  // Update HTML label markers for drones on AMap
  const updateLabelMarker = useCallback((drone: MapDrone, isSelected: boolean) => {
    if (!mapRef.current || !AMapRef.current) return;
    const AMap = AMapRef.current;

    const existing = labelMarkersRef.current.get(drone.uavId);
    const isOnline = drone.onlineStatus === true;
    const isArmed = drone.armed === true;
    const statusColor = !isOnline ? '#64748b' : isArmed ? '#22c55e' : '#3b82f6';
    const borderColor = isSelected ? '#f59e0b' : statusColor;
    const altitude = drone.altitude ?? 0;
    const battery = drone.battery != null ? `${drone.battery.toFixed(0)}%` : 'N/A';

    const content = `<div style="
      background: rgba(10,15,31,0.85);
      backdrop-filter: blur(4px);
      border: 1px solid ${borderColor};
      border-radius: 6px;
      padding: 3px 6px;
      color: white;
      font-size: 10px;
      font-family: monospace;
      text-align: center;
      white-space: nowrap;
      pointer-events: auto;
      cursor: pointer;
      ${isSelected ? 'box-shadow: 0 0 8px ' + borderColor + ';' : ''}
    ">
      <div style="font-weight:bold;color:${borderColor}">${drone.uavId}</div>
      <div style="color:#94a3b8;font-size:9px">${altitude.toFixed(1)}m | ${battery}</div>
    </div>`;

    if (existing) {
      existing.setPosition(new AMap.LngLat(drone.lng, drone.lat));
      existing.setContent(content);
    } else {
      const marker = new AMap.Marker({
        position: new AMap.LngLat(drone.lng, drone.lat),
        content,
        offset: new AMap.Pixel(-30, -50),
        zIndex: 200,
        anchor: 'bottom-center',
      });
      // Issue 4: Click on label marker to show drone info popup
      marker.on('click', (e: any) => {
        onDroneClickRef.current?.(drone.uavId);
        const d = dronesRef.current.find(dr => dr.uavId === drone.uavId);
        if (d) {
          const pixel = e.pixel || e.originEvent;
          const x = pixel?.clientX ?? pixel?.x ?? 300;
          const y = pixel?.clientY ?? pixel?.y ?? 300;
          showDronePopup(d, x, y);
        }
      });
      mapRef.current.add(marker);
      labelMarkersRef.current.set(drone.uavId, marker);
    }
  }, [showDronePopup]);

  // Sync drone data to 3D scene whenever drones change
  useEffect(() => {
    if (mapReady) {
      updateDroneModels();
    }
  }, [drones, selectedDroneId, selectedDroneIds, mapReady, updateDroneModels]);

  // Issue 1: Enhanced focus/zoom on drones with smooth animation
  const focusOnDrones = useCallback(() => {
    if (!mapRef.current || drones.length === 0) return;
    const valid = drones.filter(d => d.lat != null && d.lng != null);
    if (valid.length === 0) return;

    closePopup();

    if (valid.length === 1) {
      const d = valid[0];
      const targetZoom = Math.max(mapRef.current.getZoom(), 14);
      mapRef.current.setZoomAndCenter(targetZoom, [d.lng, d.lat], false, 800);
    } else {
      const AMap = AMapRef.current;
      if (AMap) {
        const lngs = valid.map(d => d.lng);
        const lats = valid.map(d => d.lat);
        const bounds = new AMap.Bounds(
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        );
        mapRef.current.setBounds(bounds, false, [60, 60, 60, 60]);
      }
    }
  }, [drones, closePopup]);

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
        3D模式 | 共 {drones.length} 架 | 在线 {drones.filter(d => d.onlineStatus === true).length} | 飞行中 {drones.filter(d => d.flightStatus === 'FLYING').length}
      </div>
    </div>
  );
}
