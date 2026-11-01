import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CycleSwitcher, PageHeader } from '@/components/layout/PageHeader';
import { PullToRefresh } from '@/components/layout/PullToRefresh';
import { useActiveCycle, useBillsTab, useOverview, usePlanTab, useSpendingTab, useTrendsTab, tabQuery } from '@/lib/queries';
import { useApp, type DashTab } from '@/lib/store';
import type { CompareMode } from '@/lib/types';
import { DrillSheet, TabSkeleton, type Drill } from './parts';

const OverviewTab = lazy(() => import('./tabs/OverviewTab'));
const SpendingTab = lazy(() => import('./tabs/SpendingTab'));
const BillsTab = lazy(() => import('./tabs/BillsTab'));
const TrendsTab = lazy(() => import('./tabs/TrendsTab'));
const PlanTab = lazy(() => import('./tabs/PlanTab'));

const TABS: { key: DashTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'spending', label: 'Spending' },
  { key: 'bills', label: 'Bills' },
  { key: 'trends', label: 'Trends' },
  { key: 'plan', label: 'Plan' },
];

const COMPARE: { value: CompareMode; label: string; full: string }[] = [
  { value: 'last', label: 'Last cycle', full: 'Compare with last cycle' },
  { value: 'avg3', label: '3-cycle avg', full: 'Compare with the average of the last 3 cycles' },
  { value: 'yoy', label: 'Last year', full: 'Compare with the same cycle last year' },
];

export default function DashboardPage() {
  const cycle = useActiveCycle();
  const tab = useApp((s) => s.dashTab);
  const setTab = useApp((s) => s.setDashTab);
  const compare = useApp((s) => s.compare);
  const setCompare = useApp((s) => s.setCompare);
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [drill, setDrill] = useState<Drill | null>(null);

  // deep links from insights, e.g. "/?tab=plan"
  useEffect(() => {
    const t = params.get('tab') as DashTab | null;
    if (t && TABS.some((x) => x.key === t)) {
      setTab(t);
      params.delete('tab');
      setParams(params, { replace: true });
    }
  }, [params, setParams, setTab]);

  // prefetch the neighbouring tabs so swiping feels instant
  const index = TABS.findIndex((t) => t.key === tab);
  useEffect(() => {
    if (!cycle) return;
    for (const n of [TABS[index - 1], TABS[index + 1]]) if (n) qc.prefetchQuery({ ...tabQuery(n.key, cycle, compare), staleTime: 30_000 });
  }, [cycle, compare, index, qc]);

  const go = (dir: 1 | -1) => {
    const next = TABS[index + dir];
    if (next) setTab(next.key);
  };

  const refresh = useCallback(() => qc.invalidateQueries({ predicate: (q) => ['overview', 'tab'].includes(String(q.queryKey[0])) }), [qc]);

  return (
    <>
      <PageHeader title="Dashboard" hideTitle>
        <CycleSwitcher />
        <div className="flex items-center gap-2 px-4 pb-2">
          <span className="shrink-0 text-[12px] font-medium text-muted" id="compare-label">
            Compare
          </span>
          <div role="radiogroup" aria-labelledby="compare-label" className="flex flex-1 rounded-full bg-elevated">
            {COMPARE.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={compare === c.value}
                aria-label={c.full}
                title={c.full}
                onClick={() => setCompare(c.value)}
                className={clsx(
                  'h-11 flex-1 whitespace-nowrap rounded-full border-[3px] border-transparent px-1 text-[13px] font-semibold transition',
                  compare === c.value ? 'bg-brand text-white' : 'text-muted',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div role="tablist" aria-label="Dashboard sections" className="scroll-pane flex gap-1 overflow-x-auto px-3 pb-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={clsx('h-9 shrink-0 rounded-full px-3.5 text-[14px] font-semibold transition', tab === t.key ? 'bg-brand text-white' : 'text-muted')}
            >
              {t.label}
            </button>
          ))}
        </div>
      </PageHeader>
      <PullToRefresh onRefresh={refresh}>
        <motion.div
          key={tab}
          className="px-4 pb-4 pt-4"
          role="tabpanel"
          aria-label={TABS[index].label}
          drag="x"
          dragDirectionLock
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.12}
          dragSnapToOrigin
          style={{ touchAction: 'pan-y' }}
          onDragEnd={(_, info) => {
            if (info.offset.x < -70 || info.velocity.x < -500) go(1);
            else if (info.offset.x > 70 || info.velocity.x > 500) go(-1);
          }}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          <Suspense fallback={<TabSkeleton />}>
            <TabBody tab={tab} cycle={cycle} compare={compare} onDrill={setDrill} />
          </Suspense>
        </motion.div>
      </PullToRefresh>
      <DrillSheet drill={drill} cycle={cycle} onClose={() => setDrill(null)} />
    </>
  );
}

function TabBody({ tab, cycle, compare, onDrill }: { tab: DashTab; cycle?: string; compare: CompareMode; onDrill: (d: Drill) => void }) {
  const overview = useOverview(tab === 'overview' ? cycle : undefined, compare);
  const spending = useSpendingTab(tab === 'spending' ? cycle : undefined, compare);
  const bills = useBillsTab(tab === 'bills' ? cycle : undefined);
  const trends = useTrendsTab(tab === 'trends' ? cycle : undefined);
  const plan = usePlanTab(tab === 'plan' ? cycle : undefined);
  if (tab === 'overview') return overview.data ? <OverviewTab o={overview.data} onDrill={onDrill} /> : <TabSkeleton />;
  if (tab === 'spending') return spending.data ? <SpendingTab s={spending.data} onDrill={onDrill} /> : <TabSkeleton />;
  if (tab === 'bills') return bills.data ? <BillsTab b={bills.data} /> : <TabSkeleton />;
  if (tab === 'trends') return trends.data ? <TrendsTab t={trends.data} /> : <TabSkeleton />;
  return plan.data ? <PlanTab p={plan.data} /> : <TabSkeleton />;
}
