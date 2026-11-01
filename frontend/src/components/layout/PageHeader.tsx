import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { displayLabel, shiftLabel } from '@/lib/cycle';
import { useActiveCycle, useSettings } from '@/lib/queries';
import { useApp } from '@/lib/store';

/** Sticky, safe-area-aware page header. */
export function PageHeader({ title, right, children, back }: { title: string; right?: ReactNode; children?: ReactNode; back?: ReactNode }) {
  return (
    <header
      className="header-bg sticky top-0 z-30 border-b border-hairline backdrop-blur-xl"
      style={{ paddingTop: 'max(var(--safe-top), 12px)' }}
    >
      <div className="flex min-h-[48px] items-center justify-between gap-2 px-4">
        <div className="flex min-w-0 items-center gap-1">
          {back}
          <h1 className="truncate text-[28px] font-bold tracking-tight">{title}</h1>
        </div>
        {right}
      </div>
      {children}
    </header>
  );
}

/** ‹ Nov 2026 › — switches the cycle shown across all screens. */
export function CycleSwitcher() {
  const cycle = useActiveCycle();
  const { data: settings } = useSettings();
  const setCycle = useApp((s) => s.setCycle);
  if (!cycle || !settings) return <div className="h-11" />;
  const current = settings.current_cycle;
  const atCurrent = cycle >= current;
  return (
    <div className="flex items-center justify-between px-2 pb-2">
      <button
        type="button"
        className="tap flex items-center justify-center rounded-full text-muted active:bg-elevated"
        onClick={() => setCycle(shiftLabel(cycle, -1))}
        aria-label="Previous cycle"
      >
        <ChevronLeft size={22} strokeWidth={2} aria-hidden />
      </button>
      <div className="flex items-center gap-2">
        <span className="num text-[17px] font-semibold" aria-live="polite">
          {displayLabel(cycle)}
        </span>
        {cycle !== current ? (
          <button type="button" className="rounded-full bg-[var(--brand-soft)] px-2.5 py-1 text-[12px] font-semibold text-brand" onClick={() => setCycle(null)}>
            Current
          </button>
        ) : null}
      </div>
      <button
        type="button"
        className="tap flex items-center justify-center rounded-full text-muted active:bg-elevated disabled:opacity-30"
        onClick={() => setCycle(shiftLabel(cycle, 1) === current ? null : shiftLabel(cycle, 1))}
        disabled={atCurrent}
        aria-label="Next cycle"
      >
        <ChevronRight size={22} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}
