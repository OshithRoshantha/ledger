import type { BillItem, BillsResponse, Overview } from './types';

/** Pure helpers used by optimistic updates so Safe to spend reacts instantly. */

function status(safe: number, income: number): Overview['hero']['status'] {
  if (safe < 0) return 'danger';
  if (income && safe < income * 0.1) return 'warn';
  return 'ok';
}

function allowance(safe: number, days: number): number | null {
  if (!days) return null;
  return safe > 0 ? Math.round(safe / days / 100) * 100 : 0;
}

/** Recompute the hero after spending `spentDelta` and changing commitments by `committedDelta`. */
export function heroAfter(o: Overview, spentDelta: number, committedDelta = 0): Overview {
  const h = o.hero;
  const spent = h.spent + spentDelta;
  const balance = h.income - spent;
  const committed = Math.max(0, h.committed + committedDelta);
  const safe = balance - committed - h.reserved;
  return {
    ...o,
    hero: {
      ...h,
      spent,
      balance,
      committed,
      safe_to_spend: safe,
      status: status(safe, h.income),
      daily_allowance: allowance(safe, h.days_remaining),
      income_spent_pct: h.income ? Math.round((spent / h.income) * 1000) / 10 : null,
    },
  };
}

export function overviewAfterPay(o: Overview, bill: Pick<BillItem, 'id' | 'template_amount'>, amount: number, paid: boolean): Overview {
  const dir = paid ? 1 : -1;
  const next = heroAfter(o, dir * amount, -dir * bill.template_amount);
  return { ...next, pending_bills: paid ? o.pending_bills.filter((p) => p.id !== bill.id) : o.pending_bills };
}

export function billsAfterPay(b: BillsResponse, billId: string, amount: number, day: string | null): BillsResponse {
  let { paid_count, paid_amount, pending_amount } = b;
  const items = b.items.map((item) => {
    if (item.id !== billId) return item;
    if (day !== null && item.status === 'pending') {
      paid_count += 1;
      paid_amount += amount;
      pending_amount -= item.template_amount;
      return {
        ...item,
        status: 'paid' as const,
        payment: { id: 'optimistic', fixed_expense_id: item.id, cycle: b.cycle, amount_paid: amount, paid_at: '', day, note: '' },
      };
    }
    if (day === null && item.status === 'paid' && item.payment) {
      paid_count -= 1;
      paid_amount -= item.payment.amount_paid;
      pending_amount += item.template_amount;
      return { ...item, status: 'pending' as const, payment: null };
    }
    return item;
  });
  return { ...b, items, paid_count, paid_amount, pending_amount, total_amount: paid_amount + pending_amount };
}

/** Safe-to-spend after a prospective expense; used for the warn-never-block nudge. */
export function safeAfter(o: Overview | undefined, amount: number): number | null {
  if (!o || !o.meta.is_current) return null;
  return o.hero.safe_to_spend - amount;
}
