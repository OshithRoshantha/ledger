import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Segmented } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { useSettings } from '@/lib/queries';
import { local, useApp } from '@/lib/store';
import { applyTheme } from '@/lib/theme';
import type { AppSettings } from '@/lib/types';
import { SubPage } from './shared';

export function AppearanceSettings() {
  const { data: s } = useSettings();
  const qc = useQueryClient();
  const toast = useApp((st) => st.toast);
  const [theme, setTheme] = useState<AppSettings['theme']>((local.get('theme') as AppSettings['theme']) ?? 'dark');
  useEffect(() => {
    if (s) setTheme(s.theme);
  }, [s]);
  return (
    <SubPage title="Appearance">
      <Segmented
        label="Theme"
        value={theme}
        onChange={async (t) => {
          setTheme(t);
          applyTheme(t);
          try {
            await api('/settings', { method: 'PATCH', body: { theme: t } });
            qc.invalidateQueries({ queryKey: ['settings'] });
          } catch (e) {
            toast({ message: errorMessage(e), tone: 'error' });
          }
        }}
        options={[
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
          { value: 'system', label: 'System' },
        ]}
      />
      <p className="px-1 text-[13px] text-muted">Dark is the default. System follows your iPhone’s appearance.</p>
    </SubPage>
  );
}
