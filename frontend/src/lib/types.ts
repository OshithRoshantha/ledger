export type Method = 'atm' | 'bank_transfer' | 'card' | 'cash' | 'other';
export type NeedWant = 'need' | 'want';
export type CompareMode = 'last' | 'avg3' | 'yoy';
export type Severity = 'high' | 'medium' | 'low' | 'positive';

export interface Change {
  current: number;
  previous: number;
  diff: number;
  pct: number | null;
  is_new: boolean;
  good: boolean | null;
}

export interface AmountHistory {
  amount: number;
  effective_from_cycle: string;
}

export interface AppSettings {
  id: string;
  salary_day: number;
  salary_amount: number;
  salary_history: AmountHistory[];
  savings_target: number;
  timezone: string;
  currency: 'LKR';
  theme: 'dark' | 'light' | 'system';
  auto_lock_minutes: number;
  reminder_days_before_cycle_end: number;
  onboarded: boolean;
  last_category_id: string | null;
  last_reason_id: string | null;
  last_method: Method | null;
  current_cycle: string;
  current_cycle_start: string;
  current_cycle_end: string;
}

export interface CycleInfo {
  label: string;
  display: string;
  short: string;
  start_date: string;
  end_date: string;
  days: number;
  salary_amount: number;
  is_override: boolean;
  closed: boolean;
  is_current: boolean;
}

export interface ResolveResult extends CycleInfo {
  salary_cycle: CycleInfo & { offset_days: number; can_override: boolean };
}

export interface SalarySettings {
  amount: number;
  salary_day: number;
  history: AmountHistory[];
  current_cycle: CycleInfo;
}

export interface Move {
  kind: 'income' | 'expense' | 'bill';
  id: string;
  day: string;
  amount: number;
  title: string;
  from: string;
  to: string;
  from_display: string;
  to_display: string;
}

export interface SalaryPreview {
  salary_day: number;
  count: number;
  summary: string[];
  moves: Move[];
  current_cycle: { label: string; start_date: string; old_end_date: string; new_end_date: string };
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  colour: string;
  requires_reason: boolean;
  unit: string;
  need_want: NeedWant;
  is_active: boolean;
  sort_order: number;
}

export interface Reason {
  id: string;
  name: string;
  icon: string;
  colour: string;
  need_want: NeedWant;
  is_active: boolean;
  sort_order: number;
}

export interface IncomeSource {
  id: string;
  name: string;
  type: 'fixed' | 'variable';
  default_amount: number;
  is_active: boolean;
  sort_order: number;
}

export interface FixedTemplate {
  id: string;
  name: string;
  group: string;
  amount: number;
  icon: string;
  colour: string;
  sort_order: number;
  is_active: boolean;
  archived_from_cycle: string | null;
  amount_history: AmountHistory[];
}

export interface Payment {
  id: string;
  fixed_expense_id: string;
  cycle: string;
  amount_paid: number;
  /** false = settled here but paid from an earlier salary, so not deducted from this cycle */
  deducted?: boolean;
  paid_at: string;
  day: string;
  note: string;
}

export interface BillItem {
  id: string;
  name: string;
  group: string;
  icon: string;
  colour: string;
  template_amount: number;
  status: 'paid' | 'pending';
  payment: Payment | null;
}

export interface BillsResponse {
  cycle: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  reminder_window: boolean;
  groups: string[];
  items: BillItem[];
  paid_count: number;
  total_count: number;
  paid_amount: number;
  pending_amount: number;
  total_amount: number;
}

export interface ExpenseEntry {
  id: string;
  category_id: string;
  cycle: string;
  amount: number;
  date: string;
  day: string;
  method: Method | null;
  reason_id: string | null;
  note: string;
}

export interface SpendingCategory extends Category {
  total: number;
  count: number;
  by_method?: Record<string, number>;
  by_reason?: Record<string, number>;
}

export interface SpendingSummary {
  cycle: string;
  total: number;
  categories: SpendingCategory[];
}

export interface IncomeEntry {
  id: string;
  source_id: string;
  source_name: string;
  source_type: 'fixed' | 'variable';
  cycle: string;
  amount: number;
  day: string;
  note: string;
  status: 'pending' | 'received';
}

export interface IncomeResponse {
  cycle: string;
  received_total: number;
  pending_total: number;
  items: IncomeEntry[];
}

// ---------------------------------------------------------------- analytics

export interface Meta {
  cycle: string;
  label: string;
  start: string;
  end: string;
  is_current: boolean;
  is_future: boolean;
  is_override: boolean;
  day_index: number;
  days_total: number;
  days_left: number;
  elapsed_pct: number;
  prev_cycle: string | null;
  history_cycles: number;
  compare: { mode: CompareMode; text: string; name: string; labels: string[] } | null;
}

export interface Insight {
  id: string;
  type: string;
  severity: Severity;
  title: string;
  detail: string;
  metric: string | null;
  delta_pct: number | null;
  delta_abs: number | null;
  action_link: string | null;
}

export interface Kpi {
  key: string;
  label: string;
  value: number | null;
  format: 'money' | 'pct';
  change: (Change & { diff_pts?: never }) | { diff_pts: number | null; good: boolean | null } | null;
  spark: number[];
  good: 'up' | 'down';
  count?: number;
  name?: string | null;
}

export interface Overview {
  meta: Meta;
  hero: {
    safe_to_spend: number;
    balance: number;
    committed: number;
    reserved: number;
    savings_target: number;
    projected_savings: number;
    income: number;
    spent: number;
    daily_allowance: number | null;
    days_remaining: number;
    status: 'ok' | 'warn' | 'danger';
    elapsed_pct: number;
    income_spent_pct: number | null;
    pace_warning: boolean;
  };
  health: {
    score: number;
    prev_score: number | null;
    delta: number | null;
    top_factor?: string;
    components: { key: string; label: string; weight: number; score: number; detail: string }[];
  };
  kpis: Kpi[];
  waterfall: { steps: { label: string; amount: number; kind: 'add' | 'sub' | 'total'; colour?: string; key?: string }[]; income: number; spent: number; remaining: number; takeaway: string };
  alerts: Insight[];
  insights: Insight[];
  pending_bills: { id: string; name: string; amount: number; icon: string; colour: string }[];
  takeaway: string | null;
}

export interface CategoryRow {
  key: string;
  id?: string;
  name: string;
  colour: string;
  icon: string;
  kind: 'fixed' | 'variable';
  need_want: NeedWant;
  amount: number;
  count: number | null;
  compare_amount: number;
  pct_of_spend: number | null;
  pct_of_income: number | null;
  change: Change;
  spark: number[];
  budget: number | null;
  budget_used_pct: number | null;
  unit?: string;
  archived?: boolean;
}

export interface SpendingTab {
  meta: Meta;
  total: number;
  income: number;
  change: Change;
  takeaway: string;
  categories: CategoryRow[];
  bank: {
    total: number;
    count: number;
    change: Change;
    reasons: { id: string | null; name: string; colour: string; icon: string; amount: number; count: number; pct: number | null; change: Change; budget?: number | null }[];
    methods: { method: Method; label: string; amount: number; count: number; avg: number; pct: number | null; change: Change }[];
    matrix: { reasons: string[]; methods: string[]; cells: number[][] };
  };
  movers: { up: Mover[]; down: Mover[] };
  patterns: {
    weekday: { dow: string; avg: number; total: number }[];
    takeaway: string;
    weekday_vs_weekend: { weekday: number; weekend: number; weekday_daily: number; weekend_daily: number };
    halves: { first: number; second: number; split_day: string };
  };
  heat: { day: string; amount: number }[];
  sizes: { label: string; min: number; max: number | null; count: number; total: number }[];
  top10: { id: string; amount: number; day: string; category: string; colour: string; reason: string | null; method: Method | null; note: string; category_id: string }[];
  frequency: { name: string; unit: string; count: number; avg: number; total: number }[];
}

export interface Mover {
  name: string;
  diff: number;
  pct: number | null;
  is_new: boolean;
  link: string;
}

export interface BillsTab {
  meta: Meta;
  status: {
    paid_count: number;
    total_count: number;
    paid_amount: number;
    pending_amount: number;
    items: { id: string; name: string; group: string; icon: string; colour: string; template: number; status: 'paid' | 'pending'; paid_amount: number | null; paid_day: string | null; day_of_cycle: number | null }[];
  };
  trends: { id: string; name: string; colour: string; points: { cycle: string; label: string; amount: number | null }[]; avg6: number | null; latest: number | null; above_avg_pct: number | null; flag: boolean }[];
  trend_takeaway: string;
  fixed_ratio: { series: { cycle: string; label: string; fixed: number; income: number; ratio: number | null }[]; target: number; current: number | null; takeaway: string };
  timing: { id: string; name: string; avg_day: number | null; samples: number }[];
  annual: { items: { id: string; name: string; colour: string; monthly: number; annual: number }[]; total: number; takeaway: string };
  template_vs_actual: { id: string; name: string; template: number; actual: number | null; avg_template: number | null; avg_actual: number | null }[];
}

export interface TrendRow {
  cycle: string;
  label: string;
  short: string;
  income: number;
  spent: number;
  saved: number;
  savings_rate: number | null;
  top_category: string | null;
  change_pct: number | null;
  closed: boolean;
  has_data: boolean;
}

export interface TrendsTab {
  meta: Meta;
  locked: boolean;
  unlock_message: string | null;
  rows: TrendRow[];
  takeaway: string;
  mix: { categories: { key: string; name: string; colour: string }[]; series: { cycle: string; short: string; values: number[] }[] };
  pace: { days: number; current: number[]; previous: number[]; avg3: number[] | null; prev_label: string | null };
  networth: { cycle: string; label: string; saved: number; cumulative: number }[];
  best: (TrendRow & { why: string }) | null;
  worst: (TrendRow & { why: string }) | null;
  ytd: { year: string; income: number; spent: number; saved: number; avg_monthly_savings: number; biggest_category: string | null; biggest_amount: number; cycles: number };
}

export interface BudgetRow {
  id: string;
  target_type: 'category' | 'reason';
  target_id: string;
  key: string;
  name: string;
  colour: string;
  icon: string;
  amount: number;
  spent: number;
  remaining: number;
  pct: number;
  pace_pct: number;
  state: 'ok' | 'near' | 'over';
  projected: number;
}

export interface GoalRow {
  id: string;
  name: string;
  target_amount: number;
  target_date: string;
  saved_amount: number;
  monthly_reserve: number;
  progress_pct: number;
  required_per_cycle: number;
  avg_savings: number;
  on_track: boolean;
  eta_cycles: number | null;
}

export interface PlanTab {
  meta: Meta;
  budgets: BudgetRow[];
  budget_takeaway: string;
  forecast: {
    days: number;
    actual: number[];
    low: (number | null)[];
    likely: (number | null)[];
    high: (number | null)[];
    end_spend: { low: number; likely: number; high: number };
    end_balance: { low: number; likely: number; high: number };
    so_far: number;
    pending_bills: number;
    income: number;
    takeaway: string;
  };
  goals: GoalRow[];
  recommendations: { id: string; kind: string; title: string; amount: number | null; action_link: string | null }[];
  fifty: { income: number; projected: boolean; buckets: { key: 'needs' | 'wants' | 'savings'; amount: number; pct: number | null; target: number; status: 'ok' | 'off' | null }[] };
}

export interface SimResult {
  cycle: string;
  cycle_display: string;
  is_current: boolean;
  amount: number;
  safe_before: number;
  safe_after: number;
  daily_before: number;
  daily_after: number;
  projected_balance_before: number;
  projected_balance_after: number;
  budgets: { name: string; amount: number; before_pct: number; after_pct: number; state: string; remaining_after: number }[];
  verdict: 'yes' | 'tight' | 'no';
  message: string;
}
