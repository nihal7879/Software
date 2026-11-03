import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, LockOpen } from 'lucide-react';
import { api } from '../api/client';
import { toast } from './Toast';

/**
 * One switch per audience, in the super admin's settings.
 *
 * It was a single switch for students. A parent dashboard shows the same
 * hours, fees and attendance for the same child, so locking students while
 * the figures were being corrected left the one audience most likely to ask
 * about them still reading the old numbers. Teachers are here for the same
 * reason — their screens carry hours taught.
 *
 * The three are independent on purpose: the office sometimes wants parents
 * held back while teachers carry on working.
 */
const PANELS = [
  {
    key: 'student' as const,
    title: 'Student dashboards',
    whenLocked: 'Students can sign in, finish their profile, change their password and check in — their dashboard, hours, fees and lectures are locked.',
    whenOpen: 'Students can see their dashboard, hours, fees and lectures.',
    lock: 'Lock for all students',
    unlock: 'Unlock for all students',
  },
  {
    key: 'parent' as const,
    title: 'Parent dashboards',
    whenLocked: "Parents can sign in and change their password — their child's hours, fees and attendance are locked.",
    whenOpen: "Parents can see their child's hours, fees and attendance.",
    lock: 'Lock for all parents',
    unlock: 'Unlock for all parents',
  },
  {
    key: 'faculty' as const,
    title: 'Teacher dashboards',
    whenLocked: 'Teachers can sign in and change their password — their students, hours and lectures are locked.',
    whenOpen: 'Teachers can see their students, hours and lectures.',
    lock: 'Lock for all teachers',
    unlock: 'Unlock for all teachers',
  },
];

export function PanelAccessCards() {
  const qc = useQueryClient();
  const locks = useQuery({
    queryKey: ['panel-access'],
    queryFn: () => api.get('/settings/panel-access').then((r) => r.data as Record<string, boolean>),
  });
  const [confirming, setConfirming] = useState<string | null>(null);

  const flip = useMutation({
    mutationFn: (v: { panel: string; locked: boolean }) =>
      api.put('/settings/panel-access', v).then((r) => r.data),
    onSuccess: (data, v) => {
      qc.setQueryData(['panel-access'], data);
      // The student app reads the old key; keep it in step so a locked
      // student is not left looking at a dashboard until the page reloads.
      qc.setQueryData(['student-access'], !!data.student);
      toast(v.locked ? 'Locked' : 'Unlocked');
      setConfirming(null);
    },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not change this', 'error'),
  });

  return (
    <div className="space-y-3">
      {PANELS.map((p) => {
        const locked = !!locks.data?.[p.key];
        const busy = flip.isPending && flip.variables?.panel === p.key;
        return (
          <div key={p.key} className="card p-5 flex flex-wrap items-center gap-4">
            <span
              className="grid place-items-center w-11 h-11 rounded-full shrink-0"
              style={{ background: 'var(--color-card-alt)', color: locked ? '#ef4444' : '#10b981' }}
            >
              {locked ? <Lock size={20} /> : <LockOpen size={20} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-bold flex items-center gap-2">
                {p.title}
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                  locked ? 'bg-red-500/15 text-red-600 dark:text-red-400' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                }`}>
                  {locks.isLoading ? '…' : locked ? 'Locked' : 'Open'}
                </span>
              </div>
              <p className="muted text-sm">{locked ? p.whenLocked : p.whenOpen}</p>
            </div>
            {confirming === p.key ? (
              <div className="flex items-center gap-2">
                <span className="text-sm">{locked ? 'Open it for everyone?' : 'Lock it for everyone?'}</span>
                <button className="btn-primary !py-1.5 !px-3 text-sm" disabled={busy}
                  onClick={() => flip.mutate({ panel: p.key, locked: !locked })}>
                  {busy ? 'Saving…' : locked ? 'Yes, unlock' : 'Yes, lock'}
                </button>
                <button className="btn-ghost !py-1.5 !px-3 text-sm" onClick={() => setConfirming(null)}>Cancel</button>
              </div>
            ) : (
              <button
                className="btn-ghost !py-1.5 !px-3 text-sm whitespace-nowrap"
                disabled={locks.isLoading}
                onClick={() => setConfirming(p.key)}
              >
                {locked ? p.unlock : p.lock}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

