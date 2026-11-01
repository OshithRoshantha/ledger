import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AmountDisplay, Keypad } from '@/components/keypad/Keypad';
import { BottomSheet } from '@/components/sheets/BottomSheet';
import { SalaryOverridePrompt, type OverrideAsk } from '@/components/sheets/SalaryOverridePrompt';
import { Button, Chip, Segmented, inputClass } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { isoDay } from '@/lib/cycle';
import { safeAfter } from '@/lib/optimistic';
import { formatRs, parseToCents } from '@/lib/money';
import { useAddExpense, useAddIncome, useCategories, useOverview, useReasons, useSettings, useSources } from '@/lib/queries';
import { useApp } from '@/lib/store';
import type { ResolveResult } from '@/lib/types';
import { draftProblem, ExpenseForm, type ExpenseDraft } from './ExpenseForm';

export function QuickAddSheet() {
  const { open, preset } = useApp((s) => s.quickAdd);
  const close = useApp((s) => s.closeQuickAdd);
  const compare = useApp((s) => s.compare);
  const { data: settings } = useSettings();
  const { data: categories = [] } = useCategories();
  const { data: reasons = [] } = useReasons();
  const { data: sources = [] } = useSources();
  const { data: overview } = useOverview(settings?.current_cycle, compare);
  const addExpense = useAddExpense();
  const addIncome = useAddIncome();
  const qc = useQueryClient();

  const [mode, setMode] = useState<'expense' | 'income'>('expense');
  const [draft, setDraft] = useState<ExpenseDraft>(blank(null));
  const [incomeRaw, setIncomeRaw] = useState('');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [incomeNote, setIncomeNote] = useState('');
  const [ask, setAsk] = useState<OverrideAsk | null>(null);

  // Reset on open, remembering the last-used category / reason / method.
  useEffect(() => {
    if (!open) return;
    setMode(preset?.mode ?? 'expense');
    const fallback = categories.find((c) => c.is_active)?.id ?? null;
    const categoryId = preset?.categoryId ?? settings?.last_category_id ?? fallback;
    setDraft({ ...blank(categoryId), method: settings?.last_method ?? null, reasonId: settings?.last_reason_id ?? null });
    setIncomeRaw('');
    setIncomeNote('');
    setSourceId(sources.find((s) => s.type === 'variable' && s.is_active)?.id ?? sources[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const cents = parseToCents(draft.raw);
  const problem = draftProblem(draft, categories, cents);
  // the nudge only applies when the entry lands in the current cycle
  const inCurrent = overview && overview.meta.start <= draft.date && draft.date <= overview.meta.end;
  const nudge = cents && inCurrent ? safeAfter(overview, cents) : null;
  const incomeCents = parseToCents(incomeRaw) ?? 0;
  const source = sources.find((s) => s.id === sourceId);

  const submitExpense = () => {
    if (problem || !cents) return;
    const cat = categories.find((c) => c.id === draft.categoryId)!;
    addExpense.mutate(
      {
        category_id: cat.id,
        amount: cents,
        date: draft.date,
        method: cat.requires_reason ? draft.method : null,
        reason_id: cat.requires_reason ? draft.reasonId : null,
        note: draft.note,
      },
      { onSuccess: close },
    );
  };

  const saveIncome = (date: string) => {
    if (!sourceId || incomeCents <= 0) return;
    addIncome.mutate({ source_id: sourceId, amount: incomeCents, date, note: incomeNote }, { onSuccess: close });
  };

  const submitIncome = async () => {
    // A salary received away from its usual day: ask whether the cycle should start on that day.
    if (source?.type === 'fixed') {
      const r = await qc.fetchQuery({ queryKey: ['resolve', draft.date], queryFn: () => api<ResolveResult>(`/cycles/resolve?date=${draft.date}`) });
      if (r.salary_cycle.can_override) {
        setAsk({ date: draft.date, resolve: r });
        return;
      }
    }
    saveIncome(draft.date);
  };

  return (
    <>
      <BottomSheet
        open={open}
        onOpenChange={(o) => !o && close()}
        title={mode === 'expense' ? 'Add expense' : 'Add income'}
        footer={
          mode === 'expense' ? (
            <Button block disabled={!!problem} loading={addExpense.isPending} onClick={submitExpense}>
              {problem ?? `Add ${formatRs(cents ?? 0, { whole: (cents ?? 0) % 100 === 0 })}`}
            </Button>
          ) : (
            <Button block disabled={!sourceId || incomeCents <= 0} loading={addIncome.isPending} onClick={submitIncome}>
              {incomeCents > 0 ? `Add income ${formatRs(incomeCents, { whole: incomeCents % 100 === 0 })}` : 'Enter an amount'}
            </Button>
          )
        }
      >
        <div className="mb-3">
          <Segmented
            label="Entry type"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'expense', label: 'Expense' },
              { value: 'income', label: 'Income' },
            ]}
          />
        </div>
        {mode === 'expense' ? (
          <ExpenseForm draft={draft} onChange={setDraft} categories={categories} reasons={reasons} nudge={nudge} />
        ) : (
          <div className="space-y-3">
            <AmountDisplay value={incomeRaw} />
            <div className="scroll-pane -mx-4 flex gap-2 overflow-x-auto px-4" role="radiogroup" aria-label="Income source">
              {sources
                .filter((s) => s.is_active)
                .map((s) => (
                  <Chip key={s.id} role="radio" aria-checked={sourceId === s.id} selected={sourceId === s.id} icon={s.type === 'fixed' ? 'briefcase' : 'piggy-bank'} onClick={() => setSourceId(s.id)}>
                    {s.name}
                  </Chip>
                ))}
            </div>
            <Keypad value={incomeRaw} onChange={setIncomeRaw} compact />
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" className={inputClass + ' !w-auto min-w-0 flex-1 basis-40'} value={draft.date} aria-label="Date" onChange={(e) => e.target.value && setDraft({ ...draft, date: e.target.value })} />
            </div>
            <input className={inputClass} placeholder="Note (optional)" maxLength={280} value={incomeNote} aria-label="Note" onChange={(e) => setIncomeNote(e.target.value)} />
          </div>
        )}
      </BottomSheet>
      <SalaryOverridePrompt
        ask={ask}
        onDone={(decision) => {
          setAsk(null);
          if (decision) saveIncome(decision.date);
        }}
      />
    </>
  );
}

function blank(categoryId: string | null): ExpenseDraft {
  return { raw: '', categoryId, method: null, reasonId: null, date: isoDay(), note: '' };
}
