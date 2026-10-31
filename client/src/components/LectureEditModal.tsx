import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { X } from 'lucide-react';
import { DictateButton } from './DictateButton';
import { api } from '../api/client';
import { useMasters } from '../api/masters';
import { Overlay } from './Overlay';
import { Select } from './Select';
import { TimePicker } from './TimePicker';
import { CalendarPicker } from './CalendarPicker';
import { toast } from './Toast';
import { useWide } from './ui';
import { BillableToggle, notBillable, NOT_BILLABLE_ROW } from './BillableToggle';
import { useAuth } from '../auth/AuthContext';

// Corrects an already-logged lecture: the wrong date, a mistyped time, the wrong
// teacher or topic — who was in the room, when someone was missed off the list
// or recorded by mistake, and whether each of them is being charged for it.
//
// Changing the times re-derives the duration server-side, and every attendee's
// consumed hours follow it, so the student's ledger stays honest. Adding or
// removing a student takes effect immediately, since it moves their hours, and
// so does changing the charge — for the same reason.
export function LectureEditModal({
  lecture,
  attendees,
  roster,
  onClose,
  onSaved,
}: {
  /** A row from the lecture log; needs lecture_id, and whatever fields it has. */
  lecture: any;
  /**
   * Who is on it now. Given, the students can be added and removed here; left
   * out, they are fetched read-only so the charge can still be corrected.
   */
  attendees?: { id: number; name: string; is_billable?: number | boolean | null }[];
  /** Students who may be added — the teacher's own, assigned and active. */
  roster?: { id: number; full_name: string; form_no?: string | number }[];
  onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  /**
   * A teacher does not choose the teacher.
   *
   * Whose lecture this is was settled when it was recorded — by the QR code on
   * their own desk, or by them logging it. Offering a teacher a list of every
   * teacher in the institute asks a question with one possible answer, and a
   * list that long is also how a lecture ended up belonging to nobody: the box
   * showed blank, and saving wrote the blank down.
   *
   * The office keeps the list, because correcting a class logged against the
   * wrong teacher is a real job and theirs to do.
   */
  const { user } = useAuth();
  const mayChangeTeacher = user?.role === 'admin' || user?.role === 'superadmin';
  const [addSearch, setAddSearch] = useState('');
  const [attendeeError, setAttendeeError] = useState('');
  // What the toggle has been set to in this window. The caller handed us a
  // snapshot of the class and does not necessarily re-read it, so the screen
  // would otherwise show the old answer until the window was closed.
  const [charged, setCharged] = useState<Record<number, boolean>>({});
  // Taking off the only student would leave a lecture with nobody on it, which
  // the server refuses. Rather than a cross that does nothing, pressing it asks
  // the question that was really being asked: should the lecture go?
  const [lastOne, setLastOne] = useState<{ id: number; name: string; hours: number } | null>(null);
  const wide = useWide();
  const masters = useMasters();
  const teachers = useQuery({ queryKey: ['teachers'], queryFn: () => api.get('/teachers').then((r) => r.data.data) });
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/teachers/subjects').then((r) => r.data.data) });

  // Everything that reads hours has to be told, because a student joining or
  // leaving a lecture moves hours on their ledger straight away.
  const refresh = () => {
    ['ledger', 'ledger-all', 'lectures', 'teacher-lectures', 'student-report', 'workload', 'pkg']
      .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    // The window reads the class for itself when the caller had only the
    // lecture, so that list has to be told as well or it shows the old names.
    qc.invalidateQueries({ queryKey: ['lecture-attendees', lecture.lecture_id] });
  };

  const addStudent = useMutation({
    mutationFn: (id: number) => api.post(`/lectures/${lecture.lecture_id}/attendees`, { student_id: id }),
    // The window stays open and the list below re-reads itself. It used to
    // close on every change, which made taking one student off a class of two
    // look as though nothing had happened.
    onSuccess: () => { setAddSearch(''); setAttendeeError(''); refresh(); toast('Student added to this lecture'); },
    onError: (e: any) => setAttendeeError(e?.response?.data?.error || 'Could not add the student.'),
  });
  const removeStudent = useMutation({
    mutationFn: (id: number) => api.delete(`/lectures/${lecture.lecture_id}/attendees/${id}`),
    onSuccess: (r: any) => { setAttendeeError(''); refresh(); toast(`Removed — ${r.data.hours_returned}h back to the student`); },
    onError: (e: any) => setAttendeeError(e?.response?.data?.error || 'Could not remove the student.'),
  });

  // Taking the last student off. The server refuses to leave a lecture with
  // nobody on it — and it is right to: such a lecture vanishes from the lecture
  // list, which joins its attendees, while still counting towards the teacher's
  // hours. So the lecture goes with them. Both are soft deletes, and the hours
  // come back because every hours query skips a deleted lecture.
  const deleteLecture = useMutation({
    mutationFn: () => api.delete(`/lectures/${lecture.lecture_id}`),
    onSuccess: () => {
      const who = lastOne;
      setLastOne(null);
      refresh();
      toast(who
        ? `${who.name} removed — ${who.hours}h back, and the empty lecture went with them`
        : 'Lecture deleted');
      onSaved?.();
      onClose();
    },
    onError: (e: any) => {
      setLastOne(null);
      // 403 here means a teacher: they may correct their own class, but taking
      // the last student off removes the lecture, and that is the office's.
      setAttendeeError(
        e?.response?.status === 403
          ? 'Removing the last student removes the lecture, and only the office can do that. Ask them, or add the student who is missing first.'
          : e?.response?.data?.error || 'Could not remove the student.'
      );
    },
  });

  // Charge for this class, or stop charging for it. Saved on the spot, like
  // adding and removing a student, because it moves the student's balance by
  // the length of the lecture the moment it is pressed.
  const setBillable = useMutation({
    mutationFn: (v: { studentId: number; is_billable: boolean }) =>
      api
        .patch(`/lectures/${lecture.lecture_id}/attendees/${v.studentId}/billable`, { is_billable: v.is_billable })
        .then((r) => ({ ...r.data, studentId: v.studentId })),
    onSuccess: (d: any) => {
      setCharged((c) => ({ ...c, [d.studentId]: !!d.is_billable }));
      setAttendeeError('');
      refresh();
      // What moved is said out loud: the balance is the thing people check
      // afterwards, and this is the only moment it can be explained.
      const moved = Math.abs(Number(d.hours_moved) || 0);
      toast(
        d.is_billable
          ? `Now charged${moved ? ` — ${moved}h off the student's balance` : ''}`
          : `Not billable${moved ? ` — ${moved}h back to the student` : ''}`
      );
    },
    onError: (e: any) => setAttendeeError(e?.response?.data?.error || 'Could not change the charge.'),
  });

  // The class is always read for itself, and that reading is what the list
  // shows. The caller hands us a snapshot taken before the window opened, which
  // is good enough to paint immediately but goes stale the moment a student is
  // added or taken off — so it is only the fallback while the read is in
  // flight, or where the read is not allowed.
  const fetched = useQuery({
    queryKey: ['lecture-attendees', lecture.lecture_id],
    queryFn: () => api.get(`/lectures/${lecture.lecture_id}/attendees`).then((r) => r.data.data as any[]),
    enabled: !!lecture.lecture_id,
  });

  const people = fetched.data ?? attendees ?? [];
  const mayChangeStudents = !!attendees;
  const isCharged = (a: { id: number; is_billable?: number | boolean | null }) =>
    charged[a.id] ?? !notBillable(a.is_billable);

  // Whoever is on the class now — read from the list, not the caller's
  // snapshot, or a student just added is offered for adding again.
  const onNow = people;
  const term = addSearch.trim().toLowerCase();
  const canAdd = (roster || [])
    .filter((st) => !onNow.some((a) => a.id === st.id))
    .filter((st) => !term || st.full_name?.toLowerCase().includes(term) || String(st.form_no).includes(term));

  // From the lecture row where the screen had it, otherwise from the teachers
  // list by id — the list now returns teacher_id, which is what made the box
  // blank before.
  const teacherName =
    lecture.teacher_name ||
    (teachers.data || []).find((t: any) => String(t.id) === String(lecture.teacher_id))?.name ||
    '';

  const { register, handleSubmit, watch, setValue } = useForm<any>({
    defaultValues: {
      session_date: String(lecture.session_date || '').slice(0, 10),
      teacher_id: lecture.teacher_id ? String(lecture.teacher_id) : '',
      subject_id: lecture.subject_id ? String(lecture.subject_id) : '',
      time_in: lecture.time_in || '',
      time_out: lecture.time_out || '',
      topic: lecture.topic || '',
      subtopic: lecture.subtopic || '',
      remark: lecture.remark || '',
      venue: lecture.venue || '',
      meeting_link: lecture.meeting_link || '',
    },
  });

  const save = useMutation({
    mutationFn: (b: any) => api.put(`/lectures/${lecture.lecture_id}`, {
      session_date: b.session_date,
      teacher_id: b.teacher_id ? Number(b.teacher_id) : null,
      subject_id: b.subject_id ? Number(b.subject_id) : null,
      time_in: b.time_in || null,
      time_out: b.time_out || null,
      topic: b.topic || null,
      subtopic: b.subtopic || null,
      remark: b.remark || null,
      venue: b.venue || null,
      meeting_link: b.meeting_link || null,
    }),
    onSuccess: (r: any) => {
      toast(`Lecture updated — ${r.data.total_hours}h`);
      // The edit can move hours between months and students, so everything that
      // reads a lecture or an hours balance is refetched, not just this log.
      // 'teacher-lectures' is the admin entry sheet's list: left out, reopening
      // the lecture there showed the old date and times until a page refresh.
      for (const k of ['student-report', 'lectures', 'teacher-lectures', 'ledger', 'ledger-all', 'workload', 'me-lectures', 'overview', 'trend', 'pivot']) {
        qc.invalidateQueries({ queryKey: [k] });
      }
      qc.invalidateQueries({ queryKey: ['lecture-attendees', lecture.lecture_id] });
      onSaved?.();
      onClose();
    },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not update the lecture', 'error'),
  });

  return (
    <Overlay onClose={onClose}>
      <div className="w-full max-w-xl h-full p-4 sm:p-6 overflow-y-auto" style={{ background: 'var(--color-card)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold">Edit Lecture</h2>
          <button className="btn-ghost !py-1 !px-2.5 text-sm" onClick={onClose}>Close</button>
        </div>
        <p className="muted text-sm mb-4">
          Duration is recalculated from Time In / Out, and the attendees' hours follow it.
        </p>

        <form onSubmit={handleSubmit((b) => save.mutate(b))} className="m-form space-y-3">
          {/* Phones: times side by side, everything else full width. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="text-xs font-medium muted block mb-1">Date *</label>
              <input type="hidden" {...register('session_date', { required: true })} />
              <CalendarPicker value={watch('session_date') || ''} onChange={(v) => setValue('session_date', v, { shouldValidate: true })} placeholder="Select date…" stretch={!wide} />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="text-xs font-medium muted block mb-1">Venue</label>
              <input type="hidden" {...register('venue')} />
              <Select value={watch('venue') || ''} onChange={(v) => setValue('venue', v)} options={masters.venues.map((v) => ({ value: v, label: v }))} placeholder="Select venue…" allowCustom />
            </div>
            <div>
              <label className="text-xs font-medium muted block mb-1">Time In</label>
              <input type="hidden" {...register('time_in')} />
              <TimePicker value={watch('time_in') || ''} onChange={(v) => setValue('time_in', v)} placeholder="Start time" />
            </div>
            <div>
              <label className="text-xs font-medium muted block mb-1">Time Out</label>
              <input type="hidden" {...register('time_out')} />
              <TimePicker value={watch('time_out') || ''} onChange={(v) => setValue('time_out', v)} placeholder="End time" />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="text-xs font-medium muted block mb-1">Teacher</label>
              <input type="hidden" {...register('teacher_id')} />
              {mayChangeTeacher ? (
                <Select
                  value={watch('teacher_id') || ''}
                  onChange={(v) => setValue('teacher_id', v)}
                  options={(teachers.data || []).map((t: any) => ({ value: String(t.id), label: t.name }))}
                  placeholder="Select teacher…"
                />
              ) : (
                /* Shown, not offered. It still goes back with the form, since
                   the hidden field above carries it. */
                <div
                  className="input flex items-center cursor-default select-none"
                  style={{ background: 'var(--color-card-alt)' }}
                  title="A lecture stays with the teacher who gave it. The office can move it."
                >
                  {teacherName || '—'}
                </div>
              )}
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="text-xs font-medium muted block mb-1">Subject</label>
              <input type="hidden" {...register('subject_id')} />
              <Select
                value={watch('subject_id') || ''}
                onChange={(v) => setValue('subject_id', v)}
                options={(subjects.data || []).map((s: any) => ({ value: String(s.id), label: s.name }))}
                placeholder="Select subject…"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium muted">Topic</label>
              <input className="input mt-1" {...register('topic')} placeholder="e.g. Organic Chemistry" />
            </div>
            <div>
              <label className="text-xs font-medium muted">Subtopic</label>
              <input className="input mt-1" {...register('subtopic')} placeholder="e.g. Alkanes" />
            </div>
          </div>
          <div>
            {/* The remark can be spoken instead of typed — handy right after a
                class, on a phone. What is said is added to what is there. */}
            <label className="text-xs font-medium muted">Remark</label>
            <div className="relative mt-1">
              <input className="input pr-8" {...register('remark')} placeholder="e.g. Completed, revision needed" />
              <span className="absolute right-1.5 top-1/2 -translate-y-1/2">
                <DictateButton icon value={watch('remark')} onChange={(v) => setValue('remark', v)} />
              </span>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium muted">Meeting / Recording Link</label>
            <input className="input mt-1" {...register('meeting_link')} placeholder="Google Meet / Zoom URL" />
          </div>

          {/* Who was in the room, and who is being charged for it. Kept apart
              from the fields above because it saves on the spot: a student
              added, taken off, or stopped being charged moves their hours
              immediately, without waiting for Save changes.

              A row per student rather than a line of chips — the charge is a
              decision about one person, so it has to sit beside the name it
              belongs to and be readable there. */}
          {(mayChangeStudents || people.length > 0) && (
            <div className="border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
              <label className="text-xs font-medium muted block mb-1.5">Students on this lecture</label>
              <div className="space-y-1.5">
                {people.length === 0 && <span className="muted text-sm">Nobody is on this lecture.</span>}
                {people.map((a) => {
                  const billable = isCharged(a);
                  return (
                    <div
                      key={a.id}
                      className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${billable ? '' : NOT_BILLABLE_ROW}`}
                      style={billable ? { background: 'var(--color-card-alt)' } : undefined}
                    >
                      <span className="text-sm flex-1 min-w-0 truncate">{a.name}</span>
                      <BillableToggle
                        compact
                        value={billable}
                        disabled={setBillable.isPending}
                        onChange={(next) => setBillable.mutate({ studentId: a.id, is_billable: next })}
                      />
                      {/* Always live. On the last student it does not remove
                          them — it asks whether the lecture itself should go,
                          which is the only thing that can be meant. */}
                      <button
                        type="button"
                        className="grid place-items-center w-6 h-6 shrink-0 rounded-full text-red-500 hover:bg-red-500/15 transition disabled:opacity-40"
                        title="Take off this lecture — the hours go back"
                        aria-label={`Remove ${a.name}`}
                        disabled={removeStudent.isPending || deleteLecture.isPending}
                        onClick={() =>
                          people.length === 1
                            ? setLastOne({ id: a.id, name: a.name, hours: Number(a.hours_consumed ?? lecture.total_hours) || 0 })
                            : removeStudent.mutate(a.id)
                        }
                      >
                        <X size={12} strokeWidth={2.5} />
                      </button>
                    </div>
                  );
                })}
              </div>

              {roster && (
                <div className="mt-2">
                  <input
                    className="input !py-1.5"
                    placeholder="Add a student who was missed…"
                    value={addSearch}
                    onChange={(e) => setAddSearch(e.target.value)}
                  />
                  {addSearch.trim() && (
                    <div className="card p-1 mt-1 max-h-40 overflow-y-auto thin-scroll" style={{ scrollSnapType: 'y proximity' }}>
                      {canAdd.length === 0 ? (
                        <p className="muted text-sm px-2 py-1.5">No match among this teacher's students.</p>
                      ) : canAdd.map((st) => (
                        <button
                          key={st.id}
                          type="button"
                          className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                          style={{ scrollSnapAlign: 'start' }}
                          disabled={addStudent.isPending}
                          onClick={() => addStudent.mutate(st.id)}
                        >
                          {st.full_name} <span className="muted text-xs">{st.form_no}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {/* Asked here rather than in a dialog of its own: the row it is
                  about is directly above, and this is a bigger thing than the
                  cross looks like. */}
              {lastOne && (
                <div className="mt-2 rounded-md p-2.5 text-sm" style={{ background: 'var(--color-card-alt)' }}>
                  <p>
                    Remove <span className="font-semibold">{lastOne.name}</span> from this lecture?
                  </p>
                  <p className="muted text-xs mt-1">
                    They are the only student on it, so the lecture is taken off the list with them —
                    a lecture with nobody on it would otherwise sit there counting towards the
                    teacher's hours. {lastOne.hours}h go back to the student, and both stay on the
                    record: nothing is erased.
                  </p>
                  {/* Offered to everyone who can open this window. Whether it is
                      allowed is the server's to say — guessing from the role
                      held in the browser got it wrong and left people with
                      nothing but a Close button. If it refuses, it says so
                      below in its own words. */}
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      className="btn-primary !py-1 !px-2.5 text-xs !bg-red-600 hover:!bg-red-700"
                      disabled={deleteLecture.isPending}
                      onClick={() => deleteLecture.mutate()}
                    >
                      {deleteLecture.isPending ? 'Removing…' : 'Remove the student'}
                    </button>
                    <button type="button" className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => setLastOne(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {attendeeError && <p className="text-sm text-red-500 mt-1.5">{attendeeError}</p>}
            </div>
          )}

          {/* Phones: pinned to the bottom so Save is reachable without scrolling back. */}
          <div className="flex gap-2 pt-1 max-lg:sticky max-lg:bottom-0 max-lg:-mx-4 max-lg:px-4 max-lg:py-3 max-lg:border-t max-lg:bg-[var(--color-card)] max-lg:border-[var(--color-border)]">
            <button className="btn-primary flex-1 max-lg:!py-2.5" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save changes'}</button>
            <button type="button" className="btn-ghost max-lg:!py-2.5" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </Overlay>
  );
}














