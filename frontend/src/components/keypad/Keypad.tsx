import clsx from 'clsx';
import { Delete } from 'lucide-react';
import { applyKey, formatTyping } from '@/lib/money';
import { haptic } from '@/lib/haptics';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

/** Custom numeric keypad (no iOS keyboard). `value` is the raw typed string, e.g. "2350.5". */
export function Keypad({ value, onChange, compact }: { value: string; onChange: (v: string) => void; compact?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Amount keypad">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => {
            haptic('light');
            onChange(applyKey(value, k));
          }}
          onContextMenu={(e) => {
            if (k === 'back') {
              e.preventDefault();
              onChange('');
            }
          }}
          aria-label={k === 'back' ? 'Delete digit' : k === '.' ? 'Decimal point' : k}
          className={clsx(
            'num flex select-none items-center justify-center rounded-2xl bg-elevated text-[24px] font-medium text-text transition active:scale-95 active:bg-[var(--hairline-strong)]',
            compact ? 'h-12' : 'h-[54px]',
          )}
        >
          {k === 'back' ? <Delete size={24} strokeWidth={1.75} aria-hidden /> : k}
        </button>
      ))}
    </div>
  );
}

export function AmountDisplay({ value, tone, label = 'Amount' }: { value: string; tone?: 'danger' | 'warn'; label?: string }) {
  return (
    <div className="py-2 text-center" aria-live="polite" aria-label={`${label}: Rs ${formatTyping(value)}`}>
      <span className="text-[17px] font-medium text-muted">Rs </span>
      <span
        className={clsx(
          'num text-[44px] font-semibold tracking-tight',
          !value && 'text-muted',
          tone === 'danger' && 'text-negative',
          tone === 'warn' && 'text-warning',
        )}
      >
        {formatTyping(value)}
      </span>
    </div>
  );
}
