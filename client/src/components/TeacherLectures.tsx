import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, X } from 'lucide-react';
import { api, hrs, fmtDate } from '../api/client';
import { NOT_BILLABLE_ROW, notBillable } from './BillableToggle';
import { Table, Spinner, Pagination } from './ui';
import { CalendarRangePicker } from './CalendarPicker';
import { ConfirmModal } from './ConfirmModal';
import { LectureEditModal } from './LectureEditModal';
import { toast } from './Toast';

// '16:15:00' → '4:15 PM'
const clock = (t?: string | null) => {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h)) return String(t);
  return `${h % 12 || 12}:${String(m ?? 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

// Everything that reads a lecture or an hours balance — refreshed after any change here.
const LECTURE_VIEWS = ['teacher-lectures', 'teacher-roster', 'workload', 'ledger', 'ledger-all', 'student-report', 'lectures'];

/**
 * Every lecture a teacher has taken, 20 to a page, with the students recorded on
 * each. A lecture can be edited or deleted, and a student who was added but was
 * not actually there can be taken off it — their hours come back straight away.
 */
export function TeacherLectures({ teacherId, teacherName }: { teacherId: number; teacherName: string }) {
  const qc = useQueryClient();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [removing, setRemoving] = useState<{ lecture: any; student: any } | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const refresh = () => { for (const k of LECTURE_VIEWS) qc.invalidateQueries({ queryKey: [k] }); };

  const lectures = useQuery({
    queryKey: ['teacher-lectures', teacherId, from, to, page, pageSize],
    queryFn: () =>
      api.get(`/lectures/by-teacher/${teacherId}`, {
        params: { from: from || undefined, to: to || undefined, page, limit: pageSize },
      }).then((r) => r.data as { data: any[]; page: number; limit: number; total: number; total_hours: number }),
    placeholderData: (prev) => prev, // keep the current page on screen while the next one loads
  });

  // Delete the whole lecture — every student on it gets their hours back.
  const del = useMutation({
    mutationFn: (lectureId: number) => api.delete(`/lectures/${lectureId}`),
    onSuccess: () => {
      toast('Lecture deleted — the hours were returned to its students');
      refresh();
      setDeleting(null);
    },
    onError: (e: any) => {
      toast(e?.response?.data?.error || 'Could not delete the lecture', 'error');
      setDeleting(null);
    },
  });

  // Charge for one student's place on a lecture, or stop charging for it.
  //
  // The teacher chooses when they record the class, but this is the thing that
  // gets noticed later — "that was the make-up for the one I cancelled". Here
  // it is one click per student, and the toast says which way the hours went so
  // nobody has to go and check the balance to see what happened.
  const setBillable = useMutation({
    mutationFn: (v: { lectureId: number; studentId: number; is_billable: boolean }) =>
      api.patch(`/lectures/${v.lectureId}/attendees/${v.studentId}/billable`, { is_billable: v.is_billable })
        .then((r) => r.data),
    onSuccess: (r: any, v) => {
      const who = rows.flatMap((l: any) => l.students || [])
        .find((s: any) => s.student_id === v.studentId)?.full_name || 'The student';
      toast(
        v.is_billable
          ? `${who} is charged for this lecture — ${hrs(Math.abs(r.hours_moved))} taken`
          : `${who} is not charged for this lecture — ${hrs(Math.abs(r.hours_moved))} given back`
      );
      refresh();
    },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not change that', 'error'),
  });

  const remove = useMutation({
    mutationFn: (v: { lectureId: number; studentId: number }) =>
      api.delete(`/lectures/${v.lectureId}/attendees/${v.studentId}`).then((r) => r.data),
    onSuccess: (r: any, v) => {
      const who = removing?.student?.full_name || 'Student';
      toast(`${who} removed from the lecture — ${hrs(r.hours_returned)} returned`);
      // The lecture list, this teacher's figures, and the student's hours all moved.
      refresh();
      void v;
      setRemoving(null);
    },
    onError: (e: any) => {
      toast(e?.response?.data?.error || 'Could not remove the student', 'error');
      setRemoving(null);
    },
  });

  const rows = lectures.data?.data || [];
  // Totals for every lecture in the filter, not just this page.
  const total = lectures.data?.total ?? 0;
  const totalHours = lectures.data?.total_hours ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-sm muted tabular-nums">
          {lectures.isLoading ? 'Loading…' : `${total} lecture${total === 1 ? '' : 's'} · ${hrs(totalHours)}`}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <CalendarRangePicker
            from={from}
            to={to}
            onChange={(f, t) => { setFrom(f); setTo(t); setPage(1); }}
            placeholder="Filter by date / month"
            align="right"
          />
          {(from || to) && (
            <button className="btn-ghost !py-1.5 !px-3 text-sm whitespace-nowrap" onClick={() => { setFrom(''); setTo(''); setPage(1); }}>
              Show all
            </button>
          )}
        </div>
      </div>

      {lectures.isLoading ? <Spinner /> : rows.length === 0 ? (
        <p className="muted text-sm">{from || to ? 'No lectures in these dates.' : `${teacherName} has no lectures recorded yet.`}</p>
      ) : (
        <>
          <Table head={['Date', 'Time', 'Subject / Topic', { label: 'Hours', align: 'right' }, 'Students on this lecture', '']}>
            {rows.map((l) => (
              <tr key={l.id}
                className={(l.students || []).some((x: any) => notBillable(x.is_billable)) ? NOT_BILLABLE_ROW : undefined}>
                <td className="table-td whitespace-nowrap align-top">{fmtDate(String(l.session_date).slice(0, 10))}</td>
                <td className="table-td whitespace-nowrap align-top tabular-nums text-sm">
                  {l.time_in ? `${clock(l.time_in)} – ${clock(l.time_out)}` : '—'}
                </td>
                <td className="table-td align-top min-w-[160px]">
                  <div className="font-medium text-sm">{l.subject_name || '—'}</div>
                  {(l.topic || l.subtopic) && (
                    <div className="text-xs muted mt-0.5">{[l.topic, l.subtopic].filter(Boolean).join(' · ')}</div>
                  )}
                </td>
                <td className="table-td text-right tabular-nums align-top">{hrs(l.total_hours)}</td>
                <td className="table-td align-top min-w-[260px]">
                  <div className="flex flex-wrap gap-1.5">
                    {l.students.map((s: any) => (
                      <span
                        key={s.student_id}
                        className="inline-flex items-center gap-1 text-xs pl-2 pr-1 py-0.5 rounded-full"
                        style={{ background: 'var(--color-card-alt)' }}
                      >
                        <Link to={`/admin/student/${s.student_id}`} className="hover:underline" title="Open student report">
                          <span className="font-mono muted">{s.form_no}</span> {s.full_name}
                        </Link>
                        {/* One click, both ways: a class charged by mistake, or
                            a class that should not have been charged. */}
                        <button
                          type="button"
                          className={`grid place-items-center w-5 h-5 rounded-full transition ${
                            Number(s.is_billable) === 0
                              ? 'text-amber-600 bg-amber-500/15 hover:bg-amber-500/25'
                              : 'muted hover:bg-[var(--color-card)]'
                          }`}
                          title={Number(s.is_billable) === 0
                            ? `Not billable — click to charge ${s.full_name} ${hrs(s.hours_consumed)} for this lecture`
                            : `Charged ${hrs(s.hours_consumed)} — click to stop charging ${s.full_name} for this lecture`}
                          aria-label={`Charge ${s.full_name} for this lecture`}
                          aria-pressed={Number(s.is_billable) === 0}
                          disabled={setBillable.isPending}
                          onClick={() => setBillable.mutate({
                            lectureId: l.lecture_id ?? l.id,
                            studentId: s.student_id,
                            is_billable: Number(s.is_billable) === 0,
                          })}
                        >
                          <Gift size={12} strokeWidth={2.5} />
                        </button>
                        {/* Every student carries one, the last of them included.
                            Taking the only student off removes the lecture with
                            them — one with nobody on it drops out of the lecture
                            list, which is joined to its attendees, while still
                            counting towards the teacher's hours. The dialog says
                            so before anything happens. */}
                        <button
                          type="button"
                          className="grid place-items-center w-5 h-5 rounded-full text-red-500 hover:bg-red-500/15 transition"
                          title={`Remove ${s.full_name} from this lecture`}
                          aria-label={`Remove ${s.full_name} from this lecture`}
                          onClick={() => setRemoving({ lecture: l, student: s })}
                        >
                          <X size={12} strokeWidth={2.5} />
                        </button>
                      </span>
                    ))}
                  </div>
                </td>
                <td className="table-td align-top whitespace-nowrap">
                  <div className="flex gap-1.5">
                    <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => setEditing(l)}>Edit</button>
                    <button
                      className="!py-1 !px-2.5 text-xs rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 transition-colors"
                      onClick={() => setDeleting(l)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
          <Pagination
            page={page}
            pages={pages}
            total={total}
            noun="lectures"
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={setPageSize}
          />
          <p className="muted text-xs mt-2">
            A lecture's only student cannot be removed on their own — use Delete to remove the whole lecture.
          </p>
        </>
      )}

      {editing && (
        <LectureEditModal
          lecture={editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}

      {deleting && (
        <ConfirmModal
          title="Delete lecture"
          message={`Delete ${teacherName}'s lecture on ${fmtDate(String(deleting.session_date).slice(0, 10))}${deleting.subject_name ? ` (${deleting.subject_name})` : ''}? It has ${deleting.students.length} student${deleting.students.length === 1 ? '' : 's'} — each gets their ${hrs(deleting.total_hours)} back.`}
          confirmLabel="Delete"
          danger
          busy={del.isPending}
          onConfirm={() => del.mutate(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}

      {removing && (
        <ConfirmModal
          title="Remove student from lecture"
          message={
            removing.lecture.students.length === 1
              ? `Remove ${removing.student.full_name} (Form ${removing.student.form_no}) from ${teacherName}'s lecture on ${fmtDate(String(removing.lecture.session_date).slice(0, 10))}? They are the only student on it, so the lecture is removed with them. Their ${hrs(removing.student.hours_consumed)} will be returned, and both stay on the record.`
              : `Remove ${removing.student.full_name} (Form ${removing.student.form_no}) from ${teacherName}'s lecture on ${fmtDate(String(removing.lecture.session_date).slice(0, 10))}? Their ${hrs(removing.student.hours_consumed)} for this lecture will be returned.`
          }
          confirmLabel="Remove"
          danger
          busy={remove.isPending || del.isPending}
          onConfirm={() =>
            removing.lecture.students.length === 1
              ? del.mutate(removing.lecture.id)
              : remove.mutate({ lectureId: removing.lecture.id, studentId: removing.student.student_id })
          }
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}



