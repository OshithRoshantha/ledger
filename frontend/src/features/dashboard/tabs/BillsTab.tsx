import clsx from 'clsx';
import { AlertTriangle, Check, Clock } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, IconBadge, Ring, Skeleton } from '@/components/ui/primitives';
import { formatDay } from '@/lib/cycle';
import { formatRs } from '@/lib/money';
import type { BillsTab as Data } from '@/lib/types';
import { Bar, Section, Takeaway } from '../parts';

const BillTrendChart = lazy(() => import('@/components/charts/charts').then((m) => ({ default: m.BillTrendChart })));
const FixedRatioChart = lazy(() => import('@/components/charts/charts').then((m) => ({ default: m.FixedRatioChart })));

export default function BillsTab({ b }: { b: Data }) {
  const navigate = useNavigate();
  const st = b.status;
  const flagged = b.trends.filter((t) => t.flag);
  const maxAnnual = b.annual.items[0]?.annual ?? 1;
  return (
    <div>
      <Card className="p-4">
        <button type="button" className="flex w-full items-center gap-4 text-left" onClick={() => navigate('/bills')}>
          <Ring value={st.total_count ? st.paid_count / st.total_count : 0} size={64} label={`${st.paid_count} of ${st.total_count} bills paid`} />
          <span>
            <span className="num block text-[17px] font-semibold">
              {st.paid_count} of {st.total_count} paid
            </span>
            <span className="num block text-[14px] text-muted">
              {formatRs(st.paid_amount, { whole: true })} paid · {formatRs(st.pending_amount, { whole: true })} pending
            </span>
          </span>
        </button>
        <ul className="mt-3">
          {st.items.map((i) => (
            <li key={i.id} className="flex min-h-[48px] items-center gap-3 border-t border-hairline py-1.5">
              <IconBadge icon={i.icon} colour={i.colour} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px]">{i.name}</span>
                <span className="num block text-[12px] text-muted">{formatRs(i.paid_amount ?? i.template, { whole: true })}</span>
              </span>
              {i.status === 'paid' ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--positive-soft)] px-2 py-0.5 text-[12px] font-semibold text-positive">
                  <Check size={12} strokeWidth={3} aria-hidden /> {formatDay(i.paid_day!)}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-[12px] font-semibold text-muted">
                  <Clock size={12} aria-hidden /> Pending
                </span>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Section title="Bill amounts · 12 cycles">
        <Card className="p-4">
          <Takeaway>{b.trend_takeaway}</Takeaway>
          <Suspense fallback={<Skeleton className="h-[240px] w-full" />}>
            <BillTrendChart series={b.trends} />
          </Suspense>
          {flagged.length ? (
            <ul className="mt-2 space-y-1">
              {flagged.map((f) => (
                <li key={f.id} className="flex items-center gap-1.5 text-[13px] font-medium text-warning">
                  <AlertTriangle size={14} aria-hidden /> {f.name}: {f.above_avg_pct?.toFixed(0)}% above its 6-cycle average
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </Section>

      <Section title="Fixed-cost ratio">
        <Card className="p-4">
          <Takeaway>{b.fixed_ratio.takeaway}</Takeaway>
          <Suspense fallback={<Skeleton className="h-[190px] w-full" />}>
            <FixedRatioChart data={b.fixed_ratio} />
          </Suspense>
        </Card>
      </Section>

      <Section title="Annual cost">
        <Card className="p-4">
          <Takeaway>{b.annual.takeaway}</Takeaway>
          <ul className="space-y-2.5">
            {b.annual.items.map((a) => (
              <li key={a.id}>
                <div className="flex justify-between gap-2 text-[14px]">
                  <span className="truncate">{a.name}</span>
                  <span className="num shrink-0">
                    {formatRs(a.annual, { whole: true })}
                    <span className="text-muted">/yr</span>
                  </span>
                </div>
                <Bar value={a.annual} max={maxAnnual} colour={a.colour} />
              </li>
            ))}
          </ul>
          <p className="num mt-3 text-right text-[13px] text-muted">Total {formatRs(b.annual.total, { whole: true })} a year</p>
        </Card>
      </Section>

      <Section title="Planned vs actual">
        <Card className="overflow-hidden">
          <div className="scroll-pane overflow-x-auto">
            <table className="w-full min-w-[440px] whitespace-nowrap text-[13px]">
              <thead className="text-muted">
                <tr className="border-b border-hairline">
                  <th className="py-2 pl-4 text-left font-medium">Bill</th>
                  <th className="px-2 text-right font-medium">Planned</th>
                  <th className="px-2 text-right font-medium">Paid</th>
                  <th className="px-2 text-right font-medium">Avg paid</th>
                  <th className="pr-4 text-right font-medium">Usual day</th>
                </tr>
              </thead>
              <tbody>
                {b.template_vs_actual.map((t) => {
                  const timing = b.timing.find((x) => x.id === t.id);
                  const over = t.actual !== null && t.actual > t.template;
                  return (
                    <tr key={t.id} className="border-b border-hairline last:border-0">
                      <td className="max-w-[130px] truncate py-2 pl-4">{t.name}</td>
                      <td className="num px-2 text-right">{formatRs(t.template, { whole: true })}</td>
                      <td className={clsx('num px-2 text-right', over && 'text-negative')}>{t.actual === null ? '–' : formatRs(t.actual, { whole: true })}</td>
                      <td className="num px-2 text-right text-muted">{t.avg_actual === null ? '–' : formatRs(t.avg_actual, { whole: true })}</td>
                      <td className="num pr-4 text-right text-muted">{timing?.avg_day ? `day ${Math.round(timing.avg_day)}` : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>
    </div>
  );
}
