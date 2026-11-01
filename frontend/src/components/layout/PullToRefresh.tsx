import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

const TRIGGER = 70;

/** Pull-to-refresh for the main scroll pane (touch only). */
export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<unknown>; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const pane = ref.current?.closest('#main') as HTMLElement | null;
    if (!pane) return;
    let startY: number | null = null;
    let distance = 0;
    const onStart = (e: TouchEvent) => {
      startY = pane.scrollTop <= 0 ? e.touches[0].clientY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) {
        distance = 0;
        setPull(0);
        return;
      }
      distance = Math.min(110, dy * 0.5);
      setPull(distance);
    };
    const onEnd = async () => {
      if (startY === null) return;
      startY = null;
      if (distance >= TRIGGER) {
        setBusy(true);
        setPull(TRIGGER * 0.7);
        try {
          await onRefresh();
        } finally {
          setBusy(false);
        }
      }
      distance = 0;
      setPull(0);
    };
    pane.addEventListener('touchstart', onStart, { passive: true });
    pane.addEventListener('touchmove', onMove, { passive: true });
    pane.addEventListener('touchend', onEnd);
    return () => {
      pane.removeEventListener('touchstart', onStart);
      pane.removeEventListener('touchmove', onMove);
      pane.removeEventListener('touchend', onEnd);
    };
  }, [onRefresh]);

  return (
    <div ref={ref}>
      <div className="flex items-end justify-center overflow-hidden text-muted" style={{ height: pull, transition: pull ? 'none' : 'height 200ms' }} aria-hidden={!busy}>
        <RefreshCw
          size={20}
          className={busy ? 'mb-3 animate-spin' : 'mb-3'}
          style={{ transform: `rotate(${pull * 3}deg)`, opacity: Math.min(1, pull / TRIGGER) }}
          aria-label={busy ? 'Refreshing' : undefined}
        />
      </div>
      {children}
    </div>
  );
}
