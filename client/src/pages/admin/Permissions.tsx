import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, KeyRound, Lock, LockOpen, ShieldCheck } from 'lucide-react';
import { api, dubaiNow } from '../../api/client';
import { Section, Spinner } from '../../components/ui';
import { Overlay } from '../../components/Overlay';
import { ConfirmModal } from '../../components/ConfirmModal';
import { CalendarPicker } from '../../components/CalendarPicker';
import { TimePicker } from '../../components/TimePicker';
import { useStudentAccess } from '../../components/StudentLock';
import { toast } from '../../components/Toast';

/**
 * What the Institute Admin may do beyond their own role — the super admin's
 * switches.
 *
 * Changing a student's hours moves what their family owes, so it starts with
 * the super admin alone. A switch here hands that job over until it is switched
 * back. Each one says when it was last changed and by whom, so a permission
 * left on after a busy week is visible rather than quietly standing.
 *
 * Switching one off does not undo anything already done with it — it only stops
 * the next change. The audit log holds what was done while it was on.
 */

type Detail = {
  on: boolean;
  label: string;
  changed_at: string | null;
  changed_by: string | null;
  /** The moment it stops by itself, or null to stand until switched off. */
  until: string | null;
  /** Given with an end time that has since passed. */
  expired: boolean;
};

/** '2026-09-25 11:19:20' to '25 Sep 2026, 11:19 AM'. */
function when(v: string | null) {
  if (!v) return null;
  const [date, time] = String(v).split(' ');
  const [y, m, d] = date.split('-').map(Number);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (!y || !m || !d) return null;
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${d} ${MONTHS[m - 1]} ${y}, ${h12}:${String(mm).padStart(2, '0')} ${ampm}`;
}

/** The switch itself — on is the brand colour, off is a plain track. */
function Toggle({ on, busy, onFlip }: { on: boolean; busy: boolean; onFlip: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={busy}
      onClick={onFlip}
      className="relative w-12 h-7 rounded-full transition-colors shrink-0 disabled:opacity-50"
      style={{ background: on ? 'var(--color-primary)' : 'var(--color-border)' }}
    >
      <span
        className="absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all"
        style={{ left: on ? '1.625rem' : '0.25rem' }}
      />
    </button>
  );
}

/**
 * Picks the moment a permission stops by itself.
 *
 * The office usually needs one of these for an afternoon rather than forever,
 * and a permission granted "just for today" is exactly the one most likely to
 * be left on. An end time takes it back without anybody having to remember.
 */
function UntilModal({
  title, current, busy, onSet, onClose,
}: {
  title: string;
  current: string | null;
  busy: boolean;
  onSet: (until: string | null) => void;
  onClose: () => void;
}) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const [date, setDate] = useState(current ? String(current).slice(0, 10) : stamp(dubaiNow()));
  const [time, setTime] = useState(current ? `${String(current).slice(11, 16)}:00` : '18:00:00');

  // The ends people actually pick, so the usual cases are one tap.
  const quick = (hours: number) => {
    const d = new Date(dubaiNow().getTime() + hours * 3600 * 1000);
    setDate(stamp(d));
    setTime(`${pad(d.getHours())}:${pad(d.getMinutes())}:00`);
  };
  const endOfToday = () => { setDate(stamp(dubaiNow())); setTime('23:59:00'); };

  const chosen = date && time ? `${date} ${time.slice(0, 5)}` : '';
  const past = chosen ? new Date(chosen.replace(' ', 'T')).getTime() <= dubaiNow().getTime() : false;

  return (
    <Overlay align="center" onClose={onClose}>
      <div className="card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold">On until</h2>
          <button className="btn-ghost !py-1 !px-2.5 text-sm" onClick={onClose}>Close</button>
        </div>
        <p className="muted text-sm mb-4">{title}</p>
        <p className="muted text-xs -mt-3 mb-4">All times are Dubai time.</p>

        <div className="flex flex-wrap gap-2 mb-4">
          <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => quick(1)}>1 hour</button>
          <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={endOfToday}>End of today</button>
          <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => quick(24)}>Tomorrow</button>
          <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => quick(24 * 7)}>A week</button>
        </div>

        <label className="text-xs font-medium muted block">Date</label>
        <div className="mt-1"><CalendarPicker value={date} onChange={setDate} placeholder="Pick a date…" /></div>

        <label className="text-xs font-medium muted block mt-3">Time</label>
        <div className="mt-1"><TimePicker value={time} onChange={setTime} placeholder="Pick a time…" /></div>

        {past && <p className="text-sm text-red-500 mt-3">Pick a time later than now.</p>}

        <div className="flex flex-wrap gap-2 mt-5">
          <button className="btn-primary flex-1" disabled={busy || !chosen || past} onClick={() => onSet(chosen)}>
            {busy ? 'Saving…' : 'Set end time'}
          </button>
          {current && (
            <button className="btn-ghost" disabled={busy} onClick={() => onSet(null)}>
              No end time
            </button>
          )}
        </div>
      </div>
    </Overlay>
  );
}

/**
 * Every student's dashboard at once.
 *
 * Locked, a student can still sign in, finish their profile, change their
 * password and check in to a class — but their dashboard, hours, fees and
 * lectures are closed. The server refuses that data as well, so it is not a
 * hidden screen. It sits here rather than in Settings because it is the same
 * kind of decision as the switches below: who may see or do what.
 */
function StudentAccessRow() {
  const qc = useQueryClient();
  const access = useStudentAccess();
  const [confirming, setConfirming] = useState(false);
  const locked = access.data !== false;

  const flip = useMutation({
    mutationFn: (next: boolean) => api.put('/settings/student-access', { locked: next }).then((r) => !!r.data.locked),
    onSuccess: (next) => {
      qc.setQueryData(['student-access'], next);
      toast(next ? 'Student dashboards locked' : 'Student dashboards unlocked');
      setConfirming(false);
    },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not change student access', 'error'),
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3" style={{ borderColor: 'var(--color-border)' }}>
        <span
          className="grid place-items-center w-10 h-10 rounded-full shrink-0"
          style={{ background: 'var(--color-card-alt)', color: locked ? '#ef4444' : '#10b981' }}
        >
          {locked ? <Lock size={18} /> : <LockOpen size={18} />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="font-semibold flex flex-wrap items-center gap-2">
            Students can open their dashboard
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                locked ? 'bg-red-500/15 text-red-600 dark:text-red-400' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {access.isLoading ? '…' : locked ? 'Locked' : 'Open'}
            </span>
          </div>
          <p className="muted text-sm">
            {locked
              ? 'Students can sign in, finish their profile, change their password and check in — their dashboard, hours, fees and lectures are locked.'
              : 'Students can see their dashboard, hours, fees and lectures.'}
          </p>
        </div>

        {/* On means open, so the switch reads the same way round as the others:
            on is the permissive side. */}
        <Toggle on={!locked} busy={access.isLoading || flip.isPending} onFlip={() => setConfirming(true)} />
      </div>

      {confirming && (
        <ConfirmModal
          danger={!locked}
          title={locked ? 'Open every student dashboard' : 'Lock every student dashboard'}
          message={
            locked
              ? 'Every student will see their dashboard, hours, fees and lectures again.'
              : 'Every student loses their dashboard, hours, fees and lectures. They can still sign in, finish their profile, change their password and check in to a class.'
          }
          confirmLabel={locked ? 'Open for all students' : 'Lock for all students'}
          busy={flip.isPending}
          onConfirm={() => flip.mutate(!locked)}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}

export default function Permissions() {
  const qc = useQueryClient();
  const [setting, setSetting] = useState<{ key: string; d: Detail } | null>(null);

  const perms = useQuery({
    queryKey: ['permission-details'],
    queryFn: () => api.get('/settings/permissions').then((r) => r.data.details as Record<string, Detail>),
  });

  const flip = useMutation({
    mutationFn: (v: { key: string; on: boolean; until?: string | null }) =>
      api.put(`/settings/permissions/${v.key}`, { on: v.on, until: v.until ?? null }).then((r) => r.data.details),
    onSuccess: (details, v) => {
      qc.setQueryData(['permission-details'], details);
      // The admin's own pages read this to decide what their buttons do.
      qc.invalidateQueries({ queryKey: ['permissions'] });
      setSetting(null);
      toast(
        !v.on
          ? 'Taken back from the Institute Admin'
          : v.until
          ? `On until ${when(`${v.until}:00`)}`
          : 'Given to the Institute Admin'
      );
    },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not change that permission', 'error'),
  });

  const rows = Object.entries(perms.data || {});

  return (
    <div className="space-y-4">
      <Section title="Student access">
        <p className="muted text-sm mb-4">
          What students can open when they sign in.
        </p>
        <StudentAccessRow />
      </Section>

      <Section title="Admin permissions">
        <p className="muted text-sm mb-4">
          What the Institute Admin may do beyond their own role. Everything here is
          yours by default — a switch hands it to them until you take it back.
        </p>

        {perms.isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <p className="muted text-sm">No permissions to grant yet.</p>
        ) : (
          <div className="space-y-3">
            {rows.map(([key, d]) => {
              const at = when(d.changed_at);
              return (
                <div
                  key={key}
                  className="flex flex-wrap items-center gap-3 rounded-xl border p-3"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <span
                    className="grid place-items-center w-10 h-10 rounded-full shrink-0"
                    style={{ background: 'var(--color-card-alt)', color: d.on ? '#10b981' : 'var(--color-muted)' }}
                  >
                    {d.on ? <ShieldCheck size={18} /> : <KeyRound size={18} />}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="font-semibold flex flex-wrap items-center gap-2">
                      {/* The server's own wording, so the switch and the refusal
                          message the admin sees always say the same thing. */}
                      Can {d.label}
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          d.on
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : 'bg-slate-500/15 muted'
                        }`}
                      >
                        {d.on ? 'Admin allowed' : 'Super admin only'}
                      </span>
                    </div>
                    <p className="muted text-sm">
                      {d.expired
                        ? `Ran out ${when(d.until)} — switch it on again if it is still needed.`
                        : at
                        ? `${d.on ? 'Given' : 'Taken back'} ${at}${d.changed_by ? ` by ${d.changed_by}` : ''}`
                        : 'Never changed — off since the start.'}
                    </p>
                    {/* Only worth an end time while it is actually on. */}
                    {d.on && (
                      <button
                        className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-primary)] hover:underline"
                        onClick={() => setSetting({ key, d })}
                      >
                        <Clock size={12} />
                        {d.until ? `On until ${when(d.until)} — change` : 'Set an end time'}
                      </button>
                    )}
                  </div>

                  <Toggle
                    on={d.on}
                    busy={flip.isPending}
                    onFlip={() => flip.mutate({ key, on: !d.on })}
                  />
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {setting && (
        <UntilModal
          title={`Can ${setting.d.label}`}
          current={setting.d.until}
          busy={flip.isPending}
          onClose={() => setSetting(null)}
          onSet={(until) => flip.mutate({ key: setting.key, on: true, until })}
        />
      )}
    </div>
  );
}
