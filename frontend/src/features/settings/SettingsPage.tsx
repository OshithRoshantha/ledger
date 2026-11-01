import { CalendarClock, Database, LogOut, Palette, Receipt, Shapes, ShieldCheck, Wallet } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/queries';
import { useApp } from '@/lib/store';
import { Group, Row } from './shared';

function Glyph({ children, bg }: { children: React.ReactNode; bg: string }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-white" style={{ background: bg }} aria-hidden>
      {children}
    </span>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { data: s } = useSettings();
  const username = useApp((st) => st.username);
  const setAuth = useApp((st) => st.setAuth);
  const qc = useQueryClient();

  const logout = async () => {
    await api('/auth/logout', { method: 'POST', noRetry: true }).catch(() => undefined);
    qc.clear();
    setAuth('anon');
  };

  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-5 px-4 pt-4">
        {username ? <p className="px-1 text-[14px] text-muted">Signed in as {username}</p> : null}
        <Group title="Money">
          <Row icon={<Glyph bg="#6366F1"><Receipt size={18} /></Glyph>} label="Fixed bills" onClick={() => navigate('/settings/fixed')} />
          <Row icon={<Glyph bg="#22C55E"><Wallet size={18} /></Glyph>} label="Income sources" onClick={() => navigate('/settings/income')} />
          <Row icon={<Glyph bg="#E69F00"><Shapes size={18} /></Glyph>} label="Categories & reasons" onClick={() => navigate('/settings/categories')} />
        </Group>
        <Group title="Preferences">
          <Row
            icon={<Glyph bg="#0072B2"><CalendarClock size={18} /></Glyph>}
            label="Income & Cycle"
            detail={s ? `Salary day ${s.salary_day}` : ''}
            onClick={() => navigate('/settings/cycle')}
          />
          <Row
            icon={<Glyph bg="#64748B"><Palette size={18} /></Glyph>}
            label="Appearance"
            detail={s ? s.theme[0].toUpperCase() + s.theme.slice(1) : ''}
            onClick={() => navigate('/settings/appearance')}
          />
        </Group>
        <Group title="Account">
          <Row icon={<Glyph bg="#F43F5E"><ShieldCheck size={18} /></Glyph>} label="Security" onClick={() => navigate('/settings/security')} />
          <Row icon={<Glyph bg="#14B8A6"><Database size={18} /></Glyph>} label="Data & backup" onClick={() => navigate('/settings/data')} />
        </Group>
        <Group>
          <Row icon={<LogOut size={20} className="ml-1.5 mr-0.5" aria-hidden />} label="Log out" danger onClick={logout} trailing={<span />} />
        </Group>
        <p className="pb-2 text-center text-[12px] text-muted">Ledger · amounts in LKR</p>
      </div>
    </>
  );
}
