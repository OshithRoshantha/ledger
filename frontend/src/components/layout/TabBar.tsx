import clsx from 'clsx';
import { LayoutGrid, Plus, Receipt, Settings, Wallet } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useApp } from '@/lib/store';

const TABS = [
  { to: '/', label: 'Dashboard', icon: LayoutGrid, end: true },
  { to: '/bills', label: 'Bills', icon: Receipt },
  null,
  { to: '/spending', label: 'Spending', icon: Wallet },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

export function TabBar() {
  const openQuickAdd = useApp((s) => s.openQuickAdd);
  return (
    <nav
      aria-label="Main"
      className="absolute inset-x-0 bottom-0 z-40 border-t border-hairline backdrop-blur-xl"
      style={{ background: 'var(--tabbar)', paddingBottom: 'var(--safe-bottom)', touchAction: 'none' }}
    >
      <ul className="grid h-[58px] grid-cols-5 items-stretch">
        {TABS.map((tab) =>
          tab === null ? (
            <li key="add" className="flex items-center justify-center">
              <button
                type="button"
                onClick={() => openQuickAdd()}
                aria-label="Quick add"
                className="-mt-6 flex h-[60px] w-[60px] items-center justify-center rounded-full bg-brand text-white shadow-[0_8px_24px_-6px_var(--brand)] ring-4 ring-[var(--bg)] transition active:scale-95"
              >
                <Plus size={28} strokeWidth={2.25} aria-hidden />
              </button>
            </li>
          ) : (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                end={'end' in tab ? tab.end : false}
                className={({ isActive }) =>
                  clsx('flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium', isActive ? 'text-brand' : 'text-muted')
                }
              >
                <tab.icon size={24} strokeWidth={1.75} aria-hidden />
                {tab.label}
              </NavLink>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}
