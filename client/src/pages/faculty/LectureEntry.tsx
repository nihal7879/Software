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
  const [grade, setGrade] = useState('');
  const [stuSearch, setStuSearch] = useState('');
  const [msg, setMsg] = useState('');

  // Only MY students can be attendees; teacher is forced to me server-side.
  const me = useQuery({ queryKey: ['teacher-me'], queryFn: () => api.get('/teachers/me').then((r) => r.data) });
  const students = useQuery({ queryKey: ['me-students'], queryFn: () => api.get('/teachers/me/students').then((r) => r.data.data) });
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/teachers/subjects').then((r) => r.data.data) });

  // Minimal-effort defaults captured when the page opens: today's date, the
  // current time as start, and +1 hour as end. The teacher can still change them.
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const nowTime = `${pad(now.getHours())}:${pad(now.getMinutes())}:00`;
  const plusHour = new Date(now.getTime() + 60 * 60 * 1000);
  const endTime = `${pad(plusHour.getHours())}:${pad(plusHour.getMinutes())}:00`;

  const { register, handleSubmit, reset, watch, setValue } = useForm<any>({
    defaultValues: { venue: 'JLT', session_date: today, time_in: nowTime, time_out: endTime },
  });
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
      // Reset with a fresh "now" so the next entry defaults to the current time.
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      const e = new Date(d.getTime() + 60 * 60 * 1000);
      reset({
        venue: 'JLT',
        session_date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
        time_in: `${p(d.getHours())}:${p(d.getMinutes())}:00`,
        time_out: `${p(e.getHours())}:${p(e.getMinutes())}:00`,
      });
      setAttendees([]); setGrade(''); setStuSearch('');
    },
  });

  const toggle = (id: number) => setAttendees((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  // Grade options come from the students' own grades (from the DB).
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
              <label className="text-xs font-medium muted">My students — attendees ({attendees.length} selected)</label>
              <button type="button" className="btn-ghost !py-1 !px-2.5 text-xs" onClick={toggleAllVisible} disabled={visibleIds.length === 0}>
                {allVisibleSelected ? 'Clear all' : `Select all (${visibleIds.length})`}
              </button>
            </div>
            <input className="input mt-1" placeholder="Search student by name / form no…" value={stuSearch} onChange={(e) => setStuSearch(e.target.value)} />
            <div className="card p-2 mt-1 max-h-48 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1">
              {students.isLoading ? <Spinner /> : visibleStudents.length === 0 ? (
                <div className="muted text-sm p-2">{(students.data || []).length === 0 ? 'No students assigned to you yet. Your admin will assign students to you.' : 'No students match.'}</div>
              ) : visibleStudents.map((s: any) => (
                <label key={s.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer">
                  <input type="checkbox" checked={attendees.includes(s.id)} onChange={() => toggle(s.id)} />
                  <span className="font-mono text-xs">{s.form_no}</span> {s.full_name}
                  {s.year_grade ? <span className="muted text-xs">· {s.year_grade}</span> : ''}
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
