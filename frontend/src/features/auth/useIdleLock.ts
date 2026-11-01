import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { local, useApp } from '@/lib/store';

const KEY = 'lastActive';

/**
 * Locks the UI after `minutes` without interaction. The server enforces the same idle
 * timeout on its side, so closing the app and reopening later also lands on the lock screen.
 */
export function useIdleLock(minutes: number | undefined) {
  const auth = useApp((s) => s.auth);
  const setAuth = useApp((s) => s.setAuth);
  const qc = useQueryClient();

  useEffect(() => {
    if (auth !== 'authed' || !minutes) return;
    const limit = minutes * 60_000;
    let lastWrite = 0;
    const mark = () => {
      const now = Date.now();
      if (now - lastWrite > 5_000) {
        lastWrite = now;
        local.set(KEY, String(now));
      }
    };
    const lock = async () => {
      setAuth('locked');
      qc.removeQueries();
      await api('/auth/lock', { method: 'POST', noRetry: true }).catch(() => undefined);
    };
    const check = () => {
      const last = Number(local.get(KEY) ?? Date.now());
      if (Date.now() - last > limit) lock();
    };
    check();
    mark();
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(check, 15_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, mark));
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [auth, minutes, setAuth, qc]);
}
