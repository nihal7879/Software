import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Clock, X } from 'lucide-react';
import { api } from '../api/client';
import { Section, Spinner } from './ui';

/**
 * The office's own approval requests — sent, approved, turned down.
 *
 * Read-only. Deciding stays with the super admin on their Approvals page; this
 * is the admin's record of what they asked for, which before was only a notice
 * in their bell. It covers every kind they can send (payments and hours), since
 * "did that go through?" is the same question whichever it was.
 */

type Status = 'Pending' | 'Approved' | 'Rejected';

type Request = {
  id: number;
  kind: string;
  label: string;
  status: Status;
  summary: string | null;
  request_note: string | null;
  decision_note: string | null;
  requested_at: string;
  decided_at: string | null;
  decided_by_name: string | null;
  student_name: string;
  form_no: string | null;
  changes: { label: string; from?: string; to?: string; value?: string }[];
};

/** '2026-11-02 14:05:00' → '2 Nov, 2:05 PM' — the stored Dubai time, as it is. */
function when(v: string | null) {
  if (!v) return '';
  const [date, time] = String(v).split(' ');
  const [, m, d] = date.split('-').map(Number);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  return `${d} ${MONTHS[m - 1]}, ${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}`;
}

const TABS: { key: Status; label: string }[] = [
  { key: 'Pending', label: 'Pending' },
  { key: 'Approved', label: 'Approved' },
  { key: 'Rejected', label: 'Rejected' },
];

/** How many of the admin's requests are still waiting — for the badge on the menu. */
export function useMyPendingCount(enabled = true) {
  return useQuery({
    queryKey: ['my-requests', 'Pending'],
    queryFn: () => api.get('/approvals/mine', { params: { status: 'Pending' } }).then((r) => r.data as { data: Request[]; counts: Record<string, number> }),
    enabled,
    staleTime: 0,
  });
}

export function MyRequests({ onClose }: { onClose?: () => void }) {
  const [status, setStatus] = useState<Status>('Pending');
  const list = useQuery({
    queryKey: ['my-requests', status],
    queryFn: () => api.get('/approvals/mine', { params: { status } }).then((r) => r.data as { data: Request[]; counts: Record<string, number> }),
    staleTime: 0,
  });
  const rows = list.data?.data || [];
  const counts = list.data?.counts || {};

  return (
    <Section
      title={status === 'Pending' ? 'Waiting for super admin' : status}
      action={
        <>
          <div className="flex p-1 rounded-xl flex-1 sm:flex-none" style={{ background: 'var(--color-card-alt)' }} role="tablist">
            {TABS.map((t) => {
              const on = status === t.key;
              const n = counts[t.key] || 0;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={on}
                  className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition ${on ? 'shadow-sm' : 'muted'}`}
                  style={on ? { background: 'var(--color-card)', color: 'var(--color-primary)' } : {}}
                  onClick={() => setStatus(t.key)}
                >
                  {t.label}
                  {n > 0 && <span className="text-xs tabular-nums muted">{n}</span>}
                </button>
              );
            })}
          </div>
          {onClose && (
            <button className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={onClose} aria-label="Close my requests">
              <X size={14} /> Close
            </button>
          )}
        </>
      }
    >
      {list.isLoading ? <Spinner /> : rows.length === 0 ? (
        <p className="muted text-sm">
          {status === 'Pending' ? 'Nothing waiting — every request you sent has been decided.'
            : status === 'Approved' ? 'No approved requests yet.'
            : 'None of your requests has been turned down.'}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border p-3.5" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                <div className="min-w-0">
                  <div className="font-semibold">
                    {r.student_name}
                    {r.form_no && <span className="font-mono muted text-xs font-normal ml-1.5">{r.form_no}</span>}
                  </div>
                  <div className="text-sm first-letter:uppercase">{r.label}</div>
                </div>
                <StatusChip r={r} />
              </div>

              {r.changes.length > 0 && (
                <div className="mt-2 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
                  {r.changes.map((c, i) => (
                    <div key={i} className="min-w-0 break-words">
                      <span className="muted">{c.label}: </span>
                      {c.value != null ? c.value : <>{c.from} <span className="muted">→</span> <b>{c.to}</b></>}
                    </div>
                  ))}
                </div>
              )}

              {r.request_note && (
                <p className="text-xs mt-2 break-words"><span className="muted">Your reason:</span> {r.request_note}</p>
              )}
              {r.status === 'Rejected' && (
                <p className="text-xs mt-1.5 break-words text-red-600 dark:text-red-400">
                  <span className="font-semibold">Why not:</span> {r.decision_note || 'No reason given — please ask the super admin.'}
                </p>
              )}
              <p className="text-[11px] muted mt-2">Sent {when(r.requested_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function StatusChip({ r }: { r: Request }) {
  if (r.status === 'Pending') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 whitespace-nowrap">
        <Clock size={12} /> Waiting for super admin
      </span>
    );
  }
  const ok = r.status === 'Approved';
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap ${ok ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-red-500/15 text-red-600 dark:text-red-400'}`}>
      {ok ? <Check size={12} /> : <X size={12} />}
      {ok ? 'Approved' : 'Not approved'} {when(r.decided_at)}
    </span>
  );
}
