import { Reorder, useDragControls } from 'framer-motion';
import { Archive, ArchiveRestore, GripVertical, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BottomSheet } from '@/components/sheets/BottomSheet';
import { Button, Field, IconBadge, inputClass } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { displayLabel } from '@/lib/cycle';
import { centsToRaw, formatRs, parseToCents } from '@/lib/money';
import { useSettings, useTemplates } from '@/lib/queries';
import { useApp } from '@/lib/store';
import type { FixedTemplate } from '@/lib/types';
import { ColourPicker, IconPicker, SubPage } from './shared';

export default function FixedExpensesSettings() {
  const { data } = useTemplates();
  const templates = useMemo(() => data ?? [], [data]);
  const [order, setOrder] = useState<FixedTemplate[]>([]);
  const [editing, setEditing] = useState<FixedTemplate | 'new' | null>(null);
  const qc = useQueryClient();

  // depend on the stable query result, not a fresh `[]` fallback (that would loop forever)
  useEffect(() => setOrder(templates.filter((t) => t.is_active)), [templates]);
  const archived = templates.filter((t) => !t.is_active);
  const total = order.reduce((s, t) => s + t.amount, 0);

  const saveOrder = async () => {
    const ids = [...order, ...archived].map((t) => t.id);
    if (ids.join() === templates.map((t) => t.id).join()) return;
    await api('/settings/fixed-expenses/reorder', { method: 'POST', body: { ids } });
    qc.invalidateQueries({ queryKey: ['templates'] });
    qc.invalidateQueries({ queryKey: ['bills'] });
  };

  return (
    <SubPage
      title="Fixed bills"
      right={
        <button type="button" className="tap flex items-center justify-center text-brand" onClick={() => setEditing('new')} aria-label="Add fixed bill">
          <Plus size={26} aria-hidden />
        </button>
      }
    >
      <p className="num px-1 text-[14px] text-muted">
        {order.length} bills · {formatRs(total, { whole: true })} per month. Drag ⠿ to reorder.
      </p>
      <Reorder.Group axis="y" values={order} onReorder={setOrder} className="card overflow-hidden">
        {order.map((t) => (
          <TemplateRow key={t.id} t={t} onOpen={() => setEditing(t)} onDrop={saveOrder} />
        ))}
      </Reorder.Group>
      {archived.length ? (
        <section>
          <h2 className="section-title mb-2 px-1">Archived</h2>
          <ul className="card overflow-hidden">
            {archived.map((t) => (
              <li key={t.id} className="border-b border-hairline last:border-0">
                <button type="button" className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left opacity-70" onClick={() => setEditing(t)}>
                  <IconBadge icon={t.icon} colour={t.colour} size={34} />
                  <span className="flex-1">{t.name}</span>
                  <span className="text-[13px] text-muted">from {t.archived_from_cycle ? displayLabel(t.archived_from_cycle) : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <TemplateSheet value={editing} groups={[...new Set(templates.map((t) => t.group))]} onClose={() => setEditing(null)} />
    </SubPage>
  );
}

function TemplateRow({ t, onOpen, onDrop }: { t: FixedTemplate; onOpen: () => void; onDrop: () => void }) {
  const controls = useDragControls();
  return (
    <Reorder.Item value={t} dragListener={false} dragControls={controls} onDragEnd={onDrop} className="relative border-b border-hairline bg-surface last:border-0">
      <div className="flex min-h-[60px] items-center">
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-4 text-left">
          <IconBadge icon={t.icon} colour={t.colour} size={36} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16px]">{t.name}</span>
            <span className="block text-[13px] text-muted">{t.group}</span>
          </span>
          <span className="num text-[15px]">{formatRs(t.amount, { whole: true })}</span>
        </button>
        <span
          className="tap flex cursor-grab touch-none items-center justify-center px-3 text-muted"
          onPointerDown={(e) => controls.start(e)}
          aria-label={`Reorder ${t.name}`}
          role="button"
        >
          <GripVertical size={20} aria-hidden />
        </span>
      </div>
    </Reorder.Item>
  );
}

function TemplateSheet({ value, groups, onClose }: { value: FixedTemplate | 'new' | null; groups: string[]; onClose: () => void }) {
  const isNew = value === 'new';
  const t = value && value !== 'new' ? value : null;
  const { data: settings } = useSettings();
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [raw, setRaw] = useState('');
  const [icon, setIcon] = useState('receipt');
  const [colour, setColour] = useState('#56B4E9');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!value) return;
    setName(t?.name ?? '');
    setGroup(t?.group ?? groups[0] ?? 'Utility Bills');
    setRaw(t ? centsToRaw(t.amount) : '');
    setIcon(t?.icon ?? 'receipt');
    setColour(t?.colour ?? '#56B4E9');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const cents = parseToCents(raw);
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      for (const k of ['templates', 'bills', 'summary']) qc.invalidateQueries({ queryKey: [k] });
      toast({ message: msg, tone: 'success' });
      onClose();
    } catch (e) {
      toast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!cents || !name.trim() || !group.trim()) return;
    if (isNew) return run(() => api('/settings/fixed-expenses', { method: 'POST', body: { name, group, amount: cents, icon, colour } }), 'Bill added');
    const body: Record<string, unknown> = { name, group, icon, colour };
    if (cents !== t!.amount) body.amount = cents;
    return run(() => api(`/settings/fixed-expenses/${t!.id}`, { method: 'PATCH', body }), 'Saved');
  };

  return (
    <BottomSheet
      open={!!value}
      onOpenChange={(o) => !o && onClose()}
      title={isNew ? 'New fixed bill' : 'Edit bill'}
      footer={
        <div className="flex gap-2">
          {t ? (
            <Button
              variant="secondary"
              aria-label={t.is_active ? 'Archive' : 'Restore'}
              onClick={() => run(() => api(`/settings/fixed-expenses/${t.id}`, { method: 'PATCH', body: { is_active: !t.is_active } }), t.is_active ? 'Archived' : 'Restored')}
            >
              {t.is_active ? <Archive size={18} aria-hidden /> : <ArchiveRestore size={18} aria-hidden />}
            </Button>
          ) : null}
          <Button block onClick={save} loading={busy} disabled={!cents || !name.trim() || !group.trim()}>
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <input className={inputClass} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Group">
          <input className={inputClass} value={group} list="bill-groups" maxLength={40} onChange={(e) => setGroup(e.target.value)} />
          <datalist id="bill-groups">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </Field>
        <Field
          label="Monthly amount (Rs)"
          hint={t ? `Changes apply from ${settings ? displayLabel(settings.current_cycle) : 'this cycle'} onward. Past cycles keep their amount.` : undefined}
        >
          <input className={inputClass + ' num'} inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value.replace(/[^\d.,]/g, ''))} />
        </Field>
        {t && t.amount_history.length > 1 ? (
          <div>
            <p className="label mb-1.5">Amount history</p>
            <ul className="card-elevated divide-y divide-[var(--hairline)] text-[14px]">
              {[...t.amount_history].reverse().map((h) => (
                <li key={h.effective_from_cycle} className="flex justify-between px-3 py-2">
                  <span className="text-muted">{h.effective_from_cycle === '2000-01' ? 'Original' : `From ${displayLabel(h.effective_from_cycle)}`}</span>
                  <span className="num">{formatRs(h.amount, { whole: true })}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div>
          <p className="label mb-1.5">Colour</p>
          <ColourPicker value={colour} onChange={setColour} />
        </div>
        <div>
          <p className="label mb-1.5">Icon</p>
          <IconPicker value={icon} onChange={setIcon} colour={colour} />
        </div>
      </div>
    </BottomSheet>
  );
}
