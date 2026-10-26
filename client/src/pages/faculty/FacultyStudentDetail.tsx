import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, hrs, fmtDate, todayIso } from '../../api/client';
import { NotBillableChip, NOT_BILLABLE_ROW, notBillable } from '../../components/BillableToggle';
import { Section, StatusBadge, Table, Spinner, DateTile, fmtTime } from '../../components/ui';
import { DateRangePicker } from '../../components/DateRangePicker';

// TEACHER → one of my students. Hours + lecture history only — NO fees.
export default function FacultyStudentDetail() {
  const { id } = useParams();
  const [from, setFrom] = useState('2025-09-01');
  // Up to today by default — a fixed end date goes stale and hides anything later.
  const [to, setTo] = useState(todayIso);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['fac-student', id, from, to],
    queryFn: () => api.get(`/teachers/me/student/${id}`, { params: { from, to } }).then((r) => r.data),
  });

  if (isLoading) return <Spinner />;
  if (isError) return <div className="muted p-6">This student isn’t assigned to you.</div>;

  const s = data.student;
  const sum = data.summary;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 lg:gap-3">
        {/* The phone app bar has its own back arrow. */}
        <Link to="/faculty/students" className="btn-ghost !py-1.5 !px-3 text-sm hidden lg:inline-flex">← My Students</Link>
        <h1 className="text-2xl font-bold">{s.full_name}</h1>
        <StatusBadge status={s.status} />
        <span className="muted text-sm w-full lg:w-auto">Form {s.form_no} · {s.year_grade || '—'} · {s.exam_board || '—'} · {s.school_name || '—'}</span>
      </div>

      <DateRangePicker from={from} to={to} onFrom={setFrom} onTo={setTo} />

      <Section title="Lecture Log — with you">
        {/* Phones and tablets: total first, then one card per class. */}
        <div className="lg:hidden grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="col-span-full flex items-baseline justify-between rounded-2xl px-4 py-3" style={{ background: 'var(--color-accent-soft)' }}>
            <span className="text-sm font-medium">Total in this range</span>
            <span className="font-display text-xl font-bold tnum" style={{ color: 'var(--color-primary)' }}>{hrs(sum.hours_in_range)}</span>
          </div>
          {data.lectures.length === 0 && <p className="muted text-sm py-4 text-center col-span-full">No lectures in this range.</p>}
          {data.lectures.map((l: any, i: number) => (
            <div key={i} className="rounded-2xl p-3.5 flex gap-3" style={{ background: 'var(--color-card-alt)' }}>
              <DateTile iso={l.session_date} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold truncate">{l.subject_name || 'Lecture'}</div>
                  <span className="shrink-0 flex items-center gap-1">
                    <NotBillableChip is_billable={l.is_billable} />
                    <span className="text-sm font-bold tnum" style={{ color: 'var(--color-primary)' }}>{hrs(l.no_of_hours)}</span>
                  </span>
                </div>
                {(l.topic || l.subtopic) && <div className="text-sm">{[l.topic, l.subtopic].filter(Boolean).join(' — ')}</div>}
                <div className="text-xs muted mt-0.5">
                  {[l.time_in && l.time_out ? `${fmtTime(l.time_in)} – ${fmtTime(l.time_out)}` : null, l.venue].filter(Boolean).join(' · ')}
                </div>
                {l.remark && <div className="text-xs mt-1.5 italic">{l.remark}</div>}
              </div>
            </div>
          ))}
        </div>
        <div className="hidden lg:block">
        <Table head={['Date', 'Subject', 'Time In', 'Time Out', { label: 'No. of Hours', align: 'right' }, 'Topic', 'Subtopic', 'Remark', 'Venue']}>
          {data.lectures.length === 0 ? (
            <tr><td className="table-td muted" colSpan={9}>No lectures in this range.</td></tr>
          ) : (
            <>
              {data.lectures.map((l: any, i: number) => (
                <tr key={i} className={notBillable(l.is_billable) ? NOT_BILLABLE_ROW : undefined}>
                  <td className="table-td whitespace-nowrap">{fmtDate(l.session_date)}</td>
                  <td className="table-td">{l.subject_name || '—'}</td>
                  <td className="table-td">{l.time_in || '—'}</td>
                  <td className="table-td">{l.time_out || '—'}</td>
                  <td className="table-td text-right tabular-nums font-semibold whitespace-nowrap">
                    <NotBillableChip is_billable={l.is_billable} /> {hrs(l.no_of_hours)}
                  </td>
                  <td className="table-td">{l.topic || '—'}</td>
                  <td className="table-td">{l.subtopic || '—'}</td>
                  <td className="table-td">{l.remark || '—'}</td>
                  <td className="table-td">{l.venue || '—'}</td>
                </tr>
              ))}
              <tr className="border-t-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}>
                <td className="table-td font-bold" colSpan={4}>Total</td>
                <td className="table-td text-right tabular-nums font-bold">{hrs(sum.hours_in_range)}</td>
                <td className="table-td" colSpan={4}></td>
              </tr>
            </>
          )}
        </Table>
        </div>
      </Section>
    </div>
  );
}
