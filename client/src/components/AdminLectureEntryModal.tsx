import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api } from '../api/client';
import { Spinner } from './ui';
import { Select } from './Select';
import { TimePicker } from './TimePicker';
import { CalendarPicker } from './CalendarPicker';
import { toast } from './Toast';

// Admin logs a lecture ON BEHALF of a teacher (when the teacher is busy).
// teacher_id is sent explicitly — the server allows admins to set it.
// Attendees are drawn from the students assigned to that teacher.
export function AdminLectureEntryModal({
  teacherId,
  teacherName,
  onClose,
}: {
  teacherId: number;
  teacherName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [attendees, setAttendees] = useState<number[]>([]);
  const [grade, setGrade] = useState('');
  const [stuSearch, setStuSearch] = useState('');
  const [msg, setMsg] = useState('');

  const students = useQuery({
    queryKey: ['teacher-students', teacherId],
    queryFn: () => api.get(`/teachers/${teacherId}/students`).then((r) => r.data.data),
  });
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/teachers/subjects').then((r) => r.data.data) });

  const { register, handleSubmit, reset, watch, setValue } = useForm<any>({ defaultValues: { venue: 'JLT' } });
  const create = useMutation({
    mutationFn: (b: any) => api.post('/lectures', {
      teacher_id: teacherId,
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
      toast(`Lecture saved for ${teacherName} — ${r.data.total_hours}h × ${attendees.length} student(s)`);
      qc.invalidateQueries({ queryKey: ['workload'] });
      qc.invalidateQueries({ queryKey: ['ledger-all'] });
      reset({ venue: 'JLT' });
      setAttendees([]);
      onClose();
    },
    onError: (e: any) => setMsg(e?.response?.data?.error || 'Could not save lecture'),
  });

  const toggle = (id: number) => setAttendees((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  // Grade options come from this teacher's students' grades (from the DB).
  const grades = Array.from(new Set((students.data || []).map((s: any) => s.year_grade).filter(Boolean))).sort();
  const q = stuSearch.trim().toLowerCase();
  const visibleStudents = (students.data || []).filter((s: any) =>
    (!grade || s.year_grade === grade) &&
    (!q || s.full_name?.toLowerCase().includes(q) || String(s.form_no).includes(q))
  );
  const visibleIds = visibleStudents.map((s: any) => s.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id: number) => attendees.includes(id));
  const toggleAllVisible = () => setAttendees((a) =>
    allVisibleSelected ? a.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...a, ...visibleIds]))
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={onClose}>
      <div className="w-full max-w-md h-full p-6 overflow-y-auto" style={{ background: 'var(--color-card)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold">Log Lecture</h2>
          <button className="btn-ghost !py-1 !px-2.5 text-sm" onClick={onClose}>Close</button>
        </div>
        <p className="muted text-sm mb-4">Recorded under <b>{teacherName}</b> — use this when the teacher is busy.</p>

        {msg && <div className="card p-3 text-sm text-red-500 mb-3">{msg}</div>}

        <form onSubmit={handleSubmit((b) => { if (!attendees.length) { setMsg('⚠️ Select at least one student.'); return; } setMsg(''); create.mutate(b); })} className="space-y-3">
          <div>
            <label className="text-xs font-medium muted block mb-1">Date *</label>
            <input type="hidden" {...register('session_date', { required: true })} />
            <CalendarPicker value={watch('session_date') || ''} onChange={(v) => setValue('session_date', v, { shouldValidate: true })} placeholder="Select date…" />
          </div>
          <div>
            <label className="text-xs font-medium muted block mb-1">Venue</label>
            <input type="hidden" {...register('venue')} />
            <Select value={watch('venue') || ''} onChange={(v) => setValue('venue', v)} options={['JLT', 'Oud Metha', 'Online'].map((v) => ({ value: v, label: v }))} placeholder="Select venue…" allowCustom />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium muted block mb-1">Time In</label>
              <input type="hidden" {...register('time_in')} />
              <TimePicker value={watch('time_in') || ''} onChange={(v) => setValue('time_in', v)} placeholder="Start" />
            </div>
            <div>
              <label className="text-xs font-medium muted block mb-1">Time Out</label>
              <input type="hidden" {...register('time_out')} />
              <TimePicker value={watch('time_out') || ''} onChange={(v) => setValue('time_out', v)} placeholder="End" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium muted block mb-1">Subject</label>
            <input type="hidden" {...register('subject_id')} />
            <Select value={watch('subject_id') || ''} onChange={(v) => setValue('subject_id', v)} options={(subjects.data || []).map((s: any) => ({ value: s.id, label: s.name }))} placeholder="Select subject…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
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
            <label className="text-xs font-medium muted block mb-1">Grade (filter students)</label>
            <Select
              value={grade}
              onChange={setGrade}
              options={[{ value: '', label: 'All grades' }, ...grades.map((g: any) => ({ value: g, label: g }))]}
              placeholder="All grades"
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="text-xs font-medium muted">Students — attendees ({attendees.length} selected)</label>
              <button type="button" className="btn-ghost !py-1 !px-2.5 text-xs" onClick={toggleAllVisible} disabled={visibleIds.length === 0}>
                {allVisibleSelected ? 'Clear all' : `Select all (${visibleIds.length})`}
              </button>
            </div>
            <input className="input mt-1" placeholder="Search student by name / form no…" value={stuSearch} onChange={(e) => setStuSearch(e.target.value)} />
            <div className="card p-2 mt-1 max-h-48 overflow-y-auto grid grid-cols-1 gap-1">
              {students.isLoading ? <Spinner /> : visibleStudents.length === 0 ? (
                <div className="muted text-sm p-2">{(students.data || []).length === 0 ? 'No students assigned to this teacher yet.' : 'No students match.'}</div>
              ) : visibleStudents.map((s: any) => (
                <label key={s.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer">
                  <input type="checkbox" checked={attendees.includes(s.id)} onChange={() => toggle(s.id)} />
                  <span className="font-mono text-xs">{s.form_no}</span> {s.full_name}
                  {s.year_grade ? <span className="muted text-xs">· {s.year_grade}</span> : ''}
                  {s.subject_name ? <span className="muted text-xs">· {s.subject_name}</span> : ''}
                </label>
              ))}
            </div>
          </div>

          <button className="btn-primary w-full" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Save Lecture'}</button>
        </form>
      </div>
    </div>
  );
}
