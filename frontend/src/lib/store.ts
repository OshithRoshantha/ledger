import { create } from 'zustand';
import type { CompareMode } from './types';

export type DashTab = 'overview' | 'spending' | 'bills' | 'trends' | 'plan';

export type AuthStatus = 'unknown' | 'anon' | 'authed' | 'locked';

export interface ToastItem {
  id: number;
  message: string;
  tone?: 'default' | 'error' | 'success';
  action?: { label: string; onClick: () => void };
}

interface QuickAddPreset {
  categoryId?: string;
  mode?: 'expense' | 'income';
}

interface AppState {
  auth: AuthStatus;
  username: string;
  onboarded: boolean;
  /** pre-auth token lives in memory only, never in storage */
  preAuthToken: string | null;
  cycle: string | null;
  compare: CompareMode;
  dashTab: DashTab;
  quickAdd: { open: boolean; preset?: QuickAddPreset };
  toasts: ToastItem[];
  setAuth: (auth: AuthStatus, extra?: { username?: string; onboarded?: boolean }) => void;
  setPreAuth: (token: string | null) => void;
  setOnboarded: (v: boolean) => void;
  setCycle: (c: string | null) => void;
  setCompare: (c: CompareMode) => void;
  setDashTab: (t: DashTab) => void;
  openQuickAdd: (preset?: QuickAddPreset) => void;
  closeQuickAdd: () => void;
  toast: (t: Omit<ToastItem, 'id'>) => void;
  dismissToast: (id: number) => void;
}

/** Per-device convenience values. Storage can be unavailable (private mode): never throw. */
export const local = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`ledger.${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(`ledger.${key}`, value);
    } catch {
      /* ignore */
    }
  },
};

let toastId = 0;

export const useApp = create<AppState>((set) => ({
  auth: 'unknown',
  username: '',
  onboarded: true,
  preAuthToken: null,
  cycle: null,
  compare: (local.get('compare') as CompareMode | null) ?? 'last',
  dashTab: 'overview',
  quickAdd: { open: false },
  toasts: [],
  setAuth: (auth, extra) => set((s) => ({ auth, username: extra?.username ?? s.username, onboarded: extra?.onboarded ?? s.onboarded })),
  setPreAuth: (preAuthToken) => set({ preAuthToken }),
  setOnboarded: (onboarded) => set({ onboarded }),
  setCycle: (cycle) => set({ cycle }),
  setCompare: (compare) => {
    local.set('compare', compare);
    set({ compare });
  },
  setDashTab: (dashTab) => set({ dashTab }),
  openQuickAdd: (preset) => set({ quickAdd: { open: true, preset } }),
  closeQuickAdd: () => set((s) => ({ quickAdd: { open: false, preset: s.quickAdd.preset } })),
  toast: (t) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.action ? 5000 : 3200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

