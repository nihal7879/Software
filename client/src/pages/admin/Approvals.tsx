import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, Clock, X } from 'lucide-react';
import { api, fmtDate, hrs } from '../../api/client';
import { Section, Spinner } from '../../components/ui';
import { Overlay } from '../../components/Overlay';
import { toast } from '../../components/Toast';

/**
 * Approvals — the office proposes, the super admin decides.
 *
 * Anything that moves a family's balance waits here. Nothing has been written
 * to the statement while it waits, so approving is what makes it real and
 * rejecting leaves no trace on the student's figures.
 *
 * Each request shows the student's hours as they stand and what they would
 * become, with their recent entries a click away - the question is never
 * "is this number valid" but "is this right for this student", and that cannot
 * be answered from the number alone.
 *
 * This page is the super admin's alone. The office never sees the queue: they
 * are told their change was sent when they save it, and see the result on the
 * statement once it is approved.
 */

type Row = {
  id: number;
  kind: string;
  label: string;
  summary: string;
  /** Why the office is asking. Written for the super admin, never on the statement. */
  request_note: string | null;
  status: string;
  payload: any;
  student_id: number;
  student_name: string;
  form_no: string | null;
  requested_at: string;
  requested_by_name: string | null;
  decided_at: string | null;
  decided_by_name: string | null;
  decision_note: string | null;
  hours_left: number;
  hours_change: number;
  hours_after: number;
  /** What actually moves. A field with `from`/`to` changed; one with `value` is new or being removed. */
  changes: { label: string; from?: string; to?: string; value?: string }[];
};

/** '2026-09-28 13:40:00' to '28 Sep, 1:40 PM'. */
function when(v: string | null) {
  if (!v) return '';
  const [date, time] = String(v).split(' ');
  const [, m, d] = date.split('-').map(Number);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  return `${d} ${MONTHS[m - 1]}, ${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, '0')} ${ampm}`;
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** That student's recent hours, opened under a request being judged. */
function History({ studentId }: { studentId: number }) {
  const h = useQuery({
    queryKey: ['approval-history', studentId],
    queryFn: () => api.get(`/approvals/student/${studentId}/history`).then((r) => r.data),
  });

  if (h.isLoading) return <div className="p-3"><Spinner /></div>;
  const d = h.data;
  const adjustments = d?.adjustments || [];
  const packages = d?.packages || [];

  return (
    <div className="rounded-xl border p-3 mt-3 text-sm" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap gap-x-5 gap-y-1 mb-3">
        <span>Credited <b className="tnum">{hrs(d?.credited || 0)}</b></span>
        <span>Used <b className="tnum">{hrs(d?.consumed || 0)}</b></span>
        <span>Left <b className="tnum">{hrs(d?.hours_left || 0)}</b></span>
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-wide muted mb-1">Recent hours entries</div>
      {adjustments.length === 0 ? (
        <p className="muted">No manual entries on this student.</p>
      ) : (
        <div className="space-y-1">
          {adjustments.map((a: any) => (
            <div key={a.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className={`tnum font-semibold ${Number(a.delta) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {signed(Number(a.delta))} h
              </span>
              <span className="muted text-xs">{fmtDate(String(a.adjusted_on || a.created_at).slice(0, 10))}</span>
              {a.reason && <span className="muted text-xs">- {a.reason}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="text-[11px] font-semibold uppercase tracking-wide muted mt-3 mb-1">Packages</div>
      {packages.length === 0 ? (
        <p className="muted">No packages.</p>
      ) : (
        <div className="space-y-1">
          {packages.map((p: any) => (
            <div key={p.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="tnum font-semibold">{hrs(p.package_hours)}</span>
              {Number(p.discount_hours) > 0 && (
                <span className="text-xs text-amber-600">+{hrs(p.discount_hours)} discount</span>
              )}
              <span className="muted text-xs">{fmtDate(String(p.start_date).slice(0, 10))}</span>
              {p.amount != null && <span className="muted text-xs">{Number(p.amount).toLocaleString()} AED</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Turning one down asks why, so the office is told something useful. */
function RejectModal({ row, busy, onReject, onClose }: {
  row: Row; busy: boolean; onReject: (note: string) => void; onClose: () => void;
}) {
  const [note, setNote] = useState('');
  return (
    <Overlay align="center" onClose={onClose}>
      <div className="card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold">Turn this down</h2>
          <button className="btn-ghost !py-1 !px-2.5 text-sm" onClick={onClose}>Close</button>
        </div>
        <p className="muted text-sm mb-4">{row.summary}</p>
        <label className="text-xs font-medium muted block">Reason (optional)</label>
        <input
          className="input mt-1"
          placeholder="e.g. already credited on the September payment"
          value={note}
          maxLength={255}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onReject(note); }}
        />
        <p className="muted text-xs mt-1.5">
          Nothing changes on the statement. The office sees this reason on their request.
        </p>
        <button
          className="btn-primary w-full mt-5"
          disabled={busy}
          onClick={() => onReject(note)}
        >
          {busy ? 'Saving…' : 'Turn it down'}
        </button>
      </div>
    </Overlay>
  );
}

export default function Approvals() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'Pending' | 'Approved' | 'Rejected'>('Pending');
  const [open, setOpen] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<Row | null>(null);

  const list = useQuery({
    queryKey: ['approvals', status],
    queryFn: () => api.get('/approvals', { params: { status } }).then((r) => r.data.data as Row[]),
  });

  const done = () => {
    qc.invalidateQueries({ queryKey: ['approvals'] });
    qc.invalidateQueries({ queryKey: ['approvals-count'] });
    // The statement has actually moved now.
    ['ledger', 'ledger-all', 'adjustments', 'student-report', 'mgmt-master', 'hours']
      .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  const approve = useMutation({
    mutationFn: (id: number) => api.post(`/approvals/${id}/approve`),
    onSuccess: () => { toast('Approved — it is on the statement now.'); done(); },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not approve that.', 'error'),
  });

  const reject = useMutation({
    mutationFn: (v: { id: number; note: string }) => api.post(`/approvals/${v.id}/reject`, { note: v.note || null }),
    onSuccess: () => { toast('Turned down. Nothing changed on the statement.'); setRejecting(null); done(); },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not turn that down.', 'error'),
  });

  const rows = list.data || [];

  return (
    <div className="space-y-4">
      <Section
        title="Waiting for your approval"
        action={
          <>
            {(['Pending', 'Approved', 'Rejected'] as const).map((s) => (
              <button
                key={s}
                className={status === s ? 'btn-primary !py-1 !px-2.5 text-xs' : 'btn-ghost !py-1 !px-2.5 text-xs'}
                onClick={() => { setStatus(s); setOpen(null); }}
              >
                {s}
              </button>
            ))}
          </>
        }
      >
        <p className="muted text-sm mb-4">
          Hours and fee entries added by the admin. They are added to the student
          statement only after you approve them.
        </p>

        {list.isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <p className="muted text-sm">
            {status === 'Pending' ? 'Nothing waiting.' : `Nothing ${status.toLowerCase()}.`}
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.id} className="card p-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link to={`/admin/student/${r.student_id}`} className="font-semibold hover:underline">
                    {r.student_name}
                  </Link>
                  {r.form_no && <span className="muted text-xs font-mono">#{r.form_no}</span>}
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-500/15 muted">{r.label}</span>
                  <span className="ml-auto text-xs muted whitespace-nowrap">
                    <Clock size={11} className="inline mr-1" />
                    {when(r.requested_at)}{r.requested_by_name ? ` by ${r.requested_by_name}` : ''}
                  </span>
                </div>

                <div className="text-sm muted mt-0.5">{r.summary}</div>

                {/* The explanation and then what actually moves, on one grid.
                    An edit is usually about the date or the note rather than
                    the hours, so the fields are listed one by one. */}
                <div className="rounded-xl border mt-2 overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                  {r.request_note && (
                    <div
                      className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 py-2 text-sm"
                      style={{ background: 'var(--color-card-alt)' }}
                    >
                      <span className="muted text-xs w-36 shrink-0 pt-0.5">Admin&rsquo;s explanation</span>
                      <span className="flex-1 min-w-[12rem] whitespace-pre-wrap break-words">{r.request_note}</span>
                    </div>
                  )}
                  {r.changes?.map((c, i) => (
                    <div
                      key={i}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-sm border-t"
                      style={{ borderColor: 'var(--color-border)' }}
                    >
                      <span className="muted text-xs w-36 shrink-0">{c.label}</span>
                      {c.from !== undefined ? (
                        <span className="flex flex-wrap items-baseline gap-2">
                          <span className="line-through muted">{c.from}</span>
                          <span className="muted">&rarr;</span>
                          <span className="font-semibold">{c.to}</span>
                        </span>
                      ) : (
                        <span className="font-semibold">{c.value}</span>
                      )}
                    </div>
                  ))}
                </div>

                {/* What it would do to the balance - the figure the decision
                    actually turns on. */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm mt-2">
                  <span className="muted">Hours left now <b className="tnum">{hrs(r.hours_left)}</b></span>
                  {!!r.hours_change && (
                    <>
                      <span className={Number(r.hours_change) < 0 ? 'text-red-600' : 'text-emerald-600'}>
                        {signed(Number(r.hours_change))} h
                      </span>
                      <span className="muted">would become <b className="tnum">{hrs(r.hours_after)}</b></span>
                    </>
                  )}
                  <button
                    className="text-xs font-semibold text-[var(--color-primary)] hover:underline inline-flex items-center gap-1"
                    onClick={() => setOpen(open === r.id ? null : r.id)}
                  >
                    <ChevronDown size={12} className={open === r.id ? 'rotate-180 transition' : 'transition'} />
                    {open === r.id ? 'Hide history' : "See this student's hours"}
                  </button>
                </div>

                {open === r.id && <History studentId={r.student_id} />}

                {r.status === 'Pending' && (
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <button
                      className="btn-primary !py-1 !px-3 text-xs ml-auto"
                      disabled={approve.isPending}
                      onClick={() => approve.mutate(r.id)}
                    >
                      <Check className="w-3.5 h-3.5" /> Approve
                    </button>
                    <button
                      className="inline-flex items-center justify-center gap-1.5 !py-1 !px-3 text-xs rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10"
                      disabled={approve.isPending}
                      onClick={() => setRejecting(r)}
                    >
                      <X className="w-3.5 h-3.5" /> Turn down
                    </button>
                  </div>
                )}

                {r.status !== 'Pending' && (
                  <div className="text-xs muted mt-2">
                    {r.status === 'Approved' ? 'Approved' : 'Turned down'} {when(r.decided_at)}
                    {r.decided_by_name ? ` by ${r.decided_by_name}` : ''}
                    {r.decision_note ? ` — ${r.decision_note}` : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {rejecting && (
        <RejectModal
          row={rejecting}
          busy={reject.isPending}
          onClose={() => setRejecting(null)}
          onReject={(note) => reject.mutate({ id: rejecting.id, note })}
        />
      )}
    </div>
  );
}
