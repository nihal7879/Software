import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api } from '../../api/client';
import { Section, Spinner } from '../../components/ui';

// Faculty creates a lecture record. Supports group lectures (multiple attendees).
// Duration auto-calculates server-side from Time In / Time Out.
export default function LectureEntry() {
  const qc = useQueryClient();
  const [attendees, setAttendees] = useState<number[]>([]);
  const [msg, setMsg] = useState('');

  const students = useQuery({ queryKey: ['students'], queryFn: () => api.get('/students', { params: { limit: 100 } }).then((r) => r.data.data) });
  const teachers = useQuery({ queryKey: ['teachers'], queryFn: () => api.get('/teachers').then((r) => r.data.data) });
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/teachers/subjects').then((r) => r.data.data) });

  const { register, handleSubmit, reset } = useForm();
  const create = useMutation({
    mutationFn: (b: any) => api.post('/lectures', {
      session_date: b.session_date,
      teacher_id: b.teacher_id ? Number(b.teacher_id) : null,
      subject_id: b.subject_id ? Number(b.subject_id) : null,
      time_in: b.time_in || null,
      time_out: b.time_out || null,
      topic_remark: b.topic_remark,
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
      <p className="muted text-sm">Duration is auto-calculated from Time In/Out. Select multiple students for a group lecture.</p>

      {msg && <div className="card p-3 text-sm text-emerald-600">{msg}</div>}

      <Section title="New lecture">
        <form onSubmit={handleSubmit((b) => { if (!attendees.length) { setMsg('⚠️ Select at least one student.'); return; } create.mutate(b); })} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium muted">Date * (YYYY-MM-DD)</label>
              <input className="input mt-1" {...register('session_date', { required: true })} placeholder="2026-06-19" />
            </div>
            <div>
              <label className="text-xs font-medium muted">Venue</label>
              <select className="input mt-1" {...register('venue')}>
                <option>JLT</option><option>Oud Metha</option><option>Online</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium muted">Time In</label>
              <input className="input mt-1" {...register('time_in')} placeholder="17:00:00" />
            </div>
            <div>
              <label className="text-xs font-medium muted">Time Out</label>
              <input className="input mt-1" {...register('time_out')} placeholder="19:00:00" />
            </div>
            <div>
              <label className="text-xs font-medium muted">Teacher</label>
              <select className="input mt-1" {...register('teacher_id')}>
                <option value="">—</option>
                {teachers.data?.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium muted">Subject</label>
              <select className="input mt-1" {...register('subject_id')}>
                <option value="">—</option>
                {subjects.data?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium muted">Topic / Remark</label>
            <input className="input mt-1" {...register('topic_remark')} />
          </div>
          <div>
            <label className="text-xs font-medium muted">Meeting / Recording Link</label>
            <input className="input mt-1" {...register('meeting_link')} placeholder="Google Meet / Zoom URL" />
          </div>

          <div>
            <label className="text-xs font-medium muted">Attendees ({attendees.length} selected)</label>
            <div className="card p-2 mt-1 max-h-48 overflow-y-auto grid grid-cols-2 gap-1">
              {students.isLoading ? <Spinner /> : students.data.map((s: any) => (
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
