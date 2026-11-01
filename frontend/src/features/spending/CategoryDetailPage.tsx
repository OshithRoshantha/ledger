import { ChevronLeft, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { BottomSheet } from '@/components/sheets/BottomSheet';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui/primitives';
import { SwipeRow } from '@/components/ui/SwipeRow';
import { displayLabel, relativeDay } from '@/lib/cycle';
import { centsToRaw, formatRs, parseToCents } from '@/lib/money';
import { useActiveCycle, useCategories, useEditExpense, useExpenses, useReasons, useSoftDelete } from '@/lib/queries';
import { useApp } from '@/lib/store';
import type { ExpenseEntry } from '@/lib/types';
import { draftProblem, ExpenseForm, REASON_METHODS, type ExpenseDraft } from './ExpenseForm';

export default function CategoryDetailPage() {
  const { categoryId } = useParams();
  const navigate = useNavigate();
  const cycle = useActiveCycle();
  const { data: categories = [] } = useCategories();
  const { data: reasons = [] } = useReasons();
  const { data, isLoading } = useExpenses(cycle, { categoryId });
  const del = useSoftDelete('expenses');
  const openQuickAdd = useApp((s) => s.openQuickAdd);
  const [editing, setEditing] = useState<ExpenseEntry | null>(null);
  const cat = categories.find((c) => c.id === categoryId);

  const byDay = useMemo(() => {
    const groups = new Map<string, ExpenseEntry[]>();
    for (const e of data?.items ?? []) groups.set(e.day, [...(groups.get(e.day) ?? []), e]);
    return [...groups.entries()];
  }, [data]);

  return (
    <>
      <PageHeader
        title={cat?.name ?? 'Category'}
        back={
          <button type="button" className="tap -ml-3 flex items-center justify-center text-brand" onClick={() => navigate(-1)} aria-label="Back">
            <ChevronLeft size={28} aria-hidden />
          </button>
        }
        right={
          cat?.is_active ? (
            <button type="button" className="tap flex items-center justify-center text-brand" onClick={() => openQuickAdd({ categoryId })} aria-label={`Add to ${cat.name}`}>
              <Plus size={26} aria-hidden />
            </button>
          ) : null
        }
      />
      <div className="px-4 pt-4">
        <div className="mb-4 px-1">
          <p className="label">{cycle ? displayLabel(cycle) : ''} total</p>
          <p className="num text-[32px] font-semibold">{formatRs(data?.total ?? 0)}</p>
          <p className="num text-[14px] text-muted">
            {data?.items.length ?? 0} {cat?.unit ?? 'entries'}
          </p>
        </div>
        {isLoading ? (
          <Skeleton className="h-64 w-full !rounded-[20px]" />
        ) : byDay.length === 0 ? (
          <Card>
            <EmptyState title="No entries this cycle" action={cat?.is_active ? <Button onClick={() => openQuickAdd({ categoryId })}>Add one</Button> : undefined} />
          </Card>
        ) : (
          byDay.map(([day, entries]) => (
            <section key={day} className="mb-4">
              <h2 className="section-title mb-2 px-1">{relativeDay(day)}</h2>
              <Card className="overflow-hidden">
                <ul>
                  {entries.map((e) => {
                    const reason = reasons.find((r) => r.id === e.reason_id);
                    const method = REASON_METHODS.find((m) => m.value === e.method);
                    return (
                      <li key={e.id} className="border-b border-hairline last:border-0">
                        <SwipeRow label={formatRs(e.amount)} onEdit={() => setEditing(e)} onDelete={() => del.mutate(e.id)}>
                          <button type="button" onClick={() => setEditing(e)} className="flex min-h-[60px] w-full items-center justify-between gap-3 px-4 py-3 text-left">
                            <div className="min-w-0">
                              <p className="truncate text-[15px]">{[method?.label, reason?.name].filter(Boolean).join(' · ') || e.note || cat?.name}</p>
                              {e.note && (method || reason) ? <p className="truncate text-[13px] text-muted">{e.note}</p> : null}
                            </div>
                            <span className="num shrink-0 text-[16px] font-medium">{formatRs(e.amount)}</span>
                          </button>
                        </SwipeRow>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          ))
        )}
        <p className="mt-2 text-center text-[13px] text-muted">Swipe left on an entry to edit or delete.</p>
      </div>
      <EditExpenseSheet entry={editing} onClose={() => setEditing(null)} />
    </>
  );
}

export function EditExpenseSheet({ entry, onClose }: { entry: ExpenseEntry | null; onClose: () => void }) {
  const { data: categories = [] } = useCategories();
  const { data: reasons = [] } = useReasons();
  const edit = useEditExpense();
  const del = useSoftDelete('expenses');
  const [draft, setDraft] = useState<ExpenseDraft | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);

  if (entry && entry.id !== lastId) {
    setLastId(entry.id);
    setDraft({
      raw: centsToRaw(entry.amount),
      categoryId: entry.category_id,
      method: entry.method,
      reasonId: entry.reason_id,
      date: entry.day,
      note: entry.note,
    });
  }
  if (!entry && lastId) setLastId(null);

  const cents = draft ? parseToCents(draft.raw) : null;
  const problem = draft ? draftProblem(draft, categories, cents) : 'Loading';

  return (
    <BottomSheet
      open={!!entry}
      onOpenChange={(o) => !o && onClose()}
      title="Edit expense"
      footer={
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <Button
            variant="danger"
            onClick={() => {
              if (entry) del.mutate(entry.id);
              onClose();
            }}
          >
            Delete
          </Button>
          <Button
            disabled={!!problem}
            loading={edit.isPending}
            onClick={() => {
              if (!entry || !draft || !cents) return;
              const cat = categories.find((c) => c.id === draft.categoryId);
              edit.mutate(
                {
                  id: entry.id,
                  category_id: draft.categoryId!,
                  amount: cents,
                  date: draft.date,
                  method: cat?.requires_reason ? draft.method : null,
                  reason_id: cat?.requires_reason ? draft.reasonId : null,
                  note: draft.note,
                },
                { onSuccess: onClose },
              );
            }}
          >
            {problem ?? 'Save'}
          </Button>
        </div>
      }
    >
      {draft ? <ExpenseForm draft={draft} onChange={setDraft} categories={categories} reasons={reasons} /> : null}
    </BottomSheet>
  );
}
