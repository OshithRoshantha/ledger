import clsx from 'clsx';
import { AlertTriangle } from 'lucide-react';
import { useRef } from 'react';
import { AmountDisplay, Keypad } from '@/components/keypad/Keypad';
import { AttributionChip } from '@/components/ui/AttributionChip';
import { Chip, inputClass } from '@/components/ui/primitives';
import { isoDay } from '@/lib/cycle';
import { formatRs } from '@/lib/money';
import type { Category, Method, Reason } from '@/lib/types';

export const REASON_METHODS: { value: Method; label: string; icon: string }[] = [
  { value: 'atm', label: 'ATM withdrawal', icon: 'banknote' },
  { value: 'bank_transfer', label: 'Bank transfer', icon: 'landmark' },
  { value: 'card', label: 'Card payment', icon: 'credit-card' },
];

export interface ExpenseDraft {
  raw: string;
  categoryId: string | null;
  method: Method | null;
  reasonId: string | null;
  date: string;
  note: string;
}

/** Amount + category + (method & reason when required) + date + note. Shared by Quick Add and edit. */
export function ExpenseForm({
  draft,
  onChange,
  categories,
  reasons,
  nudge,
  showCategories = true,
}: {
  draft: ExpenseDraft;
  onChange: (d: ExpenseDraft) => void;
  categories: Category[];
  reasons: Reason[];
  nudge?: number | null;
  showCategories?: boolean;
}) {
  const category = categories.find((c) => c.id === draft.categoryId);
  const set = (patch: Partial<ExpenseDraft>) => onChange({ ...draft, ...patch });
  const dateRef = useRef<HTMLInputElement>(null);
  const today = isoDay();
  const yesterday = isoDay(new Date(Date.now() - 86_400_000));

  return (
    <div className="space-y-3">
      <AmountDisplay value={draft.raw} tone={nudge !== null && nudge !== undefined && nudge < 0 ? 'danger' : undefined} />
      {nudge !== null && nudge !== undefined && nudge < 0 ? (
        <p role="status" className="-mt-2 flex items-center justify-center gap-1.5 text-center text-[14px] font-medium text-warning">
          <AlertTriangle size={16} aria-hidden />
          This leaves {formatRs(nudge, { whole: true })} after your bills and savings.
        </p>
      ) : null}

      {showCategories ? (
        <div className="scroll-pane -mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="radiogroup" aria-label="Category">
          {categories
            .filter((c) => c.is_active || c.id === draft.categoryId)
            .map((c) => (
              <Chip
                key={c.id}
                role="radio"
                aria-checked={draft.categoryId === c.id}
                selected={draft.categoryId === c.id}
                icon={c.icon}
                colour={c.colour}
                onClick={() => set({ categoryId: c.id })}
              >
                {c.name}
              </Chip>
            ))}
        </div>
      ) : null}

      {category?.requires_reason ? (
        <div className="space-y-2 py-1">
          <div className="scroll-pane -mx-4 flex gap-2 overflow-x-auto px-4" role="radiogroup" aria-label="Method">
            {REASON_METHODS.map((m) => (
              <Chip key={m.value} role="radio" aria-checked={draft.method === m.value} selected={draft.method === m.value} icon={m.icon} onClick={() => set({ method: m.value })}>
                {m.label}
              </Chip>
            ))}
          </div>
          <div className="scroll-pane -mx-4 flex gap-2 overflow-x-auto px-4" role="radiogroup" aria-label="Reason">
            {reasons
              .filter((r) => r.is_active || r.id === draft.reasonId)
              .map((r) => (
                <Chip key={r.id} role="radio" aria-checked={draft.reasonId === r.id} selected={draft.reasonId === r.id} icon={r.icon} colour={r.colour} onClick={() => set({ reasonId: r.id })}>
                  {r.name}
                </Chip>
              ))}
          </div>
        </div>
      ) : null}

      <Keypad value={draft.raw} onChange={(raw) => set({ raw })} compact />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-2" role="radiogroup" aria-label="Date">
          <Chip role="radio" aria-checked={draft.date === today} selected={draft.date === today} onClick={() => set({ date: today })}>
            Today
          </Chip>
          <Chip role="radio" aria-checked={draft.date === yesterday} selected={draft.date === yesterday} onClick={() => set({ date: yesterday })}>
            Yesterday
          </Chip>
          <label className={clsx('relative inline-flex h-11 items-center rounded-full border px-3.5 text-[15px] font-medium', draft.date !== today && draft.date !== yesterday ? 'border-transparent bg-brand text-white' : 'border-hairline bg-elevated')}>
            <span>{draft.date !== today && draft.date !== yesterday ? draft.date.slice(5).split('-').reverse().join('/') : 'Pick'}</span>
            <input
              ref={dateRef}
              type="date"
              aria-label="Pick date"
              className="absolute inset-0 opacity-0"
              value={draft.date}
              onChange={(e) => e.target.value && set({ date: e.target.value })}
            />
          </label>
        </div>
        <AttributionChip day={draft.date} />
      </div>
      <input
        className={inputClass}
        placeholder="Note (optional)"
        maxLength={280}
        value={draft.note}
        onChange={(e) => set({ note: e.target.value })}
        aria-label="Note"
      />
    </div>
  );
}

export function draftProblem(draft: ExpenseDraft, categories: Category[], cents: number | null): string | null {
  if (!cents || cents <= 0) return 'Enter an amount';
  const cat = categories.find((c) => c.id === draft.categoryId);
  if (!cat) return 'Pick a category';
  if (cat.requires_reason && !draft.method) return 'Pick a method';
  if (cat.requires_reason && !draft.reasonId) return 'Pick a reason';
  return null;
}
