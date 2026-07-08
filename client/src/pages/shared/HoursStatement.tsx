import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { api, hrs, num } from '../../api/client';
import { Section, Table, Spinner, HoursValue, StatusBadge } from '../../components/ui';
import { CalendarRangePicker } from '../../components/CalendarPicker';

// Hours statement for the logged-in student / parent — hours credited (with
// discount/adjustment) and hours consumed per lecture, with a running balance.
export default function HoursStatement() {
  const { user } = useAuth();
  const id = user?.studentId;
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [view, setView] = useState<'summary' | 'detail'>('summary');

  const ledger = useQuery({ queryKey: ['ledger', id], queryFn: () => api.get(`/fees/ledger/${id}`).then((r) => r.data), enabled: !!id });
  const lectures = useQuery({ queryKey: ['lectures', id], queryFn: () => api.get('/lectures', { params: { studentId: id } }).then((r) => r.data.data), enabled: !!id });
  const packages = useQuery({ queryKey: ['pkg', id], queryFn: () => api.get(`/fees/packages/${id}`).then((r) => r.data.data), enabled: !!id });
  const adjustments = useQuery({ queryKey: ['adjustments', id], queryFn: () => api.get(`/fees/adjustments/${id}`).then((r) => r.data.data), enabled: !!id });

  const rows = useMemo(() => {
    type Ev = {
      kind: 'credit' | 'lecture' | 'adjustment'; date: string;
      teacher?: string; subject?: string; time_in?: string; time_out?: string; reason?: string;
      fees?: number; credited?: number; discount?: number; adjusted?: number; totalCredited?: number; used?: number;
    };
    const events: Ev[] = [];
    for (const a of adjustments.data || []) {
      const delta = Number(a.delta || 0);
      events.push({ kind: 'adjustment', date: String(a.created_at || '').slice(0, 10) || '—', reason: a.reason, adjusted: delta, totalCredited: delta });
    }
    for (const p of packages.data || []) {
      const credited = Number(p.package_hours || 0);
      const discount = Number(p.discount_hours || 0);
      const adjusted = Number(p.adjusted_hours || 0);
      const date = String(p.paid_date || p.start_date || p.created_at || '').slice(0, 10) || '—';
      // Real fee actually paid (from the linked payment); fall back to rate×hours
      // only if this package has no linked transaction.
      const fees = p.paid_amount != null ? Number(p.paid_amount) : Number(p.rate_per_hour || 0) * credited;
      events.push({ kind: 'credit', date, fees, credited, discount, adjusted, totalCredited: credited + discount + adjusted });
    }
    for (const l of lectures.data || []) {
      events.push({ kind: 'lecture', date: String(l.session_date).slice(0, 10), teacher: l.teacher_name, subject: l.subject_name, time_in: l.time_in, time_out: l.time_out, used: Number(l.hours_consumed || 0) });
    }
    events.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'credit' ? -1 : 1));
    let remaining = 0;
    return events.map((e) => {
      remaining += (e.totalCredited || 0) - (e.used || 0);
      return { ...e, remaining, month: e.date.length >= 7 ? e.date.slice(0, 7) : '—' };
    });
  }, [packages.data, lectures.data, adjustments.data]);

  const visibleRows = rows.filter((r: any) => {
    if (!r.date || r.date === '—') return !fromDate && !toDate;
    if (fromDate && r.date < fromDate) return false;
    if (toDate && r.date > toDate) return false;
    return true;
  });

  const totals = visibleRows.reduce(
    (a: any, r: any) => ({
      fees: a.fees + (r.fees || 0), credited: a.credited + (r.credited || 0),
      discount: a.discount + (r.discount || 0), adjusted: a.adjusted + (r.adjusted || 0),
      totalCredited: a.totalCredited + (r.totalCredited || 0), used: a.used + (r.used || 0),
    }),
    { fees: 0, credited: 0, discount: 0, adjusted: 0, totalCredited: 0, used: 0 }
  );

  const l = ledger.data;

  if (!id) return <p className="muted p-6">No student linked to this account.</p>;
  if (ledger.isLoading || lectures.isLoading || packages.isLoading) return <Spinner />;

  // Graphical summary figures.
  const credited = Number(l?.total_hours_credited) || 0;
  const used = Number(l?.total_hours_consumed) || 0;
  const left = Number(l?.hours_left) || 0;
  const usedPct = credited > 0 ? Math.max(0, Math.min(100, (used / credited) * 100)) : 0;
  const lowOnHours = left <= 5;
  // Fees figures
  const totalFeesPaid = rows.filter((r: any) => r.kind === 'credit').reduce((a: number, r: any) => a + (r.fees || 0), 0);
  // Most recent fees payment (last recharge/package with a fee).
  const lastPaidEvent = rows.filter((r: any) => r.kind === 'credit' && (r.fees || 0) > 0).slice(-1)[0];
  // Donut geometry
  const R = 54, C = 2 * Math.PI * R;
  const dash = (usedPct / 100) * C;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Fees Info</h1>
          <p className="muted text-sm">Fees paid, hours credited, hours used per lecture, and your running balance.</p>
        </div>
        {/* View toggle: concise summary vs detailed statement */}
        <div className="inline-flex rounded-lg p-0.5" style={{ background: 'var(--color-card-alt)' }}>
          <button
            className={`px-3 py-1.5 text-sm font-semibold rounded-md transition ${view === 'summary' ? 'text-white' : 'muted'}`}
            style={view === 'summary' ? { background: 'var(--color-primary)' } : {}}
            onClick={() => setView('summary')}
          >Summary</button>
          <button
            className={`px-3 py-1.5 text-sm font-semibold rounded-md transition ${view === 'detail' ? 'text-white' : 'muted'}`}
            style={view === 'detail' ? { background: 'var(--color-primary)' } : {}}
            onClick={() => setView('detail')}
          >Detailed</button>
        </div>
      </div>

      {view === 'summary' && (
        <Section title="Hours summary">
          <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-10">
            {/* Donut — hours remaining */}
            <div className="relative shrink-0" style={{ width: 150, height: 150 }}>
              <svg width="150" height="150" viewBox="0 0 150 150" className="-rotate-90">
                <circle cx="75" cy="75" r={R} fill="none" strokeWidth="14" stroke="var(--color-card-alt)" />
                <circle
                  cx="75" cy="75" r={R} fill="none" strokeWidth="14" strokeLinecap="round"
                  stroke={lowOnHours ? 'var(--color-accent)' : 'var(--color-primary)'}
                  strokeDasharray={`${dash} ${C}`}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <div className="text-2xl font-extrabold" style={{ color: lowOnHours ? 'var(--color-accent)' : 'var(--color-primary)' }}>{hrs(left)}</div>
                <div className="text-[11px] muted">remaining</div>
              </div>
            </div>

            {/* Stat tiles + bar */}
            <div className="flex-1 w-full space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl p-3" style={{ background: 'var(--color-card-alt)' }}>
                  <div className="text-lg font-bold">{hrs(credited)}</div>
                  <div className="text-[11px] muted">Credited</div>
                </div>
                <div className="rounded-xl p-3" style={{ background: 'var(--color-card-alt)' }}>
                  <div className="text-lg font-bold">{hrs(used)}</div>
                  <div className="text-[11px] muted">Used</div>
                </div>
                <div className="rounded-xl p-3" style={{ background: 'var(--color-card-alt)' }}>
                  <div className="text-lg font-bold" style={{ color: lowOnHours ? 'var(--color-accent)' : 'var(--color-primary)' }}><HoursValue value={left} /></div>
                  <div className="text-[11px] muted">Remaining</div>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs muted mb-1"><span>{hrs(used)} used</span><span>{Math.round(usedPct)}%</span></div>
                <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--color-card-alt)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${usedPct}%`, background: lowOnHours ? 'var(--color-accent)' : 'var(--color-primary)' }} />
                </div>
              </div>
              {lowOnHours && (
                <p className="text-sm font-medium" style={{ color: 'var(--color-accent)' }}>
                  ⚠️ Running low on hours. Please contact the institute to add more.
                </p>
              )}
              <button className="btn-ghost !py-1.5 !px-3 text-sm" onClick={() => setView('detail')}>View detailed statement →</button>
            </div>
          </div>
        </Section>
      )}

      {view === 'summary' && (
        <Section title="Fees summary">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-center">
            <div className="rounded-xl p-4" style={{ background: 'var(--color-card-alt)' }}>
              <div className="text-lg font-bold text-emerald-600">{num(totalFeesPaid)}</div>
              <div className="text-[11px] muted">Total Fees Paid (AED)</div>
            </div>
            <div className="rounded-xl p-4" style={{ background: 'var(--color-card-alt)' }}>
              <div className="text-lg font-bold">{lastPaidEvent ? num(lastPaidEvent.fees) : '—'}</div>
              <div className="text-[11px] muted">Last Fees Paid (AED){lastPaidEvent?.date ? ` · ${lastPaidEvent.date}` : ''}</div>
            </div>
            <div className="rounded-xl p-4 flex flex-col items-center justify-center gap-1" style={{ background: 'var(--color-card-alt)' }}>
              <StatusBadge status={l?.fee_status || '—'} />
              <div className="text-[11px] muted">Fee Status</div>
            </div>
          </div>
        </Section>
      )}

      {view === 'detail' && (
      <Section
        title="Hours statement — credited & consumed"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <CalendarRangePicker from={fromDate} to={toDate} onChange={(f, t) => { setFromDate(f); setToDate(t); }} placeholder="Filter by date / month" align="right" />
            {(fromDate || toDate) && (
              <button className="btn-ghost !py-1.5 !px-3 text-sm whitespace-nowrap" onClick={() => { setFromDate(''); setToDate(''); }}>Show all</button>
            )}
          </div>
        }
      >
        {rows.length === 0 ? (
          <p className="muted text-sm">No hours credited or lectures recorded yet.</p>
        ) : visibleRows.length === 0 ? (
          <p className="muted text-sm">No entries in this date range.</p>
        ) : (
          <Table head={['Date', 'Month', 'Detail', 'In', 'Out', { label: 'Fees (AED)', align: 'right' }, { label: 'Hours Credited', align: 'right' }, { label: 'Discount', align: 'right' }, { label: 'Adjusted', align: 'right' }, { label: 'Total Credited', align: 'right' }, { label: 'Used', align: 'right' }, { label: 'Hours Remaining', align: 'right' }]}>
            {visibleRows.map((r: any, i: number) => (
              <tr key={i} style={r.kind !== 'lecture' ? { background: 'var(--color-card-alt)' } : undefined}>
                <td className="table-td whitespace-nowrap">{r.date || '—'}</td>
                <td className="table-td whitespace-nowrap muted">{r.month}</td>
                <td className="table-td">
                  {r.kind === 'credit'
                    ? <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 whitespace-nowrap">Package added</span>
                    : r.kind === 'adjustment'
                    ? <span className="whitespace-nowrap"><span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600">Hours adjusted</span>{r.reason ? <span className="muted"> · {r.reason}</span> : ''}</span>
                    : <span className="whitespace-nowrap">{r.subject || 'Lecture'}</span>}
                </td>
                <td className="table-td">{r.time_in || '—'}</td>
                <td className="table-td">{r.time_out || '—'}</td>
                <td className="table-td text-right tabular-nums">{r.kind === 'credit' && r.fees ? num(r.fees) : '—'}</td>
                <td className="table-td text-right tabular-nums text-emerald-600">{r.kind === 'credit' ? num(r.credited) : '—'}</td>
                <td className="table-td text-right tabular-nums">{r.kind === 'credit' ? num(r.discount) : '—'}</td>
                <td className="table-td text-right tabular-nums">{r.kind === 'credit' || r.kind === 'adjustment' ? num(r.adjusted) : '—'}</td>
                <td className="table-td text-right tabular-nums font-medium">{r.kind === 'credit' || r.kind === 'adjustment' ? num(r.totalCredited) : '—'}</td>
                <td className="table-td text-right tabular-nums text-red-500">{r.kind === 'lecture' ? num(r.used) : '—'}</td>
                <td className="table-td text-right tabular-nums font-semibold"><HoursValue value={r.remaining} /></td>
              </tr>
            ))}
            <tr className="border-t-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}>
              <td className="table-td font-bold" colSpan={5}>Total</td>
              <td className="table-td text-right tabular-nums font-bold">{num(totals.fees)}</td>
              <td className="table-td text-right tabular-nums font-bold text-emerald-600">{num(totals.credited)}</td>
              <td className="table-td text-right tabular-nums font-bold">{num(totals.discount)}</td>
              <td className="table-td text-right tabular-nums font-bold">{num(totals.adjusted)}</td>
              <td className="table-td text-right tabular-nums font-bold">{num(totals.totalCredited)}</td>
              <td className="table-td text-right tabular-nums font-bold text-red-500">{num(totals.used)}</td>
              <td className="table-td text-right tabular-nums font-bold"><HoursValue value={l?.hours_left ?? 0} /></td>
            </tr>
          </Table>
        )}
      </Section>
      )}
    </div>
  );
}
