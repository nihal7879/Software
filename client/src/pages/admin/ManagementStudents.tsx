import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api, rs } from '../../api/client';
import { Section, StatusBadge, Table, HoursValue, Spinner } from '../../components/ui';
import { MonthSelector } from '../../components/MonthSelector';

// MANAGEMENT master: one row per student — parent (who pays), fee paid status,
// hours, teachers. Month selector scopes the fees-paid / hours figures.
export default function ManagementStudents() {
  const qc = useQueryClient();
  const [month, setMonth] = useState('');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['mgmt-master', month],
    queryFn: () => api.get('/management/master', { params: { month } }).then((r) => r.data.data),
  });

  const { register, handleSubmit, reset } = useForm();
  const create = useMutation({
    mutationFn: (b: any) => api.post('/students', { ...b, age: b.age ? Number(b.age) : null, fees_received: b.fees_received ? Number(b.fees_received) : 0 }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mgmt-master'] }); setDrawer(false); reset(); },
  });

  const rows = (data || []).filter((r: any) =>
    !search || r.full_name?.toLowerCase().includes(search.toLowerCase()) || String(r.form_no).includes(search)
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Students — Master</h1>
          <p className="muted text-sm">Parent mapping, who pays, fee status, hours & teachers {month && `· ${month}`}</p>
        </div>
        <button className="btn-primary" onClick={() => setDrawer(true)}>+ Add Student</button>
      </div>

      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search name / form no…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <MonthSelector value={month} onChange={setMonth} />
      </div>

      <Section title={`${rows.length} students`}>
        {isLoading ? <Spinner /> : (
          <Table head={['Form', 'Student', 'Profile', 'Grade', 'Parent (pays)', 'Who', 'Mobile', 'Fee Paid', 'Pending', 'Status', 'Hours Left', 'Teachers', '']}>
            {rows.map((r: any) => (
              <tr key={r.id}>
                <td className="table-td font-mono">{r.form_no}</td>
                <td className="table-td font-medium">{r.full_name}</td>
                <td className="table-td">
                  {r.profile_completed
                    ? <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600">Completed</span>
                    : <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600">Pending</span>}
                </td>
                <td className="table-td">{r.year_grade || '—'}</td>
                <td className="table-td">{r.parent_name || '—'}</td>
                <td className="table-td">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${r.paid_by === 'Mother' ? 'bg-pink-500/15 text-pink-600' : 'bg-blue-500/15 text-blue-600'}`}>
                    {r.paid_by || '—'}
                  </span>
                </td>
                <td className="table-td whitespace-nowrap">{r.parent_mobile || '—'}</td>
                <td className="table-td font-semibold text-emerald-600">{rs(r.fees_paid)}</td>
                <td className="table-td">{Number(r.pending_fees) > 0 ? <span className="text-red-500 font-semibold">{rs(r.pending_fees)}</span> : rs(0)}</td>
                <td className="table-td"><StatusBadge status={r.fee_status || r.status} /></td>
                <td className="table-td"><HoursValue value={r.hours_left ?? 0} /></td>
                <td className="table-td max-w-[180px] truncate" title={r.teachers}>{r.teachers || '—'}</td>
                <td className="table-td"><Link to={`/admin/student/${r.id}`} className="btn-ghost !py-1 !px-2.5 text-xs whitespace-nowrap">Report →</Link></td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {drawer && (
        <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={() => setDrawer(false)}>
          <div className="w-full max-w-md h-full p-6 overflow-y-auto" style={{ background: 'var(--color-card)' }} onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Add Student</h2>
            <form onSubmit={handleSubmit((b) => create.mutate(b))} className="space-y-3">
              {[
                ['form_no', 'Form No *'], ['first_name', 'First Name'], ['middle_name', 'Middle Name'],
                ['last_name', 'Last Name'], ['year_grade', 'Year / Grade'], ['school_name', 'School'],
                ['exam_board', 'Exam Board'], ['father_name', 'Father Name'], ['mother_name', 'Mother Name'],
                ['email', 'Email'], ['age', 'Age'], ['nationality', 'Nationality'],
                ['student_mobile', 'Student Mobile'], ['parent_mobile', 'Parent Mobile'], ['fees_received', 'Fees Received (₹)'],
              ].map(([name, label]) => (
                <div key={name}>
                  <label className="text-xs font-medium muted">{label}</label>
                  <input className="input mt-1" {...register(name)} />
                </div>
              ))}
              <div>
                <label className="text-xs font-medium muted">Who pays (relationship)</label>
                <select className="input mt-1" {...register('relationship')} defaultValue="Father">
                  <option>Father</option><option>Mother</option><option>Guardian</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium muted">Status</label>
                <select className="input mt-1" {...register('status')} defaultValue="Active">
                  <option>Active</option><option>Inactive</option><option>SP-Active</option>
                </select>
              </div>
              {create.isError && <div className="text-sm text-red-500">Failed — Form No may already exist.</div>}
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
