import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api } from '../../api/client';
import { Section, Spinner } from '../../components/ui';
import { Select } from '../../components/Select';
import { TimePicker } from '../../components/TimePicker';
import { CalendarPicker } from '../../components/CalendarPicker';

// Faculty creates a lecture record. Supports group lectures (multiple attendees).
// Duration auto-calculates server-side from Time In / Time Out.
export default function LectureEntry() {
  const qc = useQueryClient();
  const [attendees, setAttendees] = useState<number[]>([]);
  const [msg, setMsg] = useState('');

  // Only MY students can be attendees; teacher is forced to me server-side.
  const me = useQuery({ queryKey: ['teacher-me'], queryFn: () => api.get('/teachers/me').then((r) => r.data) });
  const students = useQuery({ queryKey: ['me-students'], queryFn: () => api.get('/teachers/me/students').then((r) => r.data.data) });
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/teachers/subjects').then((r) => r.data.data) });

  const { register, handleSubmit, reset, watch, setValue } = useForm<any>({ defaultValues: { venue: 'JLT' } });
  const create = useMutation({
    mutationFn: (b: any) => api.post('/lectures', {
      session_date: b.session_date,
      subject_id: b.subject_id ? Number(b.subject_id) : null,
      time_in: b.time_in || null,
      time_out: b.time_out || null,
      topic: b.topic || null,
      subtopic: b.subtopic || null,
      remark: b.remark || null,
      venue: b.venue,
      meeting_link: b.meeting_link || null,
      attendees: attendees.map((id) => ({ student_id: id })),
    }),
    onSuccess: (r) => {
      setMsg(`✅ Lecture saved — ${r.data.total_hours}h consumed by ${attendees.length} student(s).`);
      qc.invalidateQueries({ queryKey: ['ledger'] });
      reset(); setAttendees([]);
    },
  });

  const toggle = (id: number) => setAttendees((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold">Lecture Entry</h1>
      <p className="muted text-sm">
        Logged as <b>{me.data?.name || 'teacher'}</b> — this lecture is recorded under you.
        Duration auto-calculates from Time In/Out. Select multiple of your students for a group lecture.
      </p>

      {msg && <div className="card p-3 text-sm text-emerald-600">{msg}</div>}

      <Section title="New lecture">
        <form onSubmit={handleSubmit((b) => { if (!attendees.length) { setMsg('⚠️ Select at least one student.'); return; } create.mutate(b); })} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium muted block mb-1">Date *</label>
              <input type="hidden" {...register('session_date', { required: true })} />
              <CalendarPicker
                value={watch('session_date') || ''}
                onChange={(v) => setValue('session_date', v, { shouldValidate: true })}
                placeholder="Select date…"
              />
            </div>
            <div>
              <label className="text-xs font-medium muted block mb-1">Venue</label>
              <input type="hidden" {...register('venue')} />
              <Select
                value={watch('venue') || ''}
                onChange={(v) => setValue('venue', v)}
                options={['JLT', 'Oud Metha', 'Online'].map((v) => ({ value: v, label: v }))}
                placeholder="Select venue…"
                allowCustom
              />
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
            <div className="sm:col-span-2">
              <label className="text-xs font-medium muted block mb-1">Subject</label>
              <input type="hidden" {...register('subject_id')} />
              <Select
                value={watch('subject_id') || ''}
                onChange={(v) => setValue('subject_id', v)}
                options={(subjects.data || []).map((s: any) => ({ value: s.id, label: s.name }))}
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

          <div>
            <label className="text-xs font-medium muted">My students — attendees ({attendees.length} selected)</label>
            <div className="card p-2 mt-1 max-h-48 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1">
              {students.isLoading ? <Spinner /> : (students.data || []).length === 0 ? (
                <div className="muted text-sm p-2">No students assigned to you yet. Your admin will assign students to you.</div>
              ) : students.data.map((s: any) => (
                <label key={s.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer">
                  <input type="checkbox" checked={attendees.includes(s.id)} onChange={() => toggle(s.id)} />
                  <span className="font-mono text-xs">{s.form_no}</span> {s.full_name}
                </label>
              ))}
            </div>
          </div>

          <button className="btn-primary w-full" disabled={create.isPending}>Save Lecture</button>
        </form>
      </Section>
    </div>
  );
}
