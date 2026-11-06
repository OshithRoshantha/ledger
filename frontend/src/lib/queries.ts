import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, errorMessage } from './api';
import { displayLabel } from './cycle';
import { billsAfterPay, heroAfter, overviewAfterPay } from './optimistic';
import { useApp } from './store';
import { haptic } from './haptics';
import type {
  AppSettings,
  BillItem,
  BillsResponse,
  BillsTab,
  Category,
  CompareMode,
  CycleInfo,
  ExpenseEntry,
  FixedTemplate,
  IncomeResponse,
  IncomeSource,
  Method,
  Overview,
  PlanTab,
  Reason,
  ResolveResult,
  SalarySettings,
  SpendingSummary,
  SpendingTab,
  TrendsTab,
} from './types';

const q = (cycle?: string) => (cycle ? `?cycle=${cycle}` : '');

// ---------------------------------------------------------------- reads

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api<AppSettings>('/settings'), staleTime: 60_000 });
}

/** Selected cycle, defaulting to the current one. */
export function useActiveCycle(): string | undefined {
  const selected = useApp((s) => s.cycle);
  const { data } = useSettings();
  return selected ?? data?.current_cycle;
}

export const overviewKey = (cycle?: string, compare: CompareMode = 'last') => ['overview', cycle, compare] as const;

export function useOverview(cycle?: string, compare: CompareMode = 'last') {
  return useQuery({
    queryKey: overviewKey(cycle, compare),
    queryFn: () => api<Overview>(`/analytics/overview?cycle=${cycle}&compare=${compare}`),
    enabled: !!cycle,
    placeholderData: keepPreviousData,
  });
}

export type TabName = 'overview' | 'spending' | 'bills' | 'trends' | 'plan';

export function tabQuery(tab: TabName, cycle: string, compare: CompareMode) {
  const path: Record<TabName, string> = {
    overview: `/analytics/overview?cycle=${cycle}&compare=${compare}`,
    spending: `/analytics/spending?cycle=${cycle}&compare=${compare}`,
    bills: `/analytics/bills?cycle=${cycle}&months=12`,
    trends: `/analytics/trends?cycle=${cycle}&months=12`,
    plan: `/analytics/plan?cycle=${cycle}`,
  };
  const key = tab === 'overview' ? overviewKey(cycle, compare) : ['tab', tab, cycle, tab === 'spending' ? compare : null];
  return { queryKey: key, queryFn: () => api(path[tab]) };
}

export function useTab<T>(tab: Exclude<TabName, 'overview'>, cycle: string | undefined, compare: CompareMode) {
  return useQuery({
    ...tabQuery(tab, cycle ?? '', compare),
    queryFn: tabQuery(tab, cycle ?? '', compare).queryFn as () => Promise<T>,
    enabled: !!cycle,
    placeholderData: keepPreviousData,
  });
}

export const useSpendingTab = (cycle?: string, compare: CompareMode = 'last') => useTab<SpendingTab>('spending', cycle, compare);
export const useBillsTab = (cycle?: string) => useTab<BillsTab>('bills', cycle, 'last');
export const useTrendsTab = (cycle?: string) => useTab<TrendsTab>('trends', cycle, 'last');
export const usePlanTab = (cycle?: string) => useTab<PlanTab>('plan', cycle, 'last');

export function useBills(cycle?: string) {
  return useQuery({ queryKey: ['bills', cycle], queryFn: () => api<BillsResponse>(`/fixed-expenses${q(cycle)}`), enabled: !!cycle });
}

export function useSpending(cycle?: string) {
  return useQuery({ queryKey: ['spending', cycle], queryFn: () => api<SpendingSummary>(`/spending/summary${q(cycle)}`), enabled: !!cycle });
}

export function useExpenses(cycle?: string, filter: { categoryId?: string; day?: string } = {}) {
  const params = new URLSearchParams();
  if (cycle) params.set('cycle', cycle);
  if (filter.categoryId) params.set('category_id', filter.categoryId);
  if (filter.day) params.set('day', filter.day);
  return useQuery({
    queryKey: ['expenses', cycle, filter.categoryId ?? null, filter.day ?? null],
    queryFn: () => api<{ total: number; items: ExpenseEntry[] }>(`/expenses?${params}`),
    enabled: !!cycle,
  });
}

export function useIncome(cycle?: string) {
  return useQuery({ queryKey: ['income', cycle], queryFn: () => api<IncomeResponse>(`/income${q(cycle)}`), enabled: !!cycle });
}

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories'), staleTime: 5 * 60_000 });
}

export function useReasons() {
  return useQuery({ queryKey: ['reasons'], queryFn: () => api<Reason[]>('/reasons'), staleTime: 5 * 60_000 });
}

export function useSources() {
  return useQuery({ queryKey: ['sources'], queryFn: () => api<IncomeSource[]>('/income-sources'), staleTime: 5 * 60_000 });
}

export function useTemplates() {
  return useQuery({ queryKey: ['templates'], queryFn: () => api<FixedTemplate[]>('/settings/fixed-expenses') });
}

export function useSalary() {
  return useQuery({ queryKey: ['salary'], queryFn: () => api<SalarySettings>('/settings/salary') });
}

export function useCycles(back = 12) {
  return useQuery({ queryKey: ['cycles', back], queryFn: () => api<CycleInfo[]>(`/cycles?back=${back}`) });
}

/** Which salary an entry dated `day` comes from (the attribution chip). Server decides. */
export function useResolve(day: string | undefined) {
  return useQuery({
    queryKey: ['resolve', day],
    queryFn: () => api<ResolveResult>(`/cycles/resolve?date=${day}`),
    enabled: !!day && /^\d{4}-\d{2}-\d{2}$/.test(day),
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------- writes

export function invalidateMoney(qc: QueryClient) {
  for (const key of ['overview', 'tab', 'bills', 'spending', 'expenses', 'income', 'cycles', 'resolve', 'salary']) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}

function useToastError() {
  const toast = useApp((s) => s.toast);
  return (e: unknown) => toast({ message: errorMessage(e), tone: 'error' });
}

/** Apply `fn` to every cached overview whose cycle contains `day` (the server attributes by date). */
function patchOverviews(qc: QueryClient, day: string, fn: (o: Overview) => Overview) {
  const snapshot = qc.getQueriesData<Overview>({ queryKey: ['overview'] });
  for (const [key, data] of snapshot) {
    if (data && data.meta.start <= day && day <= data.meta.end) qc.setQueryData(key, fn(data));
  }
  return snapshot;
}

function restore(qc: QueryClient, snapshot?: [readonly unknown[], unknown][]) {
  for (const [key, data] of snapshot ?? []) qc.setQueryData(key, data);
}

export interface ExpenseInput {
  category_id: string;
  amount: number;
  date: string;
  method?: Method | null;
  reason_id?: string | null;
  note?: string;
}

export function useAddExpense() {
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const onError = useToastError();
  return useMutation({
    mutationFn: (body: ExpenseInput) => api<ExpenseEntry>('/expenses', { method: 'POST', body }),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: ['overview'] });
      return { snapshot: patchOverviews(qc, body.date, (o) => heroAfter(o, body.amount)) };
    },
    onSuccess: (entry) => {
      haptic('success');
      invalidateMoney(qc);
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast({
        message: `Added · from ${displayLabel(entry.cycle).split(' ')[0]} salary`,
        tone: 'success',
        action: { label: 'Undo', onClick: () => api(`/expenses/${entry.id}`, { method: 'DELETE' }).then(() => invalidateMoney(qc)) },
      });
    },
    onError: (e, _v, ctx) => {
      restore(qc, ctx?.snapshot);
      onError(e);
    },
  });
}

export function useEditExpense() {
  const qc = useQueryClient();
  const onError = useToastError();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<ExpenseInput> & { id: string }) => api(`/expenses/${id}`, { method: 'PATCH', body }),
    onSuccess: () => invalidateMoney(qc),
    onError,
  });
}

/** Soft delete with an undo toast. */
export function useSoftDelete(kind: 'expenses' | 'income' | 'budgets' | 'goals') {
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const onError = useToastError();
  const label = { expenses: 'Expense', income: 'Income', budgets: 'Budget', goals: 'Goal' }[kind];
  return useMutation({
    mutationFn: (id: string) => api(`/${kind}/${id}`, { method: 'DELETE' }).then(() => id),
    onSuccess: (id) => {
      haptic('light');
      invalidateMoney(qc);
      toast({
        message: `${label} deleted`,
        action: { label: 'Undo', onClick: () => api(`/${kind}/${id}/restore`, { method: 'POST' }).then(() => invalidateMoney(qc)) },
      });
    },
    onError,
  });
}

export function usePayBill(cycle?: string) {
  const qc = useQueryClient();
  const onError = useToastError();
  return useMutation({
    mutationFn: ({ bill, amount, date, note }: { bill: BillItem; amount: number; date: string; note: string }) =>
      api(`/fixed-expenses/${bill.id}/pay`, { method: 'POST', body: { amount, date, note } }),
    onMutate: async ({ bill, amount, date }) => {
      await qc.cancelQueries({ queryKey: ['bills', cycle] });
      await qc.cancelQueries({ queryKey: ['overview'] });
      const bills = qc.getQueryData<BillsResponse>(['bills', cycle]);
      // Only flip the row when the payment date falls inside the cycle being viewed.
      if (bills && bills.start_date <= date && date <= bills.end_date) {
        qc.setQueryData<BillsResponse>(['bills', cycle], billsAfterPay(bills, bill.id, amount, date));
      }
      const snapshot = patchOverviews(qc, date, (o) => overviewAfterPay(o, bill, amount, true));
      haptic('success');
      return { bills, snapshot };
    },
    onError: (e, _v, ctx) => {
      qc.setQueryData(['bills', cycle], ctx?.bills);
      restore(qc, ctx?.snapshot);
      onError(e);
    },
    onSettled: () => invalidateMoney(qc),
  });
}

export function useUnpayBill(cycle?: string) {
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const onError = useToastError();
  return useMutation({
    mutationFn: (bill: BillItem) => api(`/fixed-payments/${bill.payment!.id}`, { method: 'DELETE' }).then(() => bill),
    onMutate: async (bill) => {
      await qc.cancelQueries({ queryKey: ['bills', cycle] });
      const bills = qc.getQueryData<BillsResponse>(['bills', cycle]);
      if (bills) qc.setQueryData<BillsResponse>(['bills', cycle], billsAfterPay(bills, bill.id, 0, null));
      const refund = bill.payment!.deducted === false ? 0 : bill.payment!.amount_paid;
      const snapshot = patchOverviews(qc, bill.payment!.day, (o) => overviewAfterPay(o, bill, refund, false));
      return { bills, snapshot };
    },
    onSuccess: (bill) =>
      toast({
        message: `${bill.name} marked unpaid`,
        action: { label: 'Undo', onClick: () => api(`/fixed-payments/${bill.payment!.id}/restore`, { method: 'POST' }).then(() => invalidateMoney(qc)) },
      }),
    onError: (e, _v, ctx) => {
      qc.setQueryData(['bills', cycle], ctx?.bills);
      restore(qc, ctx?.snapshot);
      onError(e);
    },
    onSettled: () => invalidateMoney(qc),
  });
}

/** A settled bill paid from an earlier salary is not deducted from this cycle. */
export function useSetPaymentDeducted() {
  const qc = useQueryClient();
  const onError = useToastError();
  return useMutation({
    mutationFn: ({ id, deducted }: { id: string; deducted: boolean }) => api(`/fixed-payments/${id}`, { method: 'PATCH', body: { deducted } }),
    onSuccess: () => invalidateMoney(qc),
    onError,
  });
}

export interface IncomeInput {
  source_id: string;
  amount: number;
  date: string;
  note?: string;
}

export function useAddIncome() {
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const onError = useToastError();
  return useMutation({
    mutationFn: (body: IncomeInput) => api<{ id: string }>('/income', { method: 'POST', body }),
    onSuccess: (entry) => {
      haptic('success');
      invalidateMoney(qc);
      toast({
        message: 'Income added',
        tone: 'success',
        action: { label: 'Undo', onClick: () => api(`/income/${entry.id}`, { method: 'DELETE' }).then(() => invalidateMoney(qc)) },
      });
    },
    onError,
  });
}

export function useEditIncome() {
  const qc = useQueryClient();
  const onError = useToastError();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<IncomeInput> & { id: string; status?: 'pending' | 'received' }) =>
      api(`/income/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      haptic('success');
      invalidateMoney(qc);
    },
    onError,
  });
}

/** Early / late salary: start a cycle on the day the salary actually arrived. */
export async function overrideCycleStart(qc: QueryClient, label: string, date: string) {
  const res = await api<{ moved: unknown[] }>(`/cycles/${label}/override-start`, { method: 'POST', body: { date } });
  invalidateMoney(qc);
  qc.invalidateQueries({ queryKey: ['settings'] });
  return res;
}

/** Generic PATCH/POST for settings-type resources that refresh one list. */
export function useResourceMutation<TBody>(path: (b: TBody) => string, method: 'POST' | 'PATCH', invalidate: string[]) {
  const qc = useQueryClient();
  const onError = useToastError();
  return useMutation({
    mutationFn: (body: TBody) => {
      const { id: _id, ...rest } = body as TBody & { id?: string };
      return api(path(body), { method, body: rest });
    },
    onSuccess: () => {
      for (const key of invalidate) qc.invalidateQueries({ queryKey: [key] });
      invalidateMoney(qc);
    },
    onError,
  });
}
