import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, hrs, num, studentOption } from '../../api/client';
import { Section, Table, Spinner, KpiCard, HoursValue, StatusBadge, Pagination, type Sort } from '../../components/ui';
import { Select } from '../../components/Select';
import { FilterMenu, FilterField } from '../../components/FilterMenu';
import { CalendarRangePicker } from '../../components/CalendarPicker';
import { AdjustHoursModal } from '../../components/AdjustHoursModal';
import { downloadHoursStatement } from '../../lib/hoursStatementExcel';

// Student Hours Statement — pick a student to see their hours summary and a
// chronological ledger: hours credited (with discount) when a package is added,
// and hours consumed per lecture, with a running balance.
export default function HoursMonthly() {
  const [studentId, setStudentId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState('');

  const [summarySearch, setSummarySearch] = useState('');
  const [summaryPage, setSummaryPage] = useState(1);
  const [summarySize, setSummarySize] = useState(20);
  const [feeStatus, setFeeStatus] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<Sort>({ key: 'form_no', dir: 'asc' });
  const allLedger = useQuery({
    queryKey: ['ledger-all', summarySearch, summaryPage, summarySize, status, feeStatus, sort.key, sort.dir],
    queryFn: () => api.get('/fees/ledger', {
      params: {
        search: summarySearch, page: summaryPage, limit: summarySize,
        status, feeStatus, sort: sort.key, dir: sort.dir,
      },
    }).then((r) => r.data),
  });
  // Sorting is done by the server, because the table is paginated — sorting the
  // 20 rows on screen would only ever reorder that page, not find the student
  // furthest into the red. A fresh column starts ascending, which on Remaining
  // means the biggest negative balance first: who owes the most, at the top.
  const toggleSort = (key: string) => {
    setSummaryPage(1);
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
  };
  // Two separate axes, because "still on the roll AND owing hours" is the list
  // that actually gets chased, and neither dropdown alone can ask for it.
  const statusOptions = [
    { value: '', label: 'All statuses' },
    { value: 'Active', label: 'Active' },
    { value: 'Inactive', label: 'Inactive' },
  ];
  const feeStatusOptions = [
    { value: '', label: 'All fee statuses' },
    { value: 'Payment Required', label: 'Payment Required' },
    { value: 'Active', label: 'Active' },
    { value: 'Trial', label: 'Trial' },
  ];
  const activeFilters = [status, feeStatus].filter(Boolean).length;
  const clearFilters = () => { setStatus(''); setFeeStatus(''); setSummaryPage(1); };
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
        // The amount actually paid, straight off the linked transaction. Falling
        // back to rate × hours is only for a package with no payment behind it —
        // a stored rate can be missing (older backfills wrote 0), and then the
        // fee showed as a dash next to a payment that plainly exists.
        fees: p.paid_amount != null ? Number(p.paid_amount) : Number(p.rate_per_hour || 0) * credited,
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

  // The Excel export follows whatever date filter is on screen, and says so in
  // its header, so a filtered statement can never be mistaken for a full one.
  const exportExcel = async () => {
    if (!l) return;
    setExporting(true);
    setExportErr('');
    try {
      const s = (students.data || []).find((x: any) => String(x.id) === String(studentId)) || {};
      await downloadHoursStatement({
        student: {
          form_no: l.form_no,
          full_name: l.student_name,
          year_grade: s.year_grade,
          school_name: s.school_name,
        },
        summary: {
          total_hours_credited: l.total_hours_credited,
          total_hours_consumed: l.total_hours_consumed,
          hours_left: l.hours_left,
          fee_status: l.fee_status,
        },
        lectures: lectures.data || [],
        packages: packages.data || [],
        from: fromDate || undefined,
        to: toDate || undefined,
      });
    } catch (e: any) {
      setExportErr(e?.message || 'Could not build the Excel file.');
    } finally {
      setExporting(false);
    }
  };
  // Most recent recharge (package added) date for this student.
  const lastRecharge = (packages.data || [])
    .map((p: any) => String(p.start_date || p.created_at || '').slice(0, 10))
    .filter(Boolean)
    .sort()
    .pop() || '';

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
        <Section
          // The count stands in for "All students" in the heading, so the number
          // on screen is the first thing read, and it follows the filters:
          // "61 students — hours summary" once they are narrowed.
          title={
            allLedger.data
              ? `${allLedger.data.total} ${allLedger.data.total === 1 ? 'student' : 'students'} — hours summary`
              : 'All students — hours summary'
          }
          action={
          // Same shape as the Finance Tracker's filter row: one wrapping group,
          // search first, then the narrowing controls. The widths are fixed from
          // `sm` up — `w-full` alone makes each control claim a whole flex line,
          // which stacked them on top of each other.
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <input
              className="input w-full sm:w-[220px]"
              placeholder="Search student…"
              value={summarySearch}
              onChange={(e) => { setSummarySearch(e.target.value); setSummaryPage(1); }}
            />
            <FilterMenu count={activeFilters} onClear={clearFilters}>
              <FilterField label="Status">
                <Select
                  searchable={false}
                  value={status}
                  options={statusOptions}
                  onChange={(v) => { setStatus(v); setSummaryPage(1); }}
                />
              </FilterField>
              <FilterField label="Fee Status">
                <Select
                  searchable={false}
                  value={feeStatus}
                  options={feeStatusOptions}
                  onChange={(v) => { setFeeStatus(v); setSummaryPage(1); }}
                />
              </FilterField>
            </FilterMenu>
          </div>
        }>
          {allLedger.isLoading ? <Spinner /> : (
            <>
            <Table
              sort={sort}
              onSort={toggleSort}
              head={[
                { label: 'Form', sortKey: 'form_no' },
                { label: 'Student', sortKey: 'student_name' },
                'Status',
                { label: 'Total', align: 'right', sortKey: 'total_hours_credited' },
                { label: 'Used', align: 'right', sortKey: 'total_hours_consumed' },
                { label: 'Remaining', align: 'right', sortKey: 'hours_left' },
                'Fee Status',
                { label: 'Last Lecture', sortKey: 'last_attended_lecture' },
              ]}
            >
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
              {(allLedger.data?.data || []).length === 0 && (
                <tr><td className="table-td muted" colSpan={8}>No students match this filter.</td></tr>
              )}
            </Table>
            {(() => { const total = allLedger.data?.total || 0; const pages = Math.ceil(total / summarySize) || 1; return (
              <Pagination
                page={summaryPage} pages={pages} total={total} noun="students"
                pageSize={summarySize} onPage={setSummaryPage} onPageSize={setSummarySize}
              />
            ); })()}
            </>
          )}
        </Section>
      ) : ledger.isLoading || lectures.isLoading || packages.isLoading ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiCard label="Recharge Hours" value={hrs(l?.total_hours_credited)} accent="blue" />
            <KpiCard label="Used Hours" value={hrs(l?.total_hours_consumed)} accent="indigo" />
            <KpiCard label="Remaining Hours" value={<HoursValue value={l?.hours_left ?? 0} />} accent={Number(l?.hours_left) <= 0 ? 'red' : 'emerald'} />
            <KpiCard label="Fee Status" value={<StatusBadge status={l?.fee_status || '—'} />} accent="purple" />
            <KpiCard label="Last Recharge" value={<span className="text-base">{lastRecharge || '—'}</span>} accent="blue" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-ghost !py-1.5 !px-3 text-sm" onClick={() => setAdjustOpen(true)}>± Adjust Hours</button>
            <button
              className="btn-ghost !py-1.5 !px-3 text-sm"
              onClick={exportExcel}
              disabled={exporting || !l}
              title="Download this statement as a formatted Excel file"
            >
              {exporting ? 'Preparing…' : '⤓ Export Excel'}
            </button>
            {exportErr && <span className="text-sm text-red-500">{exportErr}</span>}
          </div>

          <Section
            title="Hours statement — credited & consumed"
            action={
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm muted whitespace-nowrap tabular-nums">
                  {visibleRows.length} {visibleRows.length === 1 ? 'entry' : 'entries'}
                  {visibleRows.length !== rows.length && <span className="opacity-70"> of {rows.length}</span>}
                </span>
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
