import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Overlay } from './Overlay';
import { Spinner } from './ui';
import { toast } from './Toast';
import { useAuth } from '../auth/AuthContext';

/**
 * The reminder rule and its wording, in one place.
 *
 * Both halves live here on purpose. "Chase them at 5 hours" and "this is what
 * we say when we do" are one decision made by the same person on the same
 * afternoon, and splitting them across two screens is how they drift apart.
 *
 * Reading it is open to any admin — a number nobody can see is a number
 * nobody trusts, and the office is entitled to know why a family appeared on
 * their list. Changing it is the super admin's, like every other switch that
 * applies to the whole institute: moving the first warning from 5 hours to 8
 * changes who gets chased across every family at once.
 */

type Config = {
  enabled: boolean;
  firstHours: number;
  overdraftFrom: number;
  textFirst: string;
  textZero: string;
  textOver: string;
  signature: string;
};

/** What {name} and {n} become, so the editor shows a real sentence, not a template. */
const preview = (t: string, name: string, n: string) =>
  t.replace(/\{name\}/g, name).replace(/\{form_no\}/g, '102').replace(/\{n\}/g, n).replace(/\b1 hours\b/g, '1 hour');

export function ReminderWording({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = user?.role === 'superadmin';
  const [form, setForm] = useState<Config | null>(null);
  const [error, setError] = useState('');

  const cfg = useQuery({
    queryKey: ['reminders-config'],
    queryFn: () => api.get('/reminders/config').then((r) => r.data as Config),
  });

  useEffect(() => { if (cfg.data && !form) setForm({ ...cfg.data }); }, [cfg.data, form]);

  const save = useMutation({
    mutationFn: () => api.put('/reminders/config', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders-config'] });
      qc.invalidateQueries({ queryKey: ['reminders'] });
      setError('');
      toast('Wording saved');
      onClose();
    },
    onError: (e: any) => setError(e?.response?.data?.error || 'Could not save it.'),
  });

  const set = <K extends keyof Config>(k: K, v: Config[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const num = (label: string, k: 'firstHours' | 'overdraftFrom', hint: string) => (
    <div>
      <label className="text-xs font-medium muted">{label}</label>
      <input
        className="input mt-1 tnum"
        type="number"
        step="1"
        disabled={!canEdit}
        value={form ? String(form[k]) : ''}
        onChange={(e) => set(k, Number(e.target.value) as any)}
      />
      <p className="text-[11px] muted mt-1 leading-snug">{hint}</p>
    </div>
  );

  const text = (label: string, k: 'textFirst' | 'textZero' | 'textOver', example: string, n: string) => (
    <div>
      <div className="flex items-baseline gap-2">
        <label className="text-xs font-semibold">{label}</label>
        <span className="text-[11px] muted">{example}</span>
      </div>
      <textarea
        className="input mt-1"
        rows={4}
        maxLength={2000}
        disabled={!canEdit}
        value={form ? form[k] : ''}
        onChange={(e) => set(k, e.target.value)}
      />
      <div className="rounded-lg px-3 py-2 mt-1.5 text-[12.5px] leading-relaxed whitespace-pre-line"
        style={{ background: 'var(--color-card-alt)' }}>
        {form ? preview(form[k], 'Meera Samrat Navale', n) : ''}
      </div>
    </div>
  );

  return (
    <Overlay align="center" onClose={onClose}>
      <div className="card w-full max-w-2xl p-6 max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold shrink-0">Reminder wording</h2>
        <p className="muted text-sm mt-1 mb-4 shrink-0">
          When a reminder is raised, and what it says. {canEdit
            ? 'Changes apply within ten seconds.'
            : 'Only the super admin can change these.'}
        </p>

        {cfg.isLoading || !form ? <Spinner /> : (
          <div className="overflow-auto pr-1 space-y-5">
            <div className="rounded-xl p-3" style={{ background: 'var(--color-card-alt)' }}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {num('Running low at', 'firstHours', 'The first message, when the balance falls to this many hours.')}
                {num('Overdrawn at', 'overdraftFrom', 'This or deeper. -2 catches -3, -6 and worse — one message, not one per hour.')}
              </div>
              <label className="flex items-center gap-2 mt-3 text-sm">
                <input type="checkbox" disabled={!canEdit} checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
                Raise reminders automatically
              </label>
              <p className="text-[11px] muted mt-2 leading-snug">
                Nothing fires between the first number and zero. Zero always fires on its own. Only active students
                who have had hours credited are ever chased.
              </p>
            </div>

            <p className="text-xs muted">
              <b>{'{name}'}</b> the student · <b>{'{n}'}</b> their real hours, never the threshold ·
              <b> {'{form_no}'}</b> the form number · <b>{'{n_after}'}</b> hours left in a fresh
              package once the overdraft comes off it
            </p>
            {/* The office writes these, so the one piece of syntax they need is
                spelled out rather than left to be discovered. */}
            <p className="text-xs muted mt-1">
              Anything inside <b>{'[[ ]]'}</b> is only sent to a parent whose child has actually
              gone past the package. At exactly zero hours it drops out, so nobody is told they
              have exceeded 0 hours.
            </p>

            {text('1 · Running low', 'textFirst', 'hours left, above zero', '3')}
            {text('2 · Out of hours', 'textZero', 'zero, down to the overdraft line', '0')}
            {text('3 · Overdrawn', 'textOver', 'at the overdraft line or past it', '4.5')}

            <div>
              <label className="text-xs font-semibold">Bank details and sign-off</label>
              <p className="text-[11px] muted mt-0.5 mb-1">
                Added under every message when it is copied. Not shown on the list — the office knows their own account.
              </p>
              <textarea
                className="input"
                rows={8}
                maxLength={2000}
                disabled={!canEdit}
                value={form.signature}
                onChange={(e) => set('signature', e.target.value)}
              />
            </div>

            <p className="text-xs muted">
              Reminders already raised keep the words they were raised with. A parent was told something specific,
              and the record should not quietly rewrite itself.
            </p>
          </div>
        )}

        {error && <p className="text-sm mt-3 shrink-0" style={{ color: 'var(--color-danger, #DC2626)' }}>{error}</p>}

        <div className="flex gap-2 justify-end mt-4 shrink-0">
          <button className="btn-ghost" onClick={onClose}>Close</button>
          {canEdit && (
            <button className="btn-primary" disabled={!form || save.isPending} onClick={() => save.mutate()}>
              Save
            </button>
          )}
        </div>
      </div>
    </Overlay>
  );
}
