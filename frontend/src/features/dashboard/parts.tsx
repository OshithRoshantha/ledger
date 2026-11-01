import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Bell, ChevronRight, CircleCheck, Info, Minus, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BottomSheet } from '@/components/sheets/BottomSheet';
import { Card, IconBadge, Skeleton } from '@/components/ui/primitives';
import { Sparkline } from '@/components/ui/Sparkline';
import { api } from '@/lib/api';
import { formatDay } from '@/lib/cycle';
import { formatPct, formatRs } from '@/lib/money';
import { useBills, useCategories, useReasons } from '@/lib/queries';
import type { Change, ExpenseEntry, Insight, Kpi, Severity } from '@/lib/types';

/** One-line plain-English takeaway shown above every chart. */
export function Takeaway({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="mb-3 text-[15px] leading-snug">{children}</p>;
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="section-title">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Arrow + sign + % + LKR; colour reinforces but never carries the meaning alone. */
export function Delta({ change, compact, money = true }: { change: Change | null | undefined; compact?: boolean; money?: boolean }) {
  if (!change) return null;
  if (change.is_new) return <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[12px] font-semibold text-brand">New</span>;
  if (change.diff === 0)
    return (
      <span className="num inline-flex items-center gap-0.5 text-[12px] text-muted">
        <Minus size={13} aria-hidden /> 0%
      </span>
    );
  const up = change.diff > 0;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  const tone = change.good === null ? 'text-muted' : change.good ? 'text-positive' : 'text-negative';
  const pctText = change.pct === null ? '' : `${up ? '+' : '−'}${Math.abs(change.pct).toFixed(0)}%`;
  const abs = formatRs(change.diff, { whole: true, signed: true });
  return (
    <span className={clsx('num inline-flex flex-wrap items-center gap-x-1 text-[12px] font-medium', tone)} aria-label={`${up ? 'up' : 'down'} ${pctText} (${abs})`}>
      <span className="inline-flex items-center">
        <Arrow size={13} strokeWidth={2.25} aria-hidden />
        {pctText}
      </span>
      {money && !compact ? <span className="opacity-80">{abs}</span> : null}
    </span>
  );
}

export function MetricCard({ kpi, onClick }: { kpi: Kpi; onClick?: () => void }) {
  const value =
    kpi.value === null ? '–' : kpi.format === 'pct' ? `${kpi.value.toFixed(0)}%` : formatRs(kpi.value, { whole: true });
  const ch = kpi.change;
  let foot: ReactNode = <span className="text-[12px] text-muted">&nbsp;</span>;
  if (ch && 'diff_pts' in ch && ch.diff_pts !== undefined) {
    foot =
      ch.diff_pts === null ? (
        <span className="text-[12px] text-muted">No baseline</span>
      ) : (
        <span className={clsx('num text-[12px] font-medium', ch.good === null ? 'text-muted' : ch.good ? 'text-positive' : 'text-negative')}>
          {ch.diff_pts >= 0 ? '▲ +' : '▼ −'}
          {Math.abs(ch.diff_pts).toFixed(0)} pts
        </span>
      );
  } else if (ch) {
    foot = <Delta change={ch as Change} />;
  }
  if (kpi.key === 'pending_bills') foot = <span className="num text-[12px] text-muted">{kpi.count} bill{kpi.count === 1 ? '' : 's'}</span>;
  const sparkColour = kpi.good === 'up' ? 'var(--positive)' : 'var(--brand)';
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp type={onClick ? 'button' : undefined} onClick={onClick} className="card flex min-w-0 flex-col p-3.5 text-left active:opacity-80">
      <span className="label truncate">{kpi.key === 'biggest' && kpi.name ? kpi.name : kpi.label}</span>
      <span className="num mt-0.5 truncate text-[18px] font-semibold">{value}</span>
      <span className="mt-1 flex items-end justify-between gap-1">
        <span className="min-w-0">{foot}</span>
        <Sparkline values={kpi.spark} width={52} height={20} colour={sparkColour} label={`${kpi.label}, last 6 cycles`} />
      </span>
    </Comp>
  );
}

export function HealthGauge({ score }: { score: number }) {
  const r = 46;
  const c = Math.PI * r;
  const v = Math.max(0, Math.min(100, score)) / 100;
  const colour = score >= 70 ? 'var(--positive)' : score >= 45 ? 'var(--warning)' : 'var(--negative)';
  return (
    <svg width="120" height="70" viewBox="0 0 120 70" role="img" aria-label={`Money health score ${score} out of 100`}>
      <path d="M14 62 A46 46 0 0 1 106 62" fill="none" stroke="var(--elevated)" strokeWidth="10" strokeLinecap="round" />
      <path
        d="M14 62 A46 46 0 0 1 106 62"
        fill="none"
        stroke={colour}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - v)}
        style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(.2,.8,.2,1)' }}
      />
      <text x="60" y="58" textAnchor="middle" fontSize="26" fontWeight="700" fill="var(--text)" className="num">
        {score}
      </text>
    </svg>
  );
}

export function Bar({ value, max, colour, marker }: { value: number; max: number; colour: string; marker?: number }) {
  const w = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="relative mt-1.5 h-2 overflow-visible rounded-full bg-elevated">
      <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${w}%`, background: colour }} />
      {marker !== undefined ? (
        <span className="absolute -top-1 h-4 w-0.5 rounded bg-[var(--text)]" style={{ left: `calc(${Math.min(100, marker)}% - 1px)` }} aria-hidden />
      ) : null}
    </div>
  );
}

const SEVERITY: Record<Severity, { icon: LucideIcon; cls: string }> = {
  high: { icon: AlertTriangle, cls: 'text-negative bg-[var(--negative-soft)]' },
  medium: { icon: Bell, cls: 'text-warning bg-[var(--warning-soft)]' },
  low: { icon: Info, cls: 'text-brand bg-[var(--brand-soft)]' },
  positive: { icon: CircleCheck, cls: 'text-positive bg-[var(--positive-soft)]' },
};

export function InsightList({ items, compact }: { items: Insight[]; compact?: boolean }) {
  const navigate = useNavigate();
  if (!items.length) return <Card className="p-4 text-[15px] text-muted">Nothing needs your attention right now.</Card>;
  return (
    <ul className="space-y-2">
      {items.map((i) => {
        const s = SEVERITY[i.severity];
        return (
          <li key={i.id}>
            <button
              type="button"
              onClick={() => i.action_link && navigate(i.action_link)}
              className="card flex w-full items-start gap-3 p-3.5 text-left active:opacity-80"
            >
              <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', s.cls)}>
                <s.icon size={18} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium leading-snug">{i.title}</span>
                {!compact && i.detail ? <span className="mt-0.5 block text-[13px] text-muted">{i.detail}</span> : null}
              </span>
              {i.action_link ? <ChevronRight size={16} className="mt-2.5 shrink-0 text-muted" aria-hidden /> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function HeatStrip({ heat, start, dayIndex, isCurrent, onSelect }: { heat: { day: string; amount: number }[]; start: string; dayIndex: number; isCurrent: boolean; onSelect: (day: string) => void }) {
  const max = Math.max(...heat.map((h) => h.amount), 1);
  const lead = (new Date(`${start}T00:00:00`).getDay() + 6) % 7;
  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1.5 text-center text-[11px] text-muted" aria-hidden>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`l${i}`} aria-hidden />
        ))}
        {heat.map((h, i) => {
          const future = isCurrent && i >= dayIndex;
          const intensity = h.amount ? 0.18 + 0.82 * Math.sqrt(h.amount / max) : 0;
          return (
            <button
              key={h.day}
              type="button"
              disabled={future}
              onClick={() => onSelect(h.day)}
              aria-label={`${formatDay(h.day, { weekday: 'long', day: 'numeric', month: 'long' })}: ${formatRs(h.amount, { whole: true })}`}
              className={clsx('num aspect-square rounded-lg text-[11px] font-medium', future && 'opacity-40', isCurrent && i === dayIndex - 1 && 'ring-2 ring-[var(--brand)]')}
              style={{ background: h.amount ? `color-mix(in srgb, var(--brand) ${Math.round(intensity * 100)}%, var(--heat-0))` : 'var(--heat-0)' }}
            >
              <span className={intensity > 0.55 ? 'text-white' : 'text-muted'}>{Number(h.day.slice(8))}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TabSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-[200px] w-full !rounded-[20px]" />
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[96px] !rounded-[20px]" />
        ))}
      </div>
      <Skeleton className="h-[260px] w-full !rounded-[20px]" />
    </div>
  );
}

export function Pct({ value }: { value: number | null | undefined }) {
  return <span className="num">{formatPct(value)}</span>;
}

// ---------------------------------------------------------------- drill-down

export type Drill =
  | { title: string; kind: 'expenses'; categoryId?: string; reasonId?: string; method?: string; day?: string }
  | { title: string; kind: 'bills'; group?: string };

/** The entries behind any card or chart element. */
export function DrillSheet({ drill, cycle, onClose }: { drill: Drill | null; cycle?: string; onClose: () => void }) {
  const { data: categories = [] } = useCategories();
  const { data: reasons = [] } = useReasons();
  const { data: bills } = useBills(drill?.kind === 'bills' || drill?.kind === 'expenses' ? cycle : undefined);
  const params = new URLSearchParams();
  if (cycle) params.set('cycle', cycle);
  if (drill?.kind === 'expenses') {
    if (drill.categoryId) params.set('category_id', drill.categoryId);
    if (drill.reasonId) params.set('reason_id', drill.reasonId);
    if (drill.method) params.set('method', drill.method);
    if (drill.day) params.set('day', drill.day);
  }
  const { data, isLoading } = useQuery({
    queryKey: ['expenses', 'drill', params.toString()],
    queryFn: () => api<{ total: number; items: ExpenseEntry[] }>(`/expenses?${params}`),
    enabled: !!drill && drill.kind === 'expenses' && !!cycle,
  });

  type Row = { id: string; icon: string; colour: string; title: string; sub: string; amount: number };
  let rows: Row[] = [];
  if (drill?.kind === 'bills') {
    rows = (bills?.items ?? [])
      .filter((b) => b.payment && (!drill.group || b.group === drill.group))
      .map((b) => ({ id: b.id, icon: b.icon, colour: b.colour, title: b.name, sub: `Paid ${formatDay(b.payment!.day)}`, amount: b.payment!.amount_paid }));
  } else if (drill) {
    const dayBills =
      drill.day && !drill.categoryId && !drill.reasonId
        ? (bills?.items ?? [])
            .filter((b) => b.payment?.day === drill.day)
            .map((b) => ({ id: `b${b.id}`, icon: b.icon, colour: b.colour, title: b.name, sub: 'Bill paid', amount: b.payment!.amount_paid }))
        : [];
    rows = [
      ...dayBills,
      ...(data?.items ?? []).map((e) => {
        const cat = categories.find((c) => c.id === e.category_id);
        const reason = reasons.find((r) => r.id === e.reason_id);
        return {
          id: e.id,
          icon: cat?.icon ?? 'tag',
          colour: cat?.colour ?? '#9AA3B2',
          title: reason ? `${cat?.name ?? ''} Â· ${reason.name}` : cat?.name ?? 'Expense',
          sub: [formatDay(e.day), e.note].filter(Boolean).join(' Â· '),
          amount: e.amount,
        };
      }),
    ];
  }
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <BottomSheet open={!!drill} onOpenChange={(o) => !o && onClose()} title={drill?.title ?? ''}>
      {drill?.kind === 'expenses' && isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-muted">No entries.</p>
      ) : (
        <>
          <p className="num mb-2 text-[22px] font-semibold">
            {formatRs(total)} <span className="text-[14px] font-normal text-muted">Â· {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}</span>
          </p>
          <ul>
            {rows.map((r) => (
              <li key={r.id} className="flex min-h-[56px] items-center gap-3 border-b border-hairline py-2 last:border-0">
                <IconBadge icon={r.icon} colour={r.colour} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px]">{r.title}</p>
                  {r.sub ? <p className="truncate text-[13px] text-muted">{r.sub}</p> : null}
                </div>
                <span className="num font-medium">{formatRs(r.amount)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </BottomSheet>
  );
}

