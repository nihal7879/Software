import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api, hrs } from '../../api/client';
import { Section, Table, Spinner } from '../../components/ui';

export default function Teachers() {
  const qc = useQueryClient();
  const [drawer, setDrawer] = useState(false);
  const teachers = useQuery({ queryKey: ['teachers'], queryFn: () => api.get('/teachers').then((r) => r.data.data) });
  const workload = useQuery({ queryKey: ['workload'], queryFn: () => api.get('/analytics/teacher-workload').then((r) => r.data.data) });

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
        {workload.isLoading ? <Spinner /> : (
          <Table head={['Teacher', 'Students', 'Total Hours Taught', 'This Month']}>
            {workload.data.map((t: any) => (
              <tr key={t.id}>
                <td className="table-td font-medium">{t.name}</td>
                <td className="table-td">{t.total_students}</td>
                <td className="table-td">{hrs(t.total_hours_taught)}</td>
                <td className="table-td">{hrs(t.month_hours)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {drawer && (
        <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={() => setDrawer(false)}>
          <div className="w-full max-w-md h-full p-6" style={{ background: 'var(--color-card)' }} onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Add Teacher</h2>
            <form onSubmit={handleSubmit((b) => create.mutate(b))} className="space-y-3">
              {[['name', 'Name *'], ['email', 'Email'], ['mobile', 'Mobile'], ['specialization', 'Specialization']].map(([n, l]) => (
                <div key={n}>
                  <label className="text-xs font-medium muted">{l}</label>
                  <input className="input mt-1" {...register(n, n === 'name' ? { required: true } : {})} />
                </div>
              ))}
              <div className="flex gap-2 pt-2">
                <button className="btn-primary flex-1" disabled={create.isPending}>Save</button>
                <button type="button" className="btn-ghost" onClick={() => setDrawer(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
