/**
 * Holographic Weather Panel
 * Bottom-right corner - shows weather condition information
 */
import { Cloud, Sun, CloudRain, Wind, Thermometer, Droplets, Eye } from 'lucide-react';

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

function getWeatherIcon(condition?: string) {
  if (!condition) return <Cloud className="w-5 h-5" />;
  const c = condition.toLowerCase();
  if (c.includes('rain') || c.includes('雨')) return <CloudRain className="w-5 h-5" />;
  if (c.includes('sun') || c.includes('晴')) return <Sun className="w-5 h-5" />;
  if (c.includes('cloud') || c.includes('云') || c.includes('阴')) return <Cloud className="w-5 h-5" />;
  if (c.includes('wind') || c.includes('风')) return <Wind className="w-5 h-5" />;
  return <Cloud className="w-5 h-5" />;
}

export function HoloWeatherPanel({ weather }: HoloWeatherPanelProps) {
  // Use provided weather or show placeholder
  const data: WeatherData = weather || {
    temperature: 22,
    humidity: 65,
    windSpeed: 3.2,
    windDirection: 'NE',
    visibility: 10,
    condition: '多云',
    description: '适宜飞行',
  };

  return (
    <div className="p-3">
      {/* Main weather display */}
      <div className="flex items-center gap-3 mb-3">
        <div className="text-cyan-400">
          {getWeatherIcon(data.condition)}
        </div>
        <div>
          <div className="text-2xl font-bold text-white leading-none">
            {data.temperature ?? '--'}°
          </div>
          <div className="text-[10px] text-cyan-300 mt-0.5">{data.condition || '未知'}</div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[9px] text-slate-400">{data.description || ''}</div>
        </div>
      </div>

      {/* Weather details grid */}
      <div className="grid grid-cols-3 gap-2">
        <WeatherItem
          icon={<Droplets className="w-3 h-3" />}
          label="湿度"
          value={`${data.humidity ?? '--'}%`}
        />
        <WeatherItem
          icon={<Wind className="w-3 h-3" />}
          label="风速"
          value={`${data.windSpeed ?? '--'}m/s`}
        />
        <WeatherItem
          icon={<Eye className="w-3 h-3" />}
          label="能见度"
          value={`${data.visibility ?? '--'}km`}
        />
      </div>

      {/* Flight condition indicator */}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[9px] text-slate-400">飞行条件:</span>
        <FlightConditionBar windSpeed={data.windSpeed} visibility={data.visibility} />
      </div>
    </div>
  );
}

function WeatherItem({ icon, label, value }: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-cyan-500/60">{icon}</span>
      <div>
        <div className="text-[8px] text-slate-500">{label}</div>
        <div className="text-[10px] text-slate-300 font-mono">{value}</div>
      </div>
    </div>
  );
}

function FlightConditionBar({ windSpeed, visibility }: { windSpeed?: number; visibility?: number }) {
  // Simple flight condition assessment
  let level: 'good' | 'fair' | 'poor' = 'good';
  let label = '良好';
  let color = '#22c55e';

  if ((windSpeed ?? 0) > 10 || (visibility ?? 10) < 3) {
    level = 'poor';
    label = '不宜';
    color = '#ef4444';
  } else if ((windSpeed ?? 0) > 6 || (visibility ?? 10) < 5) {
    level = 'fair';
    label = '一般';
    color = '#f59e0b';
  }

  return (
    <div className="flex items-center gap-1.5 flex-1">
      <div className="flex-1 h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: level === 'good' ? '100%' : level === 'fair' ? '60%' : '25%',
            background: `linear-gradient(90deg, ${color}, ${color}80)`,
          }}
        />
      </div>
      <span className="text-[9px] font-mono" style={{ color }}>{label}</span>
    </div>
  );
}

export default HoloWeatherPanel;
