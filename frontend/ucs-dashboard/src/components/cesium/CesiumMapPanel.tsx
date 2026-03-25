/**
 * CesiumJS 3D Globe Map Panel
 * 
 * Replaces AMap3DPanel with CesiumJS for WebGL 2 support.
 * Features:
 * - Cesium 3D globe with Gaode vector tiles
 * - Drone entities with labels and tracking
 * - Grid overlay for sci-fi aesthetic
 * - Camera fly-to for drone focus
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import * as Cesium from 'cesium';
import type { MapDrone } from '../MapPanel';

// Cesium Ion access token - set via env or use default
const CESIUM_ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN || '';

interface CesiumMapPanelProps {
  drones: MapDrone[];
  selectedDroneId?: string | null;
  selectedDroneIds?: Set<string>;
  onDroneClick?: (uavId: string) => void;
  onMapClick?: (lat: number, lon: number) => void;
  className?: string;
  center?: [number, number]; // [lng, lat]
  zoom?: number;
  pitch?: number;
}

// Drone color based on state
function getDroneColor(drone: MapDrone, isSelected: boolean): Cesium.Color {
  if (isSelected) return Cesium.Color.fromCssColorString('#f59e0b');
  if (!drone.onlineStatus) return Cesium.Color.fromCssColorString('#64748b');
  if (drone.armed) return Cesium.Color.fromCssColorString('#22c55e');
  return Cesium.Color.fromCssColorString('#3b82f6');
}

export default function CesiumMapPanel({
  drones,
  selectedDroneId,
  selectedDroneIds,
  onDroneClick,
  onMapClick,
  className = '',
  center = [116.397428, 39.90923], // Beijing Tiananmen
  zoom = 2000,
  pitch = 35,
}: CesiumMapPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const droneEntitiesRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const dronesRef = useRef(drones);
  dronesRef.current = drones;

  const onDroneClickRef = useRef(onDroneClick);
  const onMapClickRef = useRef(onMapClick);
  const selectedDroneIdRef = useRef(selectedDroneId);
  const selectedDroneIdsRef = useRef(selectedDroneIds);
  useEffect(() => { onDroneClickRef.current = onDroneClick; }, [onDroneClick]);
  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);
  useEffect(() => { selectedDroneIdRef.current = selectedDroneId; }, [selectedDroneId]);
  useEffect(() => { selectedDroneIdsRef.current = selectedDroneIds; }, [selectedDroneIds]);

  // Initialize Cesium Viewer
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    // Set Ion token
    if (CESIUM_ION_TOKEN) {
      Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;
    }

    try {
      // Gaode vector tile imagery provider
      const gaodeProvider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
        subdomains: ['1', '2', '3', '4'],
        minimumLevel: 1,
        maximumLevel: 18,
      });

      const viewer = new Cesium.Viewer(containerRef.current, {
        // Use flat ellipsoid terrain for holographic sandbox feel
        terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        selectionIndicator: false,
        timeline: false,
        animation: false,
        fullscreenButton: false,
        vrButton: false,
        navigationHelpButton: false,
        infoBox: false,
        creditContainer: document.createElement('div'), // Hide credits
        imageryProvider: gaodeProvider,
        msaaSamples: 4,
      });

      viewerRef.current = viewer;

      // Add grid overlay for sci-fi aesthetic
      viewer.imageryLayers.addImageryProvider(
        new Cesium.GridImageryProvider({
          cells: 8,
          color: Cesium.Color.fromCssColorString('rgba(0, 255, 255, 0.08)'),
          glowColor: Cesium.Color.fromCssColorString('rgba(0, 255, 255, 0.03)'),
          glowWidth: 2,
        })
      );

      // Disable default atmosphere for cleaner sci-fi look
      viewer.scene.skyAtmosphere.show = false;
      viewer.scene.fog.enabled = false;
      viewer.scene.globe.showGroundAtmosphere = false;

      // Dark space background
      viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#0a0f1a');
      viewer.scene.skyBox.show = false;
      viewer.scene.sun.show = false;
      viewer.scene.moon.show = false;

      // Enable lighting for better visual
      viewer.scene.globe.enableLighting = false;

      // Set globe base color for areas without imagery
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#0d1526');

      // Fly to initial view (Beijing Tiananmen area)
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(center[0], center[1], zoom),
        orientation: {
          heading: Cesium.Math.toRadians(20),
          pitch: Cesium.Math.toRadians(-pitch),
          roll: 0,
        },
        duration: 2,
      });

      // Click handler for map
      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((click: { position: Cesium.Cartesian2 }) => {
        const picked = viewer.scene.pick(click.position);
        if (Cesium.defined(picked) && picked.id && picked.id.properties) {
          const uavId = picked.id.properties.uavId?.getValue();
          if (uavId) {
            onDroneClickRef.current?.(uavId);
            return;
          }
        }
        // Map click (empty area)
        const cartesian = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
        if (cartesian) {
          const carto = Cesium.Cartographic.fromCartesian(cartesian);
          const lat = Cesium.Math.toDegrees(carto.latitude);
          const lon = Cesium.Math.toDegrees(carto.longitude);
          onMapClickRef.current?.(lat, lon);
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

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
      const heading = drone.heading ?? 0;

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
  }, [drones, selectedDroneId, selectedDroneIds]);

  // Sync drone data whenever drones change
  useEffect(() => {
    if (mapReady) {
      updateDroneEntities();
    }
  }, [drones, selectedDroneId, selectedDroneIds, mapReady, updateDroneEntities]);

  // Fly to drones when they become available
  const focusOnDrones = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || drones.length === 0) return;
    const valid = drones.filter(d => d.lat != null && d.lng != null);
    if (valid.length === 0) return;

    if (valid.length === 1) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          valid[0].lng, valid[0].lat, 2000
        ),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-45),
          roll: 0,
        },
        duration: 1.5,
      });
    } else {
      const rect = Cesium.Rectangle.fromCartographicArray(
        valid.map(d => Cesium.Cartographic.fromDegrees(d.lng, d.lat))
      );
      viewer.camera.flyTo({
        destination: rect,
        duration: 1.5,
      });
    }
  }, [drones]);

  // Focus when drones first appear
  useEffect(() => {
    if (mapReady && drones.length > 0) {
      const timer = setTimeout(focusOnDrones, 1000);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, drones.length > 0]);

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
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ background: '#0a0f1a' }}
      />
      {!mapReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0f1a]">
          <div className="text-cyan-400 animate-pulse text-sm">
            正在初始化 Cesium 3D 地球...
          </div>
        </div>
      )}
    </div>
  );
}
