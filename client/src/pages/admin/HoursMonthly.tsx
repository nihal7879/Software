import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, hrs, num, studentOption } from '../../api/client';
import { Section, Table, Spinner, KpiCard, HoursValue, StatusBadge } from '../../components/ui';
import { Select } from '../../components/Select';
import { CalendarRangePicker } from '../../components/CalendarPicker';
import { AdjustHoursModal } from '../../components/AdjustHoursModal';

// Student Hours Statement — pick a student to see their hours summary and a
// chronological ledger: hours credited (with discount) when a package is added,
// and hours consumed per lecture, with a running balance.
export default function HoursMonthly() {
  const [studentId, setStudentId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [adjustOpen, setAdjustOpen] = useState(false);

  const [summarySearch, setSummarySearch] = useState('');
  const [summaryPage, setSummaryPage] = useState(1);
  const allLedger = useQuery({
    queryKey: ['ledger-all', summarySearch, summaryPage],
    queryFn: () => api.get('/fees/ledger', { params: { search: summarySearch, page: summaryPage, limit: 20 } }).then((r) => r.data),
  });
  const [studentSearch, setStudentSearch] = useState('');
  const students = useQuery({ queryKey: ['students-pick', studentSearch], queryFn: () => api.get('/students', { params: { search: studentSearch, limit: 1000 } }).then((r) => r.data.data) });
  const ledger = useQuery({ queryKey: ['ledger', studentId], queryFn: () => api.get(`/fees/ledger/${studentId}`).then((r) => r.data), enabled: !!studentId });
  const lectures = useQuery({ queryKey: ['lectures', studentId], queryFn: () => api.get('/lectures', { params: { studentId } }).then((r) => r.data.data), enabled: !!studentId });
  const packages = useQuery({ queryKey: ['pkg', studentId], queryFn: () => api.get(`/fees/packages/${studentId}`).then((r) => r.data.data), enabled: !!studentId });
  const adjustments = useQuery({ queryKey: ['adjustments', studentId], queryFn: () => api.get(`/fees/adjustments/${studentId}`).then((r) => r.data.data), enabled: !!studentId });

  const options = (students.data || []).map((s: any) => studentOption(s));

  // Build a single chronological ledger of credit (+) and lecture (−) events,
  // carrying a running balance.
  const rows = useMemo(() => {
    type Ev = {
      kind: 'credit' | 'lecture' | 'adjustment';
      date: string;
      teacher?: string; subject?: string; time_in?: string; time_out?: string; reason?: string;
      fees?: number; credited?: number; discount?: number; adjusted?: number; totalCredited?: number; used?: number;
    };
    const events: Ev[] = [];

    for (const a of adjustments.data || []) {
      const delta = Number(a.delta || 0);
      events.push({
        kind: 'adjustment',
        date: String(a.created_at || '').slice(0, 10) || '—',
        reason: a.reason, adjusted: delta, totalCredited: delta,
      });
    }

    for (const p of packages.data || []) {
      const credited = Number(p.package_hours || 0);
      const discount = Number(p.discount_hours || 0);
      const adjusted = Number(p.adjusted_hours || 0);
      // Recharge date — prefer start_date, fall back to when it was created (for tracing).
      const date = String(p.start_date || p.created_at || '').slice(0, 10) || '—';
      events.push({
        kind: 'credit', date,
        fees: Number(p.rate_per_hour || 0) * credited,
        credited, discount, adjusted, totalCredited: credited + discount + adjusted,
      });
    }
    for (const l of lectures.data || []) {
      events.push({
        kind: 'lecture',
        date: String(l.session_date).slice(0, 10),
        teacher: l.teacher_name, subject: l.subject_name,
        time_in: l.time_in, time_out: l.time_out,
        used: Number(l.hours_consumed || 0),
      });
    }

    // Oldest first; on the same day, credits come before consumption.
    events.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'credit' ? -1 : 1));

    let remaining = 0;
    return events.map((e) => {
      remaining += (e.totalCredited || 0) - (e.used || 0);
      return { ...e, remaining, month: e.date.length >= 7 ? e.date.slice(0, 7) : '—' };
    });
  }, [packages.data, lectures.data, adjustments.data]);

  // Filter only the display by date range; the running balance is computed over all rows.
  const visibleRows = rows.filter((r: any) => {
    if (!r.date || r.date === '—') return !fromDate && !toDate ? true : false;
    if (fromDate && r.date < fromDate) return false;
    if (toDate && r.date > toDate) return false;
    return true;
  });

  const totals = visibleRows.reduce(
    (a: any, r: any) => ({
      fees: a.fees + (r.fees || 0),
      credited: a.credited + (r.credited || 0),
      discount: a.discount + (r.discount || 0),
      adjusted: a.adjusted + (r.adjusted || 0),
      totalCredited: a.totalCredited + (r.totalCredited || 0),
      used: a.used + (r.used || 0),
    }),
    { fees: 0, credited: 0, discount: 0, adjusted: 0, totalCredited: 0, used: 0 }
  );

  const l = ledger.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          {studentId && (
            <button className="btn-ghost !py-1.5 !px-3 text-sm whitespace-nowrap" onClick={() => setStudentId('')}>← All students</button>
          )}
          <div>
            <h1 className="text-2xl font-bold">Student Hours Statement</h1>
            <p className="muted text-sm">{studentId ? 'Hours credited, hours used per lecture, and the running balance.' : 'All students at a glance — click one to see their full statement.'}</p>
          </div>
        </div>
        <div className="w-72">
          <Select value={studentId} onChange={setStudentId} options={options} onSearch={setStudentSearch} placeholder="Search & select a student…" />
        </div>
      </div>

      {!studentId ? (
        <Section title="All students — hours summary" action={
          <input className="input w-full sm:max-w-[220px]" placeholder="Search student…" value={summarySearch} onChange={(e) => { setSummarySearch(e.target.value); setSummaryPage(1); }} />
        }>
          {allLedger.isLoading ? <Spinner /> : (
            <>
            <Table head={['Form', 'Student', 'Status', { label: 'Total', align: 'right' }, { label: 'Used', align: 'right' }, { label: 'Remaining', align: 'right' }, 'Fee Status', 'Last Lecture']}>
              {(allLedger.data?.data || [])
                .map((r: any) => (
                  <tr key={r.student_id} className="cursor-pointer hover:bg-[var(--color-card-alt)]" onClick={() => setStudentId(String(r.student_id))}>
                    <td className="table-td font-mono">{r.form_no}</td>
                    <td className="table-td font-medium">{r.student_name}</td>
                    <td className="table-td"><StatusBadge status={r.status} /></td>
                    <td className="table-td text-right tabular-nums">{hrs(r.total_hours_credited)}</td>
                    <td className="table-td text-right tabular-nums">{hrs(r.total_hours_consumed)}</td>
                    <td className="table-td text-right tabular-nums"><HoursValue value={r.hours_left} /></td>
                    <td className="table-td"><StatusBadge status={r.fee_status} /></td>
                    <td className="table-td whitespace-nowrap">{r.last_attended_lecture || '—'}</td>
                  </tr>
                ))}
            </Table>
            {(() => { const total = allLedger.data?.total || 0; const pages = Math.ceil(total / 20) || 1; return (
              <div className="flex items-center justify-between mt-3 text-sm">
                <span className="muted">Page {summaryPage} / {pages} · {total} students</span>
                <div className="flex gap-2">
                  <button className="btn-ghost" disabled={summaryPage <= 1} onClick={() => setSummaryPage((p) => p - 1)}>Prev</button>
                  <button className="btn-ghost" disabled={summaryPage >= pages} onClick={() => setSummaryPage((p) => p + 1)}>Next</button>
                </div>
              </div>
            ); })()}
            </>
          )}
        </Section>
      ) : ledger.isLoading || lectures.isLoading || packages.isLoading ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiCard label="Purchased Hours" value={hrs(l?.total_hours_credited)} accent="blue" />
            <KpiCard label="Used Hours" value={hrs(l?.total_hours_consumed)} accent="indigo" />
            <KpiCard label="Remaining Hours" value={<HoursValue value={l?.hours_left ?? 0} />} accent={Number(l?.hours_left) <= 0 ? 'red' : 'emerald'} />
            <KpiCard label="Fee Status" value={<StatusBadge status={l?.fee_status || '—'} />} accent="purple" />
            <KpiCard label="Last Lecture" value={<span className="text-base">{l?.last_attended_lecture || '—'}</span>} accent="blue" />
          </div>

          <div>
            <button className="btn-ghost !py-1.5 !px-3 text-sm" onClick={() => setAdjustOpen(true)}>± Adjust Hours</button>
          </div>

          <Section
            title="Hours statement — credited & consumed"
            action={
              <div className="flex flex-wrap items-center gap-2">
                <CalendarRangePicker
                  from={fromDate}
                  to={toDate}
                  onChange={(f, t) => { setFromDate(f); setToDate(t); }}
                  placeholder="Filter by date / month"
                  align="right"
                />
                {(fromDate || toDate) && (
                  <button className="btn-ghost !py-1.5 !px-3 text-sm whitespace-nowrap" onClick={() => { setFromDate(''); setToDate(''); }}>
                    Show all
                  </button>
                )}
              </div>
            }
          >
            {rows.length === 0 ? (
              <p className="muted text-sm">No hours credited or lectures recorded for this student yet.</p>
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
                        : <span className="whitespace-nowrap">{r.teacher || '—'}{r.subject ? ` · ${r.subject}` : ''}</span>}
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
        </>
      )}

      {adjustOpen && studentId && (
        <AdjustHoursModal
          studentId={Number(studentId)}
          studentName={options.find((o: any) => String(o.value) === studentId)?.label || 'Student'}
          onClose={() => setAdjustOpen(false)}
        />
      )}
    </div>
  );
}
