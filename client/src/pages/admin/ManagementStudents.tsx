import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api, rs } from '../../api/client';
import { Section, StatusBadge, Table, HoursValue, Spinner } from '../../components/ui';
import { MonthSelector } from '../../components/MonthSelector';
import { StudentRegistrationForm } from '../../components/StudentRegistrationForm';

// MANAGEMENT master: one row per student — parent (who pays), fee paid status,
// hours, teachers. Month selector scopes the fees-paid / hours figures.
export default function ManagementStudents() {
  const qc = useQueryClient();
  const [month, setMonth] = useState('');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState(false);
  // After step 1 (create) we keep the new student id to fill the full profile form (step 2).
  const [newStudentId, setNewStudentId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['mgmt-master', month],
    queryFn: () => api.get('/management/master', { params: { month } }).then((r) => r.data.data),
  });

  const { register, handleSubmit, reset } = useForm();
  const create = useMutation({
    mutationFn: (b: any) => api.post('/students', { ...b, age: b.age ? Number(b.age) : null, fees_received: b.fees_received ? Number(b.fees_received) : 0 }),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ['mgmt-master'] }); setNewStudentId(res.data.id); },
  });

  const closeDrawer = () => { setDrawer(false); setNewStudentId(null); reset(); create.reset(); };

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
        {isLoading ? <Spinner /> : rows.length === 0 ? (
          <p className="muted text-sm">No students found.</p>
        ) : (
          <Table head={['Student', 'Profile', 'Parent (pays)', 'Relation', 'Fees', 'Hours Left', 'Status', 'Teachers', '']}>
            {rows.map((r: any) => (
              <tr key={r.id}>
                {/* Student — name + form + grade */}
                <td className="table-td min-w-[180px]">
                  <div className="font-semibold leading-tight">{r.full_name || '—'}</div>
                  <div className="text-xs muted mt-0.5">
                    <span className="font-mono">Form {r.form_no}</span>
                    {r.year_grade ? <> · {r.year_grade}</> : ''}
                    {r.exam_board ? <> · {r.exam_board}</> : ''}
                  </div>
                </td>

                {/* Profile completion */}
                <td className="table-td">
                  {r.profile_completed
                    ? <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Completed</span>
                    : <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Pending</span>}
                </td>

                {/* Parent (who pays) name + mobile */}
                <td className="table-td min-w-[160px]">
                  <div className="font-medium">{r.parent_name || <span className="muted italic font-normal">Not set</span>}</div>
                  <div className="text-xs muted mt-0.5">{r.parent_mobile || 'No mobile'}</div>
                </td>

                {/* Relation (who pays) */}
                <td className="table-td">
                  {r.paid_by
                    ? <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${r.paid_by === 'Mother' ? 'bg-pink-500/15 text-pink-600' : 'bg-blue-500/15 text-blue-600'}`}>{r.paid_by}</span>
                    : <span className="muted">—</span>}
                </td>

                {/* Fees — paid + pending */}
                <td className="table-td whitespace-nowrap">
                  <div className="font-semibold text-emerald-600">{rs(r.fees_paid)}</div>
                  {Number(r.pending_fees) > 0
                    ? <div className="text-xs text-red-500 mt-0.5">{rs(r.pending_fees)} due</div>
                    : <div className="text-xs muted mt-0.5">No dues</div>}
                </td>

                <td className="table-td whitespace-nowrap"><HoursValue value={r.hours_left ?? 0} /></td>
                <td className="table-td whitespace-nowrap"><StatusBadge status={r.fee_status || r.status} /></td>
                <td className="table-td max-w-[160px] truncate text-sm" title={r.teachers}>{r.teachers || <span className="muted">—</span>}</td>
                <td className="table-td"><Link to={`/admin/student/${r.id}`} className="btn-ghost !py-1 !px-2.5 text-xs whitespace-nowrap">Report →</Link></td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {drawer && (
        <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={closeDrawer}>
          <div className="w-full max-w-lg h-full p-6 overflow-y-auto" style={{ background: 'var(--color-card)' }} onClick={(e) => e.stopPropagation()}>
            {/* Step 1 — create the student (Form No is the key). */}
            {!newStudentId ? (
              <>
                <h2 className="text-lg font-bold mb-1">Add Student</h2>
                <p className="muted text-sm mb-4">Step 1 of 2 — set the name &amp; login, then fill the full profile. The Form No is assigned automatically.</p>
                <form onSubmit={handleSubmit((b) => create.mutate(b))} className="space-y-3">
                  {[
                    ['first_name', 'First Name *'],
                    ['last_name', 'Last Name'],
                  ].map(([name, label]) => (
                    <div key={name}>
                      <label className="text-xs font-medium muted">{label}</label>
                      <input className="input mt-1" {...register(name, name === 'first_name' ? { required: true } : {})} />
                    </div>
                  ))}

                  {/* Login credentials — management hands these to the student */}
                  <div className="rounded-lg p-3 space-y-3" style={{ background: 'var(--color-card-alt)' }}>
                    <div className="text-xs font-semibold">🔑 Student login (share these with the student)</div>
                    <div>
                      <label className="text-xs font-medium muted">Email *</label>
                      <input className="input mt-1" type="email" autoComplete="off" {...register('email', { required: true })} />
                    </div>
                    <div>
                      <label className="text-xs font-medium muted">Password * (min 6)</label>
                      <input className="input mt-1" type="text" autoComplete="off" {...register('password', { required: true, minLength: 6 })} />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium muted">Status</label>
                    <select className="input mt-1" {...register('status')} defaultValue="Active">
                      <option>Active</option><option>Inactive</option><option>SP-Active</option>
                    </select>
                  </div>
                  {create.isError && (
                    <div className="text-sm text-red-500">
                      {(create.error as any)?.response?.data?.error || 'Failed to create — the email may already be in use.'}
                    </div>
                  )}
                  <div className="flex gap-2 pt-2">
                    <button className="btn-primary flex-1" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create & Continue →'}</button>
                    <button type="button" className="btn-ghost" onClick={closeDrawer}>Cancel</button>
                  </div>
                </form>
              </>
            ) : (
              /* Step 2 — fill the full registration / profile form. */
              <>
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-lg font-bold">Complete Profile</h2>
                  <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={closeDrawer}>Done</button>
                </div>
                <p className="muted text-sm mb-4">Step 2 of 2 — fill in the student's full registration details.</p>
                <StudentRegistrationForm
                  studentId={newStudentId}
                  submitLabel="Save Profile"
                  onSaved={() => { qc.invalidateQueries({ queryKey: ['mgmt-master'] }); closeDrawer(); }}
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
