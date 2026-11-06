import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Clock } from 'lucide-react';
import { useState } from 'react';
import { CycleSwitcher, PageHeader } from '@/components/layout/PageHeader';
import { Card, IconBadge, Ring, SectionTitle, Skeleton } from '@/components/ui/primitives';
import { formatDay, isoDay } from '@/lib/cycle';
import { formatRs } from '@/lib/money';
import { useActiveCycle, useBills } from '@/lib/queries';
import type { BillItem } from '@/lib/types';
import { PaySheet } from './PaySheet';

export default function BillsPage() {
  const cycle = useActiveCycle();
  const { data, isLoading } = useBills(cycle);
  const [selected, setSelected] = useState<BillItem | null>(null);
  const reminder = data?.reminder_window;

  return (
    <>
      <PageHeader title="Bills">
        <CycleSwitcher />
      </PageHeader>
      <div className="px-4 pt-4">
        {isLoading || !data ? (
          <BillsSkeleton />
        ) : (
          <>
            <Card className="flex items-center gap-4 p-4">
              <Ring
                value={data.total_count ? data.paid_count / data.total_count : 0}
                size={64}
                label={`${data.paid_count} of ${data.total_count} bills paid`}
              />
              <div className="min-w-0">
                <p className="num text-[17px] font-semibold">
                  {data.paid_count} of {data.total_count} paid
                </p>
                <p className="num text-[14px] text-muted">
                  {formatRs(data.paid_amount, { whole: true })} of {formatRs(data.total_amount, { whole: true })}
                </p>
                {data.pending_amount > 0 ? (
                  <p className={clsx('num mt-0.5 text-[13px] font-medium', reminder ? 'text-warning' : 'text-muted')}>
                    {formatRs(data.pending_amount, { whole: true })} still committed
                  </p>
                ) : (
                  <p className="mt-0.5 text-[13px] font-medium text-positive">All bills paid 🎉</p>
                )}
              </div>
            </Card>

            {data.groups.map((group) => (
              <section key={group}>
                <SectionTitle>{group}</SectionTitle>
                <Card className="overflow-hidden">
                  <ul>
                    {data.items
                      .filter((i) => i.group === group)
                      .map((item) => (
                        <li key={item.id} className="border-b border-hairline last:border-0">
                          <BillRow item={item} overdue={!!reminder && item.status === 'pending'} onClick={() => setSelected(item)} />
                        </li>
                      ))}
                  </ul>
                </Card>
              </section>
            ))}
          </>
        )}
      </div>
      <PaySheet bill={selected} cycle={cycle} defaultDay={data && !data.is_current ? (data.end_date < isoDay() ? data.end_date : data.start_date) : undefined} onClose={() => setSelected(null)} />
    </>
  );
}

function BillRow({ item, overdue, onClick }: { item: BillItem; overdue: boolean; onClick: () => void }) {
  const paid = item.status === 'paid';
  const amount = paid ? item.payment!.amount_paid : item.template_amount;
  return (
    <button type="button" onClick={onClick} className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left active:bg-elevated">
      <IconBadge icon={item.icon} colour={item.colour} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[16px] font-medium">{item.name}</p>
        <p className={clsx('num text-[14px]', paid ? 'text-muted' : 'text-text')}>
          {formatRs(amount, { whole: amount % 100 === 0 })}
          {paid && amount !== item.template_amount ? <span className="ml-1 text-muted">(usual {formatRs(item.template_amount, { whole: true })})</span> : null}
        </p>
        {item.payment?.deducted === false ? <p className="text-[12px] text-muted">From earlier salary</p> : null}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {paid ? (
          <motion.span
            key="paid"
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 22 }}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--positive-soft)] px-2.5 py-1 text-[13px] font-semibold text-positive"
          >
            <Check size={14} strokeWidth={3} aria-hidden />
            Paid {formatDay(item.payment!.day)}
          </motion.span>
        ) : (
          <motion.span
            key="pending"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={clsx(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-semibold',
              overdue ? 'bg-[var(--warning-soft)] text-warning' : 'bg-elevated text-muted',
            )}
          >
            <Clock size={14} strokeWidth={2} aria-hidden />
            {overdue ? 'Due soon' : 'Pending'}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

function BillsSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-24 w-full !rounded-[20px]" />
      <Skeleton className="h-[64px] w-full !rounded-[20px]" />
      <Skeleton className="h-[192px] w-full !rounded-[20px]" />
      <Skeleton className="h-[64px] w-full !rounded-[20px]" />
    </div>
  );
}
