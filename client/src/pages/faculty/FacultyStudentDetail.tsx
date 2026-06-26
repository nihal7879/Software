import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, hrs } from '../../api/client';
import { Section, StatusBadge, Table, Spinner } from '../../components/ui';
import { DateRangePicker } from '../../components/DateRangePicker';

// TEACHER → one of my students. Hours + lecture history only — NO fees.
export default function FacultyStudentDetail() {
  const { id } = useParams();
  const [from, setFrom] = useState('2025-09-01');
  const [to, setTo] = useState('2026-08-31');

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
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/faculty/students" className="btn-ghost !py-1.5 !px-3 text-sm">← My Students</Link>
        <h1 className="text-2xl font-bold">{s.full_name}</h1>
        <StatusBadge status={s.status} />
        <span className="muted text-sm">Form {s.form_no} · {s.year_grade || '—'} · {s.exam_board || '—'}</span>
      </div>

      <DateRangePicker from={from} to={to} onFrom={setFrom} onTo={setTo}>
        <div className="muted text-sm pb-2">Parent mobile: <b>{s.parent_mobile || '—'}</b></div>
      </DateRangePicker>

      <Section title="Lecture Log — with you">
        <Table head={['Date', 'Subject', 'Time In', 'Time Out', { label: 'No. of Hours', align: 'right' }, 'Topic', 'Subtopic', 'Remark', 'Venue']}>
          {data.lectures.length === 0 ? (
            <tr><td className="table-td muted" colSpan={9}>No lectures in this range.</td></tr>
          ) : (
            <>
              {data.lectures.map((l: any, i: number) => (
                <tr key={i}>
                  <td className="table-td whitespace-nowrap">{l.session_date}</td>
                  <td className="table-td">{l.subject_name || '—'}</td>
                  <td className="table-td">{l.time_in || '—'}</td>
                  <td className="table-td">{l.time_out || '—'}</td>
                  <td className="table-td text-right tabular-nums font-semibold">{hrs(l.no_of_hours)}</td>
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
      </Section>
    </div>
  );
}
