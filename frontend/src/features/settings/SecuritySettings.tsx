import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, LogOut, MonitorSmartphone, QrCode, ShieldAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { BottomSheet } from '@/components/sheets/BottomSheet';
import { Button, Field, inputClass } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { useApp } from '@/lib/store';
import { OtpInput } from '@/features/auth/OtpInput';
import { Group, Row, SubPage } from './shared';

type Activity = {
  events: { event: string; ip: string; user_agent: string; at: string }[];
  sessions: { ip: string; user_agent: string; last_seen_at: string; current: boolean }[];
};

const EVENT_LABELS: Record<string, string> = {
  login_success: 'Signed in',
  login_failed: 'Failed sign-in',
  '2fa_failed': 'Wrong 2FA code',
  account_locked: 'Account locked (too many attempts)',
  logout: 'Signed out',
  logout_all: 'Signed out everywhere',
  unlock_failed: 'Wrong unlock code',
  unlock_success: 'Unlocked',
  password_changed: 'Password changed',
  '2fa_reset': '2FA reset',
  recovery_codes_regenerated: 'Recovery codes regenerated',
  refresh_reuse_detected: 'Suspicious session reuse blocked',
  settings_changed: 'Settings changed',
  data_imported: 'Backup imported',
};

function device(ua: string): string {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return ua ? ua.slice(0, 24) : 'Unknown device';
}

type Sheet = 'password' | 'codes' | 'reset' | null;

export default function SecuritySettings() {
  const { data } = useQuery({ queryKey: ['activity'], queryFn: () => api<Activity>('/security/activity') });
  const [sheet, setSheet] = useState<Sheet>(null);
  const setAuth = useApp((s) => s.setAuth);
  const qc = useQueryClient();

  return (
    <SubPage title="Security">
      <Group title="Sign-in">
        <Row icon={<KeyRound size={20} className="text-muted" aria-hidden />} label="Change password" onClick={() => setSheet('password')} />
        <Row icon={<QrCode size={20} className="text-muted" aria-hidden />} label="Reset two-factor (2FA)" onClick={() => setSheet('reset')} />
        <Row icon={<ShieldAlert size={20} className="text-muted" aria-hidden />} label="Regenerate recovery codes" onClick={() => setSheet('codes')} />
      </Group>

      <Group title="Active sessions">
        {(data?.sessions ?? []).map((s, i) => (
          <Row
            key={i}
            icon={<MonitorSmartphone size={20} className="text-muted" aria-hidden />}
            label={`${device(s.user_agent)}${s.current ? ' · this device' : ''}`}
            detail={new Date(s.last_seen_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          />
        ))}
        <Row
          icon={<LogOut size={20} aria-hidden />}
          label="Log out all devices"
          danger
          trailing={<span />}
          onClick={async () => {
            await api('/auth/logout-all', { method: 'POST' }).catch(() => undefined);
            qc.clear();
            setAuth('anon');
          }}
        />
      </Group>

      <Group title="Recent activity">
        {(data?.events ?? []).slice(0, 20).map((e, i) => (
          <li key={i} className="border-b border-hairline px-4 py-2.5 last:border-0">
            <div className="flex justify-between gap-2 text-[15px]">
              <span className={/fail|locked|reuse|wrong/i.test(e.event) ? 'text-negative' : ''}>{EVENT_LABELS[e.event] ?? e.event.replace(/_/g, ' ')}</span>
              <span className="num shrink-0 text-[13px] text-muted">
                {new Date(e.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <p className="truncate text-[13px] text-muted">
              {device(e.user_agent)} · {e.ip}
            </p>
          </li>
        ))}
      </Group>

      <PasswordSheet open={sheet === 'password'} onClose={() => setSheet(null)} />
      <RecoverySheet open={sheet === 'codes'} onClose={() => setSheet(null)} />
      <ResetSheet open={sheet === 'reset'} onClose={() => setSheet(null)} />
    </SubPage>
  );
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

function ErrorText({ children }: { children: ReactNode }) {
  return children ? (
    <p role="alert" className="text-[14px] text-negative">
      {children}
    </p>
  ) : null;
}

function PasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [code, setCode] = useState('');
  const { busy, error, run } = useAction();
  const toast = useApp((s) => s.toast);
  const close = () => {
    setCurrent('');
    setNext('');
    setCode('');
    onClose();
  };
  return (
    <BottomSheet
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Change password"
      footer={
        <Button
          block
          loading={busy}
          disabled={!current || next.length < 12 || code.length !== 6}
          onClick={async () => {
            const ok = await run(() => api('/security/change-password', { method: 'POST', body: { current_password: current, new_password: next, code } }));
            if (ok) {
              toast({ message: 'Password changed. Other devices were signed out.', tone: 'success' });
              close();
            }
          }}
        >
          Change password
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Current password">
          <input type="password" autoComplete="current-password" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" hint="At least 12 characters; common passwords are rejected.">
          <input type="password" autoComplete="new-password" className={inputClass} value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <div>
          <p className="label mb-2">Authenticator code</p>
          <OtpInput value={code} onChange={setCode} autoFocus={false} />
        </div>
        <ErrorText>{error}</ErrorText>
      </div>
    </BottomSheet>
  );
}

function CodesList({ codes }: { codes: string[] }) {
  const toast = useApp((s) => s.toast);
  return (
    <div className="space-y-3">
      <p className="text-[14px] text-warning">Save these now. Each works once and they won’t be shown again.</p>
      <ul className="card-elevated grid grid-cols-2 gap-2 p-3">
        {codes.map((c) => (
          <li key={c} className="num select-all text-center font-mono text-[15px]">
            {c}
          </li>
        ))}
      </ul>
      <Button
        variant="secondary"
        block
        onClick={() =>
          navigator.clipboard
            ?.writeText(codes.join('\n'))
            .then(() => toast({ message: 'Copied', tone: 'success' }))
            .catch(() => toast({ message: 'Copy failed', tone: 'error' }))
        }
      >
        <Copy size={18} aria-hidden /> Copy codes
      </Button>
    </div>
  );
}

function RecoverySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const { busy, error, run } = useAction();
  const close = () => {
    setPassword('');
    setCode('');
    setCodes(null);
    onClose();
  };
  return (
    <BottomSheet
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Recovery codes"
      footer={
        codes ? (
          <Button block onClick={close}>
            Done
          </Button>
        ) : (
          <Button
            block
            loading={busy}
            disabled={!password || code.length !== 6}
            onClick={async () => {
              const res = await run(() => api<{ recovery_codes: string[] }>('/security/recovery-codes', { method: 'POST', body: { password, code } }));
              if (res) setCodes(res.recovery_codes);
            }}
          >
            Generate new codes
          </Button>
        )
      }
    >
      {codes ? (
        <CodesList codes={codes} />
      ) : (
        <div className="space-y-4">
          <p className="text-[14px] text-muted">Your old recovery codes stop working immediately.</p>
          <Field label="Password">
            <input type="password" autoComplete="current-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <div>
            <p className="label mb-2">Authenticator code</p>
            <OtpInput value={code} onChange={setCode} autoFocus={false} />
          </div>
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </BottomSheet>
  );
}

function ResetSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<{ otpauth_uri: string; qr_svg: string } | null>(null);
  const [confirm, setConfirm] = useState('');
  const { busy, error, run } = useAction();
  const toast = useApp((s) => s.toast);
  const close = () => {
    setPassword('');
    setCode('');
    setSetup(null);
    setConfirm('');
    onClose();
  };
  const secret = setup ? new URL(setup.otpauth_uri).searchParams.get('secret') : null;

  return (
    <BottomSheet
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Reset two-factor"
      footer={
        setup ? (
          <Button
            block
            loading={busy}
            disabled={confirm.length !== 6}
            onClick={async () => {
              const ok = await run(() => api('/security/reset-2fa/confirm', { method: 'POST', body: { code: confirm } }));
              if (ok) {
                toast({ message: 'Two-factor updated', tone: 'success' });
                close();
              }
            }}
          >
            Activate new authenticator
          </Button>
        ) : (
          <Button
            block
            loading={busy}
            disabled={!password || code.length !== 6}
            onClick={async () => {
              const res = await run(() => api<{ otpauth_uri: string; qr_svg: string }>('/security/reset-2fa', { method: 'POST', body: { password, code } }));
              if (res) setSetup(res);
            }}
          >
            Continue
          </Button>
        )
      }
    >
      {setup ? (
        <div className="space-y-4 text-center">
          <p className="text-[14px] text-muted">Scan with Google Authenticator, then enter the new 6-digit code.</p>
          <img
            src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qr_svg)}`}
            alt="QR code for the new authenticator entry"
            className="mx-auto h-52 w-52 rounded-2xl bg-white p-2"
          />
          {secret ? <p className="num select-all break-all font-mono text-[13px] text-muted">{secret}</p> : null}
          <OtpInput value={confirm} onChange={setConfirm} autoFocus={false} />
          <ErrorText>{error}</ErrorText>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[14px] text-muted">Confirm with your password and a code from your current authenticator.</p>
          <Field label="Password">
            <input type="password" autoComplete="current-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <div>
            <p className="label mb-2">Current code</p>
            <OtpInput value={code} onChange={setCode} autoFocus={false} />
          </div>
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </BottomSheet>
  );
}
