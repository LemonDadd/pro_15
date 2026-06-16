import { useEffect, useRef, useMemo } from 'react';
import * as echarts from 'echarts';
import type { KlineData } from '../types';

interface KlineChartProps {
  data: KlineData[];
  height?: number;
}

const KlineChart = ({ data, height = 480 }: KlineChartProps) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  const chartData = useMemo(() => {
    const dates: string[] = [];
    const klineData: (number | null)[][] = [];
    const volumeData: { value: number; itemStyle?: { color: string } }[] = [];

    data.forEach((item) => {
      dates.push(item.datetime);
      klineData.push([item.open, item.close, item.low, item.high]);

      const isUp = item.close >= item.open;
      volumeData.push({
        value: item.volume,
        itemStyle: {
          color: isUp ? 'rgba(0, 212, 170, 0.6)' : 'rgba(255, 71, 87, 0.6)',
        },
      });
    });

    return { dates, klineData, volumeData };
  }, [data]);

  useEffect(() => {
    if (!chartRef.current) return;

    chartInstance.current = echarts.init(chartRef.current, 'dark');

    const handleResize = () => {
      chartInstance.current?.resize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chartInstance.current) return;

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      animation: true,
      animationDuration: 300,
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          crossStyle: {
            color: '#2a3449',
          },
        },
        backgroundColor: 'rgba(15, 20, 32, 0.95)',
        borderColor: '#2a3449',
        borderWidth: 1,
        textStyle: {
          color: '#e2e8f0',
          fontSize: 12,
        },
        formatter: (params: any) => {
          if (!params || params.length === 0) return '';
          const kline = params.find((p: any) => p.seriesName === 'K线');
          if (!kline) return '';
          const d = kline.data;
          return `
            <div style="font-family: monospace;">
              <div style="margin-bottom: 4px; color: #94a3b8;">${kline.axisValue}</div>
              <div>开: <span style="color: ${d[1] >= d[0] ? '#00d4aa' : '#ff4757'}">${d[0]}</span></div>
              <div>收: <span style="color: ${d[1] >= d[0] ? '#00d4aa' : '#ff4757'}">${d[1]}</span></div>
              <div>低: <span style="color: #ff4757">${d[2]}</span></div>
              <div>高: <span style="color: #00d4aa">${d[3]}</span></div>
            </div>
          `;
        },
      },
      axisPointer: {
        link: [{ xAxisIndex: 'all' }],
      },
      grid: [
        {
          left: '60px',
          right: '20px',
          top: '20px',
          height: '65%',
        },
        {
          left: '60px',
          right: '20px',
          top: '78%',
          height: '18%',
        },
      ],
      xAxis: [
        {
          type: 'category',
          data: chartData.dates,
          gridIndex: 0,
          axisLine: { lineStyle: { color: '#2a3449' } },
          axisLabel: { show: false },
          axisTick: { show: false },
        },
        {
          type: 'category',
          data: chartData.dates,
          gridIndex: 1,
          axisLine: { lineStyle: { color: '#2a3449' } },
          axisLabel: {
            color: '#64748b',
            fontSize: 10,
          },
          axisTick: { show: false },
        },
      ],
      yAxis: [
        {
          type: 'value',
          gridIndex: 0,
          scale: true,
          splitLine: {
            lineStyle: { color: 'rgba(42, 52, 73, 0.5)', type: 'dashed' },
          },
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: '#64748b',
            fontSize: 10,
            fontFamily: 'monospace',
          },
        },
        {
          type: 'value',
          gridIndex: 1,
          scale: true,
          splitLine: { show: false },
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: '#64748b',
            fontSize: 10,
            formatter: (value: number) => {
              if (value >= 10000) return (value / 10000).toFixed(0) + '万';
              return value.toString();
            },
          },
        },
      ],
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: [0, 1],
          start: 50,
          end: 100,
        },
        {
          type: 'slider',
          xAxisIndex: [0, 1],
          start: 50,
          end: 100,
          height: 20,
          bottom: 5,
          borderColor: '#2a3449',
          fillerColor: 'rgba(0, 212, 255, 0.1)',
          handleStyle: {
            color: '#00d4ff',
          },
          textStyle: {
            color: '#64748b',
          },
        },
      ],
      series: [
        {
          name: 'K线',
          type: 'candlestick',
          data: chartData.klineData,
          xAxisIndex: 0,
          yAxisIndex: 0,
          itemStyle: {
            color: '#00d4aa',
            color0: '#ff4757',
            borderColor: '#00d4aa',
            borderColor0: '#ff4757',
          },
        },
        {
          name: '成交量',
          type: 'bar',
          data: chartData.volumeData,
          xAxisIndex: 1,
          yAxisIndex: 1,
          barWidth: '60%',
        },
      ],
    };

    chartInstance.current.setOption(option, true);
  }, [chartData]);

  return (
    <div
      ref={chartRef}
      style={{ height }}
      className="w-full"
    />
  );
};

export default KlineChart;
