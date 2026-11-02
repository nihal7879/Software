import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, fmtDate } from '../../api/client';
import { Section, Table, Spinner } from '../../components/ui';
import { Overlay } from '../../components/Overlay';
import { toast } from '../../components/Toast';
import { useAuth } from '../../auth/AuthContext';
import { markRegistrationsSeen } from '../../lib/registrationsSeen';

type Status = 'Pending' | 'Approved' | 'Rejected';
type Reg = {
  id: number; first_name: string; last_name?: string; email: string; username?: string; mobile?: string;
  created_at: string; reviewed_at?: string; approved_as?: 'Trial' | 'Enrolled';
  reject_reason?: string; student_id?: number; form_no?: string;
};
type Decision = { reg: Reg; action: 'Trial' | 'Enrolled' | 'Reject' };

const nameOf = (r: Reg) => [r.first_name, r.last_name].filter(Boolean).join(' ');
const day = (v?: string) => (v ? fmtDate(String(v).slice(0, 10)) : '—');

type Who = 'students' | 'faculty' | 'parent';

// Everyone who registered themselves, on its own menu item. A student who
// registers on /register/student cannot sign in until an admin approves them
// here — as a Trial (with free hours, T-number) or an Enrolment (next form
// number). Teachers and parents wait here too now: approving one creates their
// login. Rejecting keeps the request on record and the person is told at
// sign-in. Approved and Rejected are kept as history.
export default function Registrations() {
  const qc = useQueryClient();
  const [who, setWho] = useState<Who>('students');
  const [status, setStatus] = useState<Status>('Pending');
  const [decision, setDecision] = useState<Decision | null>(null);
  const [trialHours, setTrialHours] = useState('2');
  const [reason, setReason] = useState('');

  const list = useQuery({
    queryKey: ['registrations', status],
    queryFn: () => api.get('/registrations', { params: { status } }).then((r) => r.data.data as Reg[]),
    refetchInterval: status === 'Pending' ? 60_000 : false,
  });
  const { user } = useAuth();
  // Looking at the Pending list counts as seeing it: the sidebar badge clears,
  // and returns only when a newer registration arrives.
  useEffect(() => {
    if (status !== 'Pending' || !list.data?.length) return;
    markRegistrationsSeen(user?.id, Math.max(...list.data.map((r) => r.id)));
    qc.invalidateQueries({ queryKey: ['registrations-count', 'unseen'] });
  }, [status, list.data, user?.id, qc]);

  const count = useQuery({
    // Its own key: Students reads the same endpoint as a bare number under
    // ['registrations-count'], and two shapes under one key overwrite each other.
    queryKey: ['registrations-count', 'by-role'],
    queryFn: () => api.get('/registrations/count').then((r) => r.data as { students: number; teachers: number; parents: number }),
  });

  const close = () => { setDecision(null); setReason(''); setTrialHours('2'); };
  const decide = useMutation({
    mutationFn: (d: Decision) =>
      d.action === 'Reject'
        ? api.post(`/registrations/${d.reg.id}/reject`, { reason: reason.trim() || null })
        : api.post(`/registrations/${d.reg.id}/approve`, {
            student_type: d.action,
            ...(d.action === 'Trial' && Number(trialHours) > 0 ? { trial_hours: Number(trialHours) } : {}),
          }),
    onSuccess: (r: any, d) => {
      toast(d.action === 'Reject'
        ? `${nameOf(d.reg)}'s registration rejected`
        : `${nameOf(d.reg)} approved as ${d.action === 'Trial' ? 'a Trial' : 'Enrolled'} — Form ${r.data.form_no}. They can sign in now as "${r.data.username}".`);
      for (const k of ['registrations', 'registrations-count', 'mgmt-master', 'students', 'ledger-all']) {
        qc.invalidateQueries({ queryKey: [k] });
      }
      close();
    },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not complete that', 'error'),
  });

  const rows = list.data || [];
  const waiting: Record<Who, number> = {
    students: count.data?.students || 0,
    faculty: count.data?.teachers || 0,
    parent: count.data?.parents || 0,
  };
  const pendingCount = waiting[who];
  // Which list — in the header of the card it filters, not as a second row of
  // tabs under the first, where the two looked like one control.
  const statusSwitch = (
    <div className="flex gap-1 rounded-lg p-0.5 w-full sm:w-auto" style={{ background: 'var(--color-card-alt)' }} role="tablist">
      {(['Pending', 'Approved', 'Rejected'] as const).map((s) => (
        <button
          key={s}
          type="button"
          role="tab"
          aria-selected={status === s}
          onClick={() => setStatus(s)}
          className={`flex-1 sm:flex-none justify-center text-xs px-3 py-1.5 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
            status === s ? 'bg-[var(--color-card)] font-semibold shadow-sm' : 'muted hover:text-[var(--color-primary)]'
          }`}
        >
          {s}
          {s === 'Pending' && pendingCount > 0 && (
            <span
              className="inline-flex items-center justify-center h-[16px] min-w-[16px] px-1 text-[10px] font-bold leading-none text-white rounded-full tabular-nums"
              style={{ background: 'var(--color-primary)' }}
            >
              {pendingCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
  const WHO_TABS: { key: Who; label: string }[] = [
    { key: 'students', label: 'Students' },
    { key: 'faculty', label: 'Teachers' },
    { key: 'parent', label: 'Parents' },
  ];

  const head =
    status === 'Pending' ? ['Student', 'Username', 'Email', 'Mobile', 'Registered', '']
    : status === 'Approved' ? ['Student', 'Username', 'Email', 'Mobile', 'Approved as', 'Form No', 'Registered', 'Approved']
    : ['Student', 'Username', 'Email', 'Mobile', 'Reason', 'Registered', 'Rejected'];

  return (
    <div className="space-y-4">
      <div className="hidden md:block">
        <h1 className="text-2xl font-bold">Registrations</h1>
        <p className="muted text-sm">Students, teachers and parents who registered themselves. Nobody can sign in until you approve them.</p>
      </div>

      {/* Who registered — each with how many are waiting. */}
      <div className="flex p-1 rounded-xl w-full sm:w-fit" style={{ background: 'var(--color-card-alt)' }} role="tablist">
        {WHO_TABS.map((t) => {
          const on = who === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition ${on ? 'shadow-sm' : 'muted'}`}
              style={on ? { background: 'var(--color-card)', color: 'var(--color-primary)' } : {}}
              onClick={() => setWho(t.key)}
            >
              {t.label}
              {waiting[t.key] > 0 && (
                <span
                  className="inline-flex items-center justify-center h-[18px] min-w-[18px] px-1 text-[11px] font-bold leading-none text-white rounded-full tabular-nums"
                  style={{ background: 'var(--color-primary)' }}
                >
                  {waiting[t.key]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {who !== 'students' ? <AccountRegistrations role={who} status={status} action={statusSwitch} /> : (
      <Section title={listTitle(status, rows.length, list.isLoading)} action={statusSwitch}>
        {list.isLoading ? <Spinner /> : rows.length === 0 ? (
          <EmptyState status={status} noun="student" />
        ) : (
          <Table head={head}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="table-td font-medium">{nameOf(r)}</td>
                <td className="table-td font-mono text-xs">{r.username || <span className="muted">{r.email}</span>}</td>
                <td className="table-td">{r.email}</td>
                <td className="table-td whitespace-nowrap">{r.mobile || '—'}</td>

                {status === 'Pending' && (
                  <>
                    <td className="table-td whitespace-nowrap">{day(r.created_at)}</td>
                    <td className="table-td whitespace-nowrap">
                      <div className="flex items-center gap-1 justify-end">
                        <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => setDecision({ reg: r, action: 'Trial' })}>Approve as Trial</button>
                        <button className="btn-primary !py-1 !px-2.5 text-xs" onClick={() => setDecision({ reg: r, action: 'Enrolled' })}>Approve as Enrolled</button>
                        <button
                          className="!py-1 !px-2.5 text-xs rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 transition-colors"
                          onClick={() => setDecision({ reg: r, action: 'Reject' })}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </>
                )}

                {status === 'Approved' && (
                  <>
                    <td className="table-td">{r.approved_as || '—'}</td>
                    <td className="table-td font-mono">
                      {r.student_id ? (
                        <Link to={`/admin/student/${r.student_id}`} className="hover:underline" style={{ color: 'var(--color-primary)' }}>{r.form_no}</Link>
                      ) : '—'}
                    </td>
                    <td className="table-td whitespace-nowrap">{day(r.created_at)}</td>
                    <td className="table-td whitespace-nowrap">{day(r.reviewed_at)}</td>
                  </>
                )}

                {status === 'Rejected' && (
                  <>
                    <td className="table-td">{r.reject_reason || <span className="muted">—</span>}</td>
                    <td className="table-td whitespace-nowrap">{day(r.created_at)}</td>
                    <td className="table-td whitespace-nowrap">{day(r.reviewed_at)}</td>
                  </>
                )}
              </tr>
            ))}
          </Table>
        )}
      </Section>
      )}

      {decision && (
        <Overlay align="center" onClose={close}>
          <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-1">
              {decision.action === 'Reject' ? 'Reject registration' : `Approve as ${decision.action === 'Trial' ? 'Trial' : 'Enrolled'}`}
            </h2>
            <p className="muted text-sm mb-4"><b>{nameOf(decision.reg)}</b> · {decision.reg.email}</p>

            {decision.action === 'Trial' && (
              <div className="mb-4">
                <label className="text-xs font-medium muted">Free trial hours</label>
                <input className="input mt-1" type="number" step="0.5" min="0" value={trialHours} onChange={(e) => setTrialHours(e.target.value)} />
                <p className="muted text-xs mt-1">They get a T-number and these hours to use. Enrol them later from the student list.</p>
              </div>
            )}
            {decision.action === 'Enrolled' && (
              <p className="text-sm mb-4">They get the next form number and can sign in straight away. Add their paid hours from Finance.</p>
            )}
            {decision.action === 'Reject' && (
              <div className="mb-4">
                <label className="text-xs font-medium muted">Reason (optional, kept on record)</label>
                <input className="input mt-1" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Duplicate registration" />
                <p className="muted text-xs mt-1">They will be told at sign-in that their registration was not approved.</p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                className={decision.action === 'Reject'
                  ? 'flex-1 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50'
                  : 'btn-primary flex-1'}
                disabled={decide.isPending}
                onClick={() => decide.mutate(decision)}
              >
                {decide.isPending ? 'Working…' : decision.action === 'Reject' ? 'Reject' : 'Approve'}
              </button>
              <button className="btn-ghost" onClick={close}>Cancel</button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}

type AccountReg = {
  id: number; role: 'faculty' | 'parent'; username: string; email: string; name: string; mobile?: string | null;
  specialization?: string | null; relationship?: string | null; status: Status; reject_reason?: string | null;
  created_at: string; reviewed_at?: string | null; child_name?: string | null; child_form_no?: string | null;
};

/**
 * Teachers or parents who registered. Approving creates their login (and the
 * teacher record, or the parent's link to the child) — what registering used
 * to do on the spot. Laid out as rows of cards rather than a wide table, since
 * a parent row carries the child as well.
 */
function AccountRegistrations({ role, status, action }: { role: 'faculty' | 'parent'; status: Status; action: ReactNode }) {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<AccountReg | null>(null);
  const [approving, setApproving] = useState<AccountReg | null>(null);
  const [reason, setReason] = useState('');
  const noun = role === 'faculty' ? 'teacher' : 'parent';

  const list = useQuery({
    queryKey: ['registrations', 'accounts', role, status],
    queryFn: () => api.get('/registrations/accounts', { params: { role, status } }).then((r) => r.data.data as AccountReg[]),
    refetchInterval: status === 'Pending' ? 60_000 : false,
  });
  const rows = list.data || [];

  const done = () => {
    for (const k of ['registrations', 'registrations-count', 'teachers', 'workload']) qc.invalidateQueries({ queryKey: [k] });
    setRejecting(null); setApproving(null); setReason('');
  };
  const approve = useMutation({
    mutationFn: (r: AccountReg) => api.post(`/registrations/accounts/${r.id}/approve`),
    onSuccess: (res: any, r) => { toast(`${r.name} approved — they can sign in now as "${res.data.username}".`); done(); },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not approve that', 'error'),
  });
  const reject = useMutation({
    mutationFn: (r: AccountReg) => api.post(`/registrations/accounts/${r.id}/reject`, { reason: reason.trim() || null }),
    onSuccess: (_res, r) => { toast(`${r.name}'s registration rejected`); done(); },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not reject that', 'error'),
  });

  return (
    <Section title={listTitle(status, rows.length, list.isLoading)} action={action}>
      {list.isLoading ? <Spinner /> : rows.length === 0 ? (
        <EmptyState status={status} noun={noun} />
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border p-3.5 flex flex-wrap items-start gap-x-4 gap-y-3" style={{ borderColor: 'var(--color-border)' }}>
              <div className="min-w-0 flex-1 basis-64">
                <div className="font-semibold">
                  {r.name}
                  {role === 'parent' && r.relationship && <span className="muted font-normal text-sm"> · {r.relationship}</span>}
                </div>
                <div className="text-sm mt-0.5 break-words">
                  <span className="font-mono text-xs">{r.username}</span>
                  <span className="muted"> · {r.email}{r.mobile ? ` · ${r.mobile}` : ''}</span>
                </div>
                {role === 'faculty' && (
                  <div className="text-sm mt-1"><span className="muted">Teaches:</span> {r.specialization || '—'}</div>
                )}
                {role === 'parent' && (
                  <div className="text-sm mt-1">
                    <span className="muted">Parent of:</span>{' '}
                    {r.child_name ? <><b>{r.child_name}</b> <span className="font-mono muted text-xs">Form {r.child_form_no}</span></> : '—'}
                  </div>
                )}
                <div className="text-xs muted mt-1.5">
                  Registered {day(r.created_at)}
                  {status === 'Approved' && ` · Approved ${day(r.reviewed_at || undefined)}`}
                  {status === 'Rejected' && ` · Rejected ${day(r.reviewed_at || undefined)}`}
                </div>
                {status === 'Rejected' && r.reject_reason && (
                  <div className="text-xs mt-1 text-red-600 dark:text-red-400">Reason: {r.reject_reason}</div>
                )}
              </div>
              {status === 'Pending' && (
                <div className="flex gap-1.5 max-sm:w-full">
                  <button className="btn-primary !py-1.5 !px-3 text-sm max-sm:flex-1" onClick={() => setApproving(r)}>Approve</button>
                  <button
                    className="!py-1.5 !px-3 text-sm rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 transition-colors max-sm:flex-1"
                    onClick={() => setRejecting(r)}
                  >
                    Reject
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {(approving || rejecting) && (
        <Overlay align="center" onClose={() => { setApproving(null); setRejecting(null); setReason(''); }}>
          <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-1">{approving ? `Approve ${noun}` : 'Reject registration'}</h2>
            <p className="muted text-sm mb-4"><b>{(approving || rejecting)!.name}</b> · {(approving || rejecting)!.email}</p>
            {approving && (
              <p className="text-sm mb-4">
                {role === 'faculty'
                  ? 'They get a teacher login and appear under Teachers. Assign their students from a student\'s Report.'
                  : <>They get a parent login linked to <b>{approving.child_name}</b>, and see only that child.</>}
              </p>
            )}
            {rejecting && (
              <div className="mb-4">
                <label className="text-xs font-medium muted">Reason (optional, kept on record)</label>
                <input className="input mt-1" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Not one of our teachers" />
                <p className="muted text-xs mt-1">They will be told at sign-in that their registration was not approved.</p>
              </div>
            )}
            <div className="flex gap-2">
              <button
                className={rejecting
                  ? 'flex-1 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50'
                  : 'btn-primary flex-1'}
                disabled={approve.isPending || reject.isPending}
                onClick={() => (approving ? approve.mutate(approving) : reject.mutate(rejecting!))}
              >
                {approve.isPending || reject.isPending ? 'Working…' : approving ? 'Approve' : 'Reject'}
              </button>
              <button className="btn-ghost" onClick={() => { setApproving(null); setRejecting(null); setReason(''); }}>Cancel</button>
            </div>
          </div>
        </Overlay>
      )}
    </Section>
  );
}

/** The card's heading: what the list is, with how many when there are any. */
function listTitle(status: Status, n: number, loading: boolean) {
  const what = status === 'Pending' ? 'Waiting for approval' : status;
  return loading || n === 0 ? what : `${what} · ${n}`;
}

/** An empty list: one plain line, as the institute asked. */
function EmptyState({ status, noun }: { status: Status; noun: string }) {
  return (
    <p className="muted text-sm">
      {status === 'Pending' ? `No ${noun}s are waiting for approval.` : `No ${status.toLowerCase()} ${noun}s yet.`}
    </p>
  );
}
