import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api, rs, hrs, num } from '../../api/client';
import { KpiCard, Section, StatusBadge, Table, HoursValue, Spinner } from '../../components/ui';
import { DateRangePicker } from '../../components/DateRangePicker';
import { StudentRegistrationForm } from '../../components/StudentRegistrationForm';
import { Select } from '../../components/Select';
import { AdjustHoursModal } from '../../components/AdjustHoursModal';

// MANAGEMENT per-student report with a DATE RANGE.
// Per-day lecture log (date, month, teacher, time in/out, hours, topic/subtopic/remark)
// + fee receipts in the same range. Admin can also EDIT the profile and ASSIGN teachers.
export default function StudentReport() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [from, setFrom] = useState('2025-09-01');
  const [to, setTo] = useState('2026-08-31');
  const [editProfile, setEditProfile] = useState(false);
  const [adjustHours, setAdjustHours] = useState(false);
  const [lecTeacher, setLecTeacher] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['student-report', id, from, to],
    queryFn: () => api.get(`/management/student/${id}/report`, { params: { from, to } }).then((r) => r.data),
  });

  // Teacher assignment data
  const assigned = useQuery({
    queryKey: ['teachers-of', id],
    queryFn: () => api.get(`/teachers/of-student/${id}`).then((r) => r.data.data),
    enabled: !!id,
  });
  const teachers = useQuery({ queryKey: ['teachers'], queryFn: () => api.get('/teachers').then((r) => r.data.data) });
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/teachers/subjects').then((r) => r.data.data) });

  const { register, handleSubmit, reset, watch, setValue } = useForm();
  const assign = useMutation({
    mutationFn: (b: any) => api.post('/teachers/assign', {
      student_id: Number(id),
      teacher_id: Number(b.teacher_id),
      subject_id: Number(b.subject_id),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['teachers-of', id] }); qc.invalidateQueries({ queryKey: ['student-report', id] }); reset(); },
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
        <button className="btn-ghost !py-1.5 !px-3 text-sm ml-auto" onClick={() => setEditProfile(true)}>
          {s.profile_completed ? 'Edit Profile' : 'Complete Profile'}
        </button>
      </div>

      {/* Date range */}
      <DateRangePicker from={from} to={to} onFrom={setFrom} onTo={setTo}>
        <div className="muted text-sm pb-2">
          Parent (pays): <b>{s.parent_name || '—'}</b> ({s.relationship}) · {s.parent_mobile || '—'}
        </div>
      </DateRangePicker>

      {/* Range KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Lectures in range" value={sum.lecture_count} accent="blue" />
        <KpiCard label="Hours in range" value={hrs(sum.hours_in_range)} accent="indigo" />
        <KpiCard label="Fees received (range)" value={rs(sum.fees_in_range)} accent="emerald" />
        <KpiCard label="Hours left (overall)" value={<HoursValue value={s.hours_left ?? 0} />} accent={Number(s.hours_left) <= 0 ? 'red' : 'emerald'} />
      </div>

      <div>
        <button className="btn-ghost !py-1.5 !px-3 text-sm" onClick={() => setAdjustHours(true)}>± Adjust Hours</button>
      </div>

      {/* Assigned teachers + assign form */}
      <Section title="Assigned Teachers">
        <form onSubmit={handleSubmit((b) => assign.mutate(b))} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end mb-4">
          <div>
            <label className="text-xs font-medium muted block mb-1">Teacher</label>
            <input type="hidden" {...register('teacher_id', { required: true })} />
            <Select
              value={watch('teacher_id') || ''}
              onChange={(v) => setValue('teacher_id', v, { shouldValidate: true })}
              options={(teachers.data || []).map((t: any) => ({ value: t.id, label: t.name }))}
              placeholder="Select teacher…"
            />
          </div>
          <div>
            <label className="text-xs font-medium muted block mb-1">Subject</label>
            <input type="hidden" {...register('subject_id', { required: true })} />
            <Select
              value={watch('subject_id') || ''}
              onChange={(v) => setValue('subject_id', v, { shouldValidate: true })}
              options={(subjects.data || []).map((s: any) => ({ value: s.id, label: s.name }))}
              placeholder="Select subject…"
            />
          </div>
          <button className="btn-primary" disabled={assign.isPending}>{assign.isPending ? 'Assigning…' : 'Assign Teacher'}</button>
        </form>
        {assign.isError && <div className="text-sm text-red-500 mb-3">Could not assign — please try again.</div>}
        {assigned.isLoading ? <Spinner /> : (
          <Table head={['Teacher', 'Subject']}>
            {(assigned.data || []).length === 0 ? (
              <tr><td className="table-td muted" colSpan={2}>No teachers assigned yet.</td></tr>
            ) : (assigned.data || []).map((t: any) => (
              <tr key={t.id}>
                <td className="table-td font-medium">{t.teacher_name}</td>
                <td className="table-td">{t.subject_name}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {/* Per-day lecture log */}
      <Section
        title="Lecture Log — per day"
        action={
          <div className="w-56">
            <Select
              value={lecTeacher}
              onChange={setLecTeacher}
              options={[{ value: '', label: 'All teachers' }, ...Array.from(new Set((data.lectures || []).map((l: any) => l.teacher_name).filter(Boolean))).map((n: any) => ({ value: n, label: n }))]}
              placeholder="All teachers"
            />
          </div>
        }
      >
        <Table head={['Date', 'Month', 'Teacher', 'Subject', 'Time In', 'Time Out', { label: 'No. of Hours', align: 'right' }, 'Topic', 'Subtopic', 'Remark', 'Venue']}>
          {(() => {
            const visible = (data.lectures || []).filter((l: any) => !lecTeacher || l.teacher_name === lecTeacher);
            return visible.length === 0 ? (
            <tr><td className="table-td muted" colSpan={11}>No lectures{lecTeacher ? ' for this teacher' : ' in this range'}.</td></tr>
          ) : visible.map((l: any, i: number) => (
            <tr key={i}>
              <td className="table-td whitespace-nowrap">{l.session_date}</td>
              <td className="table-td">{l.month}</td>
              <td className="table-td">{l.teacher_name || '—'}</td>
              <td className="table-td">{l.subject_name || '—'}</td>
              <td className="table-td">{l.time_in || '—'}</td>
              <td className="table-td">{l.time_out || '—'}</td>
              <td className="table-td text-right font-semibold">{hrs(l.no_of_hours)}</td>
              <td className="table-td">{l.topic || '—'}</td>
              <td className="table-td">{l.subtopic || '—'}</td>
              <td className="table-td">{l.remark || '—'}</td>
              <td className="table-td">{l.venue || '—'}</td>
            </tr>
          ));
          })()}
        </Table>
      </Section>

      {/* Fee receipts */}
      <Section title="Fees Received — in range">
        <Table head={['Date', 'Month', { label: 'Amount (AED)', align: 'right' }, 'Paid By (Parent)', 'Source', 'Reference', { label: 'Pkg Hrs', align: 'right' }, 'Notes']}>
          {data.fees.length === 0 ? (
            <tr><td className="table-td muted" colSpan={8}>No fee receipts in this range.</td></tr>
          ) : data.fees.map((f: any, i: number) => (
            <tr key={i}>
              <td className="table-td whitespace-nowrap">{f.payment_date}</td>
              <td className="table-td">{f.month}</td>
              <td className="table-td text-right font-semibold text-emerald-600">{num(f.amount)}</td>
              <td className="table-td">{f.parent_name || '—'}</td>
              <td className="table-td">{f.payment_source || '—'}</td>
              <td className="table-td font-mono text-xs">{f.transaction_reference || '—'}</td>
              <td className="table-td text-right">{f.course_package_hours ?? '—'}</td>
              <td className="table-td max-w-[220px] truncate" title={f.notes}>{f.notes || '—'}</td>
            </tr>
          ))}
        </Table>
      </Section>

      {adjustHours && (
        <AdjustHoursModal
          studentId={Number(id)}
          studentName={s.full_name}
          onClose={() => setAdjustHours(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: ['student-report', id] })}
        />
      )}

      {/* Edit / Complete Profile modal */}
      {editProfile && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center overflow-y-auto p-4" onClick={() => setEditProfile(false)}>
          <div className="card w-full max-w-2xl p-6 my-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">{s.profile_completed ? 'Edit Profile' : 'Complete Profile'} — {s.full_name}</h2>
              <button className="btn-ghost !py-1 !px-2.5 text-sm" onClick={() => setEditProfile(false)}>Close</button>
            </div>
            <StudentRegistrationForm
              studentId={Number(id)}
              initial={s}
              submitLabel="Save Profile"
              onSaved={() => { qc.invalidateQueries({ queryKey: ['student-report', id] }); setEditProfile(false); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
