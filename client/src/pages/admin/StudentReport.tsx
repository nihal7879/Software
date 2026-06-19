import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, rs, hrs } from '../../api/client';
import { KpiCard, Section, StatusBadge, Table, HoursValue, Spinner } from '../../components/ui';

// MANAGEMENT per-student report with a DATE RANGE.
// Per-day lecture log (date, month, teacher, time in/out, hours, topic/subtopic/remark)
// + fee receipts in the same range.
export default function StudentReport() {
  const { id } = useParams();
  const [from, setFrom] = useState('2025-09-01');
  const [to, setTo] = useState('2026-08-31');

  const { data, isLoading } = useQuery({
    queryKey: ['student-report', id, from, to],
    queryFn: () => api.get(`/management/student/${id}/report`, { params: { from, to } }).then((r) => r.data),
  });

  if (isLoading) return <Spinner />;
  const s = data.student;
  const sum = data.summary;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/admin/students" className="btn-ghost !py-1.5 !px-3 text-sm">← Students</Link>
        <h1 className="text-2xl font-bold">{s.full_name}</h1>
        <StatusBadge status={s.status} />
        <span className="muted text-sm">Form {s.form_no} · {s.year_grade} · {s.exam_board}</span>
      </div>

      {/* Date range */}
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-medium muted">From</label>
          <input type="date" className="input mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium muted">To</label>
          <input type="date" className="input mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="muted text-sm pb-2">
          Parent (pays): <b>{s.parent_name || '—'}</b> ({s.relationship}) · {s.parent_mobile || '—'}
        </div>
      </div>

      {/* Range KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Lectures in range" value={sum.lecture_count} accent="blue" />
        <KpiCard label="Hours in range" value={hrs(sum.hours_in_range)} accent="indigo" />
        <KpiCard label="Fees received (range)" value={rs(sum.fees_in_range)} accent="emerald" />
        <KpiCard label="Hours left (overall)" value={<HoursValue value={s.hours_left ?? 0} />} accent={Number(s.hours_left) < 0 ? 'red' : 'emerald'} />
      </div>

      {/* Per-day lecture log */}
      <Section title="Lecture Log — per day">
        <Table head={['Date', 'Month', 'Teacher', 'Subject', 'Time In', 'Time Out', 'No. of Hours', 'Topic', 'Subtopic', 'Remark', 'Venue']}>
          {data.lectures.length === 0 ? (
            <tr><td className="table-td muted" colSpan={11}>No lectures in this range.</td></tr>
          ) : data.lectures.map((l: any, i: number) => (
            <tr key={i}>
              <td className="table-td whitespace-nowrap">{l.session_date}</td>
              <td className="table-td">{l.month}</td>
              <td className="table-td">{l.teacher_name || '—'}</td>
              <td className="table-td">{l.subject_name || '—'}</td>
              <td className="table-td">{l.time_in || '—'}</td>
              <td className="table-td">{l.time_out || '—'}</td>
              <td className="table-td font-semibold">{hrs(l.no_of_hours)}</td>
              <td className="table-td">{l.topic || '—'}</td>
              <td className="table-td">{l.subtopic || '—'}</td>
              <td className="table-td">{l.remark || '—'}</td>
              <td className="table-td">{l.venue || '—'}</td>
            </tr>
          ))}
        </Table>
      </Section>

      {/* Fee receipts */}
      <Section title="Fees Received — in range">
        <Table head={['Date', 'Month', 'Amount', 'Paid By (Parent)', 'Source', 'Reference', 'Pkg Hrs', 'Notes']}>
          {data.fees.length === 0 ? (
            <tr><td className="table-td muted" colSpan={8}>No fee receipts in this range.</td></tr>
          ) : data.fees.map((f: any, i: number) => (
            <tr key={i}>
              <td className="table-td whitespace-nowrap">{f.payment_date}</td>
              <td className="table-td">{f.month}</td>
              <td className="table-td font-semibold text-emerald-600">{rs(f.amount)}</td>
              <td className="table-td">{f.parent_name || '—'}</td>
              <td className="table-td">{f.payment_source || '—'}</td>
              <td className="table-td font-mono text-xs">{f.transaction_reference || '—'}</td>
              <td className="table-td">{f.course_package_hours ?? '—'}</td>
              <td className="table-td max-w-[220px] truncate" title={f.notes}>{f.notes || '—'}</td>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  );
}
