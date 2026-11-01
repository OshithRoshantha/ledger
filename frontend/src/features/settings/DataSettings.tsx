import { useQueryClient } from '@tanstack/react-query';
import { Download, FileJson, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { BottomSheet } from '@/components/sheets/BottomSheet';
import { Button } from '@/components/ui/primitives';
import { api, download, errorMessage } from '@/lib/api';
import { useApp } from '@/lib/store';
import { Group, Row, SubPage } from './shared';

type Backup = { format?: string; exported_at?: string; expense_entries?: unknown[]; income_entries?: unknown[]; fixed_payments?: unknown[] };

export default function DataSettings() {
  const toast = useApp((s) => s.toast);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Backup | null>(null);
  const [busy, setBusy] = useState(false);

  const exp = (path: string) => download(path).catch((e) => toast({ message: errorMessage(e), tone: 'error' }));

  return (
    <SubPage title="Data">
      <Group title="Export" footer="CSV opens in Excel / Numbers. The JSON backup can be restored here.">
        <Row icon={<Download size={20} className="text-muted" aria-hidden />} label="Export CSV" onClick={() => exp('/export/csv')} />
        <Row icon={<FileJson size={20} className="text-muted" aria-hidden />} label="Download JSON backup" onClick={() => exp('/export/json')} />
      </Group>
      <Group title="Restore" footer="Importing replaces all current entries, bills, categories and settings with the backup.">
        <Row icon={<Upload size={20} className="text-muted" aria-hidden />} label="Import JSON backup…" onClick={() => fileRef.current?.click()} />
      </Group>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            const parsed = JSON.parse(await file.text()) as Backup;
            if (parsed.format !== 'ledger-backup') throw new Error('Not a Ledger backup file.');
            setPending(parsed);
          } catch (err) {
            toast({ message: errorMessage(err), tone: 'error' });
          }
        }}
      />
      <BottomSheet
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title="Restore this backup?"
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api('/import/json', { method: 'POST', body: pending });
                  await qc.invalidateQueries();
                  toast({ message: 'Backup restored', tone: 'success' });
                  setPending(null);
                } catch (err) {
                  toast({ message: errorMessage(err), tone: 'error' });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Replace my data
            </Button>
          </div>
        }
      >
        {pending ? (
          <div className="space-y-2 text-[15px]">
            <p>
              Exported <b>{pending.exported_at ? new Date(pending.exported_at).toLocaleString('en-GB') : 'unknown date'}</b>
            </p>
            <p className="text-muted">
              {pending.expense_entries?.length ?? 0} expenses · {pending.income_entries?.length ?? 0} income entries · {pending.fixed_payments?.length ?? 0} bill payments
            </p>
            <p className="text-warning">Tip: download a fresh backup first so you can undo this.</p>
          </div>
        ) : null}
      </BottomSheet>
    </SubPage>
  );
}
