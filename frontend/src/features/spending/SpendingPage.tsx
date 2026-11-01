import { ChevronRight, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { CycleSwitcher, PageHeader } from '@/components/layout/PageHeader';
import { Button, Card, EmptyState, IconBadge, Skeleton } from '@/components/ui/primitives';
import { formatRs, formatPct } from '@/lib/money';
import { useActiveCycle, useReasons, useSpending } from '@/lib/queries';
import { useApp } from '@/lib/store';
import type { SpendingCategory } from '@/lib/types';
import { REASON_METHODS } from './ExpenseForm';

export default function SpendingPage() {
  const cycle = useActiveCycle();
  const { data, isLoading } = useSpending(cycle);
  const openQuickAdd = useApp((s) => s.openQuickAdd);

  return (
    <>
      <PageHeader title="Spending">
        <CycleSwitcher />
      </PageHeader>
      <div className="space-y-3 px-4 pt-4">
        {isLoading || !data ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[104px] w-full !rounded-[20px]" />)
        ) : (
          <>
            <div className="flex items-baseline justify-between px-1">
              <span className="label">Total this cycle</span>
              <span className="num text-[20px] font-semibold">{formatRs(data.total)}</span>
            </div>
            {data.categories.length === 0 ? (
              <Card>
                <EmptyState title="No categories yet" body="Add one in Settings → Categories." />
              </Card>
            ) : (
              data.categories.map((c) => <CategoryCard key={c.id} cat={c} onAdd={() => openQuickAdd({ categoryId: c.id })} />)
            )}
            {data.total === 0 && data.categories.length > 0 ? (
              <EmptyState
                title="Nothing spent yet"
                body="Every top-up, ride or withdrawal adds to its card's running total."
                action={<Button onClick={() => openQuickAdd()}>Add an expense</Button>}
              />
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

function CategoryCard({ cat, onAdd }: { cat: SpendingCategory; onAdd: () => void }) {
  const navigate = useNavigate();
  const { data: reasons = [] } = useReasons();
  const unit = cat.count === 1 ? cat.unit.replace(/s$/, '') : cat.unit;
  const reasonRows = Object.entries(cat.by_reason ?? {})
    .map(([id, amount]) => ({ reason: reasons.find((r) => r.id === id), amount }))
    .sort((a, b) => b.amount - a.amount);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 p-4">
        <button
          type="button"
          onClick={() => navigate(`/spending/${cat.id}`)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-label={`${cat.name}: ${formatRs(cat.total)}, ${cat.count} ${unit}. View entries`}
        >
          <IconBadge icon={cat.icon} colour={cat.colour} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] text-muted">
              {cat.name}
              {!cat.is_active ? ' (archived)' : ''}
            </p>
            <p className="num text-[22px] font-semibold leading-tight">{formatRs(cat.total, { whole: cat.total % 100 === 0 })}</p>
            <p className="num text-[13px] text-muted">
              {cat.count} {unit}
            </p>
          </div>
          <ChevronRight size={18} className="text-muted" aria-hidden />
        </button>
        {cat.is_active ? (
          <button
            type="button"
            onClick={onAdd}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white transition active:scale-95"
            style={{ background: 'var(--brand)' }}
            aria-label={`Add to ${cat.name}`}
          >
            <Plus size={28} strokeWidth={2.25} aria-hidden />
          </button>
        ) : null}
      </div>

      {cat.requires_reason && cat.total > 0 ? (
        <div className="space-y-3 border-t border-hairline px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {REASON_METHODS.map((m) => {
              const amount = cat.by_method?.[m.value] ?? 0;
              return (
                <span key={m.value} className="num rounded-full bg-elevated px-2.5 py-1 text-[13px]">
                  <span className="text-muted">{m.label.split(' ')[0]}</span> {formatRs(amount, { whole: true })}
                </span>
              );
            })}
          </div>
          <ul className="space-y-2">
            {reasonRows.map(({ reason, amount }) => (
              <li key={reason?.id ?? 'none'} className="text-[14px]">
                <div className="flex justify-between">
                  <span>{reason?.name ?? 'Other'}</span>
                  <span className="num text-muted">
                    {formatRs(amount, { whole: true })} · {formatPct((amount / cat.total) * 100)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-elevated">
                  <div className="h-full rounded-full" style={{ width: `${(amount / cat.total) * 100}%`, background: reason?.colour ?? 'var(--text-2)' }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
