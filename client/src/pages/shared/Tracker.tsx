import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { api, rs, hrs, num } from '../../api/client';
import { KpiCard, Section, StatusBadge, Table, HoursValue, Spinner } from '../../components/ui';
import { DateRangePicker } from '../../components/DateRangePicker';

// "Student Sheet" tracker — month-wise hours + fees pivot, summary, and the full
// per-lecture log (date, month, form no, student, time in/out, hours, teacher,
// attendance). Shared by STUDENT (own history) and PARENT (their child).
// Backend scopes /lectures, /fees/* to the logged-in user's student.

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "2025-09" -> "Sep-25"
const fmtMonth = (m?: string) => {
  if (!m) return '—';
  const [y, mm] = m.split('-');
  const idx = Number(mm) - 1;
  return `${MON[idx] ?? mm}-${y.slice(2)}`;
};

export default function Tracker() {
  const { user } = useAuth();
  const id = user?.studentId;
  const isParent = user?.role === 'parent';

  const ledger = useQuery({ queryKey: ['ledger', id], queryFn: () => api.get(`/fees/ledger/${id}`).then((r) => r.data), enabled: !!id });
  const lectures = useQuery({ queryKey: ['lectures', id], queryFn: () => api.get('/lectures', { params: { studentId: id } }).then((r) => r.data.data), enabled: !!id });
  const tx = useQuery({ queryKey: ['tx', id], queryFn: () => api.get(`/fees/transactions/${id}`).then((r) => r.data.data), enabled: !!id });

  const rawLecs: any[] = lectures.data || [];
  const rawFees: any[] = tx.data || [];

  // Summary granularity — month-wise (default) or date-wise.
  const [gran, setGran] = useState<'month' | 'date'>('month');
  // Date range — filters the summary table and the lecture log (KPIs stay all-time).
  const [from, setFrom] = useState('2025-09-01');
  const [to, setTo] = useState('2026-08-31');

  const lecs = useMemo(() => rawLecs.filter((l) => l.session_date >= from && l.session_date <= to), [rawLecs, from, to]);
  const fees = useMemo(() => rawFees.filter((f) => f.payment_date >= from && f.payment_date <= to), [rawFees, from, to]);

  // Build summary rows for the chosen granularity: { period, hours, fees }.
  // Rows (not columns) so the table never overflows, even with a full year.
  const periodRows = useMemo(() => {
    const hKey = gran === 'month' ? 'month' : 'session_date';
    const fKey = gran === 'month' ? 'month' : 'payment_date';
    const map: Record<string, { hours: number; fees: number }> = {};
    lecs.forEach((l) => { const k = l[hKey]; if (k) (map[k] ||= { hours: 0, fees: 0 }).hours += Number(l.hours_consumed || 0); });
    fees.forEach((f) => { const k = f[fKey]; if (k) (map[k] ||= { hours: 0, fees: 0 }).fees += Number(f.amount || 0); });
    const keys = Object.keys(map).sort();
    if (gran === 'date') keys.reverse(); // most recent day first
    return keys.map((k) => ({ period: k, ...map[k] }));
  }, [lecs, fees, gran]);

  if (ledger.isLoading) return <Spinner />;
  const l = ledger.data;

  const allFees = rawFees.reduce((a, f) => a + Number(f.amount || 0), 0);          // all-time (KPI)
  const presentCount = rawLecs.filter((x) => x.attendance_status !== 'Absent').length; // all-time (KPI)
  const rangeHours = lecs.reduce((a, l) => a + Number(l.hours_consumed || 0), 0);   // in selected range
  const rangeFees = fees.reduce((a, f) => a + Number(f.amount || 0), 0);            // in selected range

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{isParent ? "My Child's Tracker" : 'My Tracker'}</h1>
        <StatusBadge status={l.status} />
        <span className="muted text-sm">{l.student_name} · Form {l.form_no}</span>
      </div>

      {/* Summary — overall snapshot (all-time, across all months) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Total Hours" value={hrs(l.total_hours_consumed)} sub="all months" accent="indigo" />
        <KpiCard label="Hours Left" value={<HoursValue value={l.hours_left ?? 0} />} sub="overall balance" accent={Number(l.hours_left) <= 0 ? 'red' : 'emerald'} />
        <KpiCard label="Fees Received" value={rs(allFees)} sub="all months total" accent="emerald" />
        <KpiCard label="Attendance" value={`${presentCount}/${rawLecs.length}`} sub="present / total" accent="blue" />
        <KpiCard label="Pending Fees" value={rs(l.pending_fees)} sub="outstanding" accent="red" />
      </div>

      {/* Date range — filters the summary table & lecture log below */}
      <DateRangePicker from={from} to={to} onFrom={setFrom} onTo={setTo}>
        <span className="muted text-sm pb-2">Showing {lecs.length} lectures · {fees.length} payments in range</span>
      </DateRangePicker>

      {/* Total hours used + fees per period. Rows scale vertically (no overflow). */}
      <Section
        title={gran === 'month' ? 'Month-wise Summary' : 'Date-wise Summary'}
        action={
          <div className="flex gap-1 rounded-lg p-0.5" style={{ background: 'var(--color-card-alt)' }}>
            {(['month', 'date'] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGran(g)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-md transition ${gran === g ? 'text-white' : 'muted'}`}
                style={gran === g ? { background: 'var(--color-primary)' } : {}}
              >
                {g === 'month' ? 'Month-wise' : 'Date-wise'}
              </button>
            ))}
          </div>
        }
      >
        {periodRows.length === 0 ? (
          <p className="muted text-sm">No activity recorded yet.</p>
        ) : (
          <div className="max-h-[420px] overflow-y-auto">
            <Table head={[gran === 'month' ? 'Month' : 'Date', { label: 'Total Hours', align: 'right' }, { label: 'Fees Received (AED)', align: 'right' }]}>
              {periodRows.map((r) => (
                <tr key={r.period}>
                  <td className="table-td font-semibold whitespace-nowrap">{gran === 'month' ? fmtMonth(r.period) : r.period}</td>
                  <td className="table-td text-right tabular-nums">{hrs(r.hours)}</td>
                  <td className="table-td text-right tabular-nums text-emerald-600">{num(r.fees)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--color-border)' }}>
                <td className="table-td font-bold">Total (range)</td>
                <td className="table-td text-right tabular-nums font-bold">{hrs(rangeHours)}</td>
                <td className="table-td text-right tabular-nums font-bold text-emerald-600">{num(rangeFees)}</td>
              </tr>
            </Table>
          </div>
        )}
      </Section>

      {/* Full per-lecture log */}
      <Section title="Lecture Log">
        <Table head={['Date', 'Month', 'Form No', 'Student Name', 'Subject', 'Topic', 'Subtopic', 'Time In', 'Time Out', { label: 'No. of Hrs', align: 'right' }, 'Teacher', 'Attendance']}>
          {lecs.length === 0 ? (
            <tr><td className="table-td muted" colSpan={12}>No lectures in this range.</td></tr>
          ) : lecs.map((r: any) => (
            <tr key={r.id}>
              <td className="table-td whitespace-nowrap">{r.session_date}</td>
              <td className="table-td whitespace-nowrap">{fmtMonth(r.month)}</td>
              <td className="table-td font-mono">{r.form_no}</td>
              <td className="table-td">{r.student_name}</td>
              <td className="table-td">{r.subject_name || '—'}</td>
              <td className="table-td">{r.topic || '—'}</td>
              <td className="table-td">{r.subtopic || '—'}</td>
              <td className="table-td">{r.time_in || '—'}</td>
              <td className="table-td">{r.time_out || '—'}</td>
              <td className="table-td text-right tabular-nums font-semibold">{hrs(r.hours_consumed)}</td>
              <td className="table-td">{r.teacher_name || '—'}</td>
              <td className="table-td">
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  r.attendance_status === 'Absent' ? 'bg-red-500/15 text-red-600'
                  : r.attendance_status === 'Late' ? 'bg-amber-500/15 text-amber-600'
                  : 'bg-emerald-500/15 text-emerald-600'}`}>
                  {r.attendance_status || 'Present'}
                </span>
              </td>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  );
}
