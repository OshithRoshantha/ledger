import { Lock } from 'lucide-react';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { useApp, local } from '@/lib/store';
import { AuthLayout } from './Logo';
import { OtpInput } from './OtpInput';

/** Shown after inactivity: only the 2FA code is needed while the refresh token is valid. */
export default function LockScreen() {
  const setAuth = useApp((s) => s.setAuth);
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [shakeKey, setShakeKey] = useState(0);
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    await api('/auth/logout', { method: 'POST', noRetry: true }).catch(() => undefined);
    qc.clear();
    setAuth('anon');
  };

  const submit = async (value: string) => {
    setBusy(true);
    setError('');
    try {
      await api('/auth/unlock', { method: 'POST', body: { code: value }, noRetry: true });
      local.set('lastActive', String(Date.now()));
      haptic('success');
      setAuth('authed');
      qc.invalidateQueries();
    } catch (err) {
      haptic('error');
      setCode('');
      setShakeKey((k) => k + 1);
      if (err instanceof ApiError && err.status === 401) {
        qc.clear();
        setAuth('anon');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Wrong code.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-bg">
      <AuthLayout>
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-elevated text-text">
            <Lock size={30} strokeWidth={1.75} aria-hidden />
          </span>
          <h1 className="mt-4 text-[24px] font-bold tracking-tight">Ledger is locked</h1>
          <p className="mt-1 text-[15px] text-muted">Enter your authenticator code to continue.</p>
        </div>
        <div key={shakeKey}>
          <OtpInput value={code} onChange={setCode} onComplete={submit} error={!!error} disabled={busy} />
        </div>
        {error ? (
          <p role="alert" className="mt-4 text-center text-[14px] text-negative">
            {error}
          </p>
        ) : null}
        <div className="mt-8 flex justify-center">
          <Button variant="ghost" className="!text-muted" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </AuthLayout>
    </div>
  );
}
