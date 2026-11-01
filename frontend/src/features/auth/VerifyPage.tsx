import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button, inputClass } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { local, useApp } from '@/lib/store';
import { AuthLayout } from './Logo';
import { OtpInput } from './OtpInput';

export default function VerifyPage() {
  const token = useApp((s) => s.preAuthToken);
  const setPreAuth = useApp((s) => s.setPreAuth);
  const setAuth = useApp((s) => s.setAuth);
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState('');
  const [shakeKey, setShakeKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(true);

  if (!token) return <Navigate to="/login" replace />;

  const submit = async (value: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ device_token?: string }>('/auth/verify-2fa', {
        method: 'POST',
        body: { pre_auth_token: token, code: value, remember_device: remember },
        noRetry: true,
      });
      if (res.device_token) local.set('device', res.device_token);
      const me = await api<{ username: string; onboarded: boolean }>('/auth/me', { noRetry: true });
      setPreAuth(null);
      haptic('success');
      setAuth('authed', me);
      navigate('/', { replace: true });
    } catch (err) {
      haptic('error');
      setCode('');
      setShakeKey((k) => k + 1);
      if (err instanceof ApiError && err.status === 401) {
        setPreAuth(null);
        navigate('/login', { replace: true });
        useApp.getState().toast({ message: err.message, tone: 'error' });
        return;
      }
      const remaining = err instanceof ApiError ? (err.detail as { remaining?: number })?.remaining : undefined;
      setError(remaining !== undefined ? `Wrong code. ${remaining} attempt${remaining === 1 ? '' : 's'} left.` : 'Wrong code.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <div className="mb-8 flex flex-col items-center text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-brand">
          <ShieldCheck size={32} strokeWidth={1.75} aria-hidden />
        </span>
        <h1 className="mt-4 text-[24px] font-bold tracking-tight">Two-factor code</h1>
        <p className="mt-1 max-w-[280px] text-[15px] text-muted">
          {recovery ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code from Google Authenticator.'}
        </p>
      </div>
      {recovery ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(code);
          }}
          className={error ? 'shake space-y-4' : 'space-y-4'}
          key={shakeKey}
        >
          <input
            className={inputClass + ' num text-center tracking-widest'}
            placeholder="xxxxx-xxxxx"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label="Recovery code"
            autoFocus
          />
          <Button type="submit" block loading={busy} disabled={code.length < 10}>
            Verify
          </Button>
        </form>
      ) : (
        <div key={shakeKey}>
          <OtpInput value={code} onChange={setCode} onComplete={submit} error={!!error} disabled={busy} />
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-4 text-center text-[14px] text-negative">
          {error}
        </p>
      ) : null}
      <label className="mx-auto mt-6 flex min-h-[44px] max-w-[320px] cursor-pointer items-center gap-3 rounded-2xl bg-elevated px-4 py-3">
        <input type="checkbox" className="h-5 w-5 shrink-0 accent-[var(--brand)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>
          <span className="block text-[15px] font-medium">Remember this device</span>
          <span className="block text-[13px] text-muted">Skip the code here for 30 days. Your password is still required.</span>
        </span>
      </label>
      <div className="mt-6 flex flex-col items-center gap-1">
        <Button
          variant="ghost"
          onClick={() => {
            setRecovery((r) => !r);
            setCode('');
            setError('');
          }}
        >
          {recovery ? 'Use authenticator code' : 'Use a recovery code'}
        </Button>
        <Button
          variant="ghost"
          className="!text-muted"
          onClick={() => {
            setPreAuth(null);
            navigate('/login');
          }}
        >
          Back to sign in
        </Button>
      </div>
    </AuthLayout>
  );
}
