import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { AriaComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsOption } from 'echarts';
import { useEffect, useMemo, useState } from 'react';
import { prefersReducedMotion } from '@/lib/haptics';

// Tree-shaken ECharts: only the pieces the dashboard uses.
echarts.use([PieChart, BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, AriaComponent, SVGRenderer]);

export interface ChartColors {
  text: string;
  muted: string;
  grid: string;
  axis: string;
  surface: string;
  elevated: string;
  brand: string;
  positive: string;
  negative: string;
  warning: string;
}

function readColors(): ChartColors {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    text: v('--text'),
    muted: v('--text-2'),
    grid: v('--chart-grid'),
    axis: v('--chart-axis'),
    surface: v('--surface'),
    elevated: v('--elevated'),
    brand: v('--brand'),
    positive: v('--positive'),
    negative: v('--negative'),
    warning: v('--warning'),
  };
}

/** Re-reads the CSS tokens whenever the theme attribute flips, so charts follow light/dark. */
export function useChartColors(): ChartColors {
  const [colors, setColors] = useState(readColors);
  useEffect(() => {
    const obs = new MutationObserver(() => setColors(readColors()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return colors;
}

export function baseOption(c: ChartColors): EChartsOption {
  const reduced = prefersReducedMotion();
  return {
    animation: !reduced,
    animationDuration: 700,
    animationEasing: 'cubicOut',
    textStyle: { color: c.muted, fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif' },
    tooltip: {
      backgroundColor: c.elevated,
      borderColor: c.grid,
      borderWidth: 1,
      textStyle: { color: c.text, fontSize: 13 },
      extraCssText: 'border-radius:12px;box-shadow:none;',
      confine: true,
    },
    aria: { enabled: true },
  };
}

export function EChart({
  option,
  height,
  label,
  onEvents,
}: {
  option: EChartsOption;
  height: number;
  label: string;
  onEvents?: Record<string, (params: unknown) => void>;
}) {
  const style = useMemo(() => ({ height, width: '100%' }), [height]);
  return (
    <div role="img" aria-label={label} className="overflow-hidden">
      <ReactEChartsCore echarts={echarts} option={option} style={style} notMerge lazyUpdate opts={{ renderer: 'svg' }} onEvents={onEvents} />
    </div>
  );
}
