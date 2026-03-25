/**
 * AMap 3D Map Panel
 * 
 * Uses AMap JS API v2 with viewMode:'3D' for full 3D map rendering.
 * Drones are rendered as 3D cone models via AMap.GLCustomLayer + Three.js,
 * with accurate altitude representation.
 * 
 * Accepts the same MapDrone interface as MapPanel for seamless integration.
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import AMapLoader from '@amap/amap-jsapi-loader';
import * as THREE from 'three';
import type { MapDrone } from '../MapPanel';

// AMap credentials from environment variables
// Set VITE_AMAP_KEY and VITE_AMAP_SECRET in .env or .env.local
const AMAP_KEY = import.meta.env.VITE_AMAP_KEY || '';
const AMAP_SECRET = import.meta.env.VITE_AMAP_SECRET || '';

interface AMap3DPanelProps {
  drones: MapDrone[];
  selectedDroneId?: string | null;
  selectedDroneIds?: Set<string>;
  onDroneClick?: (uavId: string) => void;
  onMapClick?: (lat: number, lon: number) => void;
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
  if (drone.armed) return 0x22c55e; // green for armed
  return 0x3b82f6; // blue for disarmed
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

  const selectedDroneIdRef = useRef(selectedDroneId);
  const selectedDroneIdsRef = useRef(selectedDroneIds);
  const onDroneClickRef = useRef(onDroneClick);
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => { selectedDroneIdRef.current = selectedDroneId; }, [selectedDroneId]);
  useEffect(() => { selectedDroneIdsRef.current = selectedDroneIds; }, [selectedDroneIds]);
  useEffect(() => { onDroneClickRef.current = onDroneClick; }, [onDroneClick]);
  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);

  // Create a simple 3D drone model (cone body + rotor arms)
  const createDroneModel = useCallback((color: number): THREE.Group => {
    const group = new THREE.Group();

    // Body - cone pointing upward
    const bodyGeom = new THREE.ConeGeometry(8, 20, 6);
    const bodyMat = new THREE.MeshPhongMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.9,
    });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.rotation.x = Math.PI; // Point cone downward (drone body)
    body.position.y = 10;
    group.add(body);

    // Rotor arms - 4 thin cylinders in X pattern
    const armGeom = new THREE.CylinderGeometry(1, 1, 24, 6);
    const armMat = new THREE.MeshPhongMaterial({ color: 0xcccccc });
    
    const arm1 = new THREE.Mesh(armGeom, armMat);
    arm1.rotation.z = Math.PI / 2;
    arm1.position.y = 18;
    group.add(arm1);

    const arm2 = new THREE.Mesh(armGeom, armMat);
    arm2.rotation.z = Math.PI / 2;
    arm2.rotation.y = Math.PI / 2;
    arm2.position.y = 18;
    group.add(arm2);

    // Rotors - 4 small discs at arm tips
    const rotorGeom = new THREE.CircleGeometry(5, 12);
    const rotorMat = new THREE.MeshPhongMaterial({
      color: 0x88ccff,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    });

    const rotorPositions = [
      [12, 19, 0],
      [-12, 19, 0],
      [0, 19, 12],
      [0, 19, -12],
    ];
    rotorPositions.forEach(([x, y, z]) => {
      const rotor = new THREE.Mesh(rotorGeom, rotorMat);
      rotor.rotation.x = -Math.PI / 2;
      rotor.position.set(x, y, z);
      group.add(rotor);
    });

    // Scale the whole model
    group.scale.set(0.5, 0.5, 0.5);

    return group;
  }, []);

  // Initialize AMap
  useEffect(() => {
    if (!containerRef.current) return;

    // Set security config before loading
    (window as any)._AMapSecurityConfig = {
      securityJsCode: AMAP_SECRET,
    };

    let destroyed = false;

    AMapLoader.load({
      key: AMAP_KEY,
      version: '2.0',
      plugins: ['AMap.ControlBar', 'AMap.ToolBar', 'AMap.Scale'],
    }).then((AMap: any) => {
      if (destroyed || !containerRef.current) return;
      AMapRef.current = AMap;

      const map = new AMap.Map(containerRef.current, {
        viewMode: '3D',
        pitch,
        zoom,
        center,
        rotation: 0,
        rotateEnable: true,
        pitchEnable: true,
        zooms: [2, 20],
        mapStyle: 'amap://styles/dark',
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

      // Map click handler
      map.on('click', (e: any) => {
        onMapClickRef.current?.(e.lnglat.getLat(), e.lnglat.getLng());
      });

      // Initialize Three.js GL custom layer for 3D drones
      const customCoords = map.customCoords;
      customCoordsRef.current = customCoords;
      customCoords.setCenter(center);

      const glLayer = new AMap.GLCustomLayer({
        zIndex: 120,
        init: (gl: WebGLRenderingContext) => {
          const camera = new THREE.PerspectiveCamera(
            60,
            containerRef.current!.offsetWidth / containerRef.current!.offsetHeight,
            1,
            1 << 30,
          );
          cameraRef.current = camera;

          const renderer = new THREE.WebGLRenderer({
            context: gl,
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
    }).catch((err: Error) => {
      if (!destroyed) {
        console.error('AMap load error:', err);
        setLoadError(err.message || '高德地图加载失败');
      }
    });

    return () => {
      destroyed = true;
      // Clean up label markers
      labelMarkersRef.current.forEach(m => m.remove?.());
      labelMarkersRef.current.clear();
      droneModelsRef.current.clear();
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

        // Update scale for selected
        const scale = isSelected ? 0.7 : 0.5;
        existing.scale.set(scale, scale, scale);
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
      marker.on('click', () => {
        onDroneClickRef.current?.(drone.uavId);
      });
      mapRef.current.add(marker);
      labelMarkersRef.current.set(drone.uavId, marker);
    }
  }, []);

  // Sync drone data to 3D scene whenever drones change
  useEffect(() => {
    if (mapReady) {
      updateDroneModels();
    }
  }, [drones, selectedDroneId, selectedDroneIds, mapReady, updateDroneModels]);

  // Fly to drones when they become available
  const focusOnDrones = useCallback(() => {
    if (!mapRef.current || drones.length === 0) return;
    const valid = drones.filter(d => d.lat != null && d.lng != null);
    if (valid.length === 0) return;

    if (valid.length === 1) {
      mapRef.current.setCenter([valid[0].lng, valid[0].lat]);
      mapRef.current.setZoom(14);
    } else {
      const AMap = AMapRef.current;
      if (AMap) {
        const bounds = new AMap.Bounds(
          [Math.min(...valid.map(d => d.lng)), Math.min(...valid.map(d => d.lat))],
          [Math.max(...valid.map(d => d.lng)), Math.max(...valid.map(d => d.lat))],
        );
        mapRef.current.setBounds(bounds, false, [50, 50, 50, 50]);
      }
    }
  }, [drones]);

  return (
    <div className={`relative w-full h-full ${className}`}>
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />

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
