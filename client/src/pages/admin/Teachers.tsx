import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api, hrs } from '../../api/client';
import { Section, Table, Spinner } from '../../components/ui';
import { ConfirmModal } from '../../components/ConfirmModal';
import { AdminLectureEntryModal } from '../../components/AdminLectureEntryModal';
import { MultiSelect } from '../../components/MultiSelect';

// Chips with a clickable "+N" that expands/collapses the rest (touch-friendly).
function ChipList({ value }: { value?: string }) {
  const [open, setOpen] = useState(false);
  const list = String(value || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (list.length === 0) return <span className="muted">—</span>;
  const shown = open ? list : list.slice(0, 3);
  const extra = list.length - shown.length;
  return (
    <span className="flex flex-wrap gap-1 items-center">
      {shown.map((n) => (
        <span key={n} className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: 'var(--color-card-alt)' }}>{n}</span>
      ))}
      {extra > 0 && (
        <button type="button" onClick={() => setOpen(true)} className="text-xs px-2 py-0.5 rounded-full muted hover:text-[var(--color-primary)]" style={{ background: 'var(--color-card-alt)' }}>+{extra}</button>
      )}
      {open && list.length > 3 && (
        <button type="button" onClick={() => setOpen(false)} className="text-xs px-2 py-0.5 rounded-full muted hover:text-[var(--color-primary)]" style={{ background: 'var(--color-card-alt)' }}>show less</button>
      )}
    </span>
  );
}

export default function Teachers() {
  const qc = useQueryClient();
  const [drawer, setDrawer] = useState(false);
  const [openTeacher, setOpenTeacher] = useState<{ id: number; name: string } | null>(null);
  const rosterRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (openTeacher) rosterRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [openTeacher]);
  const teachers = useQuery({ queryKey: ['teachers'], queryFn: () => api.get('/teachers').then((r) => r.data.data) });
  const workload = useQuery({ queryKey: ['workload'], queryFn: () => api.get('/analytics/teacher-workload').then((r) => r.data.data) });

  // Roster for the expanded teacher: students they've taught OR are assigned to.
  const students = useQuery({
    queryKey: ['teacher-roster', openTeacher?.id],
    queryFn: () => api.get(`/teachers/${openTeacher!.id}/roster`).then((r) => r.data.data),
    enabled: !!openTeacher,
  });

  const { register, handleSubmit, reset, watch, setValue } = useForm();
  const create = useMutation({
    mutationFn: (b: any) => api.post('/teachers', b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['teachers'] }); qc.invalidateQueries({ queryKey: ['workload'] }); setDrawer(false); reset(); },
  });

  // Subjects management
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/teachers/subjects').then((r) => r.data.data) });
  const [subjectName, setSubjectName] = useState('');
  const addSubject = useMutation({
    mutationFn: (name: string) => api.post('/teachers/subjects', { name }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subjects'] }); setSubjectName(''); },
  });
  const delSubject = useMutation({
    mutationFn: (id: number) => api.delete(`/teachers/subjects/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subjects'] }),
  });

  // Teacher activate/deactivate + a generic confirm dialog.
  const setTeacherStatus = useMutation({
    mutationFn: (v: { id: number; is_active: boolean }) => api.post(`/teachers/${v.id}/set-status`, { is_active: v.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workload'] }),
  });
  const [confirm, setConfirm] = useState<{ title: string; message: string; confirmLabel: string; danger?: boolean; onConfirm: () => void } | null>(null);
  // Admin logs a lecture on behalf of a (busy) teacher.
  const [lectureFor, setLectureFor] = useState<{ id: number; name: string } | null>(null);
  const [workloadSearch, setWorkloadSearch] = useState('');
  const visibleWorkload = (workload.data || []).filter((t: any) => {
    if (!workloadSearch) return true;
    const q = workloadSearch.toLowerCase();
    return t.name?.toLowerCase().includes(q) || String(t.specialization || '').toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Teachers</h1>
        <button className="btn-primary" onClick={() => setDrawer(true)}>+ Add Teacher</button>
      </div>

      <Section title="Subjects">
        <p className="muted text-sm mb-3">Add the subjects taught here — they appear in the Subject dropdown when assigning teachers to students.</p>
        <form
          onSubmit={(e) => { e.preventDefault(); if (subjectName.trim()) addSubject.mutate(subjectName.trim()); }}
          className="flex flex-wrap items-center gap-2 mb-3"
        >
          <input
            className="input max-w-xs"
            placeholder="New subject name…"
            value={subjectName}
            onChange={(e) => setSubjectName(e.target.value)}
          />
          <button className="btn-primary" disabled={addSubject.isPending || !subjectName.trim()}>
            {addSubject.isPending ? 'Adding…' : '+ Add Subject'}
          </button>
        </form>
        {addSubject.isError && (
          <div className="text-sm text-red-500 mb-3">
            {(addSubject.error as any)?.response?.data?.error || 'Could not add subject.'}
          </div>
        )}
        {subjects.isLoading ? <Spinner /> : (
          <div className="flex flex-wrap gap-2">
            {(subjects.data || []).length === 0 ? (
              <span className="muted text-sm">No subjects yet.</span>
            ) : (subjects.data || []).map((s: any) => (
              <span key={s.id} className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm" style={{ background: 'var(--color-card-alt)' }}>
                {s.name}
                <button
                  className="text-red-500 hover:text-red-600 disabled:opacity-50"
                  title="Remove subject"
                  disabled={delSubject.isPending}
                  onClick={() => setConfirm({ title: 'Remove subject', message: `Remove subject "${s.name}"?`, confirmLabel: 'Remove', danger: true, onConfirm: () => delSubject.mutate(s.id) })}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </Section>

      <Section title="Workload" action={
        <input className="input max-w-[220px]" placeholder="Search teacher…" value={workloadSearch} onChange={(e) => setWorkloadSearch(e.target.value)} />
      }>
        <p className="muted text-sm mb-3">Click a teacher to see the students assigned to them. Assign teachers from a student's Report.</p>
        {workload.isLoading ? <Spinner /> : visibleWorkload.length === 0 ? (
          <p className="muted text-sm">No teachers match “{workloadSearch}”.</p>
        ) : (
          <Table head={['Teacher', 'Specialization', { label: 'Students', align: 'right' }, { label: 'Total Hours Taught', align: 'right' }, { label: 'This Month', align: 'right' }, 'Status', '']}>
            {visibleWorkload.map((t: any) => {
              const active = Number(t.is_active) === 1;
              return (
              <tr key={t.id}>
                <td className="table-td font-medium">{t.name}</td>
                <td className="table-td max-w-[260px]">
                  <ChipList value={t.specialization} />
                </td>
                <td className="table-td text-right tabular-nums">{t.total_students}</td>
                <td className="table-td text-right tabular-nums">{hrs(t.total_hours_taught)}</td>
                <td className="table-td text-right tabular-nums">{hrs(t.month_hours)}</td>
                <td className="table-td">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${active ? 'bg-emerald-500/15 text-emerald-600' : 'bg-slate-500/15 text-slate-500'}`}>
                    {active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="table-td">
                  <div className="flex gap-1.5 whitespace-nowrap">
                    <button
                      className="btn-ghost !py-1 !px-2.5 text-xs"
                      onClick={() => setOpenTeacher(openTeacher?.id === t.id ? null : { id: t.id, name: t.name })}
                    >
                      {openTeacher?.id === t.id ? 'Hide students' : 'View students'}
                    </button>
                    <button
                      className="!py-1 !px-2.5 text-xs rounded-lg border border-blue-500/30 text-blue-600 hover:bg-blue-500/10 transition-colors whitespace-nowrap"
                      onClick={() => setLectureFor({ id: t.id, name: t.name })}
                    >
                      + Lecture
                    </button>
                    {active ? (
                      <button
                        className="!py-1 !px-2.5 text-xs rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 transition-colors"
                        onClick={() => setConfirm({ title: 'Deactivate teacher', message: `Deactivate ${t.name}? They won't be able to log in.`, confirmLabel: 'Deactivate', danger: true, onConfirm: () => setTeacherStatus.mutate({ id: t.id, is_active: false }) })}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        className="!py-1 !px-2.5 text-xs rounded-lg border border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 transition-colors"
                        onClick={() => setConfirm({ title: 'Activate teacher', message: `Activate ${t.name}?`, confirmLabel: 'Activate', onConfirm: () => setTeacherStatus.mutate({ id: t.id, is_active: true }) })}
                      >
                        Activate
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </Table>
        )}
      </Section>

      {openTeacher && (
        <div ref={rosterRef}>
        <Section title={`Students of ${openTeacher.name}`}>
          {students.isLoading ? <Spinner /> : (
            <Table head={['Form', 'Student', 'Grade', 'Subject', { label: 'Hours Taught', align: 'right' }, 'Assignment', 'Status', '']}>
              {(students.data || []).length === 0 ? (
                <tr><td className="table-td muted" colSpan={8}>No students taught or assigned to this teacher yet.</td></tr>
              ) : (students.data || []).map((s: any) => (
                <tr key={s.id}>
                  <td className="table-td font-mono">{s.form_no}</td>
                  <td className="table-td font-medium">{s.full_name}</td>
                  <td className="table-td">{s.year_grade || '—'}</td>
                  <td className="table-td">{s.subjects || '—'}</td>
                  <td className="table-td text-right tabular-nums">{hrs(s.hours_with_teacher)}</td>
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
        </div>
      )}

      {drawer && (
        <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={() => setDrawer(false)}>
          <div className="w-full max-w-md h-full p-6" style={{ background: 'var(--color-card)' }} onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-1">Add Teacher</h2>
            <p className="muted text-sm mb-4">Set the email &amp; password — these are the teacher's login (share them with the teacher).</p>
            <form onSubmit={handleSubmit((b) => create.mutate(b))} className="space-y-3">
              {[['name', 'Name *'], ['mobile', 'Mobile']].map(([n, l]) => (
                <div key={n}>
                  <label className="text-xs font-medium muted">{l}</label>
                  <input className="input mt-1" {...register(n, n === 'name' ? { required: true } : {})} />
                </div>
              ))}
              <div>
                <label className="text-xs font-medium muted block mb-1">Specialization</label>
                <input type="hidden" {...register('specialization')} />
                <MultiSelect
                  value={watch('specialization') || ''}
                  onChange={(v) => setValue('specialization', v)}
                  options={(subjects.data || []).map((s: any) => ({ value: s.name, label: s.name }))}
                  placeholder="Select subject(s)…"
                  allowCustom
                />
              </div>
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

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          danger={confirm.danger}
          onConfirm={() => { confirm.onConfirm(); setConfirm(null); }}
          onClose={() => setConfirm(null)}
        />
      )}

      {lectureFor && (
        <AdminLectureEntryModal
          teacherId={lectureFor.id}
          teacherName={lectureFor.name}
          onClose={() => setLectureFor(null)}
        />
      )}
    </div>
  );
}
