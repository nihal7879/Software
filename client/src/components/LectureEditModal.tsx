import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api } from '../api/client';
import { useMasters } from '../api/masters';
import { Overlay } from './Overlay';
import { Select } from './Select';
import { TimePicker } from './TimePicker';
import { CalendarPicker } from './CalendarPicker';
import { toast } from './Toast';

// Corrects an already-logged lecture: the wrong date, a mistyped time, the wrong
// teacher or topic. Attendees are not editable here — changing who was in the
// room is a different action from fixing what was typed about it.
//
// Changing the times re-derives the duration server-side, and every attendee's
// consumed hours follow it, so the student's ledger stays honest.
export function LectureEditModal({
  lecture,
  onClose,
  onSaved,
}: {
  /** A row from the lecture log; needs lecture_id, and whatever fields it has. */
  lecture: any;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const masters = useMasters();
  const teachers = useQuery({ queryKey: ['teachers'], queryFn: () => api.get('/teachers').then((r) => r.data.data) });
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/teachers/subjects').then((r) => r.data.data) });

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
      for (const k of ['student-report', 'lectures', 'ledger', 'ledger-all', 'workload', 'me-lectures', 'overview', 'trend', 'pivot']) {
        qc.invalidateQueries({ queryKey: [k] });
      }
      onSaved?.();
      onClose();
    },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not update the lecture', 'error'),
  });

  return (
    <Overlay onClose={onClose}>
      <div className="w-full max-w-xl h-full p-6 overflow-y-auto" style={{ background: 'var(--color-card)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold">Edit Lecture</h2>
          <button className="btn-ghost !py-1 !px-2.5 text-sm" onClick={onClose}>Close</button>
        </div>
        <p className="muted text-sm mb-4">
          Duration is recalculated from Time In / Out, and the attendees' hours follow it.
        </p>

        <form onSubmit={handleSubmit((b) => save.mutate(b))} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium muted block mb-1">Date *</label>
              <input type="hidden" {...register('session_date', { required: true })} />
              <CalendarPicker value={watch('session_date') || ''} onChange={(v) => setValue('session_date', v, { shouldValidate: true })} placeholder="Select date…" />
            </div>
            <div>
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
            <div>
              <label className="text-xs font-medium muted block mb-1">Teacher</label>
              <input type="hidden" {...register('teacher_id')} />
              <Select
                value={watch('teacher_id') || ''}
                onChange={(v) => setValue('teacher_id', v)}
                options={(teachers.data || []).map((t: any) => ({ value: String(t.id), label: t.name }))}
                placeholder="Select teacher…"
              />
            </div>
            <div>
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
            <label className="text-xs font-medium muted">Remark</label>
            <input className="input mt-1" {...register('remark')} placeholder="e.g. Completed, revision needed" />
          </div>
          <div>
            <label className="text-xs font-medium muted">Meeting / Recording Link</label>
            <input className="input mt-1" {...register('meeting_link')} placeholder="Google Meet / Zoom URL" />
          </div>

          <div className="flex gap-2 pt-1">
            <button className="btn-primary flex-1" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save changes'}</button>
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </Overlay>
  );
}
