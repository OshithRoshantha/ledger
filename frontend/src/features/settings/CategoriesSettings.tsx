import { useState } from 'react';
import { BottomSheet } from '@/components/sheets/BottomSheet';
import { Button, Field, IconBadge, Segmented, inputClass } from '@/components/ui/primitives';
import { useCategories, useReasons, useResourceMutation } from '@/lib/queries';
import type { Category, NeedWant, Reason } from '@/lib/types';
import { ColourPicker, Group, IconPicker, Row, SubPage } from './shared';

type Kind = 'categories' | 'reasons';
type Editing = { kind: Kind; item: Category | Reason | null } | null;
type Body = { id?: string; name?: string; icon?: string; colour?: string; is_active?: boolean; unit?: string; requires_reason?: boolean; need_want?: NeedWant };

export default function CategoriesSettings() {
  const { data: categories = [] } = useCategories();
  const { data: reasons = [] } = useReasons();
  const [editing, setEditing] = useState<Editing>(null);

  const list = (kind: Kind, items: (Category | Reason)[]) => (
    <>
      {items.map((c) => (
        <Row
          key={c.id}
          icon={<IconBadge icon={c.icon} colour={c.colour} size={32} />}
          label={<span className={c.is_active ? '' : 'opacity-50'}>{c.name}</span>}
          detail={c.is_active ? ('requires_reason' in c && c.requires_reason ? 'Needs reason' : undefined) : 'Archived'}
          onClick={() => setEditing({ kind, item: c })}
        />
      ))}
      <Row label={<span className="text-brand">Add {kind === 'categories' ? 'category' : 'reason'}…</span>} onClick={() => setEditing({ kind, item: null })} trailing={<span />} />
    </>
  );

  return (
    <SubPage title="Categories">
      <Group title="Spending categories" footer="Archived items disappear from Quick Add but stay in historical charts.">
        {list('categories', categories)}
      </Group>
      <Group title="Reasons (bank & cash)">{list('reasons', reasons)}</Group>
      <ItemSheet editing={editing} onClose={() => setEditing(null)} />
    </SubPage>
  );
}

function ItemSheet({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const item = editing?.item ?? null;
  const kind = editing?.kind ?? 'categories';
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('tag');
  const [colour, setColour] = useState('#0072B2');
  const [unit, setUnit] = useState('entries');
  const [requiresReason, setRequiresReason] = useState(false);
  const [needWant, setNeedWant] = useState<NeedWant>('want');
  const [key, setKey] = useState<string | null>(null);
  const k = editing ? `${kind}:${item?.id ?? 'new'}` : null;
  if (k !== key) {
    setKey(k);
    setName(item?.name ?? '');
    setIcon(item?.icon ?? 'tag');
    setColour(item?.colour ?? '#0072B2');
    const cat = kind === 'categories' ? (item as Category | null) : null;
    setUnit(cat?.unit ?? 'entries');
    setRequiresReason(!!cat?.requires_reason);
    setNeedWant(item?.need_want ?? 'want');
  }
  const create = useResourceMutation<Body>(() => `/${kind}`, 'POST', [kind]);
  const patch = useResourceMutation<Body>((b) => `/${kind}/${b.id}`, 'PATCH', [kind, 'spending']);

  const save = () => {
    const body: Body = { name, icon, colour, need_want: needWant };
    if (kind === 'categories') Object.assign(body, { unit, requires_reason: requiresReason });
    if (item) patch.mutate({ id: item.id, ...body }, { onSuccess: onClose });
    else create.mutate(body, { onSuccess: onClose });
  };

  return (
    <BottomSheet
      open={!!editing}
      onOpenChange={(o) => !o && onClose()}
      title={`${item ? 'Edit' : 'New'} ${kind === 'categories' ? 'category' : 'reason'}`}
      footer={
        <div className="flex gap-2">
          {item ? (
            <Button variant="secondary" onClick={() => patch.mutate({ id: item.id, is_active: !item.is_active }, { onSuccess: onClose })}>
              {item.is_active ? 'Archive' : 'Restore'}
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
        {!requiresReason ? (
          <div>
            <p className="label mb-1.5">50/30/20 bucket</p>
            <Segmented
              label="Need or want"
              value={needWant}
              onChange={setNeedWant}
              options={[
                { value: 'need', label: 'Need' },
                { value: 'want', label: 'Want' },
              ]}
            />
          </div>
        ) : null}
        {kind === 'categories' ? (
          <>
            <Field label="Count label" hint="Shown on the card, e.g. “12 rides”.">
              <input className={inputClass} value={unit} maxLength={20} onChange={(e) => setUnit(e.target.value)} />
            </Field>
            <label className="flex min-h-[44px] items-center justify-between gap-3">
              <span>
                <span className="block text-[16px]">Requires method & reason</span>
                <span className="block text-[13px] text-muted">For ATM, transfer and card spending</span>
              </span>
              <input type="checkbox" className="h-6 w-6 accent-[var(--brand)]" checked={requiresReason} onChange={(e) => setRequiresReason(e.target.checked)} />
            </label>
          </>
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
