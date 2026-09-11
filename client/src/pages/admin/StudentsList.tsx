import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api } from '../../api/client';
import { Section, StatusBadge, Table, Spinner, Pagination } from '../../components/ui';
import { ConfirmModal } from '../../components/ConfirmModal';
import { Overlay } from '../../components/Overlay';
import { toast } from '../../components/Toast';
import { familyProblem, EMAIL_RE } from '../../components/StudentRegistrationForm';

export default function StudentsList() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [drawer, setDrawer] = useState(false);
  const [confirm, setConfirm] = useState<{ id: number; name: string; next: 'Active' | 'Inactive' } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['students', search, status, page, pageSize],
    queryFn: () =>
      api.get('/students', { params: { search, status, page, limit: pageSize } }).then((r) => r.data),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<any>({
    defaultValues: { status: 'Active', fees_received: '0' },
  });
  const [familyError, setFamilyError] = useState('');
  const create = useMutation({
    mutationFn: (body: any) =>
      api.post('/students', {
        ...body,
        age: body.age ? Number(body.age) : null,
        fees_received: body.fees_received ? Number(body.fees_received) : 0,
      }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['students'] });
      // The form number is assigned by the server, so this is where it is seen.
      toast(`Student added — Form ${r.data.form_no}`);
      setDrawer(false);
      setFamilyError('');
      reset();
    },
  });
  // Same family rule as the profile form: at least one contact, each with a number.
  const onCreate = (b: any) => {
    const fe = familyProblem(b);
    setFamilyError(fe);
    if (!fe) create.mutate(b);
  };
  // Every field is required except Extra Mobile; family is checked as a set by
  // familyProblem rather than field by field.
  // Called as a plain function, not rendered as a component: one declared inside
  // this component is a new type on every render, so React would rebuild the
  // input — and drop the cursor — each time validation re-renders the form.
  const field = (name: string, label: string, { type = 'text', required = true, rules = {} }: any = {}) => (
    <div key={name}>
      <label className="text-xs font-medium muted">{label}{required && ' *'}</label>
      <input className="input mt-1" type={type} autoComplete="off"
        {...register(name, { ...(required ? { required: 'Required' } : {}), ...rules })} />
      {errors[name] && <span className="text-xs text-red-500">{String((errors[name] as any)?.message || 'Required')}</span>}
    </div>
  );

  const setStatus_ = useMutation({
    mutationFn: (v: { id: number; status: 'Active' | 'Inactive' }) => api.post(`/students/${v.id}/set-status`, { status: v.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['students'] }),
  });

  const total = data?.total || 0;
  const pages = Math.ceil(total / pageSize) || 1;

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
            <Pagination
              page={page} pages={pages} total={total} noun="students"
              pageSize={pageSize} onPage={setPage} onPageSize={setPageSize}
            />
          </>
        )}
      </Section>

      {/* Drawer form */}
      {drawer && (
        <Overlay onClose={() => setDrawer(false)}>
          <div className="w-full max-w-md h-full p-6 overflow-y-auto" style={{ background: 'var(--color-card)' }} onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Add Student</h2>
            <p className="muted text-xs mb-4">The form number is assigned automatically when you save.</p>
            <form onSubmit={handleSubmit(onCreate)} className="space-y-3">
              {field('first_name', 'First Name')}
              {field('middle_name', 'Middle Name')}
              {field('last_name', 'Last Name')}
              {field('year_grade', 'Year / Grade')}
              {field('school_name', 'School')}
              {field('exam_board', 'Exam Board')}
              {field('age', 'Age', { type: 'number' })}
              <div>
                <label className="text-xs font-medium muted">Gender *</label>
                <select className="input mt-1" {...register('gender', { required: 'Required' })}>
                  <option value="">—</option>
                  <option>Male</option><option>Female</option><option>Other</option>
                </select>
                {errors.gender && <span className="text-xs text-red-500">Required</span>}
              </div>
              {field('nationality', 'Nationality')}

              <div className="pt-2">
                <div className="text-xs font-semibold">Family *</div>
                <div className="muted text-xs mb-2">At least one — father, mother or guardian — with their mobile number.</div>
                <div className="grid grid-cols-2 gap-2">
                  {field('father_name', 'Father Name', { required: false })}
                  {field('father_mobile', 'Father Mobile', { type: 'tel', required: false })}
                  {field('mother_name', 'Mother Name', { required: false })}
                  {field('mother_mobile', 'Mother Mobile', { type: 'tel', required: false })}
                  {field('guardian_name', 'Guardian Name', { required: false })}
                  {field('guardian_mobile', 'Guardian Mobile', { type: 'tel', required: false })}
                </div>
                {familyError && <div className="text-xs text-red-500 font-medium mt-1">{familyError}</div>}
              </div>

              {field('email', 'Student Email', { type: 'email', rules: { pattern: { value: EMAIL_RE, message: 'Enter a valid email' } } })}
              {field('student_mobile', 'Student Mobile', { type: 'tel' })}
              {field('extra_mobile', 'Extra Mobile', { type: 'tel', required: false })}
              {field('fees_received', 'Fees Received (AED)', { type: 'number' })}
              <div>
                <label className="text-xs font-medium muted">Status *</label>
                <select className="input mt-1" {...register('status', { required: 'Required' })}>
                  <option>Active</option>
                  <option>Inactive</option>
                </select>
              </div>
              {create.isError && <div className="text-sm text-red-500">{(create.error as any)?.response?.data?.error || 'Could not save the student.'}</div>}
              <div className="flex gap-2 pt-2">
                <button className="btn-primary flex-1" disabled={create.isPending}>Save</button>
                <button type="button" className="btn-ghost" onClick={() => setDrawer(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </Overlay>
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
