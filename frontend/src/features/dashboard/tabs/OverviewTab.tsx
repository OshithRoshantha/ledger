import clsx from 'clsx';
import { AlertTriangle, ChevronDown, ChevronRight, PiggyBank } from 'lucide-react';
import { lazy, Suspense, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui/primitives';
import { CountUp } from '@/components/ui/CountUp';
import { formatRs } from '@/lib/money';
import { useApp } from '@/lib/store';
import type { Overview } from '@/lib/types';
import { Bar, HealthGauge, InsightList, MetricCard, Section, Takeaway, type Drill } from '../parts';

const Waterfall = lazy(() => import('@/components/charts/charts').then((m) => ({ default: m.Waterfall })));

const KPI_KEYS = ['savings_rate', 'avg_daily', 'projected_balance', 'biggest'];

export default function OverviewTab({ o, onDrill }: { o: Overview; onDrill: (d: Drill) => void }) {
  const navigate = useNavigate();
  const openQuickAdd = useApp((s) => s.openQuickAdd);
  const h = o.hero;
  const m = o.meta;
  const tone = h.status === 'danger' ? 'text-negative' : h.status === 'warn' ? 'text-warning' : 'text-text';
  const kpis = KPI_KEYS.map((k) => o.kpis.find((x) => x.key === k)).filter((k) => k !== undefined);

  return (
    <div>
      {/* the month in one calculation */}
      <Card className="p-5" style={{ backgroundImage: 'var(--hero-gradient)' }}>
        <dl>
          <Line label="Income this month" value={h.income} onClick={() => navigate('/income')} />
          <Line label="Spent so far" value={h.spent} minus onClick={() => onDrill({ kind: 'expenses', title: `Spending · ${m.label}` })} />
          <Line label="Pending bills" value={h.committed} minus onClick={() => navigate('/bills')} />
          {h.savings_target ? <Line label="Savings target" value={h.savings_target} minus onClick={() => navigate('/settings/cycle')} /> : null}
          {h.reserved ? <Line label="Goal reserves" value={h.reserved} minus onClick={() => useApp.getState().setDashTab('plan')} /> : null}
        </dl>
        <div className="mt-3 border-t border-hairline pt-3">
          <p className="label flex items-center gap-1.5">
            Safe to spend
            {h.status !== 'ok' && h.income ? (
              <span className={clsx('inline-flex items-center gap-1 text-[12px] font-semibold', tone)}>
                <AlertTriangle size={13} aria-hidden /> {h.status === 'danger' ? 'Over your limit' : 'Running low'}
              </span>
            ) : null}
          </p>
          <p className={clsx('mt-0.5 text-hero font-semibold', tone)}>
            <CountUp cents={h.safe_to_spend} whole />
          </p>
          {!h.income && m.is_current ? (
            <Button className="mt-3" block onClick={() => navigate('/income')}>
              Confirm your salary
            </Button>
          ) : h.daily_allowance !== null ? (
            <p className="mt-1 text-[15px]">
              You can spend <b className="num">{formatRs(h.daily_allowance, { whole: true })}/day</b> for {h.days_remaining} more day{h.days_remaining === 1 ? '' : 's'}
            </p>
          ) : (
            <p className="mt-1 text-[14px] text-muted">{m.is_future ? 'This cycle hasn’t started yet.' : `${m.label} is closed.`}</p>
          )}
        </div>
      </Card>

      {/* savings + pace */}
      {m.is_current && h.income ? <SavingsCard o={o} /> : null}

      {o.alerts.length ? (
        <Section title="Needs attention">
          <InsightList items={o.alerts.slice(0, 3)} compact />
        </Section>
      ) : null}

      <Section title="At a glance" right={<span className="text-[12px] text-muted">{m.compare?.text}</span>}>
        <div className="grid grid-cols-2 gap-3">
          {kpis.map((k) => (
            <MetricCard
              key={k.key}
              kpi={k}
              onClick={() => useApp.getState().setDashTab(k.key === 'biggest' ? 'spending' : 'trends')}
            />
          ))}
        </div>
      </Section>

      <Section title="Where the salary went">
        <Card className="p-4">
          <Takeaway>{o.waterfall.takeaway}</Takeaway>
          {o.waterfall.steps.length > 2 ? (
            <Suspense fallback={<Skeleton className="h-[240px] w-full" />}>
              <Waterfall
                steps={o.waterfall.steps}
                onSelect={(i) => {
                  const s = o.waterfall.steps[i];
                  if (s.kind === 'add') navigate('/income');
                  else if (s.label === 'Fixed bills') onDrill({ kind: 'bills', title: `Fixed bills · ${m.label}` });
                  else if (s.kind === 'sub') onDrill({ kind: 'expenses', title: `${s.label} · ${m.label}`, ...drillFor(s) });
                }}
              />
            </Suspense>
          ) : (
            <EmptyState title="No spending yet" action={<Button onClick={() => openQuickAdd()}>Add an expense</Button>} />
          )}
        </Card>
      </Section>

      <Section title="Money health">
        <details className="card group p-4">
          <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
            <HealthGauge score={o.health.score} />
            <span className="min-w-0 flex-1">
              {o.health.delta !== null ? (
                <span className={clsx('num block text-[15px] font-semibold', o.health.delta > 0 ? 'text-positive' : o.health.delta < 0 ? 'text-negative' : 'text-muted')}>
                  {o.health.delta > 0 ? '▲ +' : o.health.delta < 0 ? '▼ −' : ''}
                  {Math.abs(o.health.delta)} vs last cycle
                </span>
              ) : (
                <span className="block text-[15px] text-muted">First cycle</span>
              )}
              <span className="block text-[13px] text-muted">What drives this</span>
            </span>
            <ChevronDown size={18} className="shrink-0 text-muted transition group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="mt-3 space-y-2.5">
            {o.health.components.map((c) => (
              <li key={c.key}>
                <div className="flex justify-between gap-2 text-[13px]">
                  <span>{c.label}</span>
                  <span className="num text-muted">
                    {c.detail} · <b className="text-text">{c.score}</b>
                  </span>
                </div>
                <Bar value={c.score} max={100} colour={c.score >= 70 ? 'var(--positive)' : c.score >= 45 ? 'var(--warning)' : 'var(--negative)'} />
              </li>
            ))}
          </ul>
        </details>
      </Section>
    </div>
  );
}

function SavingsCard({ o }: { o: Overview }) {
  const navigate = useNavigate();
  const h = o.hero;
  const target = h.savings_target;
  const projected = h.projected_savings;
  const short = target - projected;
  let headline: ReactNode;
  if (!target) headline = <>On pace to save <b className="num">{formatRs(projected, { whole: true })}</b> this cycle</>;
  else if (short > 0) headline = <>On pace to save <b className="num">{formatRs(projected, { whole: true })}</b>, <span className="text-negative">{formatRs(short, { whole: true })} short</span></>;
  else headline = <>On pace to save <b className="num text-positive">{formatRs(projected, { whole: true })}</b></>;
  return (
    <Card className="mt-3 p-4">
      <p className="flex items-start gap-2 text-[15px]">
        <PiggyBank size={20} className="mt-0.5 shrink-0 text-brand" aria-hidden />
        <span>{headline}</span>
      </p>
      {target ? (
        <div className="mt-2.5">
          <div className="flex justify-between text-[12px] text-muted">
            <span>Target</span>
            <span className="num">{formatRs(target, { whole: true })}</span>
          </div>
          <Bar value={Math.max(projected, 0)} max={target} colour={short > 0 ? 'var(--negative)' : 'var(--positive)'} />
        </div>
      ) : (
        <button type="button" className="mt-1.5 inline-flex min-h-[44px] items-center text-[14px] font-semibold text-brand" onClick={() => navigate('/settings/cycle')}>
          Set a savings target
        </button>
      )}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Progress label="Cycle elapsed" value={h.elapsed_pct} colour="var(--text-2)" />
        <Progress label="Income spent" value={h.income_spent_pct ?? 0} colour={h.pace_warning ? 'var(--negative)' : 'var(--brand)'} />
      </div>
      {h.pace_warning ? (
        <p className="mt-2 flex items-center gap-1.5 text-[13px] font-medium text-negative">
          <AlertTriangle size={14} aria-hidden /> Spending is running ahead of the calendar.
        </p>
      ) : null}
    </Card>
  );
}

function drillFor(step: Overview['waterfall']['steps'][number]): { categoryId?: string; reasonId?: string } {
  const key = step.key ?? '';
  if (key.startsWith('var:')) return { categoryId: key.slice(4) };
  if (key.startsWith('reason:') && key.length > 7) return { reasonId: key.slice(7) };
  return {};
}

function Line({ label, value, minus, onClick }: { label: string; value: number; minus?: boolean; onClick: () => void }) {
  return (
    <div>
      <button type="button" onClick={onClick} className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left active:opacity-70">
        <dt className="flex items-center gap-2 text-[15px] text-muted">
          <span className="num w-3 text-center" aria-hidden>
            {minus ? '−' : ''}
          </span>
          {label}
        </dt>
        <dd className="num flex items-center gap-1 text-[17px] font-semibold">
          {formatRs(value, { whole: true })}
          <ChevronRight size={14} className="text-muted" aria-hidden />
        </dd>
      </button>
    </div>
  );
}

function Progress({ label, value, colour }: { label: string; value: number; colour: string }) {
  return (
    <div>
      <div className="flex justify-between text-[12px] text-muted">
        <span>{label}</span>
        <span className="num">{Math.round(value)}%</span>
      </div>
      <Bar value={value} max={100} colour={colour} />
    </div>
  );
}
