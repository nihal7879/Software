import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api } from '../../api/client';
import { Section, StatusBadge, Table, Spinner } from '../../components/ui';
import { ConfirmModal } from '../../components/ConfirmModal';

export default function StudentsList() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState(false);
  const [confirm, setConfirm] = useState<{ id: number; name: string; next: 'Active' | 'Inactive' } | null>(null);

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

  const setStatus_ = useMutation({
    mutationFn: (v: { id: number; status: 'Active' | 'Inactive' }) => api.post(`/students/${v.id}/set-status`, { status: v.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['students'] }),
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
        </select>
      </div>

      <Section title={`${total} students`}>
        {isLoading ? <Spinner /> : (
          <>
            <Table head={['Form', 'Name', 'Grade', 'Board', 'School', 'Status', 'Parent Mobile', '']}>
              {data.data.map((s: any) => (
                <tr key={s.id}>
                  <td className="table-td font-mono">{s.form_no}</td>
                  <td className="table-td font-medium">{s.full_name}</td>
                  <td className="table-td">{s.year_grade || '—'}</td>
                  <td className="table-td">{s.exam_board || '—'}</td>
                  <td className="table-td">{s.school_name || '—'}</td>
                  <td className="table-td"><StatusBadge status={s.status} /></td>
                  <td className="table-td whitespace-nowrap">{s.parent_mobile || '—'}</td>
                  <td className="table-td">
                    {s.status === 'Active' ? (
                      <button
                        className="!py-1 !px-2.5 text-xs rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 transition-colors whitespace-nowrap"
                        onClick={() => setConfirm({ id: s.id, name: s.full_name, next: 'Inactive' })}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        className="!py-1 !px-2.5 text-xs rounded-lg border border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 transition-colors whitespace-nowrap"
                        onClick={() => setConfirm({ id: s.id, name: s.full_name, next: 'Active' })}
                      >
                        Activate
                      </button>
                    )}
                  </td>
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

      {confirm && (
        <ConfirmModal
          title={confirm.next === 'Inactive' ? 'Deactivate student' : 'Activate student'}
          message={`${confirm.next === 'Inactive' ? 'Deactivate' : 'Activate'} ${confirm.name}?`}
          confirmLabel={confirm.next === 'Inactive' ? 'Deactivate' : 'Activate'}
          danger={confirm.next === 'Inactive'}
          busy={setStatus_.isPending}
          onConfirm={() => { setStatus_.mutate({ id: confirm.id, status: confirm.next }); setConfirm(null); }}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
