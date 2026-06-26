import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api, rs, num } from '../../api/client';
import { Section, Table, Spinner } from '../../components/ui';
import { CalendarPicker, CalendarRangePicker } from '../../components/CalendarPicker';
import { Select } from '../../components/Select';
import { ConfirmModal } from '../../components/ConfirmModal';
import { toast } from '../../components/Toast';
import { parseFeeWorkbook } from '../../lib/excel';

export default function Finance() {
  const qc = useQueryClient();
  const [drawer, setDrawer] = useState(false);
  const [editing, setEditing] = useState<any | null>(null); // tx being edited, or null = new
  const [fromDate, setFromDate] = useState(''); // date-range filter; '' = show all
  const [toDate, setToDate] = useState('');
  const [txSearch, setTxSearch] = useState('');
  const [page, setPage] = useState(1);
  const [importMsg, setImportMsg] = useState('');
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => void } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const tx = useQuery({
    queryKey: ['transactions', txSearch, fromDate, toDate, page],
    queryFn: () => api.get('/fees/transactions', { params: { search: txSearch, from: fromDate || undefined, to: toDate || undefined, page, limit: 20 } }).then((r) => r.data),
  });
  const [studentSearch, setStudentSearch] = useState('');
  const students = useQuery({ queryKey: ['students-pick', studentSearch], queryFn: () => api.get('/students', { params: { search: studentSearch, limit: 50 } }).then((r) => r.data.data) });
  const drafts = useQuery({ queryKey: ['fee-drafts'], queryFn: () => api.get('/fees/drafts').then((r) => r.data.data) });

  const { register, handleSubmit, reset, watch, setValue } = useForm();

  const openAdd = () => { setEditing(null); reset({ student_id: '', amount: '', payment_date: '', payment_source: '', transaction_reference: '', parent_name: '', course_package_hours: '', discount_hours: '', notes: '' }); setDrawer(true); };
  const openEdit = (t: any) => { setEditing(t); reset({ ...t, course_package_hours: t.course_package_hours ?? '', discount_hours: t.discount_hours ?? '' }); setDrawer(true); };
  const closeDrawer = () => { setDrawer(false); setEditing(null); reset(); save.reset(); };

  const save = useMutation({
    mutationFn: (b: any) => {
      const payload = {
        ...b,
        student_id: Number(b.student_id),
        amount: Number(b.amount),
        course_package_hours: b.course_package_hours ? Number(b.course_package_hours) : null,
        discount_hours: b.discount_hours ? Number(b.discount_hours) : null,
      };
      return editing ? api.put(`/fees/transactions/${editing.id}`, payload) : api.post('/fees/transactions', payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      toast(editing ? 'Payment updated' : 'Payment recorded');
      closeDrawer();
    },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not save payment', 'error'),
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/fees/transactions/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transactions'] }); toast('Payment deleted'); },
  });

  const onDelete = (t: any) => setConfirm({
    title: 'Delete payment',
    message: `Delete the ${rs(t.amount)} payment from ${t.student_name} on ${t.payment_date}? This cannot be undone.`,
    confirmLabel: 'Delete',
    onConfirm: () => del.mutate(t.id),
  });

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['fee-drafts'] });
      toast('Payment assigned to student');
    },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not assign payment', 'error'),
  });
  const discard = useMutation({
    mutationFn: (id: number) => api.delete(`/fees/drafts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fee-drafts'] }),
  });

  const draftList = drafts.data || [];

  // Transactions are filtered + paginated server-side (search, from, to, page).
  const visibleTx = tx.data?.data || [];
  const txTotal = tx.data?.total || 0;
  const txPages = Math.ceil(txTotal / 20) || 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Finance Tracker</h1>
        <div className="flex items-center gap-2">
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
              <p className="muted text-sm mb-3">These rows from your upload couldn't be auto-matched. Pick the student (fix any field if needed), add a note, then assign — or discard.</p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {['Date', 'Transaction', 'Reference', 'Credit', 'Source', 'Assign to student', 'Pkg Hrs', 'Disc Hrs', 'Note', ''].map((h) => <th key={h} className="table-th">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {draftList.map((d: any) => (
                      <DraftRow
                        key={d.id}
                        draft={d}
                        students={students.data || []}
                        onStudentSearch={setStudentSearch}
                        busy={assign.isPending || discard.isPending}
                        onAssign={(payload) => assign.mutate({ id: d.id, payload })}
                        onDiscard={() => setConfirm({ title: 'Discard draft', message: 'Discard this draft row? This cannot be undone.', confirmLabel: 'Discard', onConfirm: () => discard.mutate(d.id) })}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Section>
      )}

      <Section
        title="Fee Transactions (AED)"
        action={
          <div className="flex items-center gap-2">
            <input
              className="input w-[220px]"
              placeholder="Search payments…"
              value={txSearch}
              onChange={(e) => { setTxSearch(e.target.value); setPage(1); }}
            />
            <CalendarRangePicker
              from={fromDate}
              to={toDate}
              onChange={(f, t) => { setFromDate(f); setToDate(t); setPage(1); }}
              placeholder="Filter by date / month"
              align="right"
            />
            {(fromDate || toDate || txSearch) && (
              <button className="btn-ghost !py-1.5 !px-3 text-sm whitespace-nowrap" onClick={() => { setFromDate(''); setToDate(''); setTxSearch(''); setPage(1); }}>
                Show all
              </button>
            )}
          </div>
        }
      >
        {tx.isLoading ? <Spinner /> : (visibleTx.length === 0 ? (
          <p className="muted text-sm">No payments recorded{fromDate || toDate || txSearch ? ' for this filter' : ''}.</p>
        ) : (
          <Table head={['Date', 'Form', 'Student', { label: 'Amount (AED)', align: 'right' }, 'Source', 'Reference', 'Parent', { label: 'Pkg Hrs', align: 'right' }, { label: 'Disc Hrs', align: 'right' }, 'Notes', '']}>
            {visibleTx.map((t: any) => (
              <tr key={t.id}>
                <td className="table-td whitespace-nowrap">{t.payment_date}</td>
                <td className="table-td font-mono">{t.form_no}</td>
                <td className="table-td font-medium">{t.student_name}</td>
                <td className="table-td text-right font-semibold text-emerald-600">{num(t.amount)}</td>
                <td className="table-td">{t.payment_source || '—'}</td>
                <td className="table-td font-mono text-xs">{t.transaction_reference || '—'}</td>
                <td className="table-td">{t.parent_name || '—'}</td>
                <td className="table-td text-right">{t.course_package_hours ?? '—'}</td>
                <td className="table-td text-right">{t.discount_hours ?? '—'}</td>
                <td className="table-td max-w-[200px] truncate" title={t.notes}>{t.notes || '—'}</td>
                <td className="table-td">
                  <div className="flex gap-1.5 whitespace-nowrap">
                    <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => openEdit(t)}>Edit</button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        ))}
        {!tx.isLoading && visibleTx.length > 0 && (
          <div className="flex items-center justify-between mt-3 text-sm">
            <span className="muted">Page {page} / {txPages} · {txTotal} payments</span>
            <div className="flex gap-2">
              <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
              <button className="btn-ghost" disabled={page >= txPages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </div>
        )}
      </Section>

      {drawer && (
        <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={closeDrawer}>
          <div className="w-full max-w-md h-full p-6 overflow-y-auto" style={{ background: 'var(--color-card)' }} onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">{editing ? 'Edit Payment' : 'Record Payment'}</h2>
            <form onSubmit={handleSubmit((b) => save.mutate(b))} className="space-y-3">
              <div>
                <label className="text-xs font-medium muted block mb-1">Student *</label>
                <input type="hidden" {...register('student_id', { required: true })} />
                <Select
                  value={watch('student_id') || ''}
                  onChange={(v) => setValue('student_id', v, { shouldValidate: true })}
                  options={(students.data || []).map((s: any) => ({ value: s.id, label: `${s.form_no} — ${s.full_name}` }))}
                  onSearch={setStudentSearch}
                  placeholder="Search student…"
                />
              </div>
              <div>
                <label className="text-xs font-medium muted">Amount (AED) *</label>
                <input className="input mt-1" type="number" step="0.01" {...register('amount', { required: true })} />
              </div>
              <div>
                <label className="text-xs font-medium muted block mb-1">Payment Date *</label>
                <input type="hidden" {...register('payment_date', { required: true })} />
                <CalendarPicker
                  value={watch('payment_date') || ''}
                  onChange={(d) => setValue('payment_date', d, { shouldValidate: true })}
                  placeholder="Select payment date"
                />
              </div>
              {[
                ['payment_source', 'Payment Source'],
                ['transaction_reference', 'Transaction Reference'],
                ['parent_name', 'Parent Name'],
                ['course_package_hours', 'Course Package Hours'],
                ['discount_hours', 'Discount Hours'],
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

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          danger
          onConfirm={() => { confirm.onConfirm(); setConfirm(null); }}
          onClose={() => setConfirm(null)}
        />
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
  onStudentSearch,
}: {
  draft: any;
  students: any[];
  busy: boolean;
  onAssign: (payload: any) => void;
  onDiscard: () => void;
  onStudentSearch: (q: string) => void;
}) {
  const [studentId, setStudentId] = useState<string>(draft.student_id ? String(draft.student_id) : '');
  const [pkgHours, setPkgHours] = useState<string>(draft.course_package_hours != null ? String(draft.course_package_hours) : '');
  const [discHours, setDiscHours] = useState<string>(draft.discount_hours != null ? String(draft.discount_hours) : '');
  const [note, setNote] = useState<string>('');

  // Imported fields are locked — only student / hours / note are editable.
  const amount = draft.amount != null ? String(draft.amount) : '';
  const date = draft.payment_date ? String(draft.payment_date).slice(0, 10) : '';
  const reference = draft.transaction_reference || '';
  const source = draft.payment_source || '';

  const transaction = draft.notes || draft.guessed_student_name || '—';
  const canAssign = studentId && Number(amount) > 0 && date;

  return (
    <tr>
      <td className="table-td whitespace-nowrap text-sm">{date || '—'}</td>
      <td className="table-td max-w-[260px]">
        <div className="text-xs whitespace-pre-wrap break-words" title={transaction}>{transaction}</div>
      </td>
      <td className="table-td font-mono text-xs">{reference || '—'}</td>
      <td className="table-td text-sm">{amount || '—'}</td>
      <td className="table-td text-sm">{source || '—'}</td>
      <td className="table-td min-w-[220px]">
        <Select
          value={studentId}
          onChange={setStudentId}
          options={students.map((s: any) => ({ value: s.id, label: `${s.form_no} — ${s.full_name}` }))}
          onSearch={onStudentSearch}
          placeholder="Search student…"
        />
      </td>
      <td className="table-td"><input className="input !py-1 w-24" type="number" step="0.01" value={pkgHours} onChange={(e) => setPkgHours(e.target.value)} placeholder="0" /></td>
      <td className="table-td"><input className="input !py-1 w-24" type="number" step="0.01" value={discHours} onChange={(e) => setDiscHours(e.target.value)} placeholder="0" /></td>
      <td className="table-td"><input className="input !py-1 w-40" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add note…" /></td>
      <td className="table-td">
        <div className="flex gap-1.5 whitespace-nowrap">
          <button
            className="btn-primary !py-1 !px-2.5 text-xs"
            disabled={!canAssign || busy}
            onClick={() => onAssign({
              student_id: Number(studentId),
              amount: Number(amount),
              payment_date: date,
              transaction_reference: reference || null,
              payment_source: source || null,
              course_package_hours: pkgHours ? Number(pkgHours) : null,
              discount_hours: discHours ? Number(discHours) : null,
              notes: [transaction !== '—' ? transaction : '', note].filter(Boolean).join(' — ') || null,
            })}
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
