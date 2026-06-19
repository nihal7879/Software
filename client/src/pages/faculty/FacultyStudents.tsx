import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api } from '../../api/client';
import { Section, StatusBadge, Table, Spinner } from '../../components/ui';

// Faculty: see all students, select one, and record what they teach (assign self+subject).
export default function FacultyStudents() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<any>(null);

  const students = useQuery({ queryKey: ['students'], queryFn: () => api.get('/students', { params: { limit: 100 } }).then((r) => r.data.data) });
  const teachers = useQuery({ queryKey: ['teachers'], queryFn: () => api.get('/teachers').then((r) => r.data.data) });
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/teachers/subjects').then((r) => r.data.data) });

  const mapping = useQuery({
    queryKey: ['mapping', selected?.id],
    queryFn: () => api.get(`/teachers/of-student/${selected.id}`).then((r) => r.data.data),
    enabled: !!selected,
  });

  const { register, handleSubmit, reset } = useForm();
  const assign = useMutation({
    mutationFn: (b: any) => api.post('/teachers/assign', {
      student_id: selected.id,
      teacher_id: Number(b.teacher_id),
      subject_id: Number(b.subject_id),
      package_hours: b.package_hours ? Number(b.package_hours) : 0,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mapping', selected.id] }); reset(); },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">My Students</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="All Students — select to assign">
          {students.isLoading ? <Spinner /> : (
            <Table head={['Form', 'Name', 'Grade', 'Status', '']}>
              {students.data.map((s: any) => (
                <tr key={s.id} className={selected?.id === s.id ? 'bg-blue-500/10' : ''}>
                  <td className="table-td font-mono">{s.form_no}</td>
                  <td className="table-td font-medium">{s.full_name}</td>
                  <td className="table-td">{s.year_grade || '—'}</td>
                  <td className="table-td"><StatusBadge status={s.status} /></td>
                  <td className="table-td"><button className="btn-ghost text-xs" onClick={() => setSelected(s)}>Select</button></td>
                </tr>
              ))}
            </Table>
          )}
        </Section>

        <Section title={selected ? `Teaching: ${selected.full_name}` : 'Select a student'}>
          {!selected ? <p className="muted text-sm">Pick a student on the left to assign a teacher & subject.</p> : (
            <>
              <form onSubmit={handleSubmit((b) => assign.mutate(b))} className="space-y-3 mb-4">
                <div>
                  <label className="text-xs font-medium muted">Teacher</label>
                  <select className="input mt-1" {...register('teacher_id', { required: true })}>
                    <option value="">Select teacher…</option>
                    {teachers.data?.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium muted">Subject</label>
                  <select className="input mt-1" {...register('subject_id', { required: true })}>
                    <option value="">Select subject…</option>
                    {subjects.data?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium muted">Package Hours</label>
                  <input className="input mt-1" {...register('package_hours')} />
                </div>
                <button className="btn-primary w-full" disabled={assign.isPending}>Assign</button>
              </form>

              <div className="text-xs font-semibold uppercase muted mb-2">Current teachers</div>
              {mapping.isLoading ? <Spinner /> : (
                <Table head={['Teacher', 'Subject', 'Pkg Hrs']}>
                  {(mapping.data || []).map((m: any) => (
                    <tr key={m.id}>
                      <td className="table-td">{m.teacher_name}</td>
                      <td className="table-td">{m.subject_name}</td>
                      <td className="table-td">{m.package_hours}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </>
          )}
        </Section>
      </div>
    </div>
  );
}
