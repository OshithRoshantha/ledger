import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Lightbulb, Pencil, Plus, Target } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BottomSheet } from '@/components/sheets/BottomSheet';
import { AttributionChip } from '@/components/ui/AttributionChip';
import { Button, Card, Chip, Field, Skeleton, inputClass } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { isoDay } from '@/lib/cycle';
import { centsToRaw, formatRs, parseToCents } from '@/lib/money';
import { invalidateMoney, useCategories, useReasons, useSoftDelete } from '@/lib/queries';
import { useApp } from '@/lib/store';
import type { BudgetRow, GoalRow, PlanTab as Data, SimResult } from '@/lib/types';
import { Bar, Section, Takeaway } from '../parts';

const ConeChart = lazy(() => import('@/components/charts/charts').then((m) => ({ default: m.ConeChart })));

const STATE = {
  ok: { label: 'On track', cls: 'text-positive', colour: 'var(--positive)' },
  near: { label: 'Near limit', cls: 'text-warning', colour: 'var(--warning)' },
  over: { label: 'Over', cls: 'text-negative', colour: 'var(--negative)' },
};

export default function PlanTab({ p }: { p: Data }) {
  const navigate = useNavigate();
  const [budgetsOpen, setBudgetsOpen] = useState(false);
  const [goal, setGoal] = useState<GoalRow | 'new' | null>(null);
  const f = p.forecast;
  return (
    <div>
      <Section
        title="Budgets"
        right={
          <button type="button" className="tap -my-3 flex items-center gap-1 text-[14px] font-semibold text-brand" onClick={() => setBudgetsOpen(true)}>
            <Pencil size={14} aria-hidden /> Edit
          </button>
        }
      >
        <Card className="p-4">
          <Takeaway>{p.budget_takeaway}</Takeaway>
          {p.budgets.length ? (
            <ul className="space-y-3.5">
              {p.budgets.map((b) => (
                <BudgetBar key={b.id} b={b} />
              ))}
            </ul>
          ) : (
            <Button variant="secondary" block onClick={() => setBudgetsOpen(true)}>
              <Plus size={18} aria-hidden /> Set budgets
            </Button>
          )}
          {p.budgets.length ? <p className="mt-3 text-[12px] text-muted">The marker shows where you should be today ({p.budgets[0].pace_pct}% of the cycle).</p> : null}
        </Card>
      </Section>

      <Section title="Can I afford it?">
        <Simulator />
      </Section>

      <Section title="End-of-cycle forecast">
        <Card className="p-4">
          <Takeaway>{f.takeaway}</Takeaway>
          <div className="mb-2 grid grid-cols-3 gap-2 text-center">
            {(['low', 'likely', 'high'] as const).map((k) => (
              <div key={k} className={clsx('rounded-xl px-2 py-2', k === 'likely' ? 'bg-[var(--brand-soft)]' : 'bg-elevated')}>
                <p className="text-[12px] capitalize text-muted">{k === 'low' ? 'Best case' : k === 'high' ? 'Worst case' : 'Likely'}</p>
                <p className={clsx('num text-[15px] font-semibold', f.end_balance[k] < 0 && 'text-negative')}>{formatRs(f.end_balance[k], { whole: true })}</p>
              </div>
            ))}
          </div>
          <Suspense fallback={<Skeleton className="h-[230px] w-full" />}>
            <ConeChart f={f} />
          </Suspense>
          <p className="num mt-1 text-[12px] text-muted">
            So far {formatRs(f.so_far, { whole: true })} + pending bills {formatRs(f.pending_bills, { whole: true })} + expected variable spend.
          </p>
        </Card>
      </Section>

      <Section
        title="Savings goals"
        right={
          <button type="button" className="tap -my-3 flex items-center gap-1 text-[14px] font-semibold text-brand" onClick={() => setGoal('new')}>
            <Plus size={16} aria-hidden /> Add
          </button>
        }
      >
        {p.goals.length ? (
          <ul className="space-y-3">
            {p.goals.map((g) => (
              <li key={g.id}>
                <button type="button" className="card w-full p-4 text-left active:opacity-80" onClick={() => setGoal(g)}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-[16px] font-semibold">
                      <Target size={18} className="text-brand" aria-hidden /> {g.name}
                    </span>
                    <span className={clsx('text-[12px] font-semibold', g.progress_pct >= 100 ? 'text-positive' : g.on_track ? 'text-positive' : 'text-warning')}>
                      {g.progress_pct >= 100 ? 'Reached' : g.on_track ? 'On track' : 'Behind'}
                    </span>
                  </div>
                  <p className="num mt-1 text-[13px] text-muted">
                    {formatRs(g.saved_amount, { whole: true })} of {formatRs(g.target_amount, { whole: true })} · by {new Date(`${g.target_date}T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                  </p>
                  <Bar value={g.progress_pct} max={100} colour="var(--brand)" />
                  <p className="num mt-2 text-[13px]">
                    Needs <b>{formatRs(g.required_per_cycle, { whole: true })}</b>/cycle · you save ~{formatRs(g.avg_savings, { whole: true })}
                    {g.eta_cycles ? ` · ETA ${g.eta_cycles} cycles` : ''}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Card className="p-4">
            <p className="mb-3 text-[15px] text-muted">Create a goal to see the monthly saving it needs and whether you’re on track.</p>
            <Button variant="secondary" block onClick={() => setGoal('new')}>
              <Plus size={18} aria-hidden /> New goal
            </Button>
          </Card>
        )}
      </Section>

      {p.recommendations.length ? (
        <Section title="Recommendations">
          <ul className="space-y-2">
            {p.recommendations.map((r) => (
              <li key={r.id}>
                <button type="button" className="card flex w-full items-start gap-3 p-3.5 text-left active:opacity-80" onClick={() => r.action_link && navigate(r.action_link)}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-brand">
                    <Lightbulb size={18} aria-hidden />
                  </span>
                  <span className="pt-1.5 text-[15px] leading-snug">{r.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="50 / 30 / 20 check">
        <Card className="p-4">
          <Takeaway>
            {p.fifty.income ? `Needs, wants and savings as a share of income${p.fifty.projected ? ' (projected to cycle end)' : ''}.` : 'Add income to run the 50/30/20 check.'}
          </Takeaway>
          <ul className="space-y-3.5">
            {p.fifty.buckets.map((b) => (
              <li key={b.key}>
                <div className="flex justify-between text-[14px]">
                  <span className="capitalize">
                    {b.key} <span className="text-muted">· target {b.key === 'savings' ? '≥' : '≤'}
                    {b.target}%</span>
                  </span>
                  <span className={clsx('num font-semibold', b.status === 'off' ? 'text-negative' : b.status === 'ok' ? 'text-positive' : '')}>
                    {b.pct === null ? '–' : `${b.pct.toFixed(0)}%`} {b.status === 'ok' ? '✓' : b.status === 'off' ? '✗' : ''}
                  </span>
                </div>
                <Bar value={Math.max(0, b.pct ?? 0)} max={100} colour={b.key === 'needs' ? 'var(--brand)' : b.key === 'wants' ? '#E69F00' : 'var(--positive)'} marker={b.target} />
                <p className="num mt-1 text-[12px] text-muted">{formatRs(b.amount, { whole: true })}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-muted">Tag categories and reasons as Need or Want in Settings → Categories.</p>
        </Card>
      </Section>

      <BudgetsSheet open={budgetsOpen} budgets={p.budgets} onClose={() => setBudgetsOpen(false)} />
      <GoalSheet goal={goal} onClose={() => setGoal(null)} />
    </div>
  );
}

function BudgetBar({ b }: { b: BudgetRow }) {
  const s = STATE[b.state];
  return (
    <li>
      <div className="flex items-center justify-between gap-2 text-[14px]">
        <span className="truncate">{b.name}</span>
        <span className="num shrink-0">
          {formatRs(b.spent, { whole: true })} <span className="text-muted">/ {formatRs(b.amount, { whole: true })}</span>
        </span>
      </div>
      <Bar value={b.spent} max={b.amount} colour={s.colour} marker={b.pace_pct} />
      <p className="mt-1 flex justify-between text-[12px]">
        <span className={clsx('font-semibold', s.cls)}>
          {b.state === 'over' ? '▲' : b.state === 'near' ? '●' : '✓'} {s.label} · {b.pct.toFixed(0)}%
        </span>
        <span className="num text-muted">{b.remaining >= 0 ? `${formatRs(b.remaining, { whole: true })} left` : `${formatRs(-b.remaining, { whole: true })} over`}</span>
      </p>
    </li>
  );
}

function Simulator() {
  const { data: categories = [] } = useCategories();
  const { data: reasons = [] } = useReasons();
  const [raw, setRaw] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [date, setDate] = useState(isoDay());
  const [debounced, setDebounced] = useState<{ amount: number; categoryId: string; reasonId: string | null; date: string } | null>(null);
  const cents = parseToCents(raw) ?? 0;
  const cat = categories.find((c) => c.id === categoryId) ?? categories.find((c) => c.is_active);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(cents > 0 && cat ? { amount: cents, categoryId: cat.id, reasonId: cat.requires_reason ? reasonId : null, date } : null), 300);
    return () => clearTimeout(t);
  }, [cents, cat, reasonId, date]);

  const { data: sim, isFetching } = useQuery({
    queryKey: ['simulate', debounced],
    queryFn: () =>
      api<SimResult>('/analytics/simulate', {
        method: 'POST',
        body: { amount: debounced!.amount, category_id: debounced!.categoryId, reason_id: debounced!.reasonId, date: debounced!.date },
      }),
    enabled: !!debounced,
    placeholderData: (prev) => prev,
  });

  return (
    <Card className="space-y-3 p-4">
      <input
        className={inputClass + ' num text-[20px] font-semibold'}
        inputMode="decimal"
        placeholder="Amount (Rs)"
        aria-label="Amount to check"
        value={raw}
        onChange={(e) => setRaw(e.target.value.replace(/[^\d.]/g, ''))}
      />
      <div className="scroll-pane -mx-4 flex gap-2 overflow-x-auto px-4" role="radiogroup" aria-label="Category">
        {categories
          .filter((c) => c.is_active)
          .map((c) => (
            <Chip key={c.id} role="radio" aria-checked={cat?.id === c.id} selected={cat?.id === c.id} icon={c.icon} colour={c.colour} onClick={() => setCategoryId(c.id)}>
              {c.name}
            </Chip>
          ))}
      </div>
      {cat?.requires_reason ? (
        <div className="scroll-pane -mx-4 flex gap-2 overflow-x-auto px-4" role="radiogroup" aria-label="Reason">
          {reasons
            .filter((r) => r.is_active)
            .map((r) => (
              <Chip key={r.id} role="radio" aria-checked={reasonId === r.id} selected={reasonId === r.id} icon={r.icon} colour={r.colour} onClick={() => setReasonId(r.id)}>
                {r.name}
              </Chip>
            ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" className={inputClass + ' !w-auto min-w-0 flex-1 basis-40'} value={date} aria-label="Date" onChange={(e) => e.target.value && setDate(e.target.value)} />
        <AttributionChip day={date} />
      </div>
      {sim && debounced ? (
        <div className={clsx('rounded-2xl p-3.5 transition-opacity', isFetching && 'opacity-60')} style={{ background: sim.verdict === 'yes' ? 'var(--positive-soft)' : sim.verdict === 'tight' ? 'var(--warning-soft)' : 'var(--negative-soft)' }} role="status" aria-live="polite">
          <p className={clsx('text-[15px] font-semibold', sim.verdict === 'yes' ? 'text-positive' : sim.verdict === 'tight' ? 'text-warning' : 'text-negative')}>{sim.message}</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
            <Sim label="Safe to spend" before={sim.safe_before} after={sim.safe_after} />
            <Sim label="Daily allowance" before={sim.daily_before} after={sim.daily_after} />
            <Sim label="End-of-cycle balance" before={sim.projected_balance_before} after={sim.projected_balance_after} />
            {sim.budgets.map((b) => (
              <div key={b.name}>
                <dt className="text-muted">{b.name} budget</dt>
                <dd className={clsx('num font-medium', b.state === 'over' ? 'text-negative' : b.state === 'near' ? 'text-warning' : '')}>
                  {b.before_pct.toFixed(0)}% → {b.after_pct.toFixed(0)}%
                </dd>
              </div>
            ))}
          </dl>
          {!sim.is_current ? <p className="mt-2 text-[12px] text-muted">This date belongs to the {sim.cycle_display} cycle.</p> : null}
          <p className="mt-2 text-[12px] text-muted">Nothing is saved — this is a what-if.</p>
        </div>
      ) : (
        <p className="text-[13px] text-muted">Enter an amount to see the impact before you spend.</p>
      )}
    </Card>
  );
}

function Sim({ label, before, after }: { label: string; before: number; after: number }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="num font-medium">
        <span className="text-muted line-through decoration-1">{formatRs(before, { whole: true })}</span>{' '}
        <span className={after < 0 ? 'text-negative' : ''}>{formatRs(after, { whole: true })}</span>
      </dd>
    </div>
  );
}

function BudgetsSheet({ open, budgets, onClose }: { open: boolean; budgets: BudgetRow[]; onClose: () => void }) {
  const { data: categories = [] } = useCategories();
  const { data: reasons = [] } = useReasons();
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const targets = [
    ...categories.filter((c) => c.is_active && !c.requires_reason).map((c) => ({ key: `category:${c.id}`, type: 'category' as const, id: c.id, name: c.name })),
    ...reasons.filter((r) => r.is_active).map((r) => ({ key: `reason:${r.id}`, type: 'reason' as const, id: r.id, name: `Bank: ${r.name}` })),
  ];
  useEffect(() => {
    if (!open) return;
    const v: Record<string, string> = {};
    for (const b of budgets) v[`${b.target_type}:${b.target_id}`] = centsToRaw(b.amount);
    setValues(v);
  }, [open, budgets]);

  const save = async () => {
    setBusy(true);
    try {
      for (const t of targets) {
        const cents = parseToCents(values[t.key] ?? '') ?? 0;
        const existing = budgets.find((b) => `${b.target_type}:${b.target_id}` === t.key);
        if (cents > 0 && (!existing || existing.amount !== cents)) {
          await api('/budgets', { method: 'POST', body: { target_type: t.type, target_id: t.id, amount: cents } });
        } else if (cents === 0 && existing) {
          await api(`/budgets/${existing.id}`, { method: 'DELETE' });
        }
      }
      invalidateMoney(qc);
      toast({ message: 'Budgets saved', tone: 'success' });
      onClose();
    } catch (e) {
      toast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Monthly budgets"
      description="Leave blank for no limit."
      footer={
        <Button block loading={busy} onClick={save}>
          Save budgets
        </Button>
      }
    >
      <ul>
        {targets.map((t) => (
          <li key={t.key} className="flex min-h-[56px] items-center justify-between gap-3 border-b border-hairline last:border-0">
            <label htmlFor={`b-${t.key}`} className="min-w-0 flex-1 truncate text-[15px]">
              {t.name}
            </label>
            <input
              id={`b-${t.key}`}
              className={inputClass + ' num !h-11 !w-32 text-right'}
              inputMode="decimal"
              placeholder="No limit"
              value={values[t.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [t.key]: e.target.value.replace(/[^\d.]/g, '') }))}
            />
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}

function GoalSheet({ goal, onClose }: { goal: GoalRow | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const del = useSoftDelete('goals');
  const g = goal && goal !== 'new' ? goal : null;
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [saved, setSaved] = useState('');
  const [reserve, setReserve] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!goal) return;
    setName(g?.name ?? '');
    setTarget(g ? centsToRaw(g.target_amount) : '');
    setSaved(g ? centsToRaw(g.saved_amount) : '');
    setReserve(g ? centsToRaw(g.monthly_reserve) : '');
    const d = new Date();
    setDate(g?.target_date ?? isoDay(new Date(d.getFullYear() + 1, d.getMonth(), 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal]);
  const targetCents = parseToCents(target) ?? 0;
  const body = { name, target_amount: targetCents, target_date: date, saved_amount: parseToCents(saved || '0') ?? 0, monthly_reserve: parseToCents(reserve || '0') ?? 0 };

  return (
    <BottomSheet
      open={!!goal}
      onOpenChange={(o) => !o && onClose()}
      title={g ? 'Edit goal' : 'New savings goal'}
      footer={
        <div className="flex gap-2">
          {g ? (
            <Button
              variant="danger"
              onClick={() => {
                del.mutate(g.id);
                onClose();
              }}
            >
              Delete
            </Button>
          ) : null}
          <Button
            block
            loading={busy}
            disabled={!name.trim() || targetCents <= 0 || !date}
            onClick={async () => {
              setBusy(true);
              try {
                await api(g ? `/goals/${g.id}` : '/goals', { method: g ? 'PATCH' : 'POST', body });
                invalidateMoney(qc);
                onClose();
              } catch (e) {
                toast({ message: errorMessage(e), tone: 'error' });
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <input className={inputClass} value={name} maxLength={60} placeholder="Emergency fund" onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target (Rs)">
            <input className={inputClass + ' num'} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
          <Field label="Target date">
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Saved so far (Rs)">
            <input className={inputClass + ' num'} inputMode="decimal" value={saved} onChange={(e) => setSaved(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
          <Field label="Reserve / cycle (Rs)">
            <input className={inputClass + ' num'} inputMode="decimal" value={reserve} onChange={(e) => setReserve(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
        </div>
        <p className="text-[13px] text-muted">The per-cycle reserve is set aside from Safe to spend on the Overview.</p>
      </div>
    </BottomSheet>
  );
}
