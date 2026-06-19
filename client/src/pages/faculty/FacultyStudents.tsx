import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api } from '../../api/client';
import { Section, StatusBadge, Table, HoursValue, Spinner } from '../../components/ui';

// Faculty: see ONLY my assigned students. Add a student to myself (pick from all
// students + subject) — teacher is always me (forced server-side).
export default function FacultyStudents() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const mine = useQuery({ queryKey: ['me-students'], queryFn: () => api.get('/teachers/me/students').then((r) => r.data.data) });
  const allStudents = useQuery({ queryKey: ['students-pick'], queryFn: () => api.get('/students', { params: { limit: 100 } }).then((r) => r.data.data), enabled: adding });
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/teachers/subjects').then((r) => r.data.data) });

  const { register, handleSubmit, reset } = useForm();
  const assign = useMutation({
    mutationFn: (b: any) => api.post('/teachers/assign', {
      student_id: Number(b.student_id),
      subject_id: Number(b.subject_id),
      package_hours: b.package_hours ? Number(b.package_hours) : 0,
    }), // teacher_id is forced to me server-side
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['me-students'] }); reset(); setAdding(false); },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">My Students</h1>
          <p className="muted text-sm">Students assigned to you only.</p>
        </div>
        <button className="btn-primary" onClick={() => setAdding((v) => !v)}>{adding ? 'Close' : '+ Add Student to me'}</button>
      </div>

      {adding && (
        <Section title="Assign a student to yourself">
          <form onSubmit={handleSubmit((b) => assign.mutate(b))} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium muted">Student</label>
              <select className="input mt-1" {...register('student_id', { required: true })}>
                <option value="">Select student…</option>
                {(allStudents.data || []).map((s: any) => <option key={s.id} value={s.id}>{s.form_no} — {s.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium muted">Subject</label>
              <select className="input mt-1" {...register('subject_id', { required: true })}>
                <option value="">Select…</option>
                {(subjects.data || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <input className="input" placeholder="Pkg hrs" {...register('package_hours')} />
              <button className="btn-primary" disabled={assign.isPending}>Add</button>
            </div>
          </form>
        </Section>
      )}

      <Section title={`${(mine.data || []).length} students`}>
        {mine.isLoading ? <Spinner /> : (
          <Table head={['Form', 'Student', 'Grade', 'Subjects', 'Parent Mobile', 'Hours Left', 'Status', '']}>
            {(mine.data || []).length === 0 ? (
              <tr><td className="table-td muted" colSpan={8}>No students assigned to you yet. Use “Add Student to me”.</td></tr>
            ) : mine.data.map((s: any) => (
              <tr key={s.id}>
                <td className="table-td font-mono">{s.form_no}</td>
                <td className="table-td font-medium">{s.full_name}</td>
                <td className="table-td">{s.year_grade || '—'}</td>
                <td className="table-td">{s.subjects || '—'}</td>
                <td className="table-td whitespace-nowrap">{s.parent_mobile || '—'}</td>
                <td className="table-td">{s.hours_left != null ? <HoursValue value={s.hours_left} /> : '—'}</td>
                <td className="table-td"><StatusBadge status={s.status} /></td>
                <td className="table-td"><Link to={`/faculty/student/${s.id}`} className="btn-ghost !py-1 !px-2.5 text-xs whitespace-nowrap">View →</Link></td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}
