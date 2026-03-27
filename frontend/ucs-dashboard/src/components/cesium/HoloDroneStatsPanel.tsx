/**
 * Holographic Drone Statistics Panel - Phase 4
 * Top-left: stat cards + ECharts pie/bar chart toggle
 * Matches HTML prototype style with card/bar/pie switch buttons
 */
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { MapDrone } from '../MapPanel';

// Dynamically import echarts to avoid SSR issues
let echarts: typeof import('echarts') | null = null;
import('echarts').then(mod => { echarts = mod; });

interface HoloDroneStatsPanelProps {
  drones: MapDrone[];
}

type ChartMode = 'card' | 'bar' | 'pie';

export function HoloDroneStatsPanel({ drones }: HoloDroneStatsPanelProps) {
  const [chartMode, setChartMode] = useState<ChartMode>('card');
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<ReturnType<typeof import('echarts')['init']> | null>(null);

  const stats = useMemo(() => {
    const total = drones.length;
    const online = drones.filter(d => d.onlineStatus === true).length;
    const flying = drones.filter(d => d.onlineStatus === true && d.armed === true).length;
    const offline = total - online;
    const lowBattery = drones.filter(d => (d.battery ?? 100) < 20).length;
    return { total, online, flying, offline, lowBattery };
  }, [drones]);

  const updateChart = useCallback((mode: ChartMode) => {
    if (!chartRef.current || !echarts) return;

    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);
    }
    const chart = chartInstanceRef.current;

    if (mode === 'bar') {
      chart.setOption({
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'axis',
          backgroundColor: 'rgba(8, 15, 42, 0.9)',
          borderColor: 'rgba(82, 168, 255, 0.5)',
          textStyle: { color: '#fff', fontSize: 11 },
        },
        grid: { top: 10, bottom: 20, left: 30, right: 10 },
        xAxis: {
          type: 'category',
          data: ['在线', '飞行中', '离线', '低电量'],
          axisLabel: { color: '#a0cfff', fontSize: 10 },
          axisLine: { lineStyle: { color: 'rgba(82, 168, 255, 0.3)' } },
        },
        yAxis: {
          type: 'value',
          axisLabel: { color: '#a0cfff', fontSize: 10 },
          splitLine: { lineStyle: { color: 'rgba(82, 168, 255, 0.1)' } },
        },
        series: [{
          data: [stats.online, stats.flying, stats.offline, stats.lowBattery],
          type: 'bar',
          itemStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: '#52a8ff' },
                { offset: 1, color: 'rgba(82, 168, 255, 0.3)' },
              ],
            },
          },
        }],
      }, true);
    } else if (mode === 'pie') {
      chart.setOption({
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'item',
          backgroundColor: 'rgba(8, 15, 42, 0.9)',
          borderColor: 'rgba(82, 168, 255, 0.5)',
          textStyle: { color: '#fff', fontSize: 11 },
        },
        series: [{
          type: 'pie',
          radius: ['35%', '65%'],
          center: ['50%', '50%'],
          label: {
            color: '#a0cfff',
            fontSize: 10,
          },
          data: [
            { value: stats.online, name: '在线', itemStyle: { color: '#00ff7f' } },
            { value: stats.flying, name: '飞行中', itemStyle: { color: '#52a8ff' } },
            { value: stats.offline, name: '离线', itemStyle: { color: '#ff4d4f' } },
            { value: stats.lowBattery, name: '低电量', itemStyle: { color: '#ffd700' } },
          ],
        }],
      }, true);
    }
  }, [stats]);

  useEffect(() => {
    if (chartMode !== 'card') {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => updateChart(chartMode), 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [chartMode, updateChart]);

  // Cleanup chart on unmount
  useEffect(() => {
    return () => {
      chartInstanceRef.current?.dispose();
    };
  }, []);

  return (
    <div>
      {/* Header with switch buttons */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <div style={{ fontSize: '12px', color: '#a0cfff', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#52a8ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          态势总览
        </div>
        <div style={{ display: 'flex', gap: '3px' }}>
          {(['card', 'bar', 'pie'] as ChartMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setChartMode(mode)}
              style={{
                padding: '2px 6px',
                background: chartMode === mode ? 'rgba(82, 168, 255, 0.3)' : 'rgba(82, 168, 255, 0.1)',
                border: `1px solid ${chartMode === mode ? '#52a8ff' : 'rgba(82, 168, 255, 0.3)'}`,
                borderRadius: '3px',
                fontSize: '10px',
                color: chartMode === mode ? '#fff' : '#a0cfff',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {mode === 'card' ? '卡片' : mode === 'bar' ? '柱状图' : '饼图'}
            </button>
          ))}
        </div>
      </div>

      {/* Card view */}
      {chartMode === 'card' && (
        <div style={{ display: 'flex', gap: '8px' }}>
          <StatCard label="总机数" value={stats.total} />
          <StatCard label="在线" value={stats.online} colorClass="online" />
          <StatCard label="飞行中" value={stats.flying} colorClass="flying" />
          <StatCard label="离线" value={stats.offline} colorClass="offline" />
        </div>
      )}

      {/* Chart view */}
      <div
        ref={chartRef}
        style={{
          width: '100%',
          height: '120px',
          marginTop: chartMode !== 'card' ? '8px' : '0',
          display: chartMode !== 'card' ? 'block' : 'none',
        }}
      />
    </div>
  );
}

function StatCard({ label, value, colorClass }: { label: string; value: number; colorClass?: string }) {
  const numColor = colorClass === 'online' ? '#00ff7f'
    : colorClass === 'flying' ? '#52a8ff'
    : colorClass === 'offline' ? '#ff4d4f'
    : '#fff';

  return (
    <div
      style={{
        flex: 1,
        background: 'rgba(82, 168, 255, 0.08)',
        border: '1px solid rgba(82, 168, 255, 0.15)',
        borderRadius: '4px',
        padding: '4px 2px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '18px', fontWeight: 'bold', color: numColor, lineHeight: 1, marginBottom: '2px' }}>
        {value}
      </div>
      <div style={{ fontSize: '9px', color: '#a0cfff', lineHeight: 1 }}>{label}</div>
    </div>
  );
}

export default HoloDroneStatsPanel;
