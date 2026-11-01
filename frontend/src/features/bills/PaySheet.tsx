import { useEffect, useState } from 'react';
import { AmountDisplay, Keypad } from '@/components/keypad/Keypad';
import { BottomSheet } from '@/components/sheets/BottomSheet';
import { AttributionChip } from '@/components/ui/AttributionChip';
import { Button, Field, inputClass } from '@/components/ui/primitives';
import { formatDay, isoDay } from '@/lib/cycle';
import { centsToRaw, formatRs, parseToCents } from '@/lib/money';
import { usePayBill, useUnpayBill } from '@/lib/queries';
import type { BillItem } from '@/lib/types';

export function PaySheet({ bill, cycle, defaultDay, onClose }: { bill: BillItem | null; cycle?: string; defaultDay?: string; onClose: () => void }) {
  const [raw, setRaw] = useState('');
  const [date, setDate] = useState(isoDay());
  const [note, setNote] = useState('');
  const pay = usePayBill(cycle);
  const unpay = useUnpayBill(cycle);

  useEffect(() => {
    if (bill) {
      setRaw(centsToRaw(bill.template_amount));
      setDate(defaultDay ?? isoDay());
      setNote('');
    }
  }, [bill]);

  const cents = parseToCents(raw) ?? 0;
  const paid = bill?.status === 'paid' && bill.payment;
  const diff = bill ? cents - bill.template_amount : 0;

  return (
    <BottomSheet
      open={!!bill}
      onOpenChange={(o) => !o && onClose()}
      title={bill ? (paid ? bill.name : `Pay ${bill.name}`) : ''}
      footer={
        bill ? (
          paid ? (
            <Button
              variant="danger"
              block
              disabled={bill.payment!.id === 'optimistic'}
              onClick={() => {
                unpay.mutate(bill);
                onClose();
              }}
            >
              Mark unpaid
            </Button>
          ) : (
            <Button
              block
              disabled={cents <= 0}
              onClick={() => {
                pay.mutate({ bill, amount: cents, date, note });
                onClose();
              }}
            >
              Mark paid · {formatRs(cents, { whole: cents % 100 === 0 })}
            </Button>
          )
        ) : null
      }
    >
      {bill && paid ? (
        <dl className="space-y-3 py-2">
          <Row label="Amount paid" value={formatRs(bill.payment!.amount_paid)} />
          <Row label="Usual amount" value={formatRs(bill.template_amount)} />
          <Row label="Paid on" value={formatDay(bill.payment!.day, { weekday: 'short', day: 'numeric', month: 'long' })} />
          {bill.payment!.note ? <Row label="Note" value={bill.payment!.note} /> : null}
        </dl>
      ) : bill ? (
        <div className="space-y-3">
          <AmountDisplay value={raw} />
          <p className="-mt-2 text-center text-[13px] text-muted" aria-live="polite">
            {diff === 0
              ? `Usual amount ${formatRs(bill.template_amount, { whole: true })}`
              : `${formatRs(Math.abs(diff), { whole: true })} ${diff > 0 ? 'above' : 'below'} usual · this cycle only`}
          </p>
          <Keypad value={raw} onChange={setRaw} compact />
          <Field label="Paid on">
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" className={inputClass + ' !w-auto min-w-0 flex-1 basis-40'} value={date} max="2100-12-31" onChange={(e) => setDate(e.target.value || isoDay())} />
              <AttributionChip day={date} />
            </div>
          </Field>
          <Field label="Note">
            <input className={inputClass} value={note} maxLength={280} placeholder="Optional" onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      ) : null}
    </BottomSheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-hairline pb-3 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="num font-medium">{value}</dd>
    </div>
  );
}
