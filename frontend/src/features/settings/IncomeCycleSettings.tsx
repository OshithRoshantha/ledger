import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BottomSheet } from '@/components/sheets/BottomSheet';
import { Button, Field, inputClass } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { displayLabel, formatDay } from '@/lib/cycle';
import { centsToRaw, formatRs, parseToCents } from '@/lib/money';
import { invalidateMoney, useCycles, useSalary, useSettings } from '@/lib/queries';
import { useApp } from '@/lib/store';
import type { AppSettings, SalaryPreview } from '@/lib/types';
import { SubPage } from './shared';

const TIMEZONES = ['Asia/Colombo', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney', 'Europe/London', 'America/New_York', 'UTC'];

export default function IncomeCycleSettings() {
  const { data: salary } = useSalary();
  const { data: cycles = [] } = useCycles(12);
  const { data: settings } = useSettings();
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const setCycle = useApp((s) => s.setCycle);
  const [raw, setRaw] = useState('');
  const [day, setDay] = useState(5);
  const [preview, setPreview] = useState<SalaryPreview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!salary) return;
    setRaw(centsToRaw(salary.amount));
    setDay(salary.salary_day);
  }, [salary]);

  const run = async (key: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(key);
    try {
      await fn();
      invalidateMoney(qc);
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast({ message: msg, tone: 'success' });
    } catch (e) {
      toast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const cents = parseToCents(raw) ?? 0;
  const cur = salary?.current_cycle;

  return (
    <SubPage title="Income & Cycle">
      <section className="card space-y-4 p-4">
        <Field label="Monthly salary (Rs)" hint={cur ? `Applies from the ${cur.display} cycle onward. Past cycles keep their amount.` : undefined}>
          <div className="flex gap-2">
            <input className={inputClass + ' num flex-1'} inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value.replace(/[^\d.]/g, ''))} />
            <Button
              className="!h-12 !px-4"
              disabled={!cents || cents === salary?.amount}
              loading={busy === 'amount'}
              onClick={() => run('amount', () => api('/settings/salary', { method: 'PATCH', body: { amount: cents } }), 'Salary updated')}
            >
              Save
            </Button>
          </div>
        </Field>
        {salary && salary.history.length ? (
          <ul className="card-elevated divide-y divide-[var(--hairline)] text-[14px]">
            {[...salary.history].reverse().map((h) => (
              <li key={h.effective_from_cycle} className="flex justify-between px-3 py-2">
                <span className="text-muted">{h.effective_from_cycle === '2000-01' ? 'Starting salary' : `From ${displayLabel(h.effective_from_cycle)}`}</span>
                <span className="num">{formatRs(h.amount, { whole: true })}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <Field label="Salary day of the month" hint="A cycle runs from the salary day to the day before the next. Days 29–31 use the last day of shorter months.">
          <div className="flex gap-2">
            <select className={inputClass + ' flex-1'} value={day} onChange={(e) => setDay(Number(e.target.value))}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <Button
              className="!h-12 !px-4"
              variant="secondary"
              disabled={!salary || day === salary.salary_day}
              loading={busy === 'preview'}
              onClick={async () => {
                setBusy('preview');
                try {
                  setPreview(await api<SalaryPreview>('/settings/salary/preview', { method: 'POST', body: { salary_day: day } }));
                } catch (e) {
                  toast({ message: errorMessage(e), tone: 'error' });
                } finally {
                  setBusy(null);
                }
              }}
            >
              Review
            </Button>
          </div>
        </Field>
      </section>

      <section>
        <h2 className="section-title mb-2 px-1">Cycles</h2>
        <ul className="card overflow-hidden">
          {cycles.map((c) => (
            <li key={c.label} className="flex min-h-[52px] items-center gap-3 border-b border-hairline px-4 py-2 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">
                  {c.display}
                  {c.is_current ? <span className="ml-2 rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] font-semibold text-brand">Current</span> : null}
                  {c.is_override ? <span className="ml-2 rounded-full bg-[var(--warning-soft)] px-2 py-0.5 text-[11px] font-semibold text-warning">Moved start</span> : null}
                </span>
                <span className="num block text-[13px] text-muted">
                  {formatDay(c.start_date)} – {formatDay(c.end_date)} · {c.days} days
                </span>
              </span>
              <span className={clsx('num text-[13px]', c.closed ? 'text-muted' : '')}>{formatRs(c.salary_amount, { whole: true })}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 px-1 text-[13px] text-muted">Closed cycles never change. Early or late salaries can move a cycle’s start when you mark the salary received.</p>
      </section>

      <Prefs settings={settings} />

      <BottomSheet
        open={!!preview}
        onOpenChange={(o) => !o && setPreview(null)}
        title={`Change salary day to ${preview?.salary_day}?`}
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setPreview(null)}>
              Cancel
            </Button>
            <Button
              loading={busy === 'day'}
              onClick={async () => {
                await run('day', () => api('/settings/salary', { method: 'PATCH', body: { salary_day: preview!.salary_day } }), 'Salary day changed');
                setCycle(null);
                setPreview(null);
              }}
            >
              Confirm
            </Button>
          </div>
        }
      >
        {preview ? (
          <div className="space-y-3 text-[15px]">
            <p>
              The current cycle keeps its start ({formatDay(preview.current_cycle.start_date)}) and will now end on{' '}
              <b>{formatDay(preview.current_cycle.new_end_date)}</b> instead of {formatDay(preview.current_cycle.old_end_date)}. Closed cycles don’t change.
            </p>
            {preview.count === 0 ? (
              <p className="text-muted">No entries will move.</p>
            ) : (
              <>
                {preview.summary.map((s) => (
                  <p key={s} className="font-semibold text-warning">
                    {s}
                  </p>
                ))}
                <ul className="card-elevated divide-y divide-[var(--hairline)] text-[14px]">
                  {preview.moves.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate">{m.title}</span>
                        <span className="flex items-center gap-1 text-[12px] text-muted">
                          {formatDay(m.day)} · {m.from_display.split(' ')[0]} <ArrowRight size={12} aria-hidden /> {m.to_display.split(' ')[0]}
                        </span>
                      </span>
                      <span className="num shrink-0">{formatRs(m.amount, { whole: true })}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : null}
      </BottomSheet>
    </SubPage>
  );
}

function Prefs({ settings }: { settings?: AppSettings }) {
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const [tz, setTz] = useState('Asia/Colombo');
  const [reminder, setReminder] = useState(5);
  const [lock, setLock] = useState(10);
  const [target, setTarget] = useState('');
  useEffect(() => {
    if (!settings) return;
    setTarget(centsToRaw(settings.savings_target));
    setTz(settings.timezone);
    setReminder(settings.reminder_days_before_cycle_end);
    setLock(settings.auto_lock_minutes);
  }, [settings]);
  if (!settings) return null;
  return (
    <section>
      <h2 className="section-title mb-2 px-1">Preferences</h2>
      <div className="card space-y-4 p-4">
        <Field label="Monthly savings target (Rs)" hint="Kept aside every cycle: it comes out of Safe to spend.">
          <input className={inputClass + ' num'} inputMode="decimal" placeholder="0" value={target} onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ''))} />
        </Field>
        <Field label="Timezone">
          <select className={inputClass} value={tz} onChange={(e) => setTz(e.target.value)}>
            {[...new Set([settings.timezone, ...TIMEZONES])].map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Highlight unpaid bills in the last N days">
          <input type="number" inputMode="numeric" min={0} max={15} className={inputClass} value={reminder} onChange={(e) => setReminder(Number(e.target.value))} />
        </Field>
        <Field label="Auto-lock after (minutes)">
          <input type="number" inputMode="numeric" min={1} max={60} className={inputClass} value={lock} onChange={(e) => setLock(Number(e.target.value))} />
        </Field>
        <Button
          block
          variant="secondary"
          onClick={async () => {
            try {
              await api('/settings', { method: 'PATCH', body: { timezone: tz, reminder_days_before_cycle_end: reminder, auto_lock_minutes: lock, savings_target: parseToCents(target || '0') ?? 0 } });
              await qc.invalidateQueries();
              toast({ message: 'Saved', tone: 'success' });
            } catch (e) {
              toast({ message: errorMessage(e), tone: 'error' });
            }
          }}
        >
          Save preferences
        </Button>
      </div>
    </section>
  );
}
