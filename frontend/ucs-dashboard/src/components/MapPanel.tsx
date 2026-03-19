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
  /** QGC-style map command callback: (lat, lon, commandType) */
  onMapCommand?: (lat: number, lon: number, commandType: string) => void;
  /** 是否有选中的无人机（控制地图点击菜单是否显示） */
  hasDroneSelected?: boolean;
  /** 额外的 CSS 类名 */
  className?: string;
  /** 是否显示无人机列表侧边栏 */
  showDroneList?: boolean;
  /** 是否显示事件日志面板 */
  showEventLog?: boolean;
  /** 事件日志数据 */
  eventLogs?: Array<{ id: number; time: string; detail: string; result?: string }>;
}

export default function MapPanel({
  drones,
  selectedDroneId,
  selectedDroneIds,
  homeMarker,
  rallyPoints = [],
  onDroneClick,
  onMapClick,
  onMapCommand,
  hasDroneSelected = false,
  className = '',
  showDroneList = true,
  showEventLog = false,
  eventLogs = [],
}: MapPanelProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const droneMarkersRef = useRef<Map<string, { marker: maplibregl.Marker; popup: maplibregl.Popup; element: HTMLDivElement }>>(new Map());
  const popupTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const rallyMarkersRef = useRef<Map<number, maplibregl.Marker>>(new Map());

  // 使用 ref 保存最新的回调和状态，避免 marker click listener 中的闭包过期问题
  const onDroneClickRef = useRef(onDroneClick);
  const selectedDroneIdsRef = useRef(selectedDroneIds);
  const selectedDroneIdRef = useRef(selectedDroneId);
  const onMapClickRef = useRef(onMapClick);
  const onMapCommandRef = useRef(onMapCommand);
  const hasDroneSelectedRef = useRef(hasDroneSelected);
  useEffect(() => { onDroneClickRef.current = onDroneClick; }, [onDroneClick]);
  useEffect(() => { selectedDroneIdsRef.current = selectedDroneIds; }, [selectedDroneIds]);
  useEffect(() => { selectedDroneIdRef.current = selectedDroneId; }, [selectedDroneId]);
  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);
  useEffect(() => { onMapCommandRef.current = onMapCommand; }, [onMapCommand]);
  useEffect(() => { hasDroneSelectedRef.current = hasDroneSelected; }, [hasDroneSelected]);
  const homeMarkerRef = useRef<maplibregl.Marker | null>(null);
  const mapClickPopupRef = useRef<maplibregl.Popup | null>(null);
  const [tileSource, setTileSource] = useState<TileSourceKey>('gaode');
  const [showTileSelector, setShowTileSelector] = useState(false);
  const [droneListCollapsed, setDroneListCollapsed] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapErrorDetails, setMapErrorDetails] = useState<string | null>(null);
  // 3D map toggle (Issue 7)
  const [is3DMode, setIs3DMode] = useState(false);
  const amapContainer = useRef<HTMLDivElement>(null);
  const amapInstance = useRef<unknown>(null);
  const amapMarkersRef = useRef<unknown[]>([]);

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
      // Show QGC-style command popup at click location
      const popupEl = document.createElement('div');
      popupEl.innerHTML = `<div style="background:#1e293b;padding:8px 10px;border-radius:8px;color:white;font-size:11px;min-width:160px;">
        <div style="font-size:10px;color:#94a3b8;margin-bottom:4px;text-align:center;">\u70b9\u51fb\u4f4d\u7f6e: ${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
          <button data-cmd="GOTO" style="background:#0891b2;color:white;border:none;border-radius:4px;padding:5px 4px;font-size:10px;cursor:pointer;font-weight:600;">\u2708 \u524d\u5f80</button>
          <button data-cmd="ORBIT" style="background:#6366f1;color:white;border:none;border-radius:4px;padding:5px 4px;font-size:10px;cursor:pointer;font-weight:600;">\u27f3 \u76d8\u65cb</button>
          <button data-cmd="SET_ROI" style="background:#d97706;color:white;border:none;border-radius:4px;padding:5px 4px;font-size:10px;cursor:pointer;font-weight:600;">\u25ce ROI</button>
          <button data-cmd="SET_YAW" style="background:#059669;color:white;border:none;border-radius:4px;padding:5px 4px;font-size:10px;cursor:pointer;font-weight:600;">\u21bb \u504f\u822a</button>
          <button data-cmd="SET_GPS_ORIGIN" style="background:#7c3aed;color:white;border:none;border-radius:4px;padding:5px 4px;font-size:10px;cursor:pointer;font-weight:600;grid-column:span 2;">\u2316 \u8bbe\u7f6e\u539f\u70b9</button>
        </div>
      </div>`;
      popupEl.querySelectorAll('button[data-cmd]').forEach(btn => {
        btn.addEventListener('click', () => {
          const cmd = btn.getAttribute('data-cmd');
          if (cmd) onMapCommandRef.current?.(lat, lng, cmd);
          if (mapClickPopupRef.current) { mapClickPopupRef.current.remove(); mapClickPopupRef.current = null; }
        });
        btn.addEventListener('mouseenter', () => { (btn as HTMLElement).style.opacity = '0.8'; });
        btn.addEventListener('mouseleave', () => { (btn as HTMLElement).style.opacity = '1'; });
      });
      const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '220px' })
        .setLngLat([lng, lat])
        .setDOMContent(popupEl)
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

  // 更新无人机标记
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
      // Use explicit null/undefined check instead of falsy check
      // so that lat=0, lng=0 (default PX4 position before GPS lock) is not filtered out
      if (drone.lat == null || drone.lng == null) return;

      // 支持多选高亮：如果有 selectedDroneIds 则检查是否在集合中，否则用单选 selectedDroneId
      const isSelected = selectedDroneIds ? selectedDroneIds.has(drone.uavId) : drone.uavId === selectedDroneId;

      const existing = droneMarkersRef.current.get(drone.uavId);

      if (existing) {
        // 更新位置
        existing.marker.setLngLat([drone.lng, drone.lat]);
        // 更新样式
        existing.element.innerHTML = createMarkerHTML(drone, isSelected);
        // 更新弹出内容
        existing.popup.setHTML(createPopupHTML(drone));
      } else {
        // 创建新标记
        const el = document.createElement('div');
        el.className = 'drone-marker';
        el.style.cursor = 'pointer';
        el.innerHTML = createMarkerHTML(drone, isSelected);

        const popup = new maplibregl.Popup({
          offset: 25,
          closeButton: true,
          closeOnClick: false,
          maxWidth: '280px',
        }).setHTML(createPopupHTML(drone));

        // Fix 6: 弹窗打开时启动自动关闭定时器，鼠标移入时暂停，移出时重启
        popup.on('open', () => {
          startPopupAutoClose(drone.uavId);
          // 添加鼠标事件监听
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

        // 不使用 marker.setPopup() 避免 MapLibre 自动 toggle popup 行为
        // 改为完全手动控制 popup 显示/隐藏
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const currentSelectedIds = selectedDroneIdsRef.current;
          const currentSelectedId = selectedDroneIdRef.current;
          const isMultiSelect = !!currentSelectedIds;

          if (isMultiSelect) {
            // 多选模式：不显示弹窗，关闭已打开的弹窗
            popup.remove();
          } else {
            // 单选模式：判断是否点击的是当前已选中的无人机
            if (currentSelectedId === drone.uavId) {
              // 再次点击同一个 -> 取消选中，关闭弹窗
              popup.remove();
            } else {
              // 点击新的无人机 -> 关闭所有其他弹窗，打开当前弹窗
              droneMarkersRef.current.forEach((entry, id) => {
                if (id !== drone.uavId && entry.popup.isOpen()) {
                  entry.popup.remove();
                }
              });
              // 显示基本信息弹窗
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

  function createMarkerHTML(drone: MapDrone, isSelected: boolean): string {
    const isOnline = drone.onlineStatus === true;
    const isArmed = drone.armed === true;
    // Three states: armed (green), disarmed/online (blue), offline (gray)
    const color = !isOnline ? '#64748b' : isArmed ? '#22c55e' : '#3b82f6';
    const borderColor = isSelected ? '#f59e0b' : color;
    const size = isSelected ? 40 : 32;

    return `
      <div style="
        width: ${size}px; height: ${size}px;
        background: ${color};
        border: 3px solid ${borderColor};
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        transition: all 0.2s;
        ${isSelected ? 'animation: pulse 1.5s infinite;' : ''}
      ">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="white" style="transform: rotate(${drone.heading != null ? drone.heading : 0}deg); transition: transform 0.5s ease;">
          <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
        </svg>
      </div>
      <div style="
        text-align: center; font-size: 10px; font-weight: bold;
        color: white; text-shadow: 0 1px 3px rgba(0,0,0,0.8);
        margin-top: 2px;
      ">${drone.uavId}</div>
    `;
  }

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

  // 当 selectedDroneId 从外部变化时（如左侧列表点击），自动打开该无人机的弹窗并飞行聚焦
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
    // 飞行到该无人机
    const lngLat = entry.marker.getLngLat();
    map.current.flyTo({ center: [lngLat.lng, lngLat.lat], zoom: 14, duration: 800 });
  }, [selectedDroneId]);

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

  // AMap 3D initialization and drone marker sync (Issue 7)
  useEffect(() => {
    if (!is3DMode) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AMap = (window as any).AMap;
    if (!AMap || !amapContainer.current) return;

    if (!amapInstance.current) {
      const center = drones.length > 0 && drones[0].lat && drones[0].lng
        ? [drones[0].lng, drones[0].lat]
        : [116.397, 39.908];
      const amap = new AMap.Map(amapContainer.current, {
        viewMode: '3D',
        zoom: 14,
        pitch: 50,
        center,
        mapStyle: 'amap://styles/dark',
      });
      amapInstance.current = amap;
    }

    // Sync drone markers to AMap 3D
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const amap = amapInstance.current as any;
    // Clear old markers
    amapMarkersRef.current.forEach((m) => amap.remove(m));
    amapMarkersRef.current = [];

    drones.forEach((drone) => {
      if (drone.lat == null || drone.lng == null) return;
      const isOnline = drone.onlineStatus === true;
      const isFlying = drone.flightStatus === 'FLYING';
      const color = !isOnline ? '#64748b' : isFlying ? '#22c55e' : '#3b82f6';
      const marker = new AMap.Marker({
        position: [drone.lng, drone.lat],
        content: `<div style="background:${color};color:white;font-size:10px;padding:2px 6px;border-radius:4px;white-space:nowrap;border:1px solid rgba(255,255,255,0.3);">${drone.uavId}</div>`,
        offset: new AMap.Pixel(-20, -10),
      });
      amap.add(marker);
      amapMarkersRef.current.push(marker);
    });
  }, [is3DMode, drones]);

  // Cleanup AMap on unmount
  useEffect(() => {
    return () => {
      if (amapInstance.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (amapInstance.current as any).destroy?.();
        amapInstance.current = null;
      }
    };
  }, []);

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
        <div ref={mapContainer} className="absolute inset-0 w-full h-full" style={{ minHeight: '100%' }} />

        {/* 地图错误提示（参考 Observer 视图） */}
        {mapError && (
          <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 bg-red-900/90 backdrop-blur-sm rounded-lg px-4 py-2 text-white text-xs flex items-center gap-2 max-w-xs shadow-lg border border-red-700">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <div>
              <div className="font-semibold">{mapError}</div>
              {mapErrorDetails && <div className="text-red-300 mt-0.5">{mapErrorDetails}</div>}
            </div>
          </div>
        )}
        
        {/* 3D AMap container (Issue 7) */}
        <div
          ref={amapContainer}
          className={`absolute inset-0 w-full h-full ${is3DMode ? 'block' : 'hidden'}`}
          style={{ minHeight: '100%', zIndex: is3DMode ? 2 : 0 }}
        />

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
          {/* 2D/3D toggle (Issue 7) */}
          <Button
            size="sm"
            variant="outline"
            className={`border-slate-600 text-white hover:bg-slate-700/80 text-xs ${is3DMode ? 'bg-indigo-700/80 border-indigo-500' : 'bg-slate-800/80'}`}
            onClick={() => setIs3DMode(!is3DMode)}
          >
            {is3DMode ? <><MapIcon className="w-3 h-3 mr-1" />二维地图</> : <><Globe className="w-3 h-3 mr-1" />三维地图</>}
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

        {/* 统计信息 */}
        <div className="absolute bottom-6 left-2 z-10 bg-slate-800/80 rounded px-2 py-1 text-xs text-slate-300">
          共 {drones.length} 架 | 在线 {drones.filter(d => d.onlineStatus === true).length} | 飞行中 {drones.filter(d => d.flightStatus === 'FLYING').length}
        </div>
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
          <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
            {sortedDrones.map(drone => (
              <div
                key={drone.uavId}
                className={`p-2 rounded cursor-pointer transition-all text-xs ${
                  selectedDroneId === drone.uavId
                    ? 'bg-blue-900/50 border border-blue-500'
                    : 'bg-slate-700/50 border border-slate-600 hover:border-slate-500'
                }`}
                onClick={() => {
                  onDroneClick?.(drone.uavId);
                  // 聚焦到该无人机
                  if (map.current && drone.lat != null && drone.lng != null) {
                    map.current.flyTo({ center: [drone.lng, drone.lat], zoom: 14, duration: 800 });
                  }
                }}
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
            ))}
            {drones.length === 0 && (
              <div className="text-center text-slate-500 py-4 text-xs">暂无无人机数据</div>
            )}
          </div>

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
