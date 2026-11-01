import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { Button } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { formatDay, monthName } from '@/lib/cycle';
import { overrideCycleStart } from '@/lib/queries';
import { useApp } from '@/lib/store';
import type { ResolveResult } from '@/lib/types';

export interface OverrideAsk {
  date: string;
  resolve: ResolveResult;
}

/**
 * Early / late salary: "Start November cycle on 4 Nov?"
 * Yes  -> the cycle starts on the received date (entries in the gap are re-assigned).
 * No   -> the salary is recorded on the usual salary date instead.
 */
export function SalaryOverridePrompt({ ask, onDone }: { ask: OverrideAsk | null; onDone: (decision: { date: string } | null) => void }) {
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const target = ask?.resolve.salary_cycle;
  const nameMonth = target ? monthName(target.label) : '';

  return (
    <BottomSheet
      open={!!ask}
      onOpenChange={(o) => !o && onDone(null)}
      title={ask && target ? `Start ${nameMonth} cycle on ${formatDay(ask.date)}?` : ''}
      footer={
        ask && target ? (
          <div className="grid gap-2">
            <Button
              block
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const res = await overrideCycleStart(qc, target.label, ask.date);
                  toast({ message: `${nameMonth} cycle starts ${formatDay(ask.date)}${res.moved.length ? ` · ${res.moved.length} moved` : ''}`, tone: 'success' });
                  onDone({ date: ask.date });
                } catch (e) {
                  toast({ message: errorMessage(e), tone: 'error' });
                  onDone(null);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Yes, start on {formatDay(ask.date)}
            </Button>
            <Button variant="secondary" block onClick={() => onDone({ date: target.start_date })}>
              No, keep {formatDay(target.start_date)}
            </Button>
          </div>
        ) : null
      }
    >
      {ask && target ? (
        <p className="pb-2 text-[15px] text-muted">
          Your salary usually arrives on {formatDay(target.start_date)}. Starting the {nameMonth} cycle on {formatDay(ask.date)} means anything you spend from
          that day comes out of this salary{target.offset_days > 0 ? ', and spending before it stays with the previous one' : ''}.
        </p>
      ) : null}
    </BottomSheet>
  );
}
