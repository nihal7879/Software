import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  UserPlus, CheckCircle2, FileSpreadsheet, LogIn, LogOut, ShieldQuestion, Gavel, Bell, Search,
} from 'lucide-react';
import { api, fmtDate } from '../../api/client';
import { Section, Spinner } from '../../components/ui';

/**
 * The notification log — everything the system has sent, and whether it landed.
 *
 * The bell answers "what have I been told?". This answers the question the
 * office actually gets asked: "was that parent ever told?" A push is opt-in per
 * device and most people never turn it on, so a notice can be perfectly well
 * sent and still have reached no phone at all — and from the outside there is
 * no way to tell that apart from a notice nobody sent. Every one of them is
 * kept here, with who it was for and how many devices it reached.
 *
 * The tabs are the way the office groups them, not the kind column: the money
 * (anything waiting on the super admin, and the statements that go out), the
 * new people, and the classes. Everything is a tab of its own as well, so a new
 * kind of notice cannot be sent and then be invisible here.
 */

type Row = {
  id: number;
  kind: string;
  title: string;
  body: string;
  status: 'sent' | 'no_device' | 'failed' | 'not_configured';
  devices: number;
  error: string | null;
  created_at: string;
  user_id: number | null;
  to_role: string | null;
  to_name: string | null;
  student_id: number | null;
  student_name: string | null;
  form_no: string | null;
};

const TABS = [
  { key: 'all', label: 'Everything' },
  { key: 'finance', label: 'Finance' },
  { key: 'login', label: 'New logins' },
  { key: 'lecture', label: 'Lectures' },
] as const;

const ICONS: Record<string, any> = {
  approval_request: ShieldQuestion,
  approval_decided: Gavel,
  registration_new: UserPlus,
  registration_approved: CheckCircle2,
  hours_statement: FileSpreadsheet,
  check_in: LogIn,
  check_out: LogOut,
};

const ROLE_LABEL: Record<string, string> = {
  admin: 'Office',
  superadmin: 'Super admin',
  faculty: 'Teacher',
  teacher: 'Teacher',
  student: 'Student',
  parent: 'Parent',
};

/**
 * Did it arrive? Four plain answers, because three of them read as "it failed"
 * otherwise — and only one of them is anybody's fault.
 */
function Delivery({ r }: { r: Row }) {
  const pill = 'inline-block px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap';
  if (r.status === 'sent') {
    return (
      <span className={`${pill} bg-emerald-500/15 text-emerald-600 dark:text-emerald-400`}>
        On {r.devices} {r.devices === 1 ? 'device' : 'devices'}
      </span>
    );
  }
  if (r.status === 'no_device') {
    return (
      <span
        className={`${pill} bg-[var(--color-card-alt)] muted`}
        title="They have never turned notifications on, on any device. It is waiting in their bell inside the app."
      >
        In their bell only
      </span>
    );
  }
  if (r.status === 'not_configured') {
    return (
      <span className={`${pill} bg-amber-500/15 text-amber-700 dark:text-amber-400`}
        title="The server has no push keys set, so nothing could be sent to any device.">
        Push is off
      </span>
    );
  }
  return (
    <span className={`${pill} bg-red-500/15 text-red-600 dark:text-red-400`}
      title={r.error || 'The push service refused it'}>
      Did not send
    </span>
  );
}

/** "26-10-26, 4:02 PM" — the institute's clock, which is what the row holds. */
function whenText(ts: string): string {
  const m = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return String(ts);
  const [, , , , hh, mm] = m;
  const clock = `${((Number(hh) + 11) % 12) + 1}:${mm} ${Number(hh) < 12 ? 'AM' : 'PM'}`;
  return `${fmtDate(ts.slice(0, 10))}, ${clock}`;
}

export default function Notifications() {
  const [tab, setTab] = useState<string>('all');
  const [q, setQ] = useState('');

  const log = useQuery({
    queryKey: ['notification-log', tab, q],
    queryFn: () =>
      api.get('/notifications/log', { params: { topic: tab, q: q || undefined, limit: 200 } })
        .then((r) => r.data as { data: Row[]; counts: Record<string, number> }),
  });

  const rows = log.data?.data ?? [];
  const counts = log.data?.counts ?? {};

  return (
    <div className="space-y-4">
      <Section
        title="Notifications sent"
        action={
          <>
            {TABS.map((t) => (
              <button
                key={t.key}
                className={tab === t.key ? 'btn-primary !py-1 !px-2.5 text-xs' : 'btn-ghost !py-1 !px-2.5 text-xs'}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                {counts[t.key] !== undefined && <span className="opacity-60 ml-1">{counts[t.key]}</span>}
              </button>
            ))}
          </>
        }
      >
        <p className="muted text-sm mb-4">
          Every notice the system has sent — an approval waiting for the super admin, a new
          registration, an hours statement, a check-in. A notice reaches a phone only where that
          person has turned notifications on; the rest wait in their bell inside the app, which is
          said plainly here rather than left looking like a failure.
        </p>

        <div className="relative mb-4 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 muted" />
          <input
            className="input !pl-9"
            placeholder="Search a name, a form number, the wording…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {log.isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <div className="py-10 text-center">
            <Bell size={28} className="mx-auto muted mb-2" />
            <p className="muted text-sm">{q ? 'Nothing matches that.' : 'Nothing has been sent yet.'}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => {
              const Icon = ICONS[r.kind] || Bell;
              return (
                <div key={r.id} className="card p-3 lg:flex lg:items-start lg:gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <span className="shrink-0 w-8 h-8 rounded-lg pill grid place-items-center">
                      <Icon size={15} style={{ color: 'var(--color-primary)' }} />
                    </span>
                    <div className="min-w-0">
                      <div className="font-semibold text-sm">{r.title}</div>
                      {/* The exact wording that was shown, so "what did it
                          actually say?" never has to be guessed at. */}
                      <div className="text-sm muted break-words">{r.body}</div>
                      {r.student_name && (
                        <div className="text-xs muted mt-0.5">
                          About {r.form_no ? `${r.form_no} — ` : ''}{r.student_name}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Below lg this sits under the wording rather than beside it,
                      so the row never widens the page. */}
                  <div className="mt-2 lg:mt-0 lg:w-56 lg:text-right shrink-0 space-y-1">
                    <div className="text-sm truncate">
                      {r.to_name || '—'}
                      {r.to_role && <span className="muted"> · {ROLE_LABEL[r.to_role] || r.to_role}</span>}
                    </div>
                    <div className="text-xs muted">{whenText(r.created_at)}</div>
                    <Delivery r={r} />
                  </div>
                </div>
              );
            })}
            {rows.length >= 200 && (
              <p className="muted text-xs pt-1">The most recent 200. Search to go further back.</p>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
