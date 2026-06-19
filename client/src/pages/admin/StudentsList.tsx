import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api } from '../../api/client';
import { Section, StatusBadge, Table, Spinner } from '../../components/ui';

export default function StudentsList() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['students', search, status, page],
    queryFn: () =>
      api.get('/students', { params: { search, status, page, limit: 15 } }).then((r) => r.data),
  });

  const { register, handleSubmit, reset } = useForm();
  const create = useMutation({
    mutationFn: (body: any) =>
      api.post('/students', {
        ...body,
        age: body.age ? Number(body.age) : null,
        fees_received: body.fees_received ? Number(body.fees_received) : 0,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students'] });
      setDrawer(false);
      reset();
    },
  });

  const total = data?.total || 0;
  const pages = Math.ceil(total / 15) || 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Students</h1>
        <button className="btn-primary" onClick={() => setDrawer(true)}>+ Add Student</button>
      </div>

      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search name / form no / email…"
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select className="input max-w-[180px]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option>Active</option>
          <option>Inactive</option>
          <option>SP-Active</option>
        </select>
      </div>

      <Section title={`${total} students`}>
        {isLoading ? <Spinner /> : (
          <>
            <Table head={['Form', 'Name', 'Grade', 'Board', 'School', 'Status', 'Parent Mobile']}>
              {data.data.map((s: any) => (
                <tr key={s.id}>
                  <td className="table-td font-mono">{s.form_no}</td>
                  <td className="table-td font-medium">{s.full_name}</td>
                  <td className="table-td">{s.year_grade || '—'}</td>
                  <td className="table-td">{s.exam_board || '—'}</td>
                  <td className="table-td">{s.school_name || '—'}</td>
                  <td className="table-td"><StatusBadge status={s.status} /></td>
                  <td className="table-td">{s.parent_mobile || '—'}</td>
                </tr>
              ))}
            </Table>
            <div className="flex items-center justify-between mt-3 text-sm">
              <span className="muted">Page {page} / {pages}</span>
              <div className="flex gap-2">
                <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
                <button className="btn-ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
              </div>
            </div>
          </>
        )}
      </Section>

      {/* Drawer form */}
      {drawer && (
        <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={() => setDrawer(false)}>
          <div className="w-full max-w-md h-full p-6 overflow-y-auto" style={{ background: 'var(--color-card)' }} onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Add Student</h2>
            <form onSubmit={handleSubmit((b) => create.mutate(b))} className="space-y-3">
              {[
                ['form_no', 'Form No *'],
                ['first_name', 'First Name'],
                ['middle_name', 'Middle Name'],
                ['last_name', 'Last Name'],
                ['year_grade', 'Year / Grade'],
                ['school_name', 'School'],
                ['exam_board', 'Exam Board'],
                ['father_name', 'Father Name'],
                ['mother_name', 'Mother Name'],
                ['email', 'Email'],
                ['age', 'Age'],
                ['nationality', 'Nationality'],
                ['student_mobile', 'Student Mobile'],
                ['parent_mobile', 'Parent Mobile'],
                ['fees_received', 'Fees Received (AED)'],
              ].map(([name, label]) => (
                <div key={name}>
                  <label className="text-xs font-medium muted">{label}</label>
                  <input className="input mt-1" {...register(name)} />
                </div>
              ))}
              <div>
                <label className="text-xs font-medium muted">Status</label>
                <select className="input mt-1" {...register('status')} defaultValue="Active">
                  <option>Active</option>
                  <option>Inactive</option>
                  <option>SP-Active</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium muted">Gender</label>
                <select className="input mt-1" {...register('gender')}>
                  <option value="">—</option>
                  <option>Male</option><option>Female</option><option>Other</option>
                </select>
              </div>
              {create.isError && <div className="text-sm text-red-500">Failed to save. Form No may already exist.</div>}
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
