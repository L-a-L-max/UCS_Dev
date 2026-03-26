import { useRef, useEffect, useCallback } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface RealtimeLineChartProps {
  data: number[];
  label?: string;
  color?: string;
  maxPoints?: number;
  unit?: string;
  className?: string;
}

export function RealtimeLineChart({
  data,
  label = '',
  color = '#00F0FF',
  maxPoints = 60,
  unit = '',
  className,
}: RealtimeLineChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);

  const updateChart = useCallback(() => {
    if (!instanceRef.current) return;

    const displayData = data.slice(-maxPoints);
    const xData = displayData.map((_, i) => `${i}`);

    instanceRef.current.setOption({
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(13, 21, 38, 0.9)',
        borderColor: 'rgba(0, 240, 255, 0.2)',
        textStyle: { color: '#F1F5F9', fontSize: 11 },
        formatter: (params: unknown) => {
          const p = (params as Array<{ value: number }>)[0];
          return `${label}: ${p.value}${unit}`;
        },
      },
      grid: { top: 8, right: 8, bottom: 8, left: 8, containLabel: false },
      xAxis: {
        type: 'category',
        data: xData,
        show: false,
        boundaryGap: false,
      },
      yAxis: {
        type: 'value',
        show: false,
      },
      series: [
        {
          type: 'line',
          data: displayData,
          smooth: true,
          symbol: 'none',
          lineStyle: { color, width: 1.5 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: color.replace(')', ', 0.3)').replace('rgb', 'rgba') || `${color}4D` },
              { offset: 1, color: 'rgba(0, 0, 0, 0)' },
            ]),
          },
        },
      ],
      animation: false,
    });
  }, [data, label, color, maxPoints, unit]);

  useEffect(() => {
    if (!chartRef.current) return;

    if (!instanceRef.current) {
      instanceRef.current = echarts.init(chartRef.current, undefined, { renderer: 'canvas' });
    }

    updateChart();

    const handleResize = () => instanceRef.current?.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [updateChart]);

  useEffect(() => {
    return () => {
      instanceRef.current?.dispose();
      instanceRef.current = null;
    };
  }, []);

  return <div ref={chartRef} className={className} style={{ width: '100%', height: '100%' }} />;
}

export default RealtimeLineChart;
