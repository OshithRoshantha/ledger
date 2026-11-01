import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronLeft, Plus } from 'lucide-react';
import { SalaryOverridePrompt, type OverrideAsk } from '@/components/sheets/SalaryOverridePrompt';
import { api } from '@/lib/api';
import type { ResolveResult } from '@/lib/types';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AmountDisplay, Keypad } from '@/components/keypad/Keypad';
import { CycleSwitcher, PageHeader } from '@/components/layout/PageHeader';
import { BottomSheet } from '@/components/sheets/BottomSheet';
import { Button, Card, EmptyState, Field, IconBadge, Skeleton, inputClass } from '@/components/ui/primitives';
import { SwipeRow } from '@/components/ui/SwipeRow';
import { formatDay, isoDay } from '@/lib/cycle';
import { centsToRaw, formatRs, parseToCents } from '@/lib/money';
import { useActiveCycle, useEditIncome, useIncome, useSoftDelete } from '@/lib/queries';
import { useApp } from '@/lib/store';
import type { IncomeEntry } from '@/lib/types';

export default function IncomePage() {
  const cycle = useActiveCycle();
  const { data, isLoading } = useIncome(cycle);
  const del = useSoftDelete('income');
  const openQuickAdd = useApp((s) => s.openQuickAdd);
  const navigate = useNavigate();
  const [editing, setEditing] = useState<IncomeEntry | null>(null);
  const pending = data?.items.filter((i) => i.status === 'pending') ?? [];
  const received = data?.items.filter((i) => i.status === 'received') ?? [];

  return (
    <>
      <PageHeader
        title="Income"
        back={
          <button type="button" className="tap -ml-3 flex items-center justify-center text-brand" onClick={() => navigate(-1)} aria-label="Back">
            <ChevronLeft size={28} aria-hidden />
          </button>
        }
        right={
          <button type="button" className="tap flex items-center justify-center text-brand" onClick={() => openQuickAdd({ mode: 'income' })} aria-label="Add other income">
            <Plus size={26} aria-hidden />
          </button>
        }
      >
        <CycleSwitcher />
      </PageHeader>
      <div className="space-y-4 px-4 pt-4">
        {isLoading || !data ? (
          <Skeleton className="h-48 w-full !rounded-[20px]" />
        ) : (
          <>
            <div className="px-1">
              <p className="label">Received this cycle</p>
              <p className="num text-[32px] font-semibold text-positive">{formatRs(data.received_total)}</p>
              {data.pending_total ? <p className="num text-[14px] text-muted">{formatRs(data.pending_total)} pending</p> : null}
            </div>

            {pending.map((p) => (
              <Card key={p.id} className="flex items-center gap-3 p-4" style={{ borderColor: 'var(--brand-soft)' }}>
                <IconBadge icon="briefcase" colour="#6366F1" />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium">{p.source_name} pending</p>
                  <p className="num text-[14px] text-muted">{formatRs(p.amount)}</p>
                </div>
                <Button className="!h-11 !px-4" onClick={() => setEditing(p)}>
                  Received
                </Button>
              </Card>
            ))}

            {received.length === 0 && pending.length === 0 ? (
              <Card>
                <EmptyState
                  title="No income yet"
                  body="Add your salary to get started."
                  action={<Button onClick={() => openQuickAdd({ mode: 'income' })}>Add income</Button>}
                />
              </Card>
            ) : received.length ? (
              <Card className="overflow-hidden">
                <ul>
                  {received.map((e) => (
                    <li key={e.id} className="border-b border-hairline last:border-0">
                      <SwipeRow label={`${e.source_name} ${formatRs(e.amount)}`} onEdit={() => setEditing(e)} onDelete={() => del.mutate(e.id)}>
                        <button type="button" onClick={() => setEditing(e)} className="flex min-h-[60px] w-full items-center gap-3 px-4 py-3 text-left">
                          <IconBadge icon={e.source_type === 'fixed' ? 'briefcase' : 'piggy-bank'} colour="#22C55E" size={36} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[15px]">{e.source_name}</p>
                            <p className="truncate text-[13px] text-muted">
                              {formatDay(e.day)}
                              {e.note ? ` · ${e.note}` : ''}
                            </p>
                          </div>
                          <span className="num text-[16px] font-medium text-positive">+{formatRs(e.amount).slice(3)}</span>
                        </button>
                      </SwipeRow>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
            <Button variant="secondary" block onClick={() => openQuickAdd({ mode: 'income' })}>
              <Plus size={18} aria-hidden /> Add other income
            </Button>
          </>
        )}
      </div>
      <IncomeSheet entry={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function IncomeSheet({ entry, onClose }: { entry: IncomeEntry | null; onClose: () => void }) {
  const edit = useEditIncome();
  const [raw, setRaw] = useState('');
  const [date, setDate] = useState(isoDay());
  const [note, setNote] = useState('');
  const [lastId, setLastId] = useState<string | null>(null);
  if (entry && entry.id !== lastId) {
    setLastId(entry.id);
    setRaw(centsToRaw(entry.amount));
    setDate(entry.status === 'pending' ? isoDay() : entry.day);
    setNote(entry.note);
  }
  if (!entry && lastId) setLastId(null);
  const cents = parseToCents(raw) ?? 0;
  const confirming = entry?.status === 'pending';
  const qc = useQueryClient();
  const [ask, setAsk] = useState<OverrideAsk | null>(null);

  const save = (day: string) =>
    entry &&
    edit.mutate({ id: entry.id, amount: cents, date: day, note, ...(confirming ? { status: 'received' as const } : {}) }, { onSuccess: onClose });

  const submit = async () => {
    if (!entry) return;
    // Salary received on a day other than the cycle's start: offer to move the start (early/late salary).
    if (entry.source_type === 'fixed' && date !== entry.day) {
      const r = await qc.fetchQuery({ queryKey: ['resolve', date], queryFn: () => api<ResolveResult>(`/cycles/resolve?date=${date}`) });
      if (r.salary_cycle.can_override && r.salary_cycle.label === entry.cycle) {
        setAsk({ date, resolve: r });
        return;
      }
    }
    save(date);
  };

  return (
    <>
    <SalaryOverridePrompt
      ask={ask}
      onDone={(decision) => {
        setAsk(null);
        if (decision) save(decision.date);
      }}
    />
    <BottomSheet
      open={!!entry}
      onOpenChange={(o) => !o && onClose()}
      title={confirming ? `Confirm ${entry?.source_name}` : 'Edit income'}
      footer={
        <Button
          block
          disabled={cents <= 0}
          loading={edit.isPending}
          onClick={submit}
        >
          {confirming ? (
            <>
              <CheckCircle2 size={18} aria-hidden /> Mark received
            </>
          ) : (
            'Save'
          )}
        </Button>
      }
    >
      <div className="space-y-3">
        <AmountDisplay value={raw} />
        <Keypad value={raw} onChange={setRaw} compact />
        <Field label={confirming ? 'Received on' : 'Date'}>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" className={inputClass + ' !w-auto min-w-0 flex-1 basis-40'} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </div>
        </Field>
        <Field label="Note">
          <input className={inputClass} value={note} maxLength={280} placeholder="Optional" onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </BottomSheet>
    </>
  );
}
