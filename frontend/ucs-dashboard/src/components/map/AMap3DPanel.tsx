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
import { useEffect, useRef, useCallback, useState, useImperativeHandle, forwardRef } from 'react';
import AMapLoader from '@amap/amap-jsapi-loader';
import * as THREE from 'three';
import type { MapDrone } from '../MapPanel';

/** Public handle exposed via ref for parent components */
export interface AMap3DPanelHandle {
  focusOnDrones: () => void;
}

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
  /** Locate drone: fly to this drone once (triggered by locateDroneCounter change) */
  locateDroneId?: string | null;
  locateDroneCounter?: number;
  /** Follow mode: continuously track this drone */
  followDroneId?: string | null;
  /** Exit follow mode callback */
  onFollowExit?: () => void;
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

// Altitude exaggeration factor for visual clarity at typical zoom levels
const ALTITUDE_EXAGGERATION = 1.0;

const AMap3DPanel = forwardRef<AMap3DPanelHandle, AMap3DPanelProps>(function AMap3DPanel({
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
  zoom = 4,
  pitch = 50,
}: AMap3DPanelProps, ref) {
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
  // Track which drone's info popup is currently shown (for position follow)
  const popupDroneIdRef = useRef<string | null>(null);

  // Altitude scale: scene units per meter (computed dynamically from coordinate system)
  const altitudeScaleRef = useRef(1.0);

  // Selection blink animation ref
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
            const scale = blinkStateRef.current ? 0.3 : 0.2;
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
    popupDroneIdRef.current = null;
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
    popupDroneIdRef.current = drone.uavId;

    // Auto-close after 5 seconds
    popupTimerRef.current = setTimeout(closePopup, 5000);
    overlay.onmouseenter = () => {
      if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
    };
    overlay.onmouseleave = () => {
      popupTimerRef.current = setTimeout(closePopup, 2000);
    };
  }, [closePopup]);

  // Issue 3: Show map click menu with lat/lng/height and control buttons
  const showMapClickMenu = useCallback((lat: number, lng: number, screenX: number, screenY: number, heightAboveGround: number = 0) => {
    const overlay = popupOverlayRef.current;
    if (!overlay) return;
    closePopup();

    const buttons = [
      { label: '前往', cmd: 'GOTO', color: '#52a8ff' },
      { label: '盘旋', cmd: 'ORBIT', color: '#a855f7' },
      { label: '返航', cmd: 'RTH', color: '#f59e0b' },
      { label: '标记Home', cmd: 'MARK_HOME', color: '#22c55e' },
    ];

    const heightDisplay = heightAboveGround > 0
      ? `${heightAboveGround.toFixed(1)}m`
      : '0m (地面)';

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
        <div>高度: ${heightDisplay}</div>
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

  // Create a 3D drone model visible from all viewing angles.
  // Uses a spherical body + cross arms + rotor discs to ensure visibility
  // regardless of camera pitch/rotation.
  const createDroneModel = useCallback((color: number): THREE.Group => {
    const group = new THREE.Group();

    // Body - sphere (visible from all angles, unlike cone which becomes a line)
    const bodyGeom = new THREE.SphereGeometry(5, 12, 8);
    const bodyMat = new THREE.MeshPhongMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.9,
    });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.set(0, 0, 5);
    group.add(body);

    // Direction indicator - small cone pointing forward (heading direction)
    const dirGeom = new THREE.ConeGeometry(2, 6, 6);
    const dirMat = new THREE.MeshPhongMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.3,
    });
    const dirCone = new THREE.Mesh(dirGeom, dirMat);
    dirCone.rotation.x = -Math.PI / 2;
    dirCone.position.set(0, 8, 5);
    group.add(dirCone);

    // Rotor arms - 4 thin boxes in X pattern (visible from all angles)
    const armGeom = new THREE.BoxGeometry(18, 1.5, 1.5);
    const armMat = new THREE.MeshPhongMaterial({ color: 0xcccccc });

    const arm1 = new THREE.Mesh(armGeom, armMat);
    arm1.position.set(0, 0, 8);
    group.add(arm1);

    const arm2 = new THREE.Mesh(armGeom, armMat);
    arm2.rotation.z = Math.PI / 2;
    arm2.position.set(0, 0, 8);
    group.add(arm2);

    // Rotors - 4 torus rings at arm tips (visible from all angles)
    const rotorGeom = new THREE.TorusGeometry(3, 0.5, 8, 16);
    const rotorMat = new THREE.MeshPhongMaterial({
      color: 0x88ccff,
      emissive: 0x88ccff,
      emissiveIntensity: 0.2,
      transparent: true,
      opacity: 0.6,
    });

    const rotorPositions: [number, number, number][] = [
      [9, 0, 8],
      [-9, 0, 8],
      [0, 9, 8],
      [0, -9, 8],
    ];
    rotorPositions.forEach(([x, y, z]) => {
      const rotor = new THREE.Mesh(rotorGeom, rotorMat);
      rotor.position.set(x, y, z);
      group.add(rotor);
    });

    // Vertical post below body (ensures visibility from above)
    const postGeom = new THREE.CylinderGeometry(0.5, 0.5, 8, 6);
    const postMat = new THREE.MeshPhongMaterial({ color });
    const post = new THREE.Mesh(postGeom, postMat);
    post.rotation.x = Math.PI / 2;
    post.position.set(0, 0, 1);
    group.add(post);

    // Model scale
    group.scale.set(0.25, 0.25, 0.25);

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

      // Map click handler - show popup with lat/lng/height and control buttons
      // Height estimation strategy:
      // 1. Three.js raycasting: cast ray from camera through click point into the
      //    Three.js scene to detect drone models (provides exact 3D position).
      // 2. Pixel-difference method: compare the clicked pixel Y against the
      //    ground-projected pixel Y for the same lng/lat. AMap's lngLatToContainer
      //    always projects to ground level, so if the user clicked a point above
      //    ground (building roof), the click pixel.y will be smaller (higher on
      //    screen) than the ground pixel.y. Convert that pixel offset to meters
      //    using the map's zoom level and pitch angle.
      map.on('click', (e: any) => {
        try {
          const lat = e.lnglat.getLat();
          const lng = e.lnglat.getLng();
          onMapClickRef.current?.(lat, lng);
          if (hasDroneSelectedRef.current) {
            const pixel = e.pixel;
            const containerRect = containerRef.current?.getBoundingClientRect();
            if (pixel && containerRect) {
              let estimatedHeight = 0;
              try {
                // Method 1: Pixel-difference estimation for buildings/terrain
                const mapPitch = map.getPitch();
                if (mapPitch > 3) {
                  const groundPixel = map.lngLatToContainer(
                    new AMap.LngLat(lng, lat)
                  );
                  if (groundPixel) {
                    const pixelDiff = groundPixel.y - pixel.y;
                    if (pixelDiff > 3) {
                      const mapZoom = map.getZoom();
                      const metersPerPixel = 156543.03 * Math.cos(lat * Math.PI / 180) / Math.pow(2, mapZoom);
                      const pitchRad = mapPitch * Math.PI / 180;
                      estimatedHeight = Math.max(0, pixelDiff * metersPerPixel / Math.sin(pitchRad));
                      estimatedHeight = Math.min(estimatedHeight, 800);
                    }
                  }
                }
              } catch { /* ignore height estimation errors */ }
              showMapClickMenu(lat, lng, pixel.x + containerRect.left, pixel.y + containerRect.top, estimatedHeight);
            }
          }
        } catch (err) {
          console.error('[AMap3D] Click handler error:', err);
        }
      });

      // Exit follow mode only when user actively drags/pans the map
      map.on('dragstart', () => {
        onFollowExitRef.current?.();
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
          // Use map's actual center instead of static prop center
          // so that model positions (computed in updateDroneModels) align with camera
          const mc = mapRef.current?.getCenter();
          customCoordsRef.current.setCenter(mc ? [mc.lng, mc.lat] : center);

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
  // Compute altitude scale: scene units per meter, based on horizontal coordinate distance
  const computeAltitudeScale = useCallback(() => {
    if (!customCoordsRef.current || !mapRef.current) return;
    const mc = mapRef.current.getCenter();
    const lng = mc.lng;
    const lat = mc.lat;

    // First try: check if lngLatsToCoords handles altitude natively
    const p0 = customCoordsRef.current.lngLatsToCoords([[lng, lat, 0]]);
    const p1 = customCoordsRef.current.lngLatsToCoords([[lng, lat, 1000]]);
    if (p0?.[0] && p1?.[0]) {
      const dx = (p1[0][0] ?? 0) - (p0[0][0] ?? 0);
      const dy = (p1[0][1] ?? 0) - (p0[0][1] ?? 0);
      const dz = (p1[0][2] ?? 0) - (p0[0][2] ?? 0);
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > 0.001) {
        altitudeScaleRef.current = dist / 1000;
        return;
      }
    }

    // Fallback: compute from horizontal distance between two nearby points
    // 0.001 degrees longitude ≈ 111.32 * cos(lat) meters
    const p2 = customCoordsRef.current.lngLatsToCoords([[lng, lat]]);
    const p3 = customCoordsRef.current.lngLatsToCoords([[lng + 0.001, lat]]);
    if (p2?.[0] && p3?.[0]) {
      const hdx = (p3[0][0] ?? 0) - (p2[0][0] ?? 0);
      const hdy = (p3[0][1] ?? 0) - (p2[0][1] ?? 0);
      const horizontalDist = Math.sqrt(hdx * hdx + hdy * hdy);
      const metersPerDeg = 111320 * Math.cos(lat * Math.PI / 180);
      if (metersPerDeg > 0) {
        altitudeScaleRef.current = horizontalDist / (0.001 * metersPerDeg);
      }
    }
  }, []);

  const updateDroneModels = useCallback(() => {
    if (!sceneRef.current || !customCoordsRef.current || !AMapRef.current) return;

    const scene = sceneRef.current;
    const currentIds = new Set(drones.map(d => d.uavId));

    // Remove models for drones that no longer exist
    droneModelsRef.current.forEach((model, id) => {
      if (!currentIds.has(id)) {
        scene.remove(model);
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

    // Recompute altitude scale if needed
    computeAltitudeScale();
    const altScale = altitudeScaleRef.current * ALTITUDE_EXAGGERATION;

    // Ensure coordinate system is centered on map's current center
    const mapCenter = mapRef.current?.getCenter();
    if (mapCenter) {
      customCoordsRef.current.setCenter([mapCenter.lng, mapCenter.lat]);
    }

    // Add or update drone models
    drones.forEach(drone => {
      if (drone.lat == null || drone.lng == null) return;

      const isSelected = selectedDroneIds
        ? selectedDroneIds.has(drone.uavId)
        : drone.uavId === selectedDroneId;
      const color = getDroneColor(drone, isSelected);
      const droneAlt = (drone.altitude ?? 0) * altScale;

      // Convert lng/lat to scene coordinates (altitude handled manually via z-axis)
      const data = customCoordsRef.current.lngLatsToCoords([
        [drone.lng, drone.lat],
      ]);

      const existing = droneModelsRef.current.get(drone.uavId);
      if (existing) {
        if (data && data[0]) {
          // x, y = horizontal position; z = altitude above ground in scene units
          existing.position.set(data[0][0], data[0][1], droneAlt);
        }

        const heading = drone.heading ?? 0;
        existing.rotation.y = -heading * (Math.PI / 180);

        existing.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshPhongMaterial) {
            if (child.material.emissiveIntensity > 0) {
              child.material.color.setHex(color);
              child.material.emissive.setHex(color);
            }
          }
        });

        if (!isSelected) {
          existing.scale.set(0.25, 0.25, 0.25);
        }
      } else {
        const model = createDroneModel(color);
        if (data && data[0]) {
          model.position.set(data[0][0], data[0][1], droneAlt);
        }
        const heading = drone.heading ?? 0;
        model.rotation.y = -heading * (Math.PI / 180);
        model.userData = { uavId: drone.uavId };
        scene.add(model);
        droneModelsRef.current.set(drone.uavId, model);
      }

      // Update label markers (HTML overlay via AMap Marker)
      updateLabelMarker(drone, isSelected);

      // Update info popup position if it belongs to this drone
      if (popupDroneIdRef.current === drone.uavId && mapRef.current && AMapRef.current) {
        try {
          const pixel = mapRef.current.lngLatToContainer(
            new AMapRef.current.LngLat(drone.lng, drone.lat)
          );
          if (pixel) {
            const overlay = popupOverlayRef.current;
            if (overlay && overlay.style.display !== 'none') {
              overlay.style.left = `${pixel.x + 10}px`;
              overlay.style.top = `${Math.max(0, pixel.y - 10)}px`;
            }
          }
        } catch { /* ignore if map not ready */ }
      }
    });

    // Trigger map re-render to show changes
    mapRef.current?.render();
  }, [drones, selectedDroneId, selectedDroneIds, createDroneModel, computeAltitudeScale]);

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

    // Compute pixel offset to position the label at drone's altitude, not on the ground.
    // lngLatToContainer gives ground-level pixel; we subtract the altitude's screen
    // height so the label floats above the 3D model.
    let labelOffset = new AMap.Pixel(-30, -50);
    if (mapRef.current && drone.altitude != null && drone.altitude > 0) {
      try {
        const groundPx = mapRef.current.lngLatToContainer(
          new AMap.LngLat(drone.lng, drone.lat)
        );
        // Estimate vertical pixel offset for altitude:
        // Use two nearby points to calculate meters-per-pixel vertically.
        const mapZoom = mapRef.current.getZoom();
        const mapPitch = mapRef.current.getPitch() || 50;
        const pitchRad = mapPitch * Math.PI / 180;
        const metersPerPixel = 156543.03 * Math.cos((drone.lat || 30) * Math.PI / 180) / Math.pow(2, mapZoom);
        // Vertical pixel offset = altitude / metersPerPixel * sin(pitch)
        // sin(pitch) accounts for the foreshortening of vertical axis in 3D view
        const altPixelOffset = metersPerPixel > 0 ? (drone.altitude / metersPerPixel) * Math.sin(pitchRad) : 0;
        // Clamp to reasonable range (max 400px offset to avoid labels going offscreen)
        const clampedOffset = Math.min(Math.max(altPixelOffset, 0), 400);
        labelOffset = new AMap.Pixel(-30, -50 - clampedOffset);
      } catch {
        // Fallback to default offset if calculation fails
      }
    }

    if (existing) {
      existing.setPosition(new AMap.LngLat(drone.lng, drone.lat));
      existing.setContent(content);
      existing.setOffset(labelOffset);
    } else {
      const marker = new AMap.Marker({
        position: new AMap.LngLat(drone.lng, drone.lat),
        content,
        offset: labelOffset,
        zIndex: 200,
        anchor: 'bottom-center',
      });
      // Issue 4: Click on label marker to show drone info popup
      marker.on('click', (e: any) => {
        try {
          onDroneClickRef.current?.(drone.uavId);
          const d = dronesRef.current.find(dr => dr.uavId === drone.uavId);
          if (d) {
            const pixel = e.pixel || e.originEvent;
            const x = pixel?.clientX ?? pixel?.x ?? 300;
            const y = pixel?.clientY ?? pixel?.y ?? 300;
            showDronePopup(d, x, y);
          }
        } catch (err) {
          console.error('[AMap3D] Label click error:', err);
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

  // Focus/zoom on all drones with smooth animation.
  // Uses setZoomAndCenter for atomic animated transition in AMap 3D view.
  // The key issue was that separate setCenter/setZoom/setPitch calls may
  // target the hidden 2D view or not animate properly in 3D mode.
  // setZoomAndCenter is the AMap-recommended way to animate in 3D.
  const focusOnDrones = useCallback(() => {
    try {
      if (!mapRef.current || drones.length === 0) return;
      const valid = drones.filter(d => d.lat != null && d.lng != null);
      if (valid.length === 0) return;

      closePopup();
      const map = mapRef.current;

      if (valid.length === 1) {
        const d = valid[0];
        map.setZoomAndCenter(16, [d.lng, d.lat], false, 800);
        map.setPitch(50, false, 800);
        map.setRotation(0, false, 800);
      } else {
        const avgLng = valid.reduce((s, d) => s + d.lng, 0) / valid.length;
        const avgLat = valid.reduce((s, d) => s + d.lat, 0) / valid.length;

        const lngs = valid.map(d => d.lng);
        const lats = valid.map(d => d.lat);
        const lngSpan = Math.max(...lngs) - Math.min(...lngs);
        const latSpan = Math.max(...lats) - Math.min(...lats);
        const maxSpan = Math.max(lngSpan, latSpan);
        let targetZoom = 16;
        if (maxSpan > 0.0001) {
          targetZoom = Math.min(18, Math.max(4, Math.floor(Math.log2(360 / maxSpan)) - 1));
        }

        map.setZoomAndCenter(targetZoom, [avgLng, avgLat], false, 800);
        map.setPitch(45, false, 800);
        map.setRotation(0, false, 800);
      }
    } catch (err) {
      console.error('[AMap3D] Focus error:', err);
    }
  }, [drones, closePopup]);

  // Expose focusOnDrones to parent via ref
  // IMPORTANT: must be defined AFTER focusOnDrones to avoid temporal dead zone
  useImperativeHandle(ref, () => ({ focusOnDrones: () => focusOnDrones() }), [focusOnDrones]);

  // Locate drone: fly to a specific drone when locateDroneCounter changes
  useEffect(() => {
    if (!locateDroneId || !mapRef.current || locateDroneCounter === 0) return;
    const drone = drones.find(d => d.uavId === locateDroneId);
    if (!drone || drone.lat == null || drone.lng == null) return;

    const map = mapRef.current;
    const targetZoom = Math.max(map.getZoom(), 16);
    // Use setZoomAndCenter for reliable 3D animated transition
    map.setZoomAndCenter(targetZoom, [drone.lng, drone.lat], false, 800);
    map.setPitch(50, false, 800);
  }, [locateDroneCounter, locateDroneId, drones]);

  // Follow mode: continuously track a specific drone's position.
  // Only moves center - does NOT lock pitch/zoom/rotation so user can
  // freely adjust viewing angle while following.
  useEffect(() => {
    if (!followDroneId || !mapRef.current) return;
    const drone = drones.find(d => d.uavId === followDroneId);
    if (!drone || drone.lat == null || drone.lng == null) return;

    // panBy or setCenter with short animation - keeps map responsive
    // Using immediate=true avoids animation queue buildup that can lock the map
    mapRef.current.setCenter([drone.lng, drone.lat], true);
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
        3D模式 | 共 {drones.length} 架 | 在线 {drones.filter(d => d.onlineStatus === true).length} | 飞行中 {drones.filter(d => d.flightStatus === 'FLYING').length}
      </div>
    </div>
  );
});

export default AMap3DPanel;
