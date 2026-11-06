import { billsAfterPay, heroAfter, overviewAfterPay, safeAfter } from './optimistic';
import type { BillsResponse, Overview } from './types';

const overview = {
  meta: { is_current: true, start: '2026-11-05', end: '2026-12-04' },
  hero: {
    safe_to_spend: 9_610_000, balance: 14_000_000, committed: 4_390_000, reserved: 0, savings_target: 0, projected_savings: 0, income: 15_000_000, spent: 1_000_000,
    daily_allowance: 417_800, days_remaining: 23, status: 'ok', elapsed_pct: 27, income_spent_pct: 6.7, pace_warning: false,
  },
  pending_bills: [{ id: 'elec', name: 'Electricity', amount: 200_000, icon: 'zap', colour: '#000000' }],
} as unknown as Overview;

describe('heroAfter (instant Safe to spend + daily allowance)', () => {
  it('an expense lowers safe-to-spend and the daily allowance', () => {
    const o = heroAfter(overview, 230_000);
    expect(o.hero.safe_to_spend).toBe(9_380_000);
    expect(o.hero.daily_allowance).toBe(Math.round(9_380_000 / 23 / 100) * 100);
    expect(o.hero.balance).toBe(13_770_000);
  });
  it('the savings target is kept out of safe-to-spend', () => {
    const o = heroAfter({ ...overview, hero: { ...overview.hero, savings_target: 3_000_000 } }, 0);
    expect(o.hero.safe_to_spend).toBe(9_610_000 - 3_000_000);
  });
  it('reserved goal money is kept out of safe-to-spend', () => {
    const o = heroAfter({ ...overview, hero: { ...overview.hero, reserved: 1_000_000 } }, 0);
    expect(o.hero.safe_to_spend).toBe(9_610_000 - 1_000_000);
  });
});

describe('overviewAfterPay', () => {
  it('reduces balance by the paid amount and committed by the template', () => {
    const o = overviewAfterPay(overview, { id: 'elec', template_amount: 200_000 }, 235_000, true);
    expect(o.hero.balance).toBe(14_000_000 - 235_000);
    expect(o.hero.committed).toBe(4_390_000 - 200_000);
    expect(o.hero.safe_to_spend).toBe(9_610_000 - 35_000);
    expect(o.pending_bills).toHaveLength(0);
  });
  it('unpaying restores the totals', () => {
    const paid = overviewAfterPay(overview, { id: 'elec', template_amount: 200_000 }, 235_000, true);
    const back = overviewAfterPay(paid, { id: 'elec', template_amount: 200_000 }, 235_000, false);
    expect(back.hero.safe_to_spend).toBe(overview.hero.safe_to_spend);
    expect(back.hero.committed).toBe(overview.hero.committed);
  });
  it('flags danger when safe-to-spend goes negative', () => {
    expect(overviewAfterPay(overview, { id: 'elec', template_amount: 200_000 }, 10_000_000, true).hero.status).toBe('danger');
  });
});

describe('billsAfterPay', () => {
  const bills: BillsResponse = {
    cycle: '2026-11', start_date: '2026-11-05', end_date: '2026-12-04', is_current: true, reminder_window: false,
    groups: ['Utility Bills'],
    items: [{ id: 'elec', name: 'Electricity', group: 'Utility Bills', icon: 'zap', colour: '#000', template_amount: 200_000, status: 'pending', payment: null }],
    paid_count: 0, total_count: 1, paid_amount: 0, pending_amount: 200_000, total_amount: 200_000,
  };
  it('marks paid then unpaid', () => {
    const paid = billsAfterPay(bills, 'elec', 235_000, '2026-11-10');
    expect(paid.items[0].status).toBe('paid');
    expect(paid.paid_amount).toBe(235_000);
    const back = billsAfterPay(paid, 'elec', 0, null);
    expect(back.items[0].status).toBe('pending');
    expect(back.total_amount).toBe(200_000);
  });
});

describe('safeAfter (warn, never block)', () => {
  it('computes the nudge for the current cycle only', () => {
    expect(safeAfter(overview, 10_000_000)).toBe(-390_000);
    expect(safeAfter({ ...overview, meta: { ...overview.meta, is_current: false } }, 10_000_000)).toBeNull();
    expect(safeAfter(undefined, 1)).toBeNull();
  });
});
