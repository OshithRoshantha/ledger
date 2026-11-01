import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, inputClass } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useApp } from '@/lib/store';
import { AuthLayout, Logo } from './Logo';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setPreAuth = useApp((s) => s.setPreAuth);
  const navigate = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ pre_auth_token: string }>('/auth/login', { method: 'POST', body: { username, password }, noRetry: true });
      setPreAuth(res.pre_auth_token);
      setPassword('');
      navigate('/login/verify');
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? 'Too many attempts. Wait a few minutes and try again.' : 'Invalid username or password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <div className="mb-10 flex flex-col items-center text-center">
        <Logo />
        <h1 className="mt-4 text-[28px] font-bold tracking-tight">Ledger</h1>
        <p className="mt-1 text-[15px] text-muted">Sign in to continue</p>
      </div>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <label className="block">
          <span className="sr-only">Username</span>
          <input
            className={inputClass}
            placeholder="Username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="block">
          <span className="sr-only">Password</span>
          <input
            className={inputClass}
            type="password"
            placeholder="Password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error ? (
          <p role="alert" className="px-1 text-[14px] text-negative">
            {error}
          </p>
        ) : null}
        <Button type="submit" block loading={busy} disabled={!username || !password} className="!mt-5">
          Continue
        </Button>
      </form>
    </AuthLayout>
  );
}
