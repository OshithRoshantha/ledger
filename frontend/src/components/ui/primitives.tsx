import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { Icon } from '@/lib/icons';
import { formatRs } from '@/lib/money';
import type { Change } from '@/lib/types';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('card', className)} {...props} />;
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean; loading?: boolean }>(
  function Button({ variant = 'primary', block, loading, className, children, disabled, ...props }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={clsx(
          'tap inline-flex items-center justify-center gap-2 rounded-2xl px-5 text-[16px] font-semibold transition active:scale-[0.98] disabled:opacity-50',
          block && 'w-full',
          variant === 'primary' && 'h-[52px] bg-brand text-white',
          variant === 'secondary' && 'h-[52px] bg-elevated text-text',
          variant === 'ghost' && 'h-11 bg-transparent text-brand',
          variant === 'danger' && 'h-[52px] bg-[var(--negative-soft)] text-negative',
          className,
        )}
        {...props}
      >
        {loading ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : null}
        {children}
      </button>
    );
  },
);

export function Chip({
  selected,
  colour,
  icon,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; colour?: string; icon?: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={clsx(
        'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[15px] font-medium transition active:scale-[0.97]',
        selected ? 'border-transparent bg-brand text-white' : 'border-hairline bg-elevated text-text',
        className,
      )}
      {...props}
    >
      {icon ? <Icon name={icon} size={16} color={selected ? '#fff' : colour} /> : null}
      {children}
    </button>
  );
}

export function IconBadge({ icon, colour, size = 40 }: { icon: string; colour: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[12px]"
      style={{ width: size, height: size, background: `${colour}22`, color: colour }}
    >
      <Icon name={icon} size={Math.round(size * 0.5)} />
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden />;
}

/**
 * % change with arrow + sign so colour is never the only signal.
 * Spending: down is good. Pass `higherIsGood` for income-like values.
 */
export function ChangeBadge({ change, showAbs = true, compact }: { change: Change; showAbs?: boolean; compact?: boolean }) {
  if (change.is_new) {
    return <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[12px] font-semibold text-brand">New</span>;
  }
  if (change.diff === 0) {
    return (
      <span className="num inline-flex items-center gap-0.5 text-[13px] text-muted">
        <Minus size={14} aria-hidden /> 0%
      </span>
    );
  }
  const up = change.diff > 0;
  const colour = change.good ? 'text-positive' : 'text-negative';
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  const label = `${up ? 'up' : 'down'} ${change.pct === null ? '' : Math.abs(change.pct).toFixed(0) + '%'} (${formatRs(change.diff, { whole: true, signed: true })})`;
  return (
    <span className={clsx('num inline-flex items-center gap-0.5 whitespace-nowrap text-[13px] font-medium', colour)} aria-label={label}>
      <Arrow size={14} strokeWidth={2.25} aria-hidden />
      {change.pct === null ? '' : `${up ? '+' : '−'}${Math.abs(change.pct).toFixed(0)}%`}
      {showAbs && !compact ? <span className="ml-1 opacity-80">{formatRs(change.diff, { whole: true, signed: true })}</span> : null}
    </span>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between px-1">
      <h2 className="section-title">{children}</h2>
      {action}
    </div>
  );
}

export function Ring({ value, size = 56, stroke = 6, colour = 'var(--positive)', label }: { value: number; size?: number; stroke?: number; colour?: string; label?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? `${Math.round(v * 100)}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--elevated)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={colour}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - v)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(.2,.8,.2,1)' }}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.24} fontWeight={600} fill="var(--text)" className="num">
        {Math.round(v * 100)}%
      </text>
    </svg>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <svg width="132" height="104" viewBox="0 0 132 104" aria-hidden className="mb-5">
        <rect x="14" y="18" width="104" height="72" rx="16" fill="var(--elevated)" />
        <rect x="28" y="56" width="14" height="20" rx="4" fill="var(--brand)" opacity=".45" />
        <rect x="50" y="44" width="14" height="32" rx="4" fill="var(--brand)" opacity=".7" />
        <rect x="72" y="32" width="14" height="44" rx="4" fill="var(--brand)" />
        <circle cx="104" cy="24" r="12" fill="var(--positive)" />
        <path d="M98 24l4 4 8-8" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <h3 className="text-[18px] font-semibold">{title}</h3>
      {body ? <p className="mt-1.5 max-w-[280px] text-[15px] text-muted">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[13px] text-muted">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  'h-12 w-full rounded-xl border border-hairline bg-elevated px-3.5 text-[16px] text-text placeholder:text-muted outline-none focus:border-brand';

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-xl bg-elevated p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'h-10 flex-1 rounded-lg text-[15px] font-medium transition',
            value === o.value ? 'bg-surface text-text shadow-sm' : 'text-muted',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
