import clsx from 'clsx';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';
import { Card, EmptyState, Segmented, Skeleton } from '@/components/ui/primitives';
import { Sparkline } from '@/components/ui/Sparkline';
import { formatDay } from '@/lib/cycle';
import { formatCompact, formatPct, formatRs } from '@/lib/money';
import type { CategoryRow, SpendingTab as Data } from '@/lib/types';
import { Bar, Delta, HeatStrip, Section, Takeaway, type Drill } from '../parts';

const SpendDonut = lazy(() => import('@/components/charts/charts').then((m) => ({ default: m.SpendDonut })));

type SortKey = 'amount' | 'pct_of_spend' | 'change' | 'budget_used_pct' | 'name';

export default function SpendingTab({ s, onDrill }: { s: Data; onDrill: (d: Drill) => void }) {
  const [mode, setMode] = useState<'spend' | 'income'>('spend');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'amount', desc: true });
  const m = s.meta;

  const drillRow = (r: CategoryRow) =>
    r.kind === 'fixed'
      ? onDrill({ kind: 'bills', group: r.name, title: `${r.name} · ${m.label}` })
      : onDrill({ kind: 'expenses', categoryId: r.id, title: `${r.name} · ${m.label}` });

  const rows = useMemo(() => {
    const val = (r: CategoryRow) =>
      sort.key === 'name' ? r.name : sort.key === 'change' ? r.change.diff : (r[sort.key] as number | null) ?? -Infinity;
    return [...s.categories].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const cmp = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
      return sort.desc ? -cmp : cmp;
    });
  }, [s.categories, sort]);

  if (!s.total) {
    return (
      <Card>
        <EmptyState title="No spending yet this cycle" body="Charts appear as soon as you add expenses or pay bills." />
      </Card>
    );
  }

  const maxWeekday = Math.max(...s.patterns.weekday.map((w) => w.avg), 1);
  const maxMatrix = Math.max(...s.bank.matrix.cells.flat(), 1);
  const head = (key: SortKey, label: string, cls = '') => (
    <th scope="col" className={clsx('whitespace-nowrap px-2 py-2 font-medium', cls)}>
      <button
        type="button"
        className="inline-flex items-center gap-0.5"
        onClick={() => setSort((p) => ({ key, desc: p.key === key ? !p.desc : true }))}
        aria-label={`Sort by ${label}`}
      >
        {label}
        {sort.key === key ? sort.desc ? <ArrowDown size={12} aria-hidden /> : <ArrowUp size={12} aria-hidden /> : null}
      </button>
    </th>
  );

  return (
    <div>
      <Section title="Where the money goes">
        <Card className="p-4">
          <Takeaway>{s.takeaway}</Takeaway>
          <Segmented
            label="Share of"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'spend', label: '% of spending' },
              { value: 'income', label: '% of income' },
            ]}
          />
          <Suspense fallback={<Skeleton className="mx-auto mt-3 h-[220px] w-[220px] !rounded-full" />}>
            <SpendDonut rows={s.categories} total={s.total} mode={mode} onSelect={(key) => drillRow(s.categories.find((r) => r.key === key)!)} />
          </Suspense>
        </Card>
      </Section>

      <Section title="Categories" right={<span className="text-[12px] text-muted">{m.compare?.text}</span>}>
        <Card className="overflow-hidden">
          <div className="scroll-pane overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead className="text-muted">
                <tr className="border-b border-hairline">
                  {head('name', 'Category', 'pl-4')}
                  {head('amount', 'Amount', 'text-right')}
                  {head('pct_of_spend', mode === 'spend' ? '% spend' : '% income', 'text-right')}
                  {head('change', 'vs compare')}
                  <th scope="col" className="px-2 py-2 font-medium">
                    6 cycles
                  </th>
                  {head('budget_used_pct', 'Budget', 'pr-4 text-right')}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-hairline last:border-0 active:bg-elevated" onClick={() => drillRow(r)}>
                    <td className="max-w-[140px] py-2.5 pl-4 pr-2">
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.colour }} aria-hidden />
                        <span className="truncate">{r.name}</span>
                      </span>
                    </td>
                    <td className="num whitespace-nowrap px-2 text-right">{formatRs(r.amount, { whole: true })}</td>
                    <td className="num px-2 text-right">{formatPct(mode === 'spend' ? r.pct_of_spend : r.pct_of_income)}</td>
                    <td className="px-2">
                      <Delta change={r.change} />
                    </td>
                    <td className="px-2">
                      <Sparkline values={r.spark} width={56} height={18} colour={r.colour} label={`${r.name} over 6 cycles`} />
                    </td>
                    <td className="num pr-4 text-right">
                      {r.budget_used_pct === null ? (
                        <span className="text-muted">–</span>
                      ) : (
                        <span className={r.budget_used_pct > 100 ? 'text-negative' : r.budget_used_pct >= 80 ? 'text-warning' : ''}>
                          {formatPct(r.budget_used_pct)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

      <Section title="Bank & cash">
        <Card className="p-4">
          {s.bank.total ? (
            <>
              <div className="mb-3 flex items-baseline justify-between">
                <span className="num text-[20px] font-semibold">
                  {formatRs(s.bank.total, { whole: true })} <span className="text-[13px] font-normal text-muted">· {s.bank.count} transactions</span>
                </span>
                <Delta change={s.bank.change} compact />
              </div>
              <p className="label mb-1.5">By method</p>
              <div className="flex h-3 overflow-hidden rounded-full bg-elevated" role="img" aria-label={s.bank.methods.map((x) => `${x.label} ${formatPct(x.pct)}`).join(', ')}>
                {s.bank.methods.map((x, i) =>
                  x.amount ? <div key={x.method} style={{ width: `${x.pct}%`, background: ['#0072B2', '#E69F00', '#CC79A7'][i] }} /> : null,
                )}
              </div>
              <ul className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
                {s.bank.methods.map((x, i) => (
                  <li key={x.method}>
                    <button type="button" className="w-full text-left" onClick={() => onDrill({ kind: 'expenses', method: x.method, title: `${x.label} · ${m.label}` })}>
                      <span className="flex items-center gap-1 text-muted">
                        <span className="h-2 w-2 rounded-full" style={{ background: ['#0072B2', '#E69F00', '#CC79A7'][i] }} aria-hidden />
                        {x.label}
                      </span>
                      <span className="num block text-[14px] font-semibold">{formatRs(x.amount, { whole: true })}</span>
                      <span className="num block text-muted">
                        {x.count}× · avg {formatCompact(x.avg)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="label mb-1 mt-4">By reason</p>
              <ul className="space-y-2.5">
                {s.bank.reasons.map((r) => (
                  <li key={r.id ?? 'none'}>
                    <button type="button" className="w-full text-left" onClick={() => r.id && onDrill({ kind: 'expenses', reasonId: r.id, title: `${r.name} · ${m.label}` })}>
                      <span className="flex items-center justify-between gap-2 text-[14px]">
                        <span className="truncate">{r.name}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="num text-muted">
                            {formatRs(r.amount, { whole: true })} · {formatPct(r.pct)}
                          </span>
                          <Delta change={r.change} compact />
                        </span>
                      </span>
                      <Bar value={r.amount} max={s.bank.reasons[0]?.amount || 1} colour={r.colour} />
                    </button>
                  </li>
                ))}
              </ul>
              {s.bank.matrix.reasons.length ? (
                <>
                  <p className="label mb-1.5 mt-4">Reason × method</p>
                  <div className="scroll-pane overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="text-muted">
                          <th className="py-1 text-left font-medium">Reason</th>
                          {s.bank.matrix.methods.map((x) => (
                            <th key={x} className="px-1 py-1 text-right font-medium">
                              {x}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {s.bank.matrix.reasons.map((name, i) => (
                          <tr key={name}>
                            <td className="max-w-[110px] truncate py-0.5 pr-2">{name}</td>
                            {s.bank.matrix.cells[i].map((v, j) => (
                              <td key={j} className="p-0.5">
                                <span
                                  className="num block rounded-md px-1.5 py-1.5 text-right"
                                  style={{ background: v ? `color-mix(in srgb, var(--brand) ${Math.round(15 + (v / maxMatrix) * 70)}%, var(--heat-0))` : 'var(--heat-0)', color: v / maxMatrix > 0.5 ? '#fff' : undefined }}
                                >
                                  {v ? formatCompact(v).replace('Rs ', '') : '·'}
                                </span>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <p className="text-[14px] text-muted">No ATM, transfer or card spending this cycle.</p>
          )}
        </Card>
      </Section>

      <Section title="Biggest movers">
        <Card className="grid grid-cols-2 gap-3 p-4">
          {(['up', 'down'] as const).map((dir) => (
            <div key={dir}>
              <p className={clsx('mb-1.5 text-[12px] font-semibold', dir === 'up' ? 'text-negative' : 'text-positive')}>{dir === 'up' ? '▲ Increases' : '▼ Decreases'}</p>
              {s.movers[dir].length ? (
                <ul className="space-y-2">
                  {s.movers[dir].map((x) => (
                    <li key={x.name} className="text-[13px]">
                      <span className="block truncate">{x.name}</span>
                      <span className={clsx('num font-medium', dir === 'up' ? 'text-negative' : 'text-positive')}>
                        {formatRs(x.diff, { whole: true, signed: true })} {x.is_new ? '· New' : x.pct !== null ? `· ${x.pct > 0 ? '+' : '−'}${Math.abs(x.pct).toFixed(0)}%` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-muted">None</p>
              )}
            </div>
          ))}
        </Card>
      </Section>

      <Section title="Spending patterns">
        <Card className="p-4">
          <Takeaway>{s.patterns.takeaway}</Takeaway>
          <div className="flex h-28 items-end gap-1.5" role="img" aria-label={s.patterns.weekday.map((w) => `${w.dow} ${formatRs(w.avg, { whole: true })}`).join(', ')}>
            {s.patterns.weekday.map((w) => (
              <div key={w.dow} className="flex flex-1 flex-col items-center gap-1">
                <span className="num text-[10px] text-muted">{w.avg ? formatCompact(w.avg).replace('Rs ', '') : ''}</span>
                <div className="w-full rounded-t-md bg-brand transition-[height] duration-700" style={{ height: `${(w.avg / maxWeekday) * 72 + 2}px`, opacity: w.avg === maxWeekday ? 1 : 0.55 }} />
                <span className="text-[11px] text-muted">{w.dow}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
            <Split a={['Weekdays', s.patterns.weekday_vs_weekend.weekday_daily]} b={['Weekends', s.patterns.weekday_vs_weekend.weekend_daily]} suffix="/day" />
            <Split a={['1st half', s.patterns.halves.first]} b={['2nd half', s.patterns.halves.second]} />
          </div>
          <p className="label mb-2 mt-4">Daily spend · tap a day</p>
          <HeatStrip heat={s.heat} start={m.start} dayIndex={m.day_index} isCurrent={m.is_current} onSelect={(day) => onDrill({ kind: 'expenses', day, title: formatDay(day, { weekday: 'long', day: 'numeric', month: 'long' }) })} />
        </Card>
      </Section>

      <Section title="Transaction sizes">
        <Card className="grid grid-cols-2 gap-3 p-4 min-[400px]:grid-cols-4">
          {s.sizes.map((b) => (
            <div key={b.label}>
              <p className="text-[12px] text-muted">{b.label}</p>
              <p className="text-[11px] text-muted">{b.max === null ? `> ${formatCompact(b.min)}` : `${b.min ? formatCompact(b.min) : 'Rs 0'}–${formatCompact(b.max).replace('Rs ', '')}`}</p>
              <p className="num mt-1 text-[17px] font-semibold">{b.count}×</p>
              <p className="num text-[12px] text-muted">{formatRs(b.total, { whole: true })}</p>
            </div>
          ))}
        </Card>
      </Section>

      {s.top10.length ? (
        <Section title="Largest expenses">
          <Card className="overflow-hidden">
            <ol>
              {s.top10.map((t, i) => (
                <li key={t.id} className="flex min-h-[52px] items-center gap-3 border-b border-hairline px-4 py-2 last:border-0">
                  <span className="num w-5 text-[13px] text-muted">{i + 1}</span>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.colour }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px]">{[t.category, t.reason].filter(Boolean).join(' · ')}</span>
                    <span className="block truncate text-[12px] text-muted">{[formatDay(t.day), t.note].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="num text-[14px] font-medium">{formatRs(t.amount, { whole: true })}</span>
                </li>
              ))}
            </ol>
          </Card>
        </Section>
      ) : null}

      {s.frequency.length ? (
        <Section title="How often">
          <Card className="grid grid-cols-2 gap-3 p-4">
            {s.frequency.map((f) => (
              <div key={f.name}>
                <p className="truncate text-[12px] text-muted">{f.name}</p>
                <p className="num text-[17px] font-semibold">
                  {f.count} <span className="text-[13px] font-normal text-muted">{f.unit}</span>
                </p>
                <p className="num text-[12px] text-muted">avg {formatRs(f.avg, { whole: true })}</p>
              </div>
            ))}
          </Card>
        </Section>
      ) : null}
    </div>
  );
}

function Split({ a, b, suffix = '' }: { a: [string, number]; b: [string, number]; suffix?: string }) {
  const total = a[1] + b[1] || 1;
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-elevated">
        <div style={{ width: `${(a[1] / total) * 100}%`, background: 'var(--brand)' }} />
        <div style={{ width: `${(b[1] / total) * 100}%`, background: '#E69F00' }} />
      </div>
      <div className="mt-1.5 flex justify-between gap-1">
        <span>
          <span className="block text-muted">{a[0]}</span>
          <span className="num font-medium">
            {formatCompact(a[1])}
            {suffix}
          </span>
        </span>
        <span className="text-right">
          <span className="block text-muted">{b[0]}</span>
          <span className="num font-medium">
            {formatCompact(b[1])}
            {suffix}
          </span>
        </span>
      </div>
    </div>
  );
}
