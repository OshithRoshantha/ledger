import clsx from 'clsx';
import { Lock, Trophy, TrendingDown } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Card, EmptyState } from '@/components/ui/primitives';
import { formatPct, formatRs } from '@/lib/money';
import type { TrendsTab as Data } from '@/lib/types';
import { Section, Takeaway } from '../parts';

const ComboChart = lazy(() => import('@/components/charts/charts').then((m) => ({ default: m.ComboChart })));
const MixArea = lazy(() => import('@/components/charts/charts').then((m) => ({ default: m.MixArea })));
const PaceChart = lazy(() => import('@/components/charts/charts').then((m) => ({ default: m.PaceChart })));
const NetworthChart = lazy(() => import('@/components/charts/charts').then((m) => ({ default: m.NetworthChart })));

const chart = (h: number) => <div className="skeleton w-full" style={{ height: h }} aria-hidden />;

export default function TrendsTab({ t }: { t: Data }) {
  if (t.locked) {
    return (
      <Card>
        <EmptyState title="Trends unlock after 2 cycles" body={t.unlock_message ?? undefined} action={<Lock size={20} className="text-muted" aria-hidden />} />
      </Card>
    );
  }
  const n = t.pace.current.length;
  const cur = t.pace.current[n - 1] ?? 0;
  const prev = t.pace.previous[Math.min(n, t.pace.previous.length) - 1] ?? 0;
  const rows = [...t.rows].filter((r) => r.has_data).reverse();
  return (
    <div>
      <Card className="p-4">
        <Takeaway>{t.takeaway}</Takeaway>
        <Suspense fallback={chart(240)}>
          <ComboChart rows={t.rows} />
        </Suspense>
      </Card>

      <Section title="Spending pace">
        <Card className="p-4">
          <Takeaway>
            {t.pace.prev_label && n ? (
              <>
                {formatRs(Math.abs(cur - prev), { whole: true })} {cur >= prev ? 'ahead of' : 'behind'} {t.pace.prev_label} at day {n}.
              </>
            ) : null}
          </Takeaway>
          <Suspense fallback={chart(220)}>
            <PaceChart pace={t.pace} label={t.meta.label} />
          </Suspense>
        </Card>
      </Section>

      <Section title="Spending mix">
        <Card className="p-4">
          <Takeaway>How your spending is split across categories, cycle by cycle.</Takeaway>
          <Suspense fallback={chart(240)}>
            <MixArea mix={t.mix} />
          </Suspense>
        </Card>
      </Section>

      <Section title="Net savings flow">
        <Card className="p-4">
          <Takeaway>
            {t.networth.length ? (
              <>
                You’ve saved <b className="num">{formatRs(t.networth[t.networth.length - 1].cumulative, { whole: true })}</b> in total since {t.networth[0].label}.
              </>
            ) : null}
          </Takeaway>
          <Suspense fallback={chart(190)}>
            <NetworthChart data={t.networth} />
          </Suspense>
        </Card>
      </Section>

      <Section title="Cycle by cycle">
        <Card className="overflow-hidden">
          <div className="scroll-pane overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead className="text-muted">
                <tr className="border-b border-hairline">
                  <th className="py-2 pl-4 text-left font-medium">Cycle</th>
                  <th className="px-2 text-right font-medium">Income</th>
                  <th className="px-2 text-right font-medium">Spent</th>
                  <th className="px-2 text-right font-medium">Saved</th>
                  <th className="px-2 text-right font-medium">Rate</th>
                  <th className="px-2 text-left font-medium">Top category</th>
                  <th className="pr-4 text-right font-medium">Spend Δ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.cycle} className="border-b border-hairline last:border-0">
                    <td className="whitespace-nowrap py-2 pl-4">{r.label}</td>
                    <td className="num px-2 text-right">{formatRs(r.income, { whole: true })}</td>
                    <td className="num px-2 text-right">{formatRs(r.spent, { whole: true })}</td>
                    <td className={clsx('num px-2 text-right', r.saved < 0 && 'text-negative')}>{formatRs(r.saved, { whole: true })}</td>
                    <td className="num px-2 text-right">{formatPct(r.savings_rate)}</td>
                    <td className="max-w-[120px] truncate px-2">{r.top_category ?? '–'}</td>
                    <td className={clsx('num pr-4 text-right', r.change_pct === null ? 'text-muted' : r.change_pct > 0 ? 'text-negative' : 'text-positive')}>
                      {r.change_pct === null ? '–' : `${r.change_pct > 0 ? '▲ +' : '▼ −'}${Math.abs(r.change_pct).toFixed(0)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

      {t.best && t.worst ? (
        <Section title="Best & worst cycles">
          <div className="grid grid-cols-2 gap-3">
            {[
              { r: t.best, title: 'Best', icon: Trophy, tone: 'text-positive' },
              { r: t.worst, title: 'Worst', icon: TrendingDown, tone: 'text-negative' },
            ].map(({ r, title, icon: Icon, tone }) => (
              <Card key={title} className="p-3.5">
                <p className={clsx('flex items-center gap-1 text-[12px] font-semibold', tone)}>
                  <Icon size={14} aria-hidden /> {title}
                </p>
                <p className="mt-1 text-[15px] font-semibold">{r.label}</p>
                <p className="num text-[13px]">Saved {formatRs(r.saved, { whole: true })}</p>
                {r.why ? <p className="mt-1 text-[12px] text-muted">{r.why}</p> : null}
              </Card>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title={`Year to date · ${t.ytd.year}`}>
        <Card className="grid grid-cols-2 gap-3 p-4">
          <Y label="Income" v={formatRs(t.ytd.income, { whole: true })} />
          <Y label="Spent" v={formatRs(t.ytd.spent, { whole: true })} />
          <Y label="Saved" v={formatRs(t.ytd.saved, { whole: true })} tone={t.ytd.saved >= 0 ? 'text-positive' : 'text-negative'} />
          <Y label="Avg saved / cycle" v={formatRs(t.ytd.avg_monthly_savings, { whole: true })} />
          <div className="col-span-2">
            <Y label="Biggest category" v={t.ytd.biggest_category ? `${t.ytd.biggest_category} · ${formatRs(t.ytd.biggest_amount, { whole: true })}` : '–'} />
          </div>
        </Card>
      </Section>
    </div>
  );
}

function Y({ label, v, tone }: { label: string; v: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[12px] text-muted">{label}</p>
      <p className={clsx('num truncate text-[16px] font-semibold', tone)}>{v}</p>
    </div>
  );
}
