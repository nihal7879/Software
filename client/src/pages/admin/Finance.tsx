import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api, aed } from '../../api/client';
import { Section, Table, Spinner } from '../../components/ui';

export default function Finance() {
  const qc = useQueryClient();
  const [drawer, setDrawer] = useState(false);

  const tx = useQuery({ queryKey: ['transactions'], queryFn: () => api.get('/fees/transactions').then((r) => r.data.data) });
  const students = useQuery({ queryKey: ['students-all'], queryFn: () => api.get('/students', { params: { limit: 100 } }).then((r) => r.data.data) });

  const { register, handleSubmit, reset } = useForm();
  const create = useMutation({
    mutationFn: (b: any) => api.post('/fees/transactions', {
      ...b,
      student_id: Number(b.student_id),
      amount: Number(b.amount),
      course_package_hours: b.course_package_hours ? Number(b.course_package_hours) : null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transactions'] }); setDrawer(false); reset(); },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Finance Tracker</h1>
        <button className="btn-primary" onClick={() => setDrawer(true)}>+ Record Payment</button>
      </div>

      <Section title="Fee Transactions (AED)">
        {tx.isLoading ? <Spinner /> : (
          <Table head={['Date', 'Form', 'Student', 'Amount', 'Source', 'Reference', 'Parent', 'Pkg Hrs', 'Notes']}>
            {tx.data.map((t: any) => (
              <tr key={t.id}>
                <td className="table-td">{t.payment_date}</td>
                <td className="table-td font-mono">{t.form_no}</td>
                <td className="table-td font-medium">{t.student_name}</td>
                <td className="table-td font-semibold text-emerald-600">{aed(t.amount)}</td>
                <td className="table-td">{t.payment_source || '—'}</td>
                <td className="table-td font-mono text-xs">{t.transaction_reference || '—'}</td>
                <td className="table-td">{t.parent_name || '—'}</td>
                <td className="table-td">{t.course_package_hours ?? '—'}</td>
                <td className="table-td max-w-[240px] truncate" title={t.notes}>{t.notes || '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {drawer && (
        <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={() => setDrawer(false)}>
          <div className="w-full max-w-md h-full p-6 overflow-y-auto" style={{ background: 'var(--color-card)' }} onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Record Payment</h2>
            <form onSubmit={handleSubmit((b) => create.mutate(b))} className="space-y-3">
              <div>
                <label className="text-xs font-medium muted">Student *</label>
                <select className="input mt-1" {...register('student_id', { required: true })}>
                  <option value="">Select…</option>
                  {students.data?.map((s: any) => <option key={s.id} value={s.id}>{s.form_no} — {s.full_name}</option>)}
                </select>
              </div>
              {[
                ['amount', 'Amount (AED) *'],
                ['payment_date', 'Payment Date * (YYYY-MM-DD)'],
                ['payment_source', 'Payment Source'],
                ['transaction_reference', 'Transaction Reference'],
                ['parent_name', 'Parent Name'],
                ['course_package_hours', 'Course Package Hours'],
              ].map(([n, l]) => (
                <div key={n}>
                  <label className="text-xs font-medium muted">{l}</label>
                  <input className="input mt-1" {...register(n)} />
                </div>
              ))}
              <div>
                <label className="text-xs font-medium muted">Notes</label>
                <textarea className="input mt-1" rows={3} {...register('notes')} />
              </div>
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
