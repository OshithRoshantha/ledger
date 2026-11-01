import clsx from 'clsx';
import { Wallet } from 'lucide-react';
import { formatDay } from '@/lib/cycle';
import { useResolve, useSettings } from '@/lib/queries';

/**
 * "From Oct salary" — which salary an entry dated `day` is paid from. The server decides
 * (GET /cycles/resolve); the client only displays it.
 */
export function AttributionChip({ day, className }: { day: string; className?: string }) {
  const { data, isFetching } = useResolve(day);
  const { data: settings } = useSettings();
  const other = data && settings && data.label !== settings.current_cycle;
  return (
    <span
      role="status"
      aria-live="polite"
      title={data ? `${data.display} cycle: ${formatDay(data.start_date)} – ${formatDay(data.end_date)}` : undefined}
      className={clsx(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-opacity',
        other ? 'bg-[var(--warning-soft)] text-warning' : 'bg-[var(--brand-soft)] text-brand',
        isFetching && !data && 'opacity-50',
        className,
      )}
    >
      <Wallet size={14} aria-hidden />
      {data ? `From ${data.short} salary` : 'From …'}
    </span>
  );
}
