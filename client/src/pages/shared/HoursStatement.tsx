import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { api, hrs, num } from '../../api/client';
import { Section, Table, Spinner, KpiCard, HoursValue } from '../../components/ui';
import { CalendarRangePicker } from '../../components/CalendarPicker';

// Hours statement for the logged-in student / parent — hours credited (with
// discount/adjustment) and hours consumed per lecture, with a running balance.
export default function HoursStatement() {
  const { user } = useAuth();
  const id = user?.studentId;
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

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
      const date = String(p.start_date || p.created_at || '').slice(0, 10) || '—';
      events.push({ kind: 'credit', date, fees: Number(p.rate_per_hour || 0) * credited, credited, discount, adjusted, totalCredited: credited + discount + adjusted });
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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Hours Statement</h1>
        <p className="muted text-sm">Hours credited, hours used per lecture, and your running balance.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard label="Total Hours" value={hrs(l?.total_hours_credited)} accent="blue" />
        <KpiCard label="Used Hours" value={hrs(l?.total_hours_consumed)} accent="indigo" />
        <KpiCard label="Remaining Hours" value={<HoursValue value={l?.hours_left ?? 0} />} accent={Number(l?.hours_left) <= 0 ? 'red' : 'emerald'} />
      </div>

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
    </div>
  );
}
