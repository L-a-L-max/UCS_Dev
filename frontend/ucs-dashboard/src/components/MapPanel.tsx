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
  model?: string;
  owner?: string;
  teamName?: string;
  teamLeader?: string;
}

interface MapPanelProps {
  drones: MapDrone[];
  /** 选中的无人机 ID（高亮显示） */
  selectedDroneId?: string | null;
  /** 多选模式下选中的无人机 ID 集合（所有选中的都高亮闪烁） */
  selectedDroneIds?: Set<string>;
  /** 点击无人机标记时的回调 */
  onDroneClick?: (uavId: string) => void;
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
  onDroneClick,
  className = '',
  showDroneList = true,
  showEventLog = false,
  eventLogs = [],
}: MapPanelProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const droneMarkersRef = useRef<Map<string, { marker: maplibregl.Marker; popup: maplibregl.Popup; element: HTMLDivElement }>>(new Map());
  const popupTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [tileSource, setTileSource] = useState<TileSourceKey>('gaode');
  const [showTileSelector, setShowTileSelector] = useState(false);
  const [droneListCollapsed, setDroneListCollapsed] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapErrorDetails, setMapErrorDetails] = useState<string | null>(null);

  // Fix 6: 弹窗自动关闭逻辑 - 默认8秒后关闭，鼠标移入保持，移出后倒计时关闭
  const POPUP_AUTO_CLOSE_MS = 8000;

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
    const validDrones = drones.filter(d => d.lat && d.lng);
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
      if (!drone.lat || !drone.lng) return;

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
          .setPopup(popup)
          .addTo(map.current!);

        el.addEventListener('click', () => {
          // 多选模式下不显示弹窗，关闭已打开的弹窗
          if (selectedDroneIds) {
            popup.remove();
          }
          onDroneClick?.(drone.uavId);
        });

        droneMarkersRef.current.set(drone.uavId, { marker, popup, element: el });
      }
    });
  }, [drones, selectedDroneId, selectedDroneIds, onDroneClick, startPopupAutoClose, clearPopupAutoClose]);

  function createMarkerHTML(drone: MapDrone, isSelected: boolean): string {
    const isFlying = drone.flightStatus === 'FLYING';
    const isOnline = drone.onlineStatus === true;
    const color = isFlying ? '#22c55e' : isOnline ? '#3b82f6' : '#64748b';
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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
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
    const isFlying = drone.flightStatus === 'FLYING';
    return `
      <div style="background: linear-gradient(135deg, rgba(30, 58, 138, 0.95), rgba(59, 130, 246, 0.9)); padding: 12px; border-radius: 8px; min-width: 200px; color: white; font-family: system-ui, sans-serif; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 8px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>
          <h3 style="margin: 0; font-size: 14px; font-weight: bold;">${drone.uavId}</h3>
          <span style="margin-left: auto; background: ${isFlying ? '#22c55e' : '#64748b'}; padding: 2px 8px; border-radius: 4px; font-size: 11px;">
            ${isFlying ? '飞行中' : '待机'}
          </span>
        </div>
        <div style="display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 12px;">
          ${drone.battery != null ? `<span style="opacity: 0.8;">电量</span><span>${drone.battery}%</span>` : ''}
          <span style="opacity: 0.8;">高度</span><span>${drone.altitude != null ? drone.altitude + 'm' : 'N/A'}</span>
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

  // resize 地图 - 响应面板折叠/展开
  useEffect(() => {
    if (map.current) {
      setTimeout(() => map.current?.resize(), 100);
      setTimeout(() => map.current?.resize(), 300);
      setTimeout(() => map.current?.resize(), 600);
    }
  }, [droneListCollapsed, showDroneList]);

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
        
        {/* 地图控制按钮 */}
        <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
          <Button
            size="sm"
            variant="outline"
            className="bg-slate-800/80 border-slate-600 text-white hover:bg-slate-700/80 text-xs"
            onClick={focusOnDrones}
          >
            <Locate className="w-3 h-3 mr-1" />聚焦无人机
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
                  if (map.current && drone.lat && drone.lng) {
                    map.current.flyTo({ center: [drone.lng, drone.lat], zoom: 14, duration: 800 });
                  }
                }}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-bold text-white">{drone.uavId}</span>
                  <Badge className={`text-[10px] px-1 py-0 ${
                    drone.flightStatus === 'FLYING'
                      ? 'bg-green-600'
                      : drone.onlineStatus === true
                        ? 'bg-blue-600'
                        : 'bg-slate-600'
                  }`}>
                    {drone.flightStatus === 'FLYING' ? '飞行中' : drone.onlineStatus === true ? '在线' : '离线'}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-slate-400">
                  <span className="flex items-center gap-0.5">
                    <Battery className="w-2.5 h-2.5" />
                    {drone.battery != null ? `${drone.battery}%` : 'N/A'}
                  </span>
                  <span>{drone.altitude != null ? `${drone.altitude}m` : ''}</span>
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
