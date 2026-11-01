import clsx from 'clsx';
import { AlertTriangle } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui/primitives';
import { CountUp } from '@/components/ui/CountUp';
import { formatRs } from '@/lib/money';
import { useApp } from '@/lib/store';
import type { Overview } from '@/lib/types';
import { Bar, HealthGauge, InsightList, MetricCard, Section, Takeaway, type Drill } from '../parts';

const Waterfall = lazy(() => import('@/components/charts/charts').then((m) => ({ default: m.Waterfall })));

export default function OverviewTab({ o, onDrill }: { o: Overview; onDrill: (d: Drill) => void }) {
  const navigate = useNavigate();
  const openQuickAdd = useApp((s) => s.openQuickAdd);
  const h = o.hero;
  const m = o.meta;

  if (!h.income && !h.spent && m.is_current) {
    return (
      <Card>
        <EmptyState
          title="Let’s get your month started"
          body="Confirm your salary to see what’s safe to spend after your bills."
          action={<Button onClick={() => navigate('/income')}>Add your salary to get started</Button>}
        />
      </Card>
    );
  }

  const tone = h.status === 'danger' ? 'text-negative' : h.status === 'warn' ? 'text-warning' : 'text-text';
  return (
    <div>
      {/* a) hero */}
      <Card className="p-5" style={{ backgroundImage: 'var(--hero-gradient)' }}>
        <p className="label flex items-center gap-1.5">
          Safe to spend
          {h.status !== 'ok' ? (
            <span className={clsx('inline-flex items-center gap-1 text-[12px] font-semibold', tone)}>
              <AlertTriangle size={13} aria-hidden /> {h.status === 'danger' ? 'Short of bills' : 'Running low'}
            </span>
          ) : null}
        </p>
        <p className={clsx('mt-1 text-hero font-semibold', tone)}>
          <CountUp cents={h.safe_to_spend} whole />
        </p>
        {h.daily_allowance !== null ? (
          <p className="mt-1 text-[15px]">
            You can spend <b className="num">{formatRs(h.daily_allowance, { whole: true })}/day</b> for {h.days_remaining} more day
            {h.days_remaining === 1 ? '' : 's'}
          </p>
        ) : (
          <p className="mt-1 text-[14px] text-muted">{m.is_future ? 'This cycle hasn’t started yet.' : `${m.label} is closed.`}</p>
        )}
        <div className="mt-4 grid grid-cols-3 gap-2 text-[13px]">
          <Stat label="Balance" value={h.balance} />
          <Stat label="Pending bills" value={h.committed} onClick={() => navigate('/bills')} />
          <Stat label="Reserved" value={h.reserved} onClick={() => useApp.getState().setDashTab('plan')} />
        </div>
        {m.is_current ? (
          <div className="mt-4 space-y-2.5">
            <Progress label="Cycle elapsed" value={h.elapsed_pct} colour="var(--text-2)" />
            <Progress label="Income spent" value={h.income_spent_pct ?? 0} colour={h.pace_warning ? 'var(--negative)' : 'var(--brand)'} />
            {h.pace_warning ? (
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-negative">
                <AlertTriangle size={14} aria-hidden /> Spending is running ahead of the calendar.
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>

      {/* b) health */}
      <Section title="Money health">
        <Card className="p-4">
          <div className="flex items-center gap-4">
            <HealthGauge score={o.health.score} />
            <div className="min-w-0 flex-1">
              {o.health.delta !== null ? (
                <p className={clsx('num text-[17px] font-semibold', o.health.delta > 0 ? 'text-positive' : o.health.delta < 0 ? 'text-negative' : 'text-muted')}>
                  {o.health.delta > 0 ? '▲ +' : o.health.delta < 0 ? '▼ −' : ''}
                  {Math.abs(o.health.delta)} vs last cycle
                </p>
              ) : (
                <p className="text-[15px] text-muted">First cycle — no comparison yet</p>
              )}
              {o.health.top_factor ? <p className="text-[13px] text-muted">Biggest change: {o.health.top_factor}</p> : null}
            </div>
          </div>
          <ul className="mt-3 space-y-2.5">
            {o.health.components.map((c) => (
              <li key={c.key}>
                <div className="flex justify-between gap-2 text-[13px]">
                  <span>
                    {c.label} <span className="text-muted">· {c.weight}%</span>
                  </span>
                  <span className="num text-muted">
                    {c.detail} · <b className="text-text">{c.score}</b>
                  </span>
                </div>
                <Bar value={c.score} max={100} colour={c.score >= 70 ? 'var(--positive)' : c.score >= 45 ? 'var(--warning)' : 'var(--negative)'} />
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      {/* e) alerts */}
      {o.alerts.length ? (
        <Section title="Alerts">
          <InsightList items={o.alerts} compact />
        </Section>
      ) : null}

      {/* c) KPI grid */}
      <Section title="At a glance" right={<span className="text-[12px] text-muted">{m.compare?.text}</span>}>
        <div className="grid grid-cols-2 gap-3">
          {o.kpis.map((k) => (
            <MetricCard
              key={k.key}
              kpi={k}
              onClick={() => {
                if (k.key === 'income') navigate('/income');
                else if (k.key === 'pending_bills') navigate('/bills');
                else if (k.key === 'spent' || k.key === 'avg_daily') onDrill({ kind: 'expenses', title: `All spending · ${m.label}` });
                else if (k.key === 'biggest') useApp.getState().setDashTab('spending');
                else useApp.getState().setDashTab('trends');
              }}
            />
          ))}
        </div>
      </Section>

      {/* d) waterfall */}
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
          <p className="num mt-2 text-right text-[13px] text-muted">
            {formatRs(o.waterfall.income, { whole: true })} − {formatRs(o.waterfall.spent, { whole: true })} ={' '}
            <b className={o.waterfall.remaining < 0 ? 'text-negative' : 'text-text'}>{formatRs(o.waterfall.remaining, { whole: true })}</b>
          </p>
        </Card>
      </Section>
    </div>
  );
}

function drillFor(step: Overview['waterfall']['steps'][number]): { categoryId?: string; reasonId?: string } {
  const key = (step as { key?: string }).key ?? '';
  if (key.startsWith('var:')) return { categoryId: key.slice(4) };
  if (key.startsWith('reason:')) return { reasonId: key.slice(7) };
  return {};
}

function Stat({ label, value, onClick }: { label: string; value: number; onClick?: () => void }) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp type={onClick ? 'button' : undefined} onClick={onClick} className="min-w-0 rounded-xl bg-elevated px-2.5 py-2 text-left">
      <span className="block truncate text-[12px] text-muted">{label}</span>
      <span className={clsx('num block truncate text-[13px] font-semibold min-[390px]:text-[15px]', value < 0 && 'text-negative')}>
        {formatRs(value, { whole: true })}
      </span>
    </Comp>
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
