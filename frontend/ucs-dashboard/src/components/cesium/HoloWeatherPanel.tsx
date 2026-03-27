/**
 * Holographic Weather Panel - Phase 5
 * Real geolocation weather API with drone position-based updates
 * Falls back to default data when API unavailable
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { MapDrone } from '../MapPanel';

export interface HoloWeatherInfo {
  temperature?: number;
  humidity?: number;
  windSpeed?: number;
  windDirection?: string;
  visibility?: number;
  condition?: string;
  description?: string;
  locationName?: string;
}

interface HoloWeatherPanelProps {
  weather?: HoloWeatherInfo | null;
  drones?: MapDrone[];
  onLocationChange?: (lat: number, lng: number) => void;
}

const DEFAULT_WEATHER: HoloWeatherInfo = {
  temperature: 24, humidity: 65, windSpeed: 2.3, windDirection: 'NE',
  visibility: 15, condition: '晴天', description: '适合飞行', locationName: '当前区域',
};

export function HoloWeatherPanel({ weather, drones = [], onLocationChange }: HoloWeatherPanelProps) {
  const [localWeather, setLocalWeather] = useState<HoloWeatherInfo>(DEFAULT_WEATHER);
  const [locationName, setLocationName] = useState('定位中...');
  const [loading, setLoading] = useState(false);
  const lastFetchRef = useRef<string>('');

  // Fetch weather from free API based on coordinates
  const fetchWeather = useCallback(async (lat: number, lng: number) => {
    const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    if (key === lastFetchRef.current) return;
    lastFetchRef.current = key;
    setLoading(true);
    try {
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code&timezone=auto`);
      if (res.ok) {
        const data = await res.json();
        const cur = data.current;
        if (cur) {
          const wmoCode = cur.weather_code ?? 0;
          const condition = wmoToCondition(wmoCode);
          setLocalWeather({
            temperature: cur.temperature_2m,
            humidity: cur.relative_humidity_2m,
            windSpeed: cur.wind_speed_10m != null ? cur.wind_speed_10m / 3.6 : undefined,
            windDirection: degToDirection(cur.wind_direction_10m),
            visibility: undefined,
            condition,
            description: getFlightAdvice(cur.wind_speed_10m / 3.6, wmoCode),
          });
        }
      }
    } catch {
      // Use default weather on error
    } finally {
      setLoading(false);
    }
  }, []);

  // Try to get location from drones or geolocation
  useEffect(() => {
    // Priority 1: Use average drone position
    const onlineDrones = drones.filter(d => d.lat != null && d.lng != null && d.onlineStatus);
    if (onlineDrones.length > 0) {
      const avgLat = onlineDrones.reduce((s, d) => s + (d.lat ?? 0), 0) / onlineDrones.length;
      const avgLng = onlineDrones.reduce((s, d) => s + (d.lng ?? 0), 0) / onlineDrones.length;
      setLocationName(`无人机区域 (${avgLat.toFixed(2)}, ${avgLng.toFixed(2)})`);
      fetchWeather(avgLat, avgLng);
      onLocationChange?.(avgLat, avgLng);
      return;
    }

    // Priority 2: Browser geolocation
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocationName(`当前位置 (${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)})`);
          fetchWeather(pos.coords.latitude, pos.coords.longitude);
          onLocationChange?.(pos.coords.latitude, pos.coords.longitude);
        },
        () => {
          // Default to Beijing
          setLocationName('北京 (默认)');
          fetchWeather(39.9, 116.4);
        },
        { timeout: 5000 }
      );
    }
  }, [drones, fetchWeather, onLocationChange]);

  const data = weather || localWeather;
  const windOk = (data.windSpeed ?? 0) <= 6;
  const flightLabel = windOk ? '适合飞行' : '不宜飞行';
  const flightColor = windOk ? '#00ff7f' : '#ff4d4f';

  const rows = [
    { icon: 'loc', label: locationName || '当前区域', value: data.condition || '未知' },
    { icon: 'wind', label: '风速', value: `${(data.windSpeed ?? 0).toFixed(1)}m/s ${data.windDirection || ''}` },
    { icon: 'temp', label: '温度', value: `${data.temperature ?? '--'}°C` },
    { icon: 'hum', label: '湿度', value: `${data.humidity ?? '--'}%` },
    { icon: 'fly', label: '飞行建议', value: data.description || flightLabel, color: flightColor },
  ];

  return (
    <div>
      {loading && <div style={{ fontSize: '9px', color: '#52a8ff', marginBottom: '4px', textAlign: 'center' }}>更新中...</div>}
      {rows.map((row, i) => (
        <div key={i} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: '12px', padding: '5px 0', color: '#c0d8ff',
          borderBottom: i < rows.length - 1 ? '1px solid rgba(82, 168, 255, 0.1)' : 'none',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <WeatherIcon name={row.icon} />
            {row.label}
          </span>
          <span style={{ color: row.color || '#c0d8ff', fontWeight: row.color ? 600 : 400 }}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function WeatherIcon({ name }: { name: string }) {
  const s = { width: 14, height: 14, fill: 'none', stroke: '#52a8ff', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'loc': return <svg {...s} viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>;
    case 'wind': return <svg {...s} viewBox="0 0 24 24"><path d="M9.59 4.59A2 2 0 1111 8H2m10.59 11.41A2 2 0 1014 16H2m15.73-8.27A2.5 2.5 0 1119.5 12H2"/></svg>;
    case 'temp': return <svg {...s} viewBox="0 0 24 24"><path d="M14 14.76V3.5a2.5 2.5 0 00-5 0v11.26a4.5 4.5 0 105 0z"/></svg>;
    case 'hum': return <svg {...s} viewBox="0 0 24 24"><path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"/></svg>;
    case 'fly': return <svg {...s} viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>;
    default: return null;
  }
}

function wmoToCondition(code: number): string {
  if (code === 0) return '晴天';
  if (code <= 3) return '多云';
  if (code <= 49) return '雾';
  if (code <= 59) return '毛毛雨';
  if (code <= 69) return '雨';
  if (code <= 79) return '雪';
  if (code <= 84) return '阵雨';
  if (code <= 94) return '雷暴';
  return '未知';
}

function degToDirection(deg: number): string {
  if (deg == null) return '';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function getFlightAdvice(windMs: number, wmoCode: number): string {
  if (windMs > 10) return '风速过大，禁止飞行';
  if (windMs > 6) return '风速较大，不宜飞行';
  if (wmoCode >= 80) return '雷暴天气，禁止飞行';
  if (wmoCode >= 60) return '降雨天气，不建议飞行';
  if (wmoCode >= 45) return '能见度低，谨慎飞行';
  return '适合飞行';
}

export default HoloWeatherPanel;
