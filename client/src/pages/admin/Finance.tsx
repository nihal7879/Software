import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api, rs } from '../../api/client';
import { Section, Table, Spinner } from '../../components/ui';
import { MonthSelector } from '../../components/MonthSelector';
import { parseFeeWorkbook } from '../../lib/excel';

export default function Finance() {
  const qc = useQueryClient();
  const [drawer, setDrawer] = useState(false);
  const [editing, setEditing] = useState<any | null>(null); // tx being edited, or null = new
  const [month, setMonth] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [draftsOpen, setDraftsOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const tx = useQuery({ queryKey: ['transactions', month], queryFn: () => api.get('/fees/transactions', { params: { month } }).then((r) => r.data.data) });
  const students = useQuery({ queryKey: ['students-all'], queryFn: () => api.get('/students', { params: { limit: 100 } }).then((r) => r.data.data) });
  const drafts = useQuery({ queryKey: ['fee-drafts'], queryFn: () => api.get('/fees/drafts').then((r) => r.data.data) });

  const { register, handleSubmit, reset } = useForm();

  const openAdd = () => { setEditing(null); reset({ student_id: '', amount: '', payment_date: '', payment_source: '', transaction_reference: '', parent_name: '', course_package_hours: '', notes: '' }); setDrawer(true); };
  const openEdit = (t: any) => { setEditing(t); reset({ ...t, course_package_hours: t.course_package_hours ?? '' }); setDrawer(true); };
  const closeDrawer = () => { setDrawer(false); setEditing(null); reset(); save.reset(); };

  const save = useMutation({
    mutationFn: (b: any) => {
      const payload = {
        ...b,
        student_id: Number(b.student_id),
        amount: Number(b.amount),
        course_package_hours: b.course_package_hours ? Number(b.course_package_hours) : null,
      };
      return editing ? api.put(`/fees/transactions/${editing.id}`, payload) : api.post('/fees/transactions', payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transactions'] }); closeDrawer(); },
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/fees/transactions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions'] }),
  });

  const onDelete = (t: any) => {
    if (window.confirm(`Delete the ${rs(t.amount)} payment from ${t.student_name} on ${t.payment_date}? This cannot be undone.`)) {
      del.mutate(t.id);
    }
  };

  // ---- Excel import -------------------------------------------------------
  const importMut = useMutation({
    mutationFn: async (file: File) => {
      const rows = await parseFeeWorkbook(file);
      if (rows.length === 0) throw new Error('No rows found in the sheet.');
      return api.post('/fees/import', { rows }).then((r) => r.data);
    },
    onSuccess: (r) => {
      setImportMsg(`Imported ${r.imported} payment(s); ${r.drafted} sent to drafts (of ${r.total} rows).`);
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['fee-drafts'] });
    },
    onError: (e: any) => setImportMsg(e?.response?.data?.error || e?.message || 'Import failed.'),
  });

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setImportMsg(''); importMut.mutate(f); }
    if (fileRef.current) fileRef.current.value = ''; // allow re-uploading the same file
  };

  const assign = useMutation({
    mutationFn: (b: { id: number; payload: any }) => api.post(`/fees/drafts/${b.id}/assign`, b.payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transactions'] }); qc.invalidateQueries({ queryKey: ['fee-drafts'] }); },
  });
  const discard = useMutation({
    mutationFn: (id: number) => api.delete(`/fees/drafts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fee-drafts'] }),
  });

  const draftList = drafts.data || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Finance Tracker</h1>
        <div className="flex items-center gap-2">
          <MonthSelector value={month} onChange={setMonth} />
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
          <button className="btn-ghost" onClick={() => fileRef.current?.click()} disabled={importMut.isPending}>
            {importMut.isPending ? 'Importing…' : '⬆ Import Excel'}
          </button>
          <button className="btn-primary" onClick={openAdd}>+ Record Payment</button>
        </div>
      </div>

      {importMsg && (
        <div className="card p-3 text-sm flex items-center justify-between gap-3">
          <span>{importMsg}</span>
          <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => setImportMsg('')}>Dismiss</button>
        </div>
      )}

      {/* Drafts queue — collapsible. Unmatched / incomplete imported rows. */}
      {draftList.length > 0 && (
        <Section
          title={`Drafts — ${draftList.length} row(s) need a student assigned`}
          action={
            <button className="btn-ghost !py-1 !px-3 text-xs flex items-center gap-1" onClick={() => setDraftsOpen((o) => !o)}>
              {draftsOpen ? 'Hide ▲' : 'Show ▼'}
            </button>
          }
        >
          {draftsOpen && (
            <>
              <p className="muted text-sm mb-3">These rows from your upload couldn't be auto-matched. Pick the student (fix amount/date if needed) and assign, or discard.</p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {['From sheet', 'Reason', 'Amount', 'Date', 'Assign to student', ''].map((h) => <th key={h} className="table-th">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {draftList.map((d: any) => (
                      <DraftRow
                        key={d.id}
                        draft={d}
                        students={students.data || []}
                        busy={assign.isPending || discard.isPending}
                        onAssign={(payload) => assign.mutate({ id: d.id, payload })}
                        onDiscard={() => { if (window.confirm('Discard this draft row?')) discard.mutate(d.id); }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Section>
      )}

      <Section title={`Fee Transactions (₹)${month ? ` · ${month}` : ''}`}>
        {tx.isLoading ? <Spinner /> : (tx.data || []).length === 0 ? (
          <p className="muted text-sm">No payments recorded{month ? ' for this month' : ''}.</p>
        ) : (
          <Table head={['Date', 'Form', 'Student', 'Amount', 'Source', 'Reference', 'Parent', 'Pkg Hrs', 'Notes', '']}>
            {tx.data.map((t: any) => (
              <tr key={t.id}>
                <td className="table-td whitespace-nowrap">{t.payment_date}</td>
                <td className="table-td font-mono">{t.form_no}</td>
                <td className="table-td font-medium">{t.student_name}</td>
                <td className="table-td font-semibold text-emerald-600">{rs(t.amount)}</td>
                <td className="table-td">{t.payment_source || '—'}</td>
                <td className="table-td font-mono text-xs">{t.transaction_reference || '—'}</td>
                <td className="table-td">{t.parent_name || '—'}</td>
                <td className="table-td">{t.course_package_hours ?? '—'}</td>
                <td className="table-td max-w-[200px] truncate" title={t.notes}>{t.notes || '—'}</td>
                <td className="table-td">
                  <div className="flex gap-1.5 whitespace-nowrap">
                    <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => openEdit(t)}>Edit</button>
                    <button
                      className="!py-1 !px-2.5 text-xs rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                      onClick={() => onDelete(t)}
                      disabled={del.isPending}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {drawer && (
        <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={closeDrawer}>
          <div className="w-full max-w-md h-full p-6 overflow-y-auto" style={{ background: 'var(--color-card)' }} onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">{editing ? 'Edit Payment' : 'Record Payment'}</h2>
            <form onSubmit={handleSubmit((b) => save.mutate(b))} className="space-y-3">
              <div>
                <label className="text-xs font-medium muted">Student *</label>
                <select className="input mt-1" {...register('student_id', { required: true })}>
                  <option value="">Select…</option>
                  {students.data?.map((s: any) => <option key={s.id} value={s.id}>{s.form_no} — {s.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium muted">Amount (₹) *</label>
                <input className="input mt-1" type="number" step="0.01" {...register('amount', { required: true })} />
              </div>
              <div>
                <label className="text-xs font-medium muted">Payment Date *</label>
                <input className="input mt-1" type="date" {...register('payment_date', { required: true })} />
              </div>
              {[
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
              {save.isError && <div className="text-sm text-red-500">Could not save — please check the fields.</div>}
              <div className="flex gap-2 pt-2">
                <button className="btn-primary flex-1" disabled={save.isPending}>{save.isPending ? 'Saving…' : editing ? 'Update' : 'Save'}</button>
                <button type="button" className="btn-ghost" onClick={closeDrawer}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// One editable draft row: pick student, fix amount/date, then assign or discard.
function DraftRow({
  draft,
  students,
  busy,
  onAssign,
  onDiscard,
}: {
  draft: any;
  students: any[];
  busy: boolean;
  onAssign: (payload: any) => void;
  onDiscard: () => void;
}) {
  const [studentId, setStudentId] = useState<string>(draft.student_id ? String(draft.student_id) : '');
  const [amount, setAmount] = useState<string>(draft.amount != null ? String(draft.amount) : '');
  const [date, setDate] = useState<string>(draft.payment_date ? String(draft.payment_date).slice(0, 10) : '');

  const canAssign = studentId && Number(amount) > 0 && date;

  return (
    <tr>
      <td className="table-td">
        <div className="font-medium">{draft.guessed_student_name || draft.matched_student_name || '—'}</div>
        <div className="text-xs muted">{draft.guessed_form_no ? `Form ${draft.guessed_form_no}` : 'No form no'}{draft.payment_source ? ` · ${draft.payment_source}` : ''}</div>
      </td>
      <td className="table-td"><span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 whitespace-nowrap">{draft.reason}</span></td>
      <td className="table-td"><input className="input !py-1 w-24" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></td>
      <td className="table-td"><input className="input !py-1 w-36" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></td>
      <td className="table-td">
        <select className="input !py-1 min-w-[200px]" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          <option value="">Select student…</option>
          {students.map((s: any) => <option key={s.id} value={s.id}>{s.form_no} — {s.full_name}</option>)}
        </select>
      </td>
      <td className="table-td">
        <div className="flex gap-1.5 whitespace-nowrap">
          <button
            className="btn-primary !py-1 !px-2.5 text-xs"
            disabled={!canAssign || busy}
            onClick={() => onAssign({ student_id: Number(studentId), amount: Number(amount), payment_date: date })}
          >
            Assign
          </button>
          <button
            className="!py-1 !px-2.5 text-xs rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            disabled={busy}
            onClick={onDiscard}
          >
            Discard
          </button>
        </div>
      </td>
    </tr>
  );
}
