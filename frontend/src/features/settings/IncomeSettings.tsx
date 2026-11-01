import { Plus } from 'lucide-react';
import { useState } from 'react';
import { BottomSheet } from '@/components/sheets/BottomSheet';
import { Button, Field, Segmented, inputClass } from '@/components/ui/primitives';
import { centsToRaw, formatRs, parseToCents } from '@/lib/money';
import { useResourceMutation, useSources } from '@/lib/queries';
import type { IncomeSource } from '@/lib/types';
import { Group, Row, SubPage } from './shared';

type SourceBody = { id?: string; name?: string; type?: 'fixed' | 'variable'; default_amount?: number; is_active?: boolean };

export default function IncomeSettings() {
  const { data: sources = [] } = useSources();
  const [editing, setEditing] = useState<IncomeSource | 'new' | null>(null);
  const active = sources.filter((s) => s.is_active);
  const archived = sources.filter((s) => !s.is_active);
  return (
    <SubPage
      title="Income"
      right={
        <button type="button" className="tap flex items-center justify-center text-brand" onClick={() => setEditing('new')} aria-label="Add income source">
          <Plus size={26} aria-hidden />
        </button>
      }
    >
      <Group title="Sources" footer="Fixed sources (like Salary) create a pending entry at the start of every cycle.">
        {active.map((s) => (
          <Row
            key={s.id}
            label={s.name}
            detail={s.type === 'fixed' ? formatRs(s.default_amount, { whole: true }) : 'Variable'}
            onClick={() => setEditing(s)}
          />
        ))}
      </Group>
      {archived.length ? (
        <Group title="Archived">
          {archived.map((s) => (
            <Row key={s.id} label={<span className="opacity-60">{s.name}</span>} onClick={() => setEditing(s)} />
          ))}
        </Group>
      ) : null}
      <SourceSheet value={editing} onClose={() => setEditing(null)} />
    </SubPage>
  );
}

function SourceSheet({ value, onClose }: { value: IncomeSource | 'new' | null; onClose: () => void }) {
  const src = value && value !== 'new' ? value : null;
  const [name, setName] = useState('');
  const [type, setType] = useState<'fixed' | 'variable'>('variable');
  const [raw, setRaw] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const k = value === 'new' ? 'new' : src?.id ?? null;
  if (k !== key) {
    setKey(k);
    setName(src?.name ?? '');
    setType(src?.type ?? 'variable');
    setRaw(src ? centsToRaw(src.default_amount) : '');
  }
  const create = useResourceMutation<SourceBody>(() => '/income-sources', 'POST', ['sources']);
  const patch = useResourceMutation<SourceBody>((b) => `/income-sources/${b.id}`, 'PATCH', ['sources']);
  const cents = parseToCents(raw || '0') ?? 0;

  const save = () => {
    const body = { name, default_amount: type === 'fixed' ? cents : 0 };
    if (src) patch.mutate({ id: src.id, ...body }, { onSuccess: onClose });
    else create.mutate({ ...body, type }, { onSuccess: onClose });
  };

  return (
    <BottomSheet
      open={!!value}
      onOpenChange={(o) => !o && onClose()}
      title={src ? 'Edit source' : 'New income source'}
      footer={
        <div className="flex gap-2">
          {src ? (
            <Button variant="secondary" onClick={() => patch.mutate({ id: src.id, is_active: !src.is_active }, { onSuccess: onClose })}>
              {src.is_active ? 'Archive' : 'Restore'}
            </Button>
          ) : null}
          <Button block disabled={!name.trim()} loading={create.isPending || patch.isPending} onClick={save}>
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <input className={inputClass} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        {!src ? (
          <Segmented label="Type" value={type} onChange={setType} options={[{ value: 'variable', label: 'Variable' }, { value: 'fixed', label: 'Fixed (monthly)' }]} />
        ) : null}
        {type === 'fixed' ? (
          <Field label="Default monthly amount (Rs)" hint="Used for the pending entry of each new cycle.">
            <input className={inputClass + ' num'} inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
        ) : null}
      </div>
    </BottomSheet>
  );
}
