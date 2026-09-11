import { useEffect, useState } from 'react';
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

// Student self-registrations, on a page of their own (reached from the button on
// Students). A student who registers on /register/student cannot sign in until
// an admin approves them here — as a Trial (with free hours, T-number) or an
// Enrolment (next form number). Rejecting keeps the request on record and the
// student is told at sign-in. Approved and Rejected are kept as history.
export default function Registrations() {
  const qc = useQueryClient();
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
    queryKey: ['registrations-count'],
    queryFn: () => api.get('/registrations/count').then((r) => Number(r.data.pending) || 0),
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
  const pendingCount = count.data || 0;

  const head =
    status === 'Pending' ? ['Student', 'Username', 'Email', 'Mobile', 'Registered', '']
    : status === 'Approved' ? ['Student', 'Username', 'Email', 'Mobile', 'Approved as', 'Form No', 'Registered', 'Approved']
    : ['Student', 'Username', 'Email', 'Mobile', 'Reason', 'Registered', 'Rejected'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/admin/students" className="btn-ghost !py-1.5 !px-3 text-sm whitespace-nowrap">← Students</Link>
        <div>
          <h1 className="text-2xl font-bold">Student Registrations</h1>
          <p className="muted text-sm">Students who registered themselves. They can sign in once you approve them as a Trial or Enrolled.</p>
        </div>
      </div>

      <div className="flex gap-1 rounded-lg p-0.5 w-fit" style={{ background: 'var(--color-card-alt)' }}>
        {(['Pending', 'Approved', 'Rejected'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors inline-flex items-center gap-1.5 ${
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

      <Section title={`${rows.length} ${status.toLowerCase()} registration${rows.length === 1 ? '' : 's'}`}>
        {list.isLoading ? <Spinner /> : rows.length === 0 ? (
          <p className="muted text-sm">
            {status === 'Pending' ? 'Nobody is waiting for approval.' : `No ${status.toLowerCase()} registrations yet.`}
          </p>
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
