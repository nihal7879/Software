import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Select } from './Select';

// One parent or guardian from /fees/parents: everyone with this name, and the
// children they are on record for.
export type ParentMatch = {
  key: string;
  name: string;
  relations: string[];
  mobiles: string[];
  children: any[]; // student rows (studentOption-ready) + `relation`
};

const childrenLine = (g: ParentMatch) => {
  const rel = g.relations.length === 1 ? g.relations[0] : 'Parent';
  const kids = g.children.map((c) => `${c.full_name} (${c.form_no})`).join(', ');
  return [`${rel} of ${kids}`, g.mobiles[0]].filter(Boolean).join(' · ');
};

/**
 * Search a parent or guardian by name or mobile — for assigning a payment by
 * who sent it, since a bank line names the payer, not the child.
 *
 * Picking a person calls onPick with them (and their children); typing a name
 * that is not on record is kept as plain text (onPick(null, name)), because the
 * payer is sometimes a relative who is on nobody's form.
 */
export function ParentPicker({
  value,
  onPick,
  compact = false,
  placeholder = 'Search parent / guardian…',
}: {
  /** The payer name shown in the box. */
  value: string;
  onPick: (match: ParentMatch | null, typedName: string) => void;
  compact?: boolean;
  placeholder?: string;
}) {
  const [search, setSearch] = useState('');
  const ready = search.trim().length >= 2;
  const found = useQuery({
    queryKey: ['parent-search', search],
    queryFn: () => api.get('/fees/parents', { params: { search } }).then((r) => r.data.data as ParentMatch[]),
    enabled: ready,
    staleTime: 30_000,
  });
  const matches = found.data || [];

  return (
    <Select
      value={value}
      compact={compact}
      allowCustom
      onSearch={setSearch}
      placeholder={placeholder}
      // Before a search there is simply nothing to show yet — "No matches" there
      // read as "this parent does not exist".
      emptyText={!ready ? 'Type a name, or 4+ digits of a mobile…' : found.isFetching ? 'Searching…' : 'No parent or guardian found.'}
      options={ready ? matches.map((g) => ({ value: g.key, label: g.name, sub: childrenLine(g) })) : []}
      onChange={(v) => {
        const g = matches.find((m) => m.key === v);
        onPick(g || null, g ? g.name : String(v));
      }}
    />
  );
}

/**
 * Shown when the chosen parent has more than one child here: one button per
 * child, so the payment is put against the right one on purpose rather than by
 * whichever came first.
 */
export function ChildChooser({
  children,
  selectedId,
  onChoose,
}: {
  children: any[];
  selectedId?: string | number;
  onChoose: (child: any) => void;
}) {
  if (children.length < 2) return null;
  return (
    <div className="mt-1.5">
      <div className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 mb-1">
        {children.length} children — which one is this for?
      </div>
      <div className="flex flex-wrap gap-1">
        {children.map((c) => {
          const on = String(selectedId) === String(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onChoose(c)}
              className={`text-xs px-2 py-1 rounded-lg border transition ${on ? 'text-white border-transparent' : 'hover:bg-[var(--color-card-alt)]'}`}
              style={on ? { background: 'var(--color-primary)' } : { borderColor: 'var(--color-border)' }}
              title={`${c.full_name} — Form ${c.form_no}${c.status !== 'Active' ? ` (${c.status})` : ''}`}
            >
              {c.full_name} <span className={on ? 'opacity-80' : 'muted'}>· {c.form_no}</span>
              {c.status !== 'Active' && <span className={on ? 'opacity-80' : 'muted'}> · {c.status}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
