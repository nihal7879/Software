import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, LockOpen, LayoutDashboard, Users, BookOpen } from 'lucide-react';
import { api } from '../api/client';
import { toast } from './Toast';

/**
 * What each audience can see, in the super admin's hands.
 *
 * It began as one switch for students. A parent dashboard shows the same
 * hours, fees and attendance for the same child, so locking students while
 * the figures were being corrected left the one audience most likely to ask
 * about them still reading the old numbers — hence a switch of their own.
 *
 * The teacher side is not one switch but three. A teacher's app is also how
 * the institute records what happened: a class entered, a desk scan
 * confirmed. One pull used to take all of that away along with the figures,
 * which stopped all nine teachers working. Now the hours on their dashboard
 * can be held back while Lecture Entry carries on.
 *
 * A toggle that is ON means the screen is there. Turning one off asks a
 * second time, because it goes off for everybody at once.
 */
type Row = {
  key: string;
  label: string;
  icon: any;
  whenOn: string;
  whenOff: string;
};

const STUDENT: Row = {
  key: 'student',
  label: 'Student dashboard',
  icon: LayoutDashboard,
  whenOn: 'Students see their dashboard, hours, fees and lectures.',
  whenOff: 'Students can sign in, finish their profile, change their password and check in — the figures are hidden.',
};

const PARENT: Row = {
  key: 'parent',
  label: 'Parent dashboard',
  icon: LayoutDashboard,
  whenOn: "Parents see their child's hours, fees and attendance.",
  whenOff: 'Parents can sign in and change their password — the figures are hidden.',
};

const TEACHER: Row[] = [
  {
    key: 'teacher_dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    whenOn: 'Teachers see their home screen: recent classes and hours taught.',
    whenOff: 'The home screen is hidden. Signing in lands on Lecture Entry instead.',
  },
  {
    key: 'teacher_students',
    label: 'My Students',
    icon: Users,
    whenOn: "Teachers see their roster, and each student's hours.",
    whenOff: 'The roster is hidden — Lecture Entry can still pick students for a class.',
  },
  {
    key: 'teacher_lecture',
    label: 'Lecture Entry',
    icon: BookOpen,
    whenOn: 'Teachers enter classes and confirm desk scans.',
    whenOff: 'No class can be entered and no scan confirmed — attendance stops being recorded. Use this one sparingly.',
  },
];

function Toggle({ on, busy, onClick, label }: { on: boolean; busy: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={busy}
      onClick={onClick}
      className={`relative shrink-0 w-12 h-7 rounded-full transition-colors duration-150 disabled:opacity-50 ${
        on ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-600'
      }`}
    >
      <span
        className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform duration-150 ${
          on ? 'translate-x-5' : ''
        }`}
      />
    </button>
  );
}

export function PanelAccessCards() {
  const qc = useQueryClient();
  const locks = useQuery({
    queryKey: ['panel-access'],
    queryFn: () => api.get('/settings/panel-access').then((r) => r.data as Record<string, boolean>),
  });
  // The one being turned off, waiting for the second press.
  const [confirming, setConfirming] = useState<string | null>(null);

  const flip = useMutation({
    mutationFn: (v: { panel: string; locked: boolean }) =>
      api.put('/settings/panel-access', v).then((r) => r.data),
    onSuccess: (data, v) => {
      qc.setQueryData(['panel-access'], data);
      // The student app reads the old key; keep it in step so a locked
      // student is not left looking at a dashboard until the page reloads.
      qc.setQueryData(['student-access'], !!data.student);
      toast(v.locked ? 'Hidden' : 'Visible');
      setConfirming(null);
    },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not change this', 'error'),
  });

  const row = (r: Row, inset: boolean) => {
    const locked = !!locks.data?.[r.key];
    const busy = flip.isPending && flip.variables?.panel === r.key;
    const asking = confirming === r.key;
    const Icon = r.icon;
    return (
      <div key={r.key} className={`flex flex-wrap items-center gap-3 ${inset ? 'py-3' : ''}`}>
        <span
          className="grid place-items-center w-9 h-9 rounded-full shrink-0"
          style={{ background: 'var(--color-card-alt)', color: locked ? '#ef4444' : '#10b981' }}
        >
          <Icon size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold flex items-center gap-2">
            {r.label}
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
              locked ? 'bg-red-500/15 text-red-600 dark:text-red-400' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
            }`}>
              {locks.isLoading ? '…' : locked ? 'Hidden' : 'Visible'}
            </span>
          </div>
          <p className="muted text-sm">{locked ? r.whenOff : r.whenOn}</p>
        </div>
        {asking ? (
          <div className="flex items-center gap-2">
            <span className="text-sm">Hide it for everyone?</span>
            <button className="btn-primary !py-1.5 !px-3 text-sm" disabled={busy}
              onClick={() => flip.mutate({ panel: r.key, locked: true })}>
              {busy ? 'Saving…' : 'Yes, hide'}
            </button>
            <button className="btn-ghost !py-1.5 !px-3 text-sm" onClick={() => setConfirming(null)}>Cancel</button>
          </div>
        ) : (
          <Toggle
            on={!locked}
            busy={busy || locks.isLoading}
            label={r.label}
            // Turning one back on is the safe direction, so it happens at
            // once. Turning one off takes everybody's screen away, so it asks.
            onClick={() => (locked ? flip.mutate({ panel: r.key, locked: false }) : setConfirming(r.key))}
          />
        )}
      </div>
    );
  };

  const allTeacherOff = TEACHER.every((t) => !!locks.data?.[t.key]);

  return (
    <div className="space-y-3">
      <div className="card p-5">{row(STUDENT, false)}</div>
      <div className="card p-5">{row(PARENT, false)}</div>

      <div className="card p-5">
        <div className="flex items-center gap-3 mb-1">
          <span
            className="grid place-items-center w-11 h-11 rounded-full shrink-0"
            style={{ background: 'var(--color-card-alt)', color: allTeacherOff ? '#ef4444' : '#10b981' }}
          >
            {allTeacherOff ? <Lock size={20} /> : <LockOpen size={20} />}
          </span>
          <div className="min-w-0">
            <div className="font-bold">Teacher app</div>
            <p className="muted text-sm">
              One screen at a time. Signing in, the profile and changing a password are never locked.
            </p>
          </div>
        </div>
        <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
          {TEACHER.map((t) => row(t, true))}
        </div>
      </div>
    </div>
  );
}
