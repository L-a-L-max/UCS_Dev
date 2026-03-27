/**
 * Holographic Weather Panel - Phase 4
 * Bottom-right: weather info rows matching HTML prototype style
 * Each row: icon + label on left, value on right
 */

interface WeatherData {
  temperature?: number;
  humidity?: number;
  windSpeed?: number;
  windDirection?: string;
  visibility?: number;
  condition?: string;
  description?: string;
}

interface HoloWeatherPanelProps {
  weather?: WeatherData | null;
}

export function HoloWeatherPanel({ weather }: HoloWeatherPanelProps) {
  const data: WeatherData = weather || {
    temperature: 24,
    humidity: 65,
    windSpeed: 2.3,
    windDirection: 'NE',
    visibility: 15,
    condition: '晴天',
    description: '适合飞行',
  };

  // Determine flight suitability
  const windOk = (data.windSpeed ?? 0) <= 6;
  const visOk = (data.visibility ?? 10) >= 5;
  const flightLabel = windOk && visOk ? '适合飞行' : '不宜飞行';

  const rows = [
    { icon: '☀', label: '当前区域', value: '成都市' },
    { icon: '🌤', label: '天气状况', value: `${data.condition || '未知'} · ${data.description || '微风'}` },
    { icon: '💨', label: '风速', value: `${data.windSpeed ?? '--'}m/s · ${flightLabel}` },
    { icon: '👁', label: '能见度', value: `${data.visibility ?? '--'}km${visOk ? '+' : ''}` },
    { icon: '🌡', label: '温度', value: `${data.temperature ?? '--'}°C` },
  ];

  return (
    <div>
      {rows.map((row, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '12px',
            padding: '6px 0',
            color: '#c0d8ff',
            borderBottom: i < rows.length - 1 ? '1px solid rgba(82, 168, 255, 0.1)' : 'none',
          }}
        >
          <span>
            <span style={{ fontSize: '14px', marginRight: '4px' }}>{row.icon}</span>
            {row.label}
          </span>
          <span>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export default HoloWeatherPanel;
