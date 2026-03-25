import { useRef, useEffect } from 'react';
import * as echarts from 'echarts/core';
import { PieChart } from 'echarts/charts';
import { TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([PieChart, TooltipComponent, LegendComponent, CanvasRenderer]);

interface DroneStatusPieProps {
  flying: number;
  idle: number;
  offline: number;
  lowBattery: number;
  className?: string;
}

export function DroneStatusPie({ flying, idle, offline, lowBattery, className }: DroneStatusPieProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    if (!instanceRef.current) {
      instanceRef.current = echarts.init(chartRef.current, undefined, { renderer: 'canvas' });
    }

    const chart = instanceRef.current;

    chart.setOption({
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(13, 21, 38, 0.9)',
        borderColor: 'rgba(0, 240, 255, 0.2)',
        textStyle: { color: '#F1F5F9', fontSize: 12 },
      },
      series: [
        {
          type: 'pie',
          radius: ['55%', '80%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 4,
            borderColor: '#0A0F1F',
            borderWidth: 2,
          },
          label: { show: false },
          emphasis: {
            label: { show: true, fontSize: 12, fontWeight: 'bold', color: '#F1F5F9' },
            itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,240,255,0.3)' },
          },
          data: [
            { value: flying, name: '飞行中', itemStyle: { color: '#00F0FF' } },
            { value: idle, name: '待机', itemStyle: { color: '#94A3B8' } },
            { value: offline, name: '离线', itemStyle: { color: '#64748B' } },
            { value: lowBattery, name: '低电量', itemStyle: { color: '#FF3B5C' } },
          ].filter((d) => d.value > 0),
        },
      ],
    });

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [flying, idle, offline, lowBattery]);

  useEffect(() => {
    return () => {
      instanceRef.current?.dispose();
      instanceRef.current = null;
    };
  }, []);

  return <div ref={chartRef} className={className} style={{ width: '100%', height: '100%' }} />;
}

export default DroneStatusPie;
