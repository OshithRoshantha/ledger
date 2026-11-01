import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '@/lib/haptics';
import { formatRs } from '@/lib/money';

/** Animated money figure (count-up on change); instant under prefers-reduced-motion. */
export function CountUp({ cents, className, whole }: { cents: number; className?: string; whole?: boolean }) {
  const [shown, setShown] = useState(cents);
  const from = useRef(cents);
  const first = useRef(true);

  useEffect(() => {
    const start = first.current ? 0 : from.current;
    first.current = false;
    if (prefersReducedMotion() || start === cents) {
      setShown(cents);
      from.current = cents;
      return;
    }
    const t0 = performance.now();
    const duration = 650;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(start + (cents - start) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = cents;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = cents;
    };
  }, [cents]);

  return (
    <span className={`num ${className ?? ''}`} aria-label={formatRs(cents)}>
      <span aria-hidden>{formatRs(shown, { whole })}</span>
    </span>
  );
}
