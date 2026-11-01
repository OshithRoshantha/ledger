import clsx from 'clsx';
import { useEffect, useRef } from 'react';

/** Six single-digit boxes: auto-advance, backspace-to-previous, paste and iOS one-time-code autofill. */
export function OtpInput({
  value,
  onChange,
  onComplete,
  error,
  disabled,
  autoFocus = true,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  error?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');

  useEffect(() => {
    if (autoFocus) refs.current[Math.min(value.length, 5)]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  const setFrom = (index: number, text: string) => {
    const clean = text.replace(/\D/g, '');
    if (!clean) return;
    const next = (value.slice(0, index) + clean).slice(0, 6);
    onChange(next);
    refs.current[Math.min(next.length, 5)]?.focus();
    if (next.length === 6) onComplete?.(next);
  };

  return (
    <div className={clsx('flex justify-center gap-2', error && 'shake')} role="group" aria-label="6-digit code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          value={d}
          disabled={disabled}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1}`}
          maxLength={i === 0 ? 6 : 1}
          className={clsx(
            'num h-14 w-12 rounded-2xl border bg-elevated text-center text-[24px] font-semibold outline-none transition focus:border-brand',
            error ? 'border-negative' : 'border-hairline',
          )}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') {
              onChange(value.slice(0, i) + value.slice(i + 1));
              return;
            }
            setFrom(i, v.length > 1 ? v.slice(i === 0 ? 0 : -1) : v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !d && i > 0) {
              e.preventDefault();
              onChange(value.slice(0, i - 1));
              refs.current[i - 1]?.focus();
            }
            if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
            if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
          }}
          onPaste={(e) => {
            e.preventDefault();
            setFrom(0, e.clipboardData.getData('text'));
          }}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}
