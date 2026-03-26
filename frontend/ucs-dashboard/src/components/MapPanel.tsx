/**
 * 可复用的地图面板组件
 * 从 Observer 视图中提取的核心地图功能，供所有角色界面复用。
 * 支持：
 * - 无人机标记显示（在线优先）
 * - 无人机弹出信息
 * - 飞行轨迹
 * - 地图源切换
 * - 聚焦无人机
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Locate,
  Layers,
  Battery,
  Activity,
  Plane,
  AlertTriangle,
  Globe,
  Map as MapIcon,
} from 'lucide-react';
import { DroneLayer, type DroneFeature } from './map/DroneLayer';
import { useVirtualizer } from '@tanstack/react-virtual';
import { lazy, Suspense } from 'react';

// Lazy load AMap 3D panel to avoid loading Three.js + AMap SDK when not needed
const AMap3DPanel = lazy(() => import('./map/AMap3DPanel'));

const getApiBase = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return `${window.location.protocol}//${window.location.hostname}:8080`;
  }
  return 'http://localhost:8080';
};

const API_BASE = getApiBase();

type TileSourceKey = 'gaode' | 'osm' | 'carto';

interface TileSourceConfig {
  name: string;
  tiles: string[];
  attribution: string;
}

const TILE_SOURCES: Record<TileSourceKey, TileSourceConfig> = {
  gaode: {
    name: '高德地图',
    tiles: [`${API_BASE}/api/v1/map/tiles/{z}/{x}/{y}.png?style=7`],
    attribution: '&copy; <a href="https://www.amap.com/">高德地图</a>',
  },
  osm: {
    name: 'OpenStreetMap',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  carto: {
    name: 'CartoDB',
    tiles: [
      'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
      'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
      'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    ],
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
  },
};

export interface MapDrone {
  uavId: string;
  lat: number;
  lng: number;
  altitude?: number;
  battery?: number;
  flightStatus?: string;
  onlineStatus?: boolean;
  /** Whether the drone is armed (motors unlocked). Used for three-state display:
   *  - offline (onlineStatus=false)
   *  - disarmed/unlocked (onlineStatus=true, armed=false)
   *  - armed/online (onlineStatus=true, armed=true)
   */
  armed?: boolean;
  model?: string;
  owner?: string;
  teamName?: string;
  teamLeader?: string;
  controlOwnerName?: string;
  /** Heading in degrees (0-360) for drone icon rotation */
  heading?: number;
}

/** Rally point data for map display */
export interface MapRallyPoint {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  capacity: number;
  currentOccupancy: number;
  status: number; // 0=disabled, 1=enabled, 2=maintenance
  serviceType: number; // 0=parking, 1=charging, 2=maintenance, 3=supply
}

interface MapPanelProps {
  drones: MapDrone[];
  /** 选中的无人机 ID（高亮显示） */
  selectedDroneId?: string | null;
  /** 多选模式下选中的无人机 ID 集合（所有选中的都高亮闪烁） */
  selectedDroneIds?: Set<string>;
  /** Home marker position for flashing dot display (5s duration) */
  homeMarker?: { lat: number; lng: number } | null;
  /** Rally points to display on map */
  rallyPoints?: MapRallyPoint[];
  /** 点击无人机标记时的回调 */
  onDroneClick?: (uavId: string) => void;
  /** 点击地图空白区域时的回调（经纬度），仅在有选中无人机时触发 */
  onMapClick?: (lat: number, lon: number) => void;
  /** 地图点击快捷指令回调 (QGC风格) */
  onMapClickCommand?: (command: string, lat: number, lon: number) => void;
  /** 是否有选中的无人机（控制地图点击菜单是否显示） */
  hasDroneSelected?: boolean;
  /** 定位无人机：设置后地图飞到该无人机位置（一次性），改变值触发定位 */
  locateDroneCounter?: number;
  locateDroneId?: string | null;
  /** 追随模式：持续跟踪该无人机，视野随其移动 */
  followDroneId?: string | null;
  /** 退出追随模式回调（用户拖拽/点击地图时触发） */
  onFollowExit?: () => void;
  /** 额外的 CSS 类名 */
  className?: string;
  /** 是否显示无人机列表侧边栏 */
  showDroneList?: boolean;
  /** 是否显示事件日志面板 */
  showEventLog?: boolean;
  /** 事件日志数据 */
  eventLogs?: Array<{ id: number; time: string; detail: string; result?: string }>;
  /** Phase 2: 使用 GPU Symbol Layer 渲染无人机（高性能模式，支持10万+） */
  useSymbolLayer?: boolean;
}

/** Phase 3: Virtualized drone list using TanStack Virtual for 10k+ drone support */
function VirtualDroneList({ drones, selectedDroneId, onDroneClick }: {
  drones: MapDrone[];
  selectedDroneId?: string | null;
  onDroneClick?: (uavId: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: drones.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 5,
  });

  if (drones.length === 0) {
    return <div className="text-center text-slate-500 py-4 text-xs">暂无无人机数据</div>;
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto p-1.5" style={{ contain: 'strict' }}>
      <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const drone = drones[virtualRow.index];
          return (
            <div
              key={drone.uavId}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div
                className={`p-2 rounded cursor-pointer transition-all text-xs mb-1 ${
                  selectedDroneId === drone.uavId
                    ? 'bg-blue-900/50 border border-blue-500'
                    : 'bg-slate-700/50 border border-slate-600 hover:border-slate-500'
                }`}
                onClick={() => onDroneClick?.(drone.uavId)}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-bold text-white">{drone.uavId}</span>
                  <Badge className={`text-[10px] px-1 py-0 ${
                    !drone.onlineStatus
                      ? 'bg-slate-600'
                      : drone.armed === true
                        ? 'bg-green-600'
                        : 'bg-blue-600'
                  }`}>
                    {!drone.onlineStatus ? '离线' : drone.armed === true ? '已解锁' : '未解锁'}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-slate-400">
                  <span className="flex items-center gap-0.5">
                    <Battery className="w-2.5 h-2.5" />
                    {drone.battery != null ? `${drone.battery.toFixed(1)}%` : 'N/A'}
                  </span>
                  <span>{drone.altitude != null ? `${drone.altitude.toFixed(2)}m` : ''}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function MapPanel({
  drones,
  selectedDroneId,
  selectedDroneIds,
  homeMarker,
  rallyPoints = [],
  onDroneClick,
  onMapClick,
  onMapClickCommand,
  hasDroneSelected = false,
  locateDroneCounter = 0,
  locateDroneId,
  followDroneId,
  onFollowExit,
  className = '',
  showDroneList = true,
  showEventLog = false,
  eventLogs = [],
  useSymbolLayer = false,
}: MapPanelProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const droneMarkersRef = useRef<Map<string, { marker: maplibregl.Marker; popup: maplibregl.Popup; element: HTMLDivElement }>>(new Map());
  // Cumulative angle tracker per drone — avoids 359°→0° snap-back during orbiting
  const cumulativeAngleRef = useRef<Map<string, number>>(new Map());
  const popupTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const rallyMarkersRef = useRef<Map<number, maplibregl.Marker>>(new Map());

  // 使用 ref 保存最新的回调和状态，避免 marker click listener 中的闭包过期问题
  const onDroneClickRef = useRef(onDroneClick);
  const selectedDroneIdsRef = useRef(selectedDroneIds);
  const selectedDroneIdRef = useRef(selectedDroneId);
  const onMapClickRef = useRef(onMapClick);
  const onMapClickCommandRef = useRef(onMapClickCommand);
  const hasDroneSelectedRef = useRef(hasDroneSelected);
  const onFollowExitRef = useRef(onFollowExit);
  useEffect(() => { onDroneClickRef.current = onDroneClick; }, [onDroneClick]);
  useEffect(() => { selectedDroneIdsRef.current = selectedDroneIds; }, [selectedDroneIds]);
  useEffect(() => { selectedDroneIdRef.current = selectedDroneId; }, [selectedDroneId]);
  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);
  useEffect(() => { onMapClickCommandRef.current = onMapClickCommand; }, [onMapClickCommand]);
  useEffect(() => { hasDroneSelectedRef.current = hasDroneSelected; }, [hasDroneSelected]);
  useEffect(() => { onFollowExitRef.current = onFollowExit; }, [onFollowExit]);
  const homeMarkerRef = useRef<maplibregl.Marker | null>(null);
  const mapClickPopupRef = useRef<maplibregl.Popup | null>(null);
  const [tileSource, setTileSource] = useState<TileSourceKey>('gaode');
  const [showTileSelector, setShowTileSelector] = useState(false);
  const [droneListCollapsed, setDroneListCollapsed] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapErrorDetails, setMapErrorDetails] = useState<string | null>(null);
  // 3D map toggle - switches between MapLibre 2D and AMap 3D
  const [is3DMode, setIs3DMode] = useState(false);

  // 弹窗自动关闭逻辑 - 默认5秒后关闭，鼠标移入保持，移出后倒计时关闭
  const POPUP_AUTO_CLOSE_MS = 5000;

  const startPopupAutoClose = useCallback((uavId: string) => {
    // 清除旧定时器
    const oldTimer = popupTimerRef.current.get(uavId);
    if (oldTimer) clearTimeout(oldTimer);
    // 启动新定时器
    const timer = setTimeout(() => {
      const entry = droneMarkersRef.current.get(uavId);
      if (entry && entry.popup.isOpen()) {
        entry.popup.remove();
      }
      popupTimerRef.current.delete(uavId);
    }, POPUP_AUTO_CLOSE_MS);
    popupTimerRef.current.set(uavId, timer);
  }, []);

  const clearPopupAutoClose = useCallback((uavId: string) => {
    const timer = popupTimerRef.current.get(uavId);
    if (timer) {
      clearTimeout(timer);
      popupTimerRef.current.delete(uavId);
    }
  }, []);

  // 检查高德地图瓦片代理是否可用（参考 Observer 视图逻辑）
  const checkTileHealth = async (): Promise<{ configured: boolean; message: string }> => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/map/tiles/health`);
      if (!response.ok) {
        return { configured: false, message: '无法连接后端服务' };
      }
      const data = await response.json();
      return {
        configured: data.configured === true,
        message: data.message || (data.configured ? '' : '高德地图 API 密钥未配置'),
      };
    } catch {
      return { configured: false, message: '无法连接后端服务' };
    }
  };

  // 初始化地图（与 Observer 视图 initMap 逻辑完全一致）
  const initMap = async (selectedTileSource: TileSourceKey = tileSource) => {
    if (!mapContainer.current) return;

    // Remove existing map if any
    if (map.current) {
      map.current.remove();
      map.current = null;
    }

    // Get tile configuration
    const tileConfig = TILE_SOURCES[selectedTileSource];
    if (!tileConfig.tiles.length) {
      setMapError('地图加载失败');
      setMapErrorDetails('未配置地图瓦片源');
      return;
    }

    // Check tile health for Gaode source (与 Observer 视图一致)
    if (selectedTileSource === 'gaode') {
      const health = await checkTileHealth();
      if (!health.configured) {
        setMapError('高德地图 API 密钥未配置');
        setMapErrorDetails(health.message);
        // Don't return - still try to initialize map, but user will see error
      }
    }

    setMapError(null);
    setMapErrorDetails(null);

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'basemap': {
            type: 'raster',
            tiles: tileConfig.tiles,
            tileSize: 256,
            attribution: tileConfig.attribution,
          },
        },
        layers: [
          {
            id: 'basemap',
            type: 'raster',
            source: 'basemap',
            maxzoom: 19,
          },
        ],
      },
      center: [105, 30],
      zoom: 3,
      minZoom: 2,
      maxZoom: 18,
    });

    // Enhanced error handling for map loading (与 Observer 视图一致)
    map.current.on('error', (e) => {
      console.error('Map error:', e);
      const errorMsg = (e.error as Error | undefined)?.message || '';
      const sourceId = (e as unknown as { sourceId?: string }).sourceId || '';

      if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
        setMapError('网络连接异常');
        setMapErrorDetails(`地图瓦片加载失败: ${sourceId || 'basemap'}`);
      } else {
        setMapError('地图加载异常');
        setMapErrorDetails(errorMsg || '请尝试刷新页面');
      }
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.current.addControl(new maplibregl.ScaleControl(), 'bottom-left');

    // Map click handler for QGC-style click menu (Issue 4)
    map.current.on('click', (e) => {
      if (!hasDroneSelectedRef.current) return;
      // Dismiss existing map click popup
      if (mapClickPopupRef.current) {
        mapClickPopupRef.current.remove();
        mapClickPopupRef.current = null;
      }
      const { lat, lng } = e.lngLat;
      // Notify parent of click coordinates
      onMapClickRef.current?.(lat, lng);
      // Show QGC-style popup with coordinates and quick command buttons
      const popupContainer = document.createElement('div');
      popupContainer.innerHTML = `
        <div style="background:#1e293b;padding:10px;border-radius:8px;color:white;font-size:11px;min-width:180px;">
          <div style="background:#0f172a;border:1px solid #334155;border-radius:4px;padding:5px 8px;text-align:center;margin-bottom:8px;font-family:monospace;">
            <span style="font-weight:bold;font-size:12px;color:#38bdf8;">${lat.toFixed(6)}</span>
            <span style="color:#64748b;margin:0 3px;">,</span>
            <span style="font-weight:bold;font-size:12px;color:#38bdf8;">${lng.toFixed(6)}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;">
            <button data-cmd="GOTO" style="background:#0891b2;border:none;color:white;padding:5px 0;border-radius:4px;font-size:10px;font-weight:bold;cursor:pointer;">\u524d\u5f80</button>
            <button data-cmd="ORBIT" style="background:#6366f1;border:none;color:white;padding:5px 0;border-radius:4px;font-size:10px;font-weight:bold;cursor:pointer;">\u76d8\u65cb</button>
            <button data-cmd="MARK_HOME" style="background:#0d9488;border:none;color:white;padding:5px 0;border-radius:4px;font-size:10px;font-weight:bold;cursor:pointer;">\u8bbe\u4e3aHome</button>
          </div>
        </div>
      `;
      // Bind click handlers to command buttons
      popupContainer.querySelectorAll('button[data-cmd]').forEach(btn => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const cmd = (ev.currentTarget as HTMLElement).getAttribute('data-cmd');
          if (cmd) {
            onMapClickCommandRef.current?.(cmd, lat, lng);
          }
          // Close popup after command
          if (mapClickPopupRef.current) {
            mapClickPopupRef.current.remove();
            mapClickPopupRef.current = null;
          }
        });
        // Hover effect
        (btn as HTMLElement).addEventListener('mouseenter', () => {
          (btn as HTMLElement).style.opacity = '0.8';
        });
        (btn as HTMLElement).addEventListener('mouseleave', () => {
          (btn as HTMLElement).style.opacity = '1';
        });
      });
      const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '220px' })
        .setLngLat([lng, lat])
        .setDOMContent(popupContainer)
        .addTo(map.current!);
      mapClickPopupRef.current = popup;
    });

    map.current.on('load', () => {
      // Force resize to ensure map fills container properly
      // This fixes the issue where MapLibre container has 0 height initially
      requestAnimationFrame(() => {
        map.current?.resize();
      });
    });
  };

  // 切换地图源
  const changeTileSource = async (newSource: TileSourceKey) => {
    setTileSource(newSource);
    setShowTileSelector(false);
    await initMap(newSource);
  };

  // 聚焦无人机
  const focusOnDrones = useCallback(() => {
    if (!map.current || drones.length === 0) return;
    const validDrones = drones.filter(d => d.lat != null && d.lng != null);
    if (validDrones.length === 0) return;

    if (validDrones.length === 1) {
      map.current.flyTo({ center: [validDrones[0].lng, validDrones[0].lat], zoom: 14, duration: 1000 });
    } else {
      const bounds = new maplibregl.LngLatBounds();
      validDrones.forEach(d => bounds.extend([d.lng, d.lat]));
      map.current.fitBounds(bounds, { padding: 50, duration: 1000 });
    }
  }, [drones]);

  // ==================== DOM Reuse Marker Update ====================
  // Instead of innerHTML replacement (which destroys and recreates all DOM nodes,
  // causing visible flicker), we create the marker DOM structure once and only
  // update style properties, transforms, and textContent on subsequent updates.

  /** Compute marker color based on drone state */
  function getMarkerColors(drone: MapDrone, isSelected: boolean) {
    const isOnline = drone.onlineStatus === true;
    const isArmed = drone.armed === true;
    const color = !isOnline ? '#64748b' : isArmed ? '#22c55e' : '#3b82f6';
    const borderColor = isSelected ? '#f59e0b' : color;
    return { color, borderColor, isSelected };
  }

  /**
   * Compute cumulative rotation angle for a drone.
   * Avoids the 359°→0° snap-back by tracking accumulated angle
   * and always choosing the shortest rotational path.
   * Uses safe modulo to handle negative cumulative values correctly.
   */
  function getCumulativeAngle(uavId: string, newHeading: number): number {
    const prev = cumulativeAngleRef.current.get(uavId);
    if (prev == null) {
      cumulativeAngleRef.current.set(uavId, newHeading);
      return newHeading;
    }
    // Safe modulo that always returns 0-360 (JS % can return negative for negative prev)
    const prevNorm = ((prev % 360) + 360) % 360;
    // Compute shortest angular difference (-180 to +180)
    let delta = ((newHeading - prevNorm) + 540) % 360 - 180;
    const cumulative = prev + delta;
    cumulativeAngleRef.current.set(uavId, cumulative);
    return cumulative;
  }

  /** Create marker DOM structure once (circle + svg + label) */
  function createMarkerElement(drone: MapDrone, isSelected: boolean): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'drone-marker';
    el.style.cursor = 'pointer';

    const { color, borderColor } = getMarkerColors(drone, isSelected);
    const size = isSelected ? 40 : 32;

    // Circle container
    const circle = document.createElement('div');
    circle.className = 'drone-marker-circle';
    circle.style.cssText = `width:${size}px;height:${size}px;background:${color};border:3px solid ${borderColor};border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);transition:background 0.3s,border-color 0.3s,width 0.2s,height 0.2s;`;
    if (isSelected) circle.style.animation = 'pulse 1.5s infinite';

    // SVG icon — use cumulative angle for smooth orbiting
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'white');
    const cumAngle = getCumulativeAngle(drone.uavId, drone.heading ?? 0);
    svg.style.cssText = `transform:rotate(${cumAngle}deg);transition:transform 0.1s linear;will-change:transform;`;
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', 'M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z');
    svg.appendChild(path);
    circle.appendChild(svg);

    // Label
    const label = document.createElement('div');
    label.className = 'drone-marker-label';
    label.style.cssText = 'text-align:center;font-size:10px;font-weight:bold;color:white;text-shadow:0 1px 3px rgba(0,0,0,0.8);margin-top:2px;';
    label.textContent = drone.uavId;

    el.appendChild(circle);
    el.appendChild(label);
    return el;
  }

  /** Update existing marker DOM in-place — no innerHTML, only style/transform changes */
  function updateMarkerElement(el: HTMLDivElement, drone: MapDrone, isSelected: boolean) {
    const { color, borderColor } = getMarkerColors(drone, isSelected);
    const size = isSelected ? 40 : 32;

    const circle = el.querySelector('.drone-marker-circle') as HTMLDivElement | null;
    if (circle) {
      circle.style.width = `${size}px`;
      circle.style.height = `${size}px`;
      circle.style.background = color;
      circle.style.borderColor = borderColor;
      circle.style.animation = isSelected ? 'pulse 1.5s infinite' : 'none';

      // Update SVG rotation — use cumulative angle to prevent 359°→0° snap-back
      const svg = circle.querySelector('svg') as SVGElement | null;
      if (svg) {
        const cumAngle = getCumulativeAngle(drone.uavId, drone.heading ?? 0);
        svg.style.transform = `rotate(${cumAngle}deg)`;
        // Ensure transition is always set (may be lost if browser resets inline styles)
        if (!svg.style.transition) {
          svg.style.transition = 'transform 0.1s linear';
          svg.style.willChange = 'transform';
        }
      }
    }
  }

  const updateMarkers = useCallback(() => {
    if (!map.current) return;

    const currentIds = new Set(drones.map(d => d.uavId));
    
    // 移除不存在的标记
    droneMarkersRef.current.forEach((entry, id) => {
      if (!currentIds.has(id)) {
        entry.marker.remove();
        droneMarkersRef.current.delete(id);
      }
    });

    // 添加/更新标记
    drones.forEach(drone => {
      if (drone.lat == null || drone.lng == null) return;

      const isSelected = selectedDroneIds ? selectedDroneIds.has(drone.uavId) : drone.uavId === selectedDroneId;
      const existing = droneMarkersRef.current.get(drone.uavId);

      if (existing) {
        // DOM reuse: update position + style in-place (no innerHTML)
        existing.marker.setLngLat([drone.lng, drone.lat]);
        updateMarkerElement(existing.element, drone, isSelected);
        // Update open popup: refresh content AND move to drone's current position
        if (existing.popup.isOpen()) {
          existing.popup.setLngLat([drone.lng, drone.lat]);
          existing.popup.setHTML(createPopupHTML(drone));
        }
      } else {
        // Create new marker with structured DOM
        const el = createMarkerElement(drone, isSelected);

        const popup = new maplibregl.Popup({
          offset: 25,
          closeButton: true,
          closeOnClick: false,
          maxWidth: '280px',
        }).setHTML(createPopupHTML(drone));

        popup.on('open', () => {
          startPopupAutoClose(drone.uavId);
          setTimeout(() => {
            const popupEl = popup.getElement();
            if (popupEl) {
              popupEl.addEventListener('mouseenter', () => clearPopupAutoClose(drone.uavId));
              popupEl.addEventListener('mouseleave', () => startPopupAutoClose(drone.uavId));
            }
          }, 50);
        });

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([drone.lng, drone.lat])
          .addTo(map.current!);

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const currentSelectedIds = selectedDroneIdsRef.current;
          const currentSelectedId = selectedDroneIdRef.current;
          const isMultiSelect = !!currentSelectedIds;

          if (isMultiSelect) {
            popup.remove();
          } else {
            if (currentSelectedId === drone.uavId) {
              popup.remove();
            } else {
              droneMarkersRef.current.forEach((entry, id) => {
                if (id !== drone.uavId && entry.popup.isOpen()) {
                  entry.popup.remove();
                }
              });
              if (map.current && !popup.isOpen()) {
                popup.addTo(map.current);
                popup.setLngLat([drone.lng, drone.lat]);
              }
            }
          }
          onDroneClickRef.current?.(drone.uavId);
        });

        droneMarkersRef.current.set(drone.uavId, { marker, popup, element: el });
      }
    });
  }, [drones, selectedDroneId, selectedDroneIds, startPopupAutoClose, clearPopupAutoClose]);

  function createPopupHTML(drone: MapDrone): string {
    const isOnline = drone.onlineStatus === true;
    const isArmed = drone.armed === true;
    // Three states: armed (green), disarmed (blue), offline (gray)
    const statusColor = !isOnline ? '#64748b' : isArmed ? '#22c55e' : '#3b82f6';
    const statusText = !isOnline ? '离线' : isArmed ? '已解锁' : '未解锁';
    return `
      <div style="background: linear-gradient(135deg, rgba(30, 58, 138, 0.95), rgba(59, 130, 246, 0.9)); padding: 12px; border-radius: 8px; min-width: 200px; color: white; font-family: system-ui, sans-serif; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 8px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>
          <h3 style="margin: 0; font-size: 14px; font-weight: bold;">${drone.uavId}</h3>
          <span style="margin-left: auto; background: ${statusColor}; padding: 2px 8px; border-radius: 4px; font-size: 11px;">
            ${statusText}
          </span>
        </div>
        <div style="display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 12px;">
          ${drone.battery != null ? `<span style="opacity: 0.8;">电量</span><span>${drone.battery.toFixed(1)}%</span>` : ''}
          <span style="opacity: 0.8;">高度</span><span>${drone.altitude != null ? drone.altitude.toFixed(2) + 'm' : 'N/A'}</span>
          <span style="opacity: 0.8;">位置</span><span>${drone.lat?.toFixed(4)}, ${drone.lng?.toFixed(4)}</span>
          ${drone.owner ? `<span style="opacity: 0.8;">操作员</span><span>${drone.owner}</span>` : ''}
          ${drone.teamName ? `<span style="opacity: 0.8;">所属小队</span><span>${drone.teamName}</span>` : ''}
          ${drone.teamLeader ? `<span style="opacity: 0.8;">队长</span><span>${drone.teamLeader}</span>` : ''}
        </div>
      </div>
    `;
  }

  // 初始化（与 Observer 视图一致）
  useEffect(() => {
    initMap().catch(console.error);
    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 更新标记
  useEffect(() => {
    if (map.current) {
      updateMarkers();
    }
  }, [drones, selectedDroneId, selectedDroneIds, updateMarkers]);

  // 当 selectedDroneId 从外部变化时（如左侧列表点击），自动打开该无人机的弹窗（不自动飞行聚焦，定位功能已独立为按钮）
  const prevSelectedRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    // 初始化时跳过
    if (prevSelectedRef.current === undefined) {
      prevSelectedRef.current = selectedDroneId;
      return;
    }
    // 只在值实际变化时触发
    if (selectedDroneId === prevSelectedRef.current) return;
    prevSelectedRef.current = selectedDroneId;

    if (!selectedDroneId || !map.current) return;
    const entry = droneMarkersRef.current.get(selectedDroneId);
    if (!entry) return;
    // 如果弹窗已经打开则不重复操作
    if (entry.popup.isOpen()) return;
    // 关闭其他弹窗
    droneMarkersRef.current.forEach((e, id) => {
      if (id !== selectedDroneId && e.popup.isOpen()) e.popup.remove();
    });
    // 打开当前弹窗
    if (map.current) {
      entry.popup.addTo(map.current);
      entry.popup.setLngLat(entry.marker.getLngLat());
    }
  }, [selectedDroneId]);

  // 定位模式：一次性飞到指定无人机位置（locateDroneCounter 变化时触发）
  useEffect(() => {
    if (!locateDroneId || !map.current || locateDroneCounter === 0) return;
    const drone = drones.find(d => d.uavId === locateDroneId);
    if (!drone || drone.lat == null || drone.lng == null) return;
    map.current.flyTo({ center: [drone.lng, drone.lat], zoom: 14, duration: 800 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locateDroneCounter, locateDroneId]);

  // 追随模式：持续跟踪指定无人机，视野随其移动
  useEffect(() => {
    if (!followDroneId || !map.current) return;
    const drone = drones.find(d => d.uavId === followDroneId);
    if (!drone || drone.lat == null || drone.lng == null) return;
    map.current.easeTo({ center: [drone.lng, drone.lat], duration: 300 });
  }, [followDroneId, drones]);

  // 用户拖拽/交互地图时退出追随模式
  useEffect(() => {
    if (!map.current) return;
    const m = map.current;
    const exitFollow = () => { onFollowExitRef.current?.(); };
    m.on('dragstart', exitFollow);
    return () => { m.off('dragstart', exitFollow); };
  }, []);

  // resize 地图 - 响应面板折叠/展开
  useEffect(() => {
    if (map.current) {
      setTimeout(() => map.current?.resize(), 100);
      setTimeout(() => map.current?.resize(), 300);
      setTimeout(() => map.current?.resize(), 600);
    }
  }, [droneListCollapsed, showDroneList]);

  // Home marker with flashing dot effect
  useEffect(() => {
    if (!map.current) return;
    // Remove existing home marker
    if (homeMarkerRef.current) {
      homeMarkerRef.current.remove();
      homeMarkerRef.current = null;
    }
    if (!homeMarker) return;
    // Create flashing home marker element
    const el = document.createElement('div');
    el.className = 'home-marker-flash';
    el.innerHTML = `
      <div style="
        width: 24px; height: 24px;
        background: #14b8a6;
        border: 3px solid #f0fdfa;
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 0 12px rgba(20, 184, 166, 0.8);
        animation: homeFlash 0.8s ease-in-out infinite;
      ">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
          <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
        </svg>
      </div>
      <div style="text-align: center; font-size: 9px; font-weight: bold; color: #14b8a6; text-shadow: 0 1px 3px rgba(0,0,0,0.8); margin-top: 2px;">Home</div>
    `;
    // Add keyframe animation via style tag if not already present
    if (!document.getElementById('home-flash-style')) {
      const style = document.createElement('style');
      style.id = 'home-flash-style';
      style.textContent = `
        @keyframes homeFlash {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.3); }
        }
      `;
      document.head.appendChild(style);
    }
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([homeMarker.lng, homeMarker.lat])
      .addTo(map.current);
    homeMarkerRef.current = marker;
    // Fly to home marker
    map.current.flyTo({ center: [homeMarker.lng, homeMarker.lat], zoom: 10, duration: 1000 });
    return () => {
      if (homeMarkerRef.current) {
        homeMarkerRef.current.remove();
        homeMarkerRef.current = null;
      }
    };
  }, [homeMarker]);

  // Rally point markers
  useEffect(() => {
    if (!map.current) return;
    const currentIds = new Set(rallyPoints.map(rp => rp.id));
    // Remove markers for rally points no longer present
    rallyMarkersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        rallyMarkersRef.current.delete(id);
      }
    });
    // Add/update rally point markers
    const SERVICE_COLORS: Record<number, string> = { 0: '#f59e0b', 1: '#22c55e', 2: '#f97316', 3: '#8b5cf6' };
    const SERVICE_LABELS: Record<number, string> = { 0: '\u505c\u673a', 1: '\u5145\u7535', 2: '\u7ef4\u4fee', 3: '\u8865\u7ed9' };
    rallyPoints.forEach(rp => {
      if (rp.latitude == null || rp.longitude == null) return;
      const color = SERVICE_COLORS[rp.serviceType] || '#f59e0b';
      const serviceLabel = SERVICE_LABELS[rp.serviceType] || '';
      const existing = rallyMarkersRef.current.get(rp.id);
      if (existing) {
        existing.setLngLat([rp.longitude, rp.latitude]);
        const el = existing.getElement();
        if (el) el.innerHTML = createRallyMarkerHTML(rp.name, color, serviceLabel, rp.currentOccupancy, rp.capacity);
      } else {
        const el = document.createElement('div');
        el.className = 'rally-point-marker';
        el.innerHTML = createRallyMarkerHTML(rp.name, color, serviceLabel, rp.currentOccupancy, rp.capacity);
        const popup = new maplibregl.Popup({ offset: 25, closeButton: true, closeOnClick: true, maxWidth: '220px' })
          .setHTML(`<div style="background:#1e293b;padding:10px;border-radius:6px;color:white;font-size:12px;">
            <div style="font-weight:bold;margin-bottom:4px;">${rp.name}</div>
            <div>\u7c7b\u578b: ${serviceLabel}</div>
            <div>\u5bb9\u91cf: ${rp.currentOccupancy}/${rp.capacity}</div>
            <div>\u72b6\u6001: ${rp.status === 1 ? '\u542f\u7528' : rp.status === 2 ? '\u7ef4\u62a4\u4e2d' : '\u7981\u7528'}</div>
            <div style="font-size:10px;color:#94a3b8;margin-top:4px;">${rp.latitude.toFixed(6)}, ${rp.longitude.toFixed(6)}</div>
          </div>`);
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([rp.longitude, rp.latitude])
          .setPopup(popup)
          .addTo(map.current!);
        rallyMarkersRef.current.set(rp.id, marker);
      }
    });
    // Add rally marker styles if not present
    if (!document.getElementById('rally-marker-style')) {
      const style = document.createElement('style');
      style.id = 'rally-marker-style';
      style.textContent = `
        .rally-point-marker { cursor: pointer; }
        .rally-point-marker:hover { transform: scale(1.1); }
      `;
      document.head.appendChild(style);
    }
    return () => {
      rallyMarkersRef.current.forEach(m => m.remove());
      rallyMarkersRef.current.clear();
    };
  }, [rallyPoints]);

  function createRallyMarkerHTML(name: string, color: string, serviceLabel: string, occupancy: number, capacity: number): string {
    return `
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div style="width:28px;height:28px;background:${color};border:2px solid white;border-radius:6px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.4);">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M14 6V4h-4v2H2v16h20V6h-8zM6 18H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V8h2v2zm6 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V8h2v2zm6 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V8h2v2z"/></svg>
        </div>
        <div style="text-align:center;font-size:9px;font-weight:bold;color:${color};text-shadow:0 1px 3px rgba(0,0,0,0.8);margin-top:1px;max-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</div>
        <div style="font-size:8px;color:#94a3b8;text-shadow:0 1px 2px rgba(0,0,0,0.8);">${serviceLabel} ${occupancy}/${capacity}</div>
      </div>
    `;
  }

  // ResizeObserver 确保地图容器尺寸变化时自动resize
  useEffect(() => {
    if (!mapContainer.current) return;
    const observer = new ResizeObserver(() => {
      if (map.current) {
        map.current.resize();
      }
    });
    observer.observe(mapContainer.current);
    return () => observer.disconnect();
  }, []);

  // When switching back from 3D to 2D, re-initialize the MapLibre map
  useEffect(() => {
    if (!is3DMode) {
      // Re-init MapLibre map when switching back to 2D
      initMap(tileSource);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [is3DMode]);

  // 对无人机排序：在线优先
  const sortedDrones = [...drones].sort((a, b) => {
    const aOnline = a.onlineStatus === true ? 1 : 0;
    const bOnline = b.onlineStatus === true ? 1 : 0;
    if (aOnline !== bOnline) return bOnline - aOnline;
    const aFlying = a.flightStatus === 'FLYING' ? 1 : 0;
    const bFlying = b.flightStatus === 'FLYING' ? 1 : 0;
    return bFlying - aFlying;
  });

  return (
    <div className={`flex h-full ${className}`}>
      {/* 地图区域 */}
      <div className="flex-1 relative">
        {/* AMap 3D mode */}
        {is3DMode && (
          <Suspense fallback={
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900 text-slate-400 text-sm">
              加载3D地图中...
            </div>
          }>
            <AMap3DPanel
              drones={drones}
              selectedDroneId={selectedDroneId}
              selectedDroneIds={selectedDroneIds}
              onDroneClick={onDroneClick}
              onMapClick={onMapClick}
              className="absolute inset-0"
            />
          </Suspense>
        )}

        {/* MapLibre 2D mode */}
        <div
          ref={mapContainer}
          className="absolute inset-0 w-full h-full"
          style={{ minHeight: '100%', display: is3DMode ? 'none' : 'block' }}
        />

        {/* 地图错误提示（参考 Observer 视图） */}
        {!is3DMode && mapError && (
          <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 bg-red-900/90 backdrop-blur-sm rounded-lg px-4 py-2 text-white text-xs flex items-center gap-2 max-w-xs shadow-lg border border-red-700">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <div>
              <div className="font-semibold">{mapError}</div>
              {mapErrorDetails && <div className="text-red-300 mt-0.5">{mapErrorDetails}</div>}
            </div>
          </div>
        )}

        {/* 地图控制按钮 */}
        <div className="absolute top-2 left-2 z-10 flex flex-col gap-1" style={{ zIndex: 15 }}>
          <Button
            size="sm"
            variant="outline"
            className="bg-slate-800/80 border-slate-600 text-white hover:bg-slate-700/80 text-xs"
            onClick={focusOnDrones}
          >
            <Locate className="w-3 h-3 mr-1" />聚焦无人机
          </Button>
          {/* 2D/3D toggle - switches to AMap 3D map */}
          <Button
            size="sm"
            variant="outline"
            className={`border-slate-600 text-white hover:bg-slate-700/80 text-xs ${is3DMode ? 'bg-indigo-700/80 border-indigo-500' : 'bg-slate-800/80'}`}
            onClick={() => setIs3DMode(!is3DMode)}
          >
            {is3DMode ? <><MapIcon className="w-3 h-3 mr-1" />二维地图</> : <><Globe className="w-3 h-3 mr-1" />高德3D</>}
          </Button>
          <div className="relative">
            <Button
              size="sm"
              variant="outline"
              className="bg-slate-800/80 border-slate-600 text-white hover:bg-slate-700/80 text-xs"
              onClick={() => setShowTileSelector(!showTileSelector)}
            >
              <Layers className="w-3 h-3 mr-1" />地图源
            </Button>
            {showTileSelector && (
              <div className="absolute left-0 top-full mt-1 bg-slate-800 border border-slate-600 rounded shadow-lg z-20">
                {(Object.keys(TILE_SOURCES) as TileSourceKey[]).map(key => (
                  <button
                    key={key}
                    className={`block w-full text-left px-3 py-1.5 text-xs text-white hover:bg-slate-700 ${
                      tileSource === key ? 'bg-slate-700' : ''
                    }`}
                    onClick={() => changeTileSource(key)}
                  >
                    {TILE_SOURCES[key].name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Phase 2: GPU Symbol Layer for high-performance drone rendering (2D mode only) */}
        {!is3DMode && useSymbolLayer && (
          <DroneLayer
            map={map.current}
            drones={drones.filter((d): d is MapDrone & DroneFeature => d.lat != null && d.lng != null).map(d => ({
              uavId: d.uavId,
              lat: d.lat!,
              lng: d.lng!,
              altitude: d.altitude ?? 0,
              heading: d.heading ?? 0,
              flightStatus: d.flightStatus || 'IDLE',
              battery: d.battery,
              onlineStatus: d.onlineStatus === true,
              armed: d.armed,
            }))}
            selectedDroneId={selectedDroneId}
            clusterEnabled={drones.length > 50}
            onDroneClick={onDroneClick}
          />
        )}

        {/* 统计信息 (2D mode only, 3D has its own stats) */}
        {!is3DMode && (
          <div className="absolute bottom-6 left-2 z-10 bg-slate-800/80 rounded px-2 py-1 text-xs text-slate-300">
            共 {drones.length} 架 | 在线 {drones.filter(d => d.onlineStatus === true).length} | 飞行中 {drones.filter(d => d.flightStatus === 'FLYING').length}
          </div>
        )}
      </div>

      {/* 无人机列表侧边栏 */}
      {showDroneList && (
        <div className={`${droneListCollapsed ? 'w-0 overflow-hidden' : 'w-56'} bg-slate-800 border-l border-slate-700 flex flex-col transition-all duration-300`}>
          <div className="px-2 py-1.5 border-b border-slate-700 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1">
              <Plane className="w-3 h-3" />无人机列表
            </span>
            <button
              className="text-slate-400 hover:text-white text-xs"
              onClick={() => setDroneListCollapsed(!droneListCollapsed)}
            >
              {droneListCollapsed ? '展开' : '收起'}
            </button>
          </div>
          <VirtualDroneList
            drones={sortedDrones}
            selectedDroneId={selectedDroneId}
            onDroneClick={onDroneClick}
          />

          {/* 事件日志滚动区域 */}
          {showEventLog && eventLogs.length > 0 && (
            <div className="border-t border-slate-700 max-h-40 overflow-y-auto">
              <div className="px-2 py-1 text-xs font-semibold text-slate-400 flex items-center gap-1 sticky top-0 bg-slate-800">
                <Activity className="w-3 h-3" />事件日志
              </div>
              <div className="px-1.5 pb-1.5 space-y-0.5">
                {eventLogs.map(log => (
                  <div key={log.id} className="text-[10px] p-1 rounded bg-slate-700/50 text-slate-300">
                    <span className="text-slate-500">{log.time}</span>
                    <span className="ml-1">{log.detail}</span>
                    {log.result && (
                      <Badge className={`ml-1 text-[9px] px-0.5 py-0 ${log.result === 'SUCCESS' ? 'bg-green-600' : 'bg-red-600'}`}>
                        {log.result === 'SUCCESS' ? '成功' : '失败'}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
