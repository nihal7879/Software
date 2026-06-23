import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api, hrs } from '../../api/client';
import { Section, Table, Spinner } from '../../components/ui';

export default function Teachers() {
  const qc = useQueryClient();
  const [drawer, setDrawer] = useState(false);
  const [openTeacher, setOpenTeacher] = useState<{ id: number; name: string } | null>(null);
  const teachers = useQuery({ queryKey: ['teachers'], queryFn: () => api.get('/teachers').then((r) => r.data.data) });
  const workload = useQuery({ queryKey: ['workload'], queryFn: () => api.get('/analytics/teacher-workload').then((r) => r.data.data) });

  // Roster for the expanded teacher: students they've taught OR are assigned to.
  const students = useQuery({
    queryKey: ['teacher-roster', openTeacher?.id],
    queryFn: () => api.get(`/teachers/${openTeacher!.id}/roster`).then((r) => r.data.data),
    enabled: !!openTeacher,
  });

  const { register, handleSubmit, reset } = useForm();
  const create = useMutation({
    mutationFn: (b: any) => api.post('/teachers', b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['teachers'] }); qc.invalidateQueries({ queryKey: ['workload'] }); setDrawer(false); reset(); },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Teachers</h1>
        <button className="btn-primary" onClick={() => setDrawer(true)}>+ Add Teacher</button>
      </div>

      <Section title="Workload">
        <p className="muted text-sm mb-3">Click a teacher to see the students assigned to them. Assign teachers from a student's Report.</p>
        {workload.isLoading ? <Spinner /> : (
          <Table head={['Teacher', 'Students', 'Total Hours Taught', 'This Month', '']}>
            {workload.data.map((t: any) => (
              <tr key={t.id}>
                <td className="table-td font-medium">{t.name}</td>
                <td className="table-td">{t.total_students}</td>
                <td className="table-td">{hrs(t.total_hours_taught)}</td>
                <td className="table-td">{hrs(t.month_hours)}</td>
                <td className="table-td">
                  <button
                    className="btn-ghost !py-1 !px-2.5 text-xs whitespace-nowrap"
                    onClick={() => setOpenTeacher(openTeacher?.id === t.id ? null : { id: t.id, name: t.name })}
                  >
                    {openTeacher?.id === t.id ? 'Hide students' : 'View students'}
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {openTeacher && (
        <Section title={`Students of ${openTeacher.name}`}>
          {students.isLoading ? <Spinner /> : (
            <Table head={['Form', 'Student', 'Grade', 'Subject', 'Hours Taught', 'Assignment', 'Status', '']}>
              {(students.data || []).length === 0 ? (
                <tr><td className="table-td muted" colSpan={8}>No students taught or assigned to this teacher yet.</td></tr>
              ) : (students.data || []).map((s: any) => (
                <tr key={s.id}>
                  <td className="table-td font-mono">{s.form_no}</td>
                  <td className="table-td font-medium">{s.full_name}</td>
                  <td className="table-td">{s.year_grade || '—'}</td>
                  <td className="table-td">{s.subjects || '—'}</td>
                  <td className="table-td">{hrs(s.hours_with_teacher)}</td>
                  <td className="table-td">
                    {Number(s.is_assigned) === 1
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600">Assigned</span>
                      : <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600">Taught only</span>}
                  </td>
                  <td className="table-td">{s.status}</td>
                  <td className="table-td"><Link to={`/admin/student/${s.id}`} className="btn-ghost !py-1 !px-2.5 text-xs whitespace-nowrap">Report →</Link></td>
                </tr>
              ))}
            </Table>
          )}
        </Section>
      )}

      {drawer && (
        <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={() => setDrawer(false)}>
          <div className="w-full max-w-md h-full p-6" style={{ background: 'var(--color-card)' }} onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-1">Add Teacher</h2>
            <p className="muted text-sm mb-4">Set the email &amp; password — these are the teacher's login (share them with the teacher).</p>
            <form onSubmit={handleSubmit((b) => create.mutate(b))} className="space-y-3">
              {[['name', 'Name *'], ['mobile', 'Mobile'], ['specialization', 'Specialization']].map(([n, l]) => (
                <div key={n}>
                  <label className="text-xs font-medium muted">{l}</label>
                  <input className="input mt-1" {...register(n, n === 'name' ? { required: true } : {})} />
                </div>
              ))}
              <div className="rounded-lg p-3 space-y-3" style={{ background: 'var(--color-card-alt)' }}>
                <div className="text-xs font-semibold">🔑 Teacher login</div>
                <div>
                  <label className="text-xs font-medium muted">Email *</label>
                  <input className="input mt-1" type="email" autoComplete="off" {...register('email', { required: true })} />
                </div>
                <div>
                  <label className="text-xs font-medium muted">Password * (min 6)</label>
                  <input className="input mt-1" type="text" autoComplete="off" {...register('password', { required: true, minLength: 6 })} />
                </div>
              </div>
              {create.isError && (
                <div className="text-sm text-red-500">
                  {(create.error as any)?.response?.data?.error || 'Failed to create — the email may already be in use.'}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button className="btn-primary flex-1" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Save'}</button>
                <button type="button" className="btn-ghost" onClick={() => setDrawer(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
