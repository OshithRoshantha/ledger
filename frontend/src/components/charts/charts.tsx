import type { EChartsOption } from 'echarts';
import { formatCompact, formatPct, formatRs } from '@/lib/money';
import type { BillsTab, CategoryRow, Overview, PlanTab, TrendsTab } from '@/lib/types';
import { baseOption, EChart, useChartColors, type ChartColors } from './EChart';

type P = { seriesName: string; value: number | null | (number | null)[]; marker: string; name: string; axisValue?: string | number; dataIndex: number };

function axisTip(params: unknown, title?: (p: P) => string, fmt: (v: number, p: P) => string = (v) => formatRs(v, { whole: true })): string {
  const list = (Array.isArray(params) ? params : [params]) as P[];
  const head = title ? title(list[0]) : String(list[0]?.axisValue ?? list[0]?.name ?? '');
  const rows = list
    .filter((p) => p.value !== null && p.value !== undefined && p.seriesName !== '_base')
    .map((p) => `${p.marker} ${p.seriesName}: <b>${fmt(Number(Array.isArray(p.value) ? p.value[1] : p.value), p)}</b>`)
    .join('<br/>');
  return `<div style="font-weight:600;margin-bottom:4px">${head}</div>${rows}`;
}

const compactAxis = (v: number) => formatCompact(v).replace('Rs ', '');

function axes(c: ChartColors, categories: (string | number)[], opts: { interval?: number } = {}): Pick<EChartsOption, 'xAxis' | 'yAxis'> {
  return {
    xAxis: {
      type: 'category',
      data: categories,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: c.grid } },
      axisLabel: { color: c.axis, fontSize: 11, interval: opts.interval ?? 'auto' as unknown as number, hideOverlap: true },
    },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: c.grid } }, axisLabel: { color: c.axis, fontSize: 11, formatter: compactAxis } },
  };
}

const tip = (c: ChartColors) => baseOption(c).tooltip as object;
const legend = (c: ChartColors) => ({ top: 0, left: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: c.muted, fontSize: 12 } });

// ---------------------------------------------------------------- spending donut

export function SpendDonut({ rows, total, mode, onSelect }: { rows: CategoryRow[]; total: number; mode: 'spend' | 'income'; onSelect: (key: string) => void }) {
  const c = useChartColors();
  const data = rows.filter((r) => r.amount > 0);
  const option: EChartsOption = {
    ...baseOption(c),
    tooltip: {
      ...tip(c),
      trigger: 'item',
      formatter: (p: unknown) => {
        const x = p as { name: string; value: number; marker: string; dataIndex: number };
        const r = data[x.dataIndex];
        const share = mode === 'spend' ? r.pct_of_spend : r.pct_of_income;
        return `${x.marker} ${x.name}<br/><b>${formatRs(x.value, { whole: true })}</b> · ${formatPct(share)} of ${mode === 'spend' ? 'spending' : 'income'}`;
      },
    },
    series: [
      {
        type: 'pie',
        radius: ['64%', '90%'],
        padAngle: 2,
        itemStyle: { borderRadius: 6, borderColor: c.surface, borderWidth: 2 },
        label: { show: false },
        emphasis: { scale: true, scaleSize: 6 },
        data: data.map((r) => ({ name: r.name, value: r.amount, itemStyle: { color: r.colour } })),
      },
    ],
  };
  return (
    <div className="relative">
      <EChart
        option={option}
        height={220}
        label={`Spending by category: ${data.map((r) => `${r.name} ${formatPct(mode === 'spend' ? r.pct_of_spend : r.pct_of_income)}`).join(', ')}`}
        onEvents={{ click: (p) => onSelect(data[(p as { dataIndex: number }).dataIndex].key) }}
      />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="label">Spent</span>
        <span className="num text-[22px] font-semibold">{formatCompact(total)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- cash-flow waterfall

export function Waterfall({ steps, onSelect }: { steps: Overview['waterfall']['steps']; onSelect?: (index: number) => void }) {
  const c = useChartColors();
  // invisible base + visible delta bars: the classic waterfall construction
  let running = 0;
  const base: number[] = [];
  const value: { value: number; itemStyle: { color: string } }[] = [];
  for (const s of steps) {
    if (s.kind === 'add') {
      base.push(running);
      value.push({ value: s.amount, itemStyle: { color: c.positive } });
      running += s.amount;
    } else if (s.kind === 'sub') {
      running += s.amount;
      base.push(Math.max(running, 0));
      value.push({ value: -s.amount, itemStyle: { color: s.colour ?? c.negative } });
    } else {
      base.push(Math.min(s.amount, 0));
      value.push({ value: Math.abs(s.amount), itemStyle: { color: s.amount >= 0 ? c.brand : c.negative } });
    }
  }
  const option: EChartsOption = {
    ...baseOption(c),
    grid: { left: 4, right: 12, top: 8, bottom: 4, containLabel: true },
    tooltip: {
      ...tip(c),
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (p: unknown) => {
        const i = (p as P[])[0].dataIndex;
        const s = steps[i];
        return `<b>${s.label}</b><br/>${formatRs(s.amount, { whole: true, signed: s.kind !== 'total' })}`;
      },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: steps.map((s) => s.label),
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: { color: c.text, fontSize: 12, width: 112, overflow: 'truncate' },
    },
    xAxis: { type: 'value', splitLine: { lineStyle: { color: c.grid } }, axisLabel: { color: c.axis, fontSize: 11, formatter: compactAxis } },
    series: [
      { name: '_base', type: 'bar', stack: 'w', data: base, itemStyle: { color: 'transparent' }, emphasis: { disabled: true }, silent: true },
      { name: 'Amount', type: 'bar', stack: 'w', data: value, barMaxWidth: 16, itemStyle: { borderRadius: 4 } },
    ],
  };
  return (
    <EChart
      option={option}
      height={Math.max(180, steps.length * 30 + 20)}
      label={`Cash flow: ${steps.map((s) => `${s.label} ${formatRs(s.amount, { whole: true })}`).join(', ')}`}
      onEvents={onSelect ? { click: (p) => onSelect((p as { dataIndex: number }).dataIndex) } : undefined}
    />
  );
}

// ---------------------------------------------------------------- pace

export function PaceChart({ pace, label }: { pace: TrendsTab['pace']; label: string }) {
  const c = useChartColors();
  const days = Array.from({ length: Math.max(pace.days, pace.previous.length) }, (_, i) => i + 1);
  const option: EChartsOption = {
    ...baseOption(c),
    grid: { left: 8, right: 12, top: 28, bottom: 24, containLabel: true },
    legend: legend(c),
    tooltip: { ...tip(c), trigger: 'axis', formatter: (p: unknown) => axisTip(p, (x) => `Day ${x.axisValue}`) },
    ...axes(c, days, { interval: 6 }),
    series: [
      {
        name: label,
        type: 'line',
        data: pace.current,
        smooth: 0.25,
        symbol: 'none',
        lineStyle: { width: 3, color: c.brand },
        itemStyle: { color: c.brand },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${c.brand}55` }, { offset: 1, color: `${c.brand}00` }] } },
        z: 3,
      },
      ...(pace.prev_label ? [{ name: pace.prev_label, type: 'line' as const, data: pace.previous, smooth: 0.25, symbol: 'none', lineStyle: { width: 2, color: c.muted }, itemStyle: { color: c.muted } }] : []),
      ...(pace.avg3 ? [{ name: '3-cycle avg', type: 'line' as const, data: pace.avg3, smooth: 0.25, symbol: 'none', lineStyle: { width: 1.5, type: 'dashed' as const, color: c.axis }, itemStyle: { color: c.axis } }] : []),
    ],
  };
  const n = pace.current.length;
  return <EChart option={option} height={220} label={`Cumulative spend: ${formatRs(pace.current[n - 1] ?? 0, { whole: true })} by day ${n}.`} />;
}

// ---------------------------------------------------------------- bills

export function BillTrendChart({ series }: { series: BillsTab['trends'] }) {
  const c = useChartColors();
  const shown = series.filter((s) => s.points.some((p) => p.amount));
  const option: EChartsOption = {
    ...baseOption(c),
    grid: { left: 8, right: 12, top: 30 + Math.ceil(series.filter((s) => s.points.some((p) => p.amount)).length / 3) * 18, bottom: 8, containLabel: true },
    legend: { ...legend(c), type: 'plain', right: 0 },
    tooltip: { ...tip(c), trigger: 'axis', formatter: (p: unknown) => axisTip(p) },
    ...axes(c, shown[0]?.points.map((p) => p.label) ?? []),
    series: shown.map((s) => ({
      name: s.name,
      type: 'line' as const,
      data: s.points.map((p) => p.amount),
      connectNulls: true,
      symbolSize: 5,
      lineStyle: { width: s.flag ? 3 : 1.75, color: s.colour },
      itemStyle: { color: s.colour },
    })),
  };
  return <EChart option={option} height={240} label={`Bill amounts over 12 cycles for ${shown.map((s) => s.name).join(', ')}`} />;
}

export function FixedRatioChart({ data }: { data: BillsTab['fixed_ratio'] }) {
  const c = useChartColors();
  const option: EChartsOption = {
    ...baseOption(c),
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: { ...tip(c), trigger: 'axis', formatter: (p: unknown) => axisTip(p, undefined, (v) => `${v.toFixed(0)}%`) },
    ...axes(c, data.series.map((s) => s.label)),
    yAxis: { type: 'value', max: (v: { max: number }) => Math.max(100, Math.ceil(v.max / 10) * 10), splitLine: { lineStyle: { color: c.grid } }, axisLabel: { color: c.axis, fontSize: 11, formatter: '{value}%' } },
    series: [
      {
        name: 'Fixed / income',
        type: 'line',
        data: data.series.map((s) => s.ratio),
        connectNulls: true,
        symbolSize: 6,
        lineStyle: { width: 2.5, color: c.brand },
        itemStyle: { color: c.brand },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: c.warning, type: 'dashed' },
          label: { color: c.warning, formatter: `Target ${data.target}%`, position: 'insideEndTop' },
          data: [{ yAxis: data.target }],
        },
      },
    ],
  };
  return <EChart option={option} height={190} label={data.takeaway} />;
}

// ---------------------------------------------------------------- trends

export function ComboChart({ rows }: { rows: TrendsTab['rows'] }) {
  const c = useChartColors();
  const option: EChartsOption = {
    ...baseOption(c),
    grid: { left: 4, right: 4, top: 36, bottom: 4, containLabel: true },
    legend: legend(c),
    tooltip: {
      ...tip(c),
      trigger: 'axis',
      formatter: (p: unknown) => axisTip(p, undefined, (v, x) => (x.seriesName === 'Savings rate' ? `${v.toFixed(0)}%` : formatRs(v, { whole: true }))),
    },
    xAxis: { type: 'category', data: rows.map((r) => r.short), axisTick: { show: false }, axisLine: { lineStyle: { color: c.grid } }, axisLabel: { color: c.axis, fontSize: 11 } },
    yAxis: [
      { type: 'value', splitLine: { lineStyle: { color: c.grid } }, axisLabel: { color: c.axis, fontSize: 10, formatter: compactAxis } },
      { type: 'value', min: -50, max: 100, splitLine: { show: false }, axisLabel: { color: c.axis, fontSize: 10, formatter: '{value}%' } },
    ],
    series: [
      { name: 'Income', type: 'bar', data: rows.map((r) => r.income), itemStyle: { color: c.positive, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 10, barGap: '15%' },
      { name: 'Spent', type: 'bar', data: rows.map((r) => r.spent), itemStyle: { color: c.negative, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 10 },
      { name: 'Saved', type: 'line', data: rows.map((r) => r.saved), smooth: 0.3, symbolSize: 5, lineStyle: { width: 2.5, color: c.brand }, itemStyle: { color: c.brand }, z: 3 },
      { name: 'Savings rate', type: 'line', yAxisIndex: 1, data: rows.map((r) => r.savings_rate), smooth: 0.3, symbol: 'none', connectNulls: true, lineStyle: { width: 1.5, type: 'dashed', color: c.warning }, itemStyle: { color: c.warning } },
    ],
  };
  return <EChart option={option} height={240} label={`Income vs spending over ${rows.length} cycles`} />;
}

export function MixArea({ mix }: { mix: TrendsTab['mix'] }) {
  const c = useChartColors();
  const option: EChartsOption = {
    ...baseOption(c),
    grid: { left: 4, right: 8, top: 30 + Math.ceil(mix.categories.length / 3) * 18, bottom: 4, containLabel: true },
    legend: { ...legend(c), type: 'plain', right: 0 },
    tooltip: { ...tip(c), trigger: 'axis', formatter: (p: unknown) => axisTip(p) },
    ...axes(c, mix.series.map((s) => s.short)),
    series: mix.categories.map((cat, i) => ({
      name: cat.name,
      type: 'line' as const,
      stack: 'mix',
      symbol: 'none',
      smooth: 0.2,
      lineStyle: { width: 0 },
      areaStyle: { color: cat.colour, opacity: 0.85 },
      itemStyle: { color: cat.colour },
      data: mix.series.map((s) => s.values[i]),
    })),
  };
  return <EChart option={option} height={240} label="Spending mix by category over 12 cycles" />;
}

export function NetworthChart({ data }: { data: TrendsTab['networth'] }) {
  const c = useChartColors();
  const option: EChartsOption = {
    ...baseOption(c),
    grid: { left: 8, right: 12, top: 16, bottom: 8, containLabel: true },
    tooltip: { ...tip(c), trigger: 'axis', formatter: (p: unknown) => axisTip(p) },
    ...axes(c, data.map((d) => d.label)),
    series: [
      {
        name: 'Total saved',
        type: 'line',
        data: data.map((d) => d.cumulative),
        smooth: 0.3,
        symbolSize: 5,
        lineStyle: { width: 3, color: c.positive },
        itemStyle: { color: c.positive },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${c.positive}44` }, { offset: 1, color: `${c.positive}00` }] } },
      },
    ],
  };
  return <EChart option={option} height={190} label={`Cumulative savings: ${formatRs(data[data.length - 1]?.cumulative ?? 0, { whole: true })}`} />;
}

// ---------------------------------------------------------------- plan: forecast cone

export function ConeChart({ f }: { f: PlanTab['forecast'] }) {
  const c = useChartColors();
  const days = Array.from({ length: f.days }, (_, i) => i + 1);
  const band = f.high.map((h, i) => (h === null || f.low[i] === null ? null : h - (f.low[i] as number)));
  const option: EChartsOption = {
    ...baseOption(c),
    grid: { left: 8, right: 12, top: 32, bottom: 24, containLabel: true },
    legend: { ...legend(c), data: ['Actual', 'Likely', 'Low', 'High'] },
    tooltip: { ...tip(c), trigger: 'axis', formatter: (p: unknown) => axisTip(p, (x) => `Day ${x.axisValue}`) },
    ...axes(c, days, { interval: 6 }),
    series: [
      { name: 'Low', type: 'line', data: f.low, stack: 'cone', symbol: 'none', lineStyle: { width: 1, color: c.positive, type: 'dashed' }, itemStyle: { color: c.positive } },
      { name: '_base', type: 'line', data: band, stack: 'cone', symbol: 'none', lineStyle: { width: 0 }, areaStyle: { color: c.brand, opacity: 0.16 }, silent: true, tooltip: { show: false } },
      { name: 'High', type: 'line', data: f.high, symbol: 'none', lineStyle: { width: 1, color: c.negative, type: 'dashed' }, itemStyle: { color: c.negative } },
      { name: 'Likely', type: 'line', data: f.likely, symbol: 'none', lineStyle: { width: 2.5, color: c.brand }, itemStyle: { color: c.brand } },
      { name: 'Actual', type: 'line', data: f.actual, symbol: 'none', lineStyle: { width: 3, color: c.text }, itemStyle: { color: c.text }, z: 4 },
      {
        name: 'Income',
        type: 'line',
        data: [],
        markLine: { silent: true, symbol: 'none', lineStyle: { color: c.warning, type: 'dotted' }, label: { color: c.warning, formatter: 'Income', position: 'insideEndTop' }, data: [{ yAxis: f.income }] },
      },
    ],
  };
  return <EChart option={option} height={230} label={f.takeaway} />;
}
