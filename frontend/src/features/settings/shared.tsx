import clsx from 'clsx';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { ICON_NAMES, Icon, SWATCHES } from '@/lib/icons';

export function SubPage({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title={title}
        right={right}
        back={
          <button type="button" className="tap -ml-3 flex items-center justify-center text-brand" onClick={() => navigate('/settings')} aria-label="Back to settings">
            <ChevronLeft size={28} aria-hidden />
          </button>
        }
      />
      <div className="space-y-4 px-4 pb-6 pt-4">{children}</div>
    </>
  );
}

export function Group({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section>
      {title ? <h2 className="section-title mb-2 px-1">{title}</h2> : null}
      <div className="card overflow-hidden">
        <ul>{children}</ul>
      </div>
      {footer ? <p className="mt-2 px-1 text-[13px] text-muted">{footer}</p> : null}
    </section>
  );
}

export function Row({
  icon,
  label,
  detail,
  onClick,
  danger,
  trailing,
}: {
  icon?: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  trailing?: ReactNode;
}) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <li className="border-b border-hairline last:border-0">
      <Comp
        type={onClick ? 'button' : undefined}
        onClick={onClick}
        className={clsx('flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left', onClick && 'active:bg-elevated', danger && 'text-negative')}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate text-[16px]">{label}</span>
        {detail !== undefined ? <span className="num shrink-0 text-[15px] text-muted">{detail}</span> : null}
        {trailing ?? (onClick ? <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden /> : null)}
      </Comp>
    </li>
  );
}

export function IconPicker({ value, onChange, colour }: { value: string; onChange: (v: string) => void; colour: string }) {
  return (
    <div className="grid grid-cols-8 gap-1.5" role="radiogroup" aria-label="Icon">
      {ICON_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          role="radio"
          aria-checked={value === name}
          aria-label={name.replace(/-/g, ' ')}
          onClick={() => onChange(name)}
          className={clsx('flex aspect-square items-center justify-center rounded-xl', value === name ? 'ring-2 ring-[var(--brand)]' : 'bg-elevated')}
          style={value === name ? { background: `${colour}22`, color: colour } : undefined}
        >
          <Icon name={name} size={18} />
        </button>
      ))}
    </div>
  );
}

export function ColourPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-8 gap-2" role="radiogroup" aria-label="Colour">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value.toLowerCase() === c.toLowerCase()}
          aria-label={`Colour ${c}`}
          onClick={() => onChange(c)}
          className="flex aspect-square items-center justify-center rounded-full"
          style={{ background: c }}
        >
          {value.toLowerCase() === c.toLowerCase() ? <Check size={16} color="#fff" strokeWidth={3} aria-hidden /> : null}
        </button>
      ))}
    </div>
  );
}
