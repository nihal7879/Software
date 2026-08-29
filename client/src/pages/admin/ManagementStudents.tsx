import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api } from '../../api/client';
import { Section, StatusBadge, Table, Spinner } from '../../components/ui';
import { StudentRegistrationForm } from '../../components/StudentRegistrationForm';
import { ConfirmModal } from '../../components/ConfirmModal';

// Teachers cell: show 3 chips, then a clickable "+N" that expands/collapses the
// rest (works on touch — no hover dependency).
function TeacherChips({ teachers }: { teachers?: string }) {
  const [open, setOpen] = useState(false);
  const list = String(teachers || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (list.length === 0) return <span className="muted">—</span>;
  const shown = open ? list : list.slice(0, 3);
  const extra = list.length - shown.length;
  return (
    <span className="flex flex-wrap gap-1 items-center">
      {shown.map((n) => (
        <span key={n} className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: 'var(--color-card-alt)' }}>{n}</span>
      ))}
      {extra > 0 && (
        <button type="button" onClick={() => setOpen(true)} className="text-xs px-2 py-0.5 rounded-full muted hover:text-[var(--color-primary)]" style={{ background: 'var(--color-card-alt)' }}>
          +{extra}
        </button>
      )}
      {open && list.length > 3 && (
        <button type="button" onClick={() => setOpen(false)} className="text-xs px-2 py-0.5 rounded-full muted hover:text-[var(--color-primary)]" style={{ background: 'var(--color-card-alt)' }}>
          show less
        </button>
      )}
    </span>
  );
}

// MANAGEMENT master: one row per student — parent (who pays), fee paid status,
// hours, teachers. Month selector scopes the fees-paid / hours figures.
export default function ManagementStudents() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState(false);
  // '' = all. Trial students are people on a free trial, not yet enrolled.
  const [typeFilter, setTypeFilter] = useState<'' | 'Trial' | 'Enrolled'>('');
  // After step 1 (create) we keep the new student id to fill the full profile form (step 2).
  const [newStudentId, setNewStudentId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['mgmt-master', search, page, typeFilter],
    queryFn: () => api.get('/management/master', {
      params: { search, page, limit: 20, ...(typeFilter ? { student_type: typeFilter } : {}) },
    }).then((r) => r.data),
  });

  const { register, handleSubmit, reset, watch } = useForm();
  const isTrial = watch('student_type') === 'Trial';
  const create = useMutation({
    mutationFn: (b: any) => api.post('/students', {
      ...b,
      age: b.age ? Number(b.age) : null,
      fees_received: b.fees_received ? Number(b.fees_received) : 0,
      trial_hours: b.student_type === 'Trial' && b.trial_hours ? Number(b.trial_hours) : undefined,
    }),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ['mgmt-master'] }); setNewStudentId(res.data.id); },
  });

  const closeDrawer = () => { setDrawer(false); setNewStudentId(null); reset(); create.reset(); };

  const setStudentStatus = useMutation({
    mutationFn: (v: { id: number; status: 'Active' | 'Inactive' }) => api.post(`/students/${v.id}/set-status`, { status: v.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mgmt-master'] }),
  });
  const [confirm, setConfirm] = useState<{ id: number; name: string; next: 'Active' | 'Inactive' } | null>(null);

  // Converting a trial keeps the same student record, so their trial lectures,
  // login and parent stay attached. One-way.
  const convert = useMutation({
    mutationFn: (v: { id: number; package_hours?: number }) =>
      api.post(`/students/${v.id}/convert`, v.package_hours ? { package_hours: v.package_hours } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mgmt-master'] }),
  });
  const [converting, setConverting] = useState<{ id: number; name: string } | null>(null);
  const [convertHours, setConvertHours] = useState('');

  const rows = data?.data || [];
  const total = data?.total || 0;
  const pages = Math.ceil(total / 20) || 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Students — Master</h1>
          <p className="muted text-sm">Parent mapping, who pays, fee status, hours & teachers</p>
        </div>
        <button className="btn-primary" onClick={() => setDrawer(true)}>+ Add Student</button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input className="input max-w-xs" placeholder="Search name / form no…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <div className="flex gap-1 rounded-lg p-0.5" style={{ background: 'var(--color-card-alt)' }}>
          {([['', 'All'], ['Trial', 'Trial'], ['Enrolled', 'Enrolled']] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => { setTypeFilter(v); setPage(1); }}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                typeFilter === v ? 'bg-[var(--color-card)] font-semibold shadow-sm' : 'muted hover:text-[var(--color-primary)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Section title={`${total} students`}>
        {isLoading ? <Spinner /> : rows.length === 0 ? (
          <p className="muted text-sm">No students found.</p>
        ) : (
          <>
          <Table head={['Student', 'Profile', 'Parent (pays)', 'Relation', 'Status', 'Teachers', '']}>
            {rows.map((r: any) => (
              <tr key={r.id}>
                {/* Student — name + form + grade */}
                <td className="table-td min-w-[180px]">
                  <div className="font-semibold leading-tight flex items-center gap-1.5">
                    <span>{r.full_name || '—'}</span>
                    {r.student_type === 'Trial' && (
                      <span className="text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-600">TRIAL</span>
                    )}
                  </div>
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

                <td className="table-td whitespace-nowrap"><StatusBadge status={r.status} /></td>
                <td className="table-td max-w-[220px] text-sm">
                  <TeacherChips teachers={r.teachers} />
                </td>
                <td className="table-td">
                  <div className="flex gap-1.5 whitespace-nowrap">
                    <Link to={`/admin/student/${r.id}`} className="btn-ghost !py-1 !px-2.5 text-xs">Report →</Link>
                    {r.student_type === 'Trial' && (
                      <button
                        className="!py-1 !px-2.5 text-xs rounded-lg border border-violet-500/30 text-violet-600 hover:bg-violet-500/10 transition-colors"
                        onClick={() => { setConvertHours(''); setConverting({ id: r.id, name: r.full_name }); }}
                      >
                        Enroll
                      </button>
                    )}
                    {r.status === 'Inactive' ? (
                      <button
                        className="!py-1 !px-2.5 text-xs rounded-lg border border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 transition-colors"
                        onClick={() => setConfirm({ id: r.id, name: r.full_name, next: 'Active' })}
                      >
                        Activate
                      </button>
                    ) : (
                      <button
                        className="!py-1 !px-2.5 text-xs rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 transition-colors"
                        onClick={() => setConfirm({ id: r.id, name: r.full_name, next: 'Inactive' })}
                      >
                        Deactivate
                      </button>
                    )}
                  </div>
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
                      <label className="text-xs font-medium muted">Email or Username *</label>
                      <input className="input mt-1" type="text" autoComplete="off" placeholder="e.g. aarav or aarav@email.com" {...register('email', { required: true })} />
                    </div>
                    <div>
                      <label className="text-xs font-medium muted">Password * (min 6)</label>
                      <input className="input mt-1" type="text" autoComplete="off" {...register('password', { required: true, minLength: 6 })} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium muted">Status</label>
                      <select className="input mt-1" {...register('status')} defaultValue="Active">
                        <option>Active</option><option>Inactive</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium muted">Student type</label>
                      <select className="input mt-1" {...register('student_type')} defaultValue="Enrolled">
                        <option>Enrolled</option><option>Trial</option>
                      </select>
                    </div>
                  </div>
                  {isTrial && (
                    <div className="rounded-lg p-3" style={{ background: 'var(--color-card-alt)' }}>
                      <label className="text-xs font-medium muted">Free trial hours</label>
                      <input className="input mt-1" type="number" step="0.5" min="0.5" placeholder="e.g. 2" {...register('trial_hours')} />
                      <p className="text-xs muted mt-1.5">
                        Added as a zero-cost package so the hours count down normally.
                        You can enroll them later without losing any of this.
                      </p>
                    </div>
                  )}
                  {create.isError && (
                    <div className="text-sm text-red-500">
                      {(create.error as any)?.response?.data?.error || 'Failed to create — the username/email may already be in use.'}
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

      {converting && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setConverting(null)}>
          <div className="w-full max-w-sm rounded-xl p-5" style={{ background: 'var(--color-card)' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">Enroll {converting.name}</h3>
            <p className="muted text-sm mt-1">
              Their trial lectures, login and parent record all stay with them. This can't be undone.
            </p>
            <label className="text-xs font-medium muted block mt-4">First package hours (optional)</label>
            <input
              className="input mt-1" type="number" step="0.5" min="0.5" placeholder="e.g. 30"
              value={convertHours} onChange={(e) => setConvertHours(e.target.value)}
            />
            <p className="text-xs muted mt-1.5">Leave empty to enroll now and add the package later.</p>
            {convert.isError && (
              <div className="text-sm text-red-500 mt-2">
                {(convert.error as any)?.response?.data?.error || 'Could not enroll this student.'}
              </div>
            )}
            <div className="flex gap-2 mt-5">
              <button
                className="btn-primary flex-1" disabled={convert.isPending}
                onClick={() => {
                  convert.mutate(
                    { id: converting.id, package_hours: convertHours ? Number(convertHours) : undefined },
                    { onSuccess: () => setConverting(null) }
                  );
                }}
              >
                {convert.isPending ? 'Enrolling…' : 'Enroll'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setConverting(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.next === 'Inactive' ? 'Deactivate student' : 'Activate student'}
          message={`${confirm.next === 'Inactive' ? 'Deactivate' : 'Activate'} ${confirm.name}?`}
          confirmLabel={confirm.next === 'Inactive' ? 'Deactivate' : 'Activate'}
          danger={confirm.next === 'Inactive'}
          busy={setStudentStatus.isPending}
          onConfirm={() => { setStudentStatus.mutate({ id: confirm.id, status: confirm.next }); setConfirm(null); }}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
