/**
 * T-39: 前端地图提供商配置化
 *
 * 将地图瓦片源配置从组件硬编码提取为独立配置文件，
 * 支持通过环境变量或配置切换地图提供商（高德/Google/Mapbox/OSM）。
 *
 * 与后端 T-30 MapProviderStrategy 对应：
 * - 后端负责瓦片代理（避免前端直连第三方暴露API Key）
 * - 前端负责根据配置选择使用哪个提供商的瓦片
 */

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

/** 支持的地图提供商类型 */
export type MapProviderKey = 'amap' | 'google' | 'mapbox' | 'osm' | 'carto';

/** 地图瓦片样式 */
export type MapStyleKey = 'normal' | 'satellite' | 'dark' | 'terrain';

/** 坐标系类型 */
export type CoordinateSystem = 'GCJ02' | 'WGS84';

/** 单个地图提供商的配置 */
export interface MapProviderConfig {
  /** 提供商标识 */
  key: MapProviderKey;
  /** 显示名称 */
  displayName: string;
  /** 坐标系 */
  coordinateSystem: CoordinateSystem;
  /** 最大缩放级别 */
  maxZoom: number;
  /** 支持的样式列表 */
  styles: MapStyleKey[];
  /** 根据样式获取瓦片 URL（通过后端代理或直连） */
  getTileUrl: (style: MapStyleKey) => string[];
  /** 地图归属信息 */
  attribution: string;
}

/**
 * 所有地图提供商配置
 * 高德和Google通过后端代理访问（隐藏API Key），OSM/Carto直连
 */
export const MAP_PROVIDERS: Record<MapProviderKey, MapProviderConfig> = {
  amap: {
    key: 'amap',
    displayName: '高德地图',
    coordinateSystem: 'GCJ02',
    maxZoom: 18,
    styles: ['normal', 'satellite'],
    getTileUrl: (style: MapStyleKey) => {
      const styleCode = style === 'satellite' ? '6' : '7';
      return [`${API_BASE}/api/v1/map/tiles/{z}/{x}/{y}.png?style=${styleCode}`];
    },
    attribution: '&copy; <a href="https://www.amap.com/">高德地图</a>',
  },

  google: {
    key: 'google',
    displayName: 'Google Maps',
    coordinateSystem: 'WGS84',
    maxZoom: 21,
    styles: ['normal', 'satellite', 'terrain'],
    getTileUrl: (style: MapStyleKey) => {
      const lyrsMap: Record<string, string> = { normal: 'm', satellite: 's', terrain: 't' };
      const lyrs = lyrsMap[style] || 'm';
      return [`${API_BASE}/api/v1/map/tiles/{z}/{x}/{y}.png?provider=google&lyrs=${lyrs}`];
    },
    attribution: '&copy; Google Maps',
  },

  mapbox: {
    key: 'mapbox',
    displayName: 'Mapbox',
    coordinateSystem: 'WGS84',
    maxZoom: 22,
    styles: ['normal', 'satellite', 'dark'],
    getTileUrl: (style: MapStyleKey) => {
      const styleMap: Record<string, string> = {
        normal: 'streets-v12',
        satellite: 'satellite-streets-v12',
        dark: 'dark-v11',
      };
      const styleId = styleMap[style] || 'streets-v12';
      return [`${API_BASE}/api/v1/map/tiles/{z}/{x}/{y}.png?provider=mapbox&style=${styleId}`];
    },
    attribution: '&copy; <a href="https://www.mapbox.com/">Mapbox</a>',
  },

  osm: {
    key: 'osm',
    displayName: 'OpenStreetMap',
    coordinateSystem: 'WGS84',
    maxZoom: 19,
    styles: ['normal'],
    getTileUrl: () => ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },

  carto: {
    key: 'carto',
    displayName: 'CartoDB',
    coordinateSystem: 'WGS84',
    maxZoom: 19,
    styles: ['normal', 'dark'],
    getTileUrl: (style: MapStyleKey) => {
      const base = style === 'dark' ? 'dark_all' : 'voyager';
      return [
        `https://a.basemaps.cartocdn.com/rastertiles/${base}/{z}/{x}/{y}.png`,
        `https://b.basemaps.cartocdn.com/rastertiles/${base}/{z}/{x}/{y}.png`,
        `https://c.basemaps.cartocdn.com/rastertiles/${base}/{z}/{x}/{y}.png`,
      ];
    },
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
  },
};

/** 默认提供商（可通过环境变量覆盖） */
export const DEFAULT_MAP_PROVIDER: MapProviderKey =
  (import.meta.env.VITE_MAP_PROVIDER as MapProviderKey) || 'amap';

/** 默认样式 */
export const DEFAULT_MAP_STYLE: MapStyleKey =
  (import.meta.env.VITE_MAP_STYLE as MapStyleKey) || 'normal';

/**
 * 获取指定提供商和样式的完整瓦片配置
 * 用于初始化 MapLibre GL 地图
 */
export function getMapTileConfig(
  provider: MapProviderKey = DEFAULT_MAP_PROVIDER,
  style: MapStyleKey = DEFAULT_MAP_STYLE
) {
  const config = MAP_PROVIDERS[provider];
  if (!config) {
    console.warn(`[MapConfig] Unknown provider '${provider}', falling back to 'amap'`);
    return getMapTileConfig('amap', style);
  }

  // If requested style not supported by provider, fall back to 'normal'
  const effectiveStyle = config.styles.includes(style) ? style : 'normal';

  return {
    provider: config.key,
    displayName: config.displayName,
    tiles: config.getTileUrl(effectiveStyle),
    attribution: config.attribution,
    maxZoom: config.maxZoom,
    coordinateSystem: config.coordinateSystem,
    style: effectiveStyle,
  };
}

/**
 * 获取所有可用的提供商列表（用于 UI 下拉选择）
 */
export function getAvailableProviders(): Array<{
  key: MapProviderKey;
  displayName: string;
  styles: MapStyleKey[];
}> {
  return Object.values(MAP_PROVIDERS).map(p => ({
    key: p.key,
    displayName: p.displayName,
    styles: p.styles,
  }));
}
