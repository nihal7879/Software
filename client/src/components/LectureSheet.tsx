import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { api, fmtDate, hrs, todayIso } from '../api/client';
import { useMasters } from '../api/masters';
import { Section, Spinner, Table } from './ui';
import { ConfirmModal } from './ConfirmModal';
import { Select } from './Select';
import { TimePicker } from './TimePicker';
import { CalendarPicker } from './CalendarPicker';
import { LectureEditModal } from './LectureEditModal';
import { toast } from './Toast';

/**
 * Lecture entry as a sheet: one line across, the way the institute already
 * keeps its record in Excel. Fill the top line, press Save, and the class drops
 * into the lines below under the same headings — so the page reads like a
 * register rather than a form.
 *
 * It uses the app's ordinary table styling rather than a spreadsheet look of its
 * own, so it sits with every other list here. Venue, subtopic and the meeting
 * link are rarely changed, so they wait behind a "+" instead of costing a column
 * and forcing the line to scroll sideways.
 *
 * The same sheet is the teacher's own page and the admin's page for logging on a
 * teacher's behalf — `teacherId` is what tells them apart.
 */

type Student = { id: number; full_name: string; form_no?: string | number; year_grade?: string | null };

const DURATIONS = [0.5, 1, 1.5, 2];
const pad = (n: number) => String(n).padStart(2, '0');

const endOf = (start: string, hours: number) => {
  const [h, m] = String(start).split(':').map(Number);
  if (!Number.isFinite(h)) return '';
  const mins = h * 60 + (m || 0) + hours * 60;
  return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}:00`;
};

/** '20:00:00' → '8:00 PM'. */
const clock = (t?: string | null) => {
  const [h, m] = String(t || '').split(':').map(Number);
  if (!Number.isFinite(h)) return '—';
  return `${h % 12 || 12}:${pad(m || 0)} ${h >= 12 ? 'PM' : 'AM'}`;
};

const hoursBetween = (from: string, to: string) => {
  const mins = (t: string) => {
    const [h, m] = String(t).split(':').map(Number);
    return Number.isFinite(h) ? h * 60 + (m || 0) : NaN;
  };
  const a = mins(from), b = mins(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.round(((b - a) / 60) * 100) / 100;
};

export function LectureSheet({
  teacherId,
  teacherName,
  specialization,
}: {
  /** Set by an admin logging for a teacher; left out when a teacher logs their own. */
  teacherId?: number;
  teacherName?: string;
  specialization?: string;
}) {
  const forAdmin = teacherId != null;
  const qc = useQueryClient();
  const masters = useMasters();
  // A teacher can correct their own class — a wrong time or topic, typed in a hurry.
  const [editing, setEditing] = useState<any | null>(null);
  // Deleting a lecture hands its hours back, so it asks first — and only an
  // admin may do it; a teacher corrects theirs instead.
  const [deleting, setDeleting] = useState<any | null>(null);

  const now = new Date();
  const start = new Date(now);
  start.setMinutes(Math.round(now.getMinutes() / 15) * 15, 0, 0);
  const startTime = `${pad(start.getHours())}:${pad(start.getMinutes())}:00`;

  // ---- the line being filled in -------------------------------------------
  const [date, setDate] = useState(todayIso());
  const [students, setStudents] = useState<number[]>([]);
  const [search, setSearch] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [subjectId, setSubjectId] = useState('');
  const [timeIn, setTimeIn] = useState(startTime);
  const [timeOut, setTimeOut] = useState(endOf(startTime, 1));
  const [topic, setTopic] = useState('');
  const [remark, setRemark] = useState('');
  const [more, setMore] = useState(false);
  const [venue, setVenue] = useState('JLT');
  const [subtopic, setSubtopic] = useState('');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');

  const me = useQuery({ queryKey: ['teacher-me'], queryFn: () => api.get('/teachers/me').then((r) => r.data), enabled: !forAdmin });
  const roster = useQuery({
    queryKey: forAdmin ? ['teacher-students', teacherId] : ['me-students', 'lecture'],
    queryFn: () => (forAdmin
      ? api.get(`/teachers/${teacherId}/students`)
      : api.get('/teachers/me/students', { params: { for: 'lecture' } })
    ).then((r) => r.data.data as Student[]),
  });
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/teachers/subjects').then((r) => r.data.data) });
  // A teacher is limited to their own lectures by the server; an admin asks for
  // the one teacher they are logging for.
  const lectures = useQuery({
    queryKey: forAdmin ? ['teacher-lectures', teacherId] : ['lectures', 'mine'],
    queryFn: () => (forAdmin
      ? api.get(`/lectures/by-teacher/${teacherId}`, { params: { limit: 100 } }).then((r) =>
          (r.data.data || []).map((l: any) => ({
            ...l,
            id: l.lecture_id,
            students: (l.students || []).map((s: any) => s.full_name),
            // Kept with their ids too, so the Edit dialog can change who is on it.
            attendees: (l.students || []).map((s: any) => ({ id: s.student_id, name: s.full_name, form_no: s.form_no })),
          })))
      : api.get('/lectures', { params: { limit: 300 } }).then((r) => r.data.data as any[])
    ),
  });

  const spec = String((forAdmin ? specialization : me.data?.specialization) || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const subjectList = (subjects.data || []).filter((s: any) => spec.length === 0 || spec.includes(String(s.name).toLowerCase()));

  const byId = useMemo(() => new Map((roster.data || []).map((s) => [s.id, s])), [roster.data]);
  const term = search.trim().toLowerCase();
  // Every student the teacher has, not a handful: the list scrolls instead of
  // being cut off at eight, so someone far down the alphabet can still be picked
  // without knowing to type their name first.
  const matches = (roster.data || [])
    .filter((s) => !students.includes(s.id))
    .filter((s) => !term || s.full_name?.toLowerCase().includes(term) || String(s.form_no).includes(term));

  const hours = hoursBetween(timeIn, timeOut);

  // One row per attendee comes back; a class is one line with its students.
  const classes = useMemo(() => {
    if (forAdmin) return (lectures.data as any[]) || [];
    const by = new Map<number, any>();
    for (const r of lectures.data || []) {
      const at = by.get(r.id) || { ...r, students: [] as string[], attendees: [] as { id: number; name: string; form_no?: string }[] };
      at.students.push(r.student_name);
      at.attendees.push({ id: r.student_id, name: r.student_name, form_no: r.form_no });
      by.set(r.id, at);
    }
    return [...by.values()].sort((a, b) =>
      String(b.session_date).localeCompare(String(a.session_date)) || String(b.time_in).localeCompare(String(a.time_in))
    );
  }, [lectures.data, forAdmin]);

  const save = useMutation({
    mutationFn: () => api.post('/lectures', {
      teacher_id: teacherId,
      session_date: date,
      subject_id: subjectId ? Number(subjectId) : null,
      time_in: timeIn || null,
      time_out: timeOut || null,
      topic: topic || null,
      subtopic: subtopic || null,
      remark: remark || null,
      venue: venue || null,
      meeting_link: link || null,
      attendees: students.map((id) => ({ student_id: id })),
    }),
    onSuccess: (r: any) => {
      toast(`Lecture saved — ${r.data.total_hours}h for ${students.length} student${students.length === 1 ? '' : 's'}`);
      ['ledger', 'ledger-all', 'lectures', 'workload', 'teacher-lectures'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      // The line empties for the next class. Date and times stay, because the
      // next class of the day follows on from the last.
      setStudents([]); setSearch(''); setTopic(''); setRemark(''); setSubtopic(''); setLink('');
      setError('');
    },
    onError: (e: any) => setError(e?.response?.data?.error || 'Could not save the lecture.'),
  });

  const removeLecture = useMutation({
    mutationFn: (id: number) => api.delete(`/lectures/${id}`),
    onSuccess: (r: any) => {
      toast(`Lecture deleted — ${r.data?.hours_returned ?? ''}h back to the students`.replace('  ', ' '));
      ['ledger', 'ledger-all', 'lectures', 'teacher-lectures', 'workload'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setDeleting(null);
    },
    onError: (e: any) => { setError(e?.response?.data?.error || 'Could not delete the lecture.'); setDeleting(null); },
  });

  const problem = !students.length ? 'Add at least one student'
    : !date ? 'Pick a date'
    : hours <= 0 ? 'End time must be after the start'
    : '';

  // ---- the cells, shared by the wide line and the narrow stack -------------
  const cell = {
    date: <CalendarPicker className="w-full" value={date} onChange={setDate} placeholder="Date" />,
    students: (
      <div className="relative">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border px-2 py-1" style={{ borderColor: 'var(--color-border)' }}>
          {students.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 text-xs rounded px-1.5 py-0.5" style={{ background: 'var(--color-card-alt)' }}>
              {byId.get(id)?.full_name || 'Student'}
              <button type="button" className="muted hover:text-red-500" aria-label="Remove" onClick={() => setStudents(students.filter((x) => x !== id))}>
                <X size={11} />
              </button>
            </span>
          ))}
          <input
            className="bg-transparent outline-none text-sm flex-1 min-w-[6rem] py-0.5"
            placeholder={students.length ? 'Add…' : 'Type a name…'}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setListOpen(true); }}
            onFocus={() => setListOpen(true)}
            onBlur={() => setTimeout(() => setListOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches.length) { e.preventDefault(); setStudents([...students, matches[0].id]); setSearch(''); setError(''); }
              if (e.key === 'Backspace' && !search && students.length) setStudents(students.slice(0, -1));
            }}
          />
        </div>
        {listOpen && matches.length > 0 && (
          <div
            className="absolute z-30 mt-1 w-72 card p-0 shadow-lg overflow-hidden"
            // The count sits in its own strip and the names scroll in a box of
            // their own beneath it: they pass behind nothing, so no name can
            // show through the heading. Rows snap, so none is sliced in half.
          >
            <div
              className="text-[11px] muted px-3 py-1.5 border-b"
              style={{ borderColor: 'var(--color-border)' }}
            >
              {matches.length} student{matches.length === 1 ? '' : 's'}{term ? ' match' : ''}
            </div>
            <div className="max-h-64 overflow-y-auto thin-scroll p-1" style={{ scrollSnapType: 'y proximity' }}>
            {matches.map((s) => (
              <button
                key={s.id}
                type="button"
                className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5"
                style={{ scrollSnapAlign: 'start' }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setStudents([...students, s.id]); setSearch(''); setError(''); }}
              >
                {s.full_name} <span className="muted text-xs">{s.form_no}</span>
              </button>
            ))}
            </div>
          </div>
        )}
      </div>
    ),
    subject: (
      <Select
        compact
        value={subjectId}
        onChange={setSubjectId}
        options={subjectList.map((s: any) => ({ value: s.id, label: s.name }))}
        placeholder="Subject…"
      />
    ),
    timeIn: <TimePicker value={timeIn} onChange={(v) => { setTimeIn(v); setTimeOut(endOf(v, hours || 1)); }} placeholder="In" />,
    timeOut: <TimePicker value={timeOut} onChange={setTimeOut} placeholder="Out" />,
    topic: <input className="input !py-1.5 w-full" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic" />,
    subtopic: <input className="input !py-1.5 w-full" value={subtopic} onChange={(e) => setSubtopic(e.target.value)} placeholder="Subtopic" />,
    remark: <input className="input !py-1.5 w-full" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Remark" />,
    link: <input className="input !py-1.5 w-full" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Meet link" />,
    venue: (
      <Select
        compact
        allowCustom
        value={venue}
        onChange={setVenue}
        options={masters.venues.map((v) => ({ value: v, label: v }))}
        placeholder="Venue…"
      />
    ),
  };

  // Nine fields on one line left every box narrow. Split across two lines, each
  // field gets room: the class itself on top, what was taught underneath.
  // Hours are not typed — they follow from the times — and venue stays folded
  // away, being the same building nearly every time.
  const ROW_ONE = ['18%', '32%', '18%', '16%', '16%'];
  const ROW_TWO = ['24%', '20%', '24%', '14%', '18%'];

  return (
    <div className="space-y-4">
      <Section title="New lecture">
        {roster.isLoading ? <Spinner /> : (roster.data || []).length === 0 ? (
          <p className="muted text-sm">
            {forAdmin
              ? `No active students assigned to ${teacherName || 'this teacher'} yet.`
              : 'No active students assigned to you yet. Your admin assigns students to you.'}
          </p>
        ) : (
          <>
            {/* Wide screens: two lines, each under its own headings. */}
            <div className="hidden lg:block space-y-1">
              <table className="w-full table-fixed border-collapse">
                <colgroup>{ROW_ONE.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                <thead>
                  <tr>
                    {['Date', 'Students', 'Subject', 'Time In', 'Time Out'].map((h) => (
                      <th key={h} className="table-th">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="table-td align-top">{cell.date}</td>
                    <td className="table-td align-top">{cell.students}</td>
                    <td className="table-td align-top">{cell.subject}</td>
                    <td className="table-td align-top">{cell.timeIn}</td>
                    <td className="table-td align-top">{cell.timeOut}</td>
                  </tr>
                </tbody>
              </table>
              <table className="w-full table-fixed border-collapse">
                <colgroup>{ROW_TWO.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                <thead>
                  <tr>
                    {['Topic', 'Subtopic', 'Remark', 'Venue', 'Meet link'].map((h) => (
                      <th key={h} className="table-th">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="table-td align-top">{cell.topic}</td>
                    <td className="table-td align-top">{cell.subtopic}</td>
                    <td className="table-td align-top">{cell.remark}</td>
                    <td className="table-td align-top">{cell.venue}</td>
                    <td className="table-td align-top">{cell.link}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Narrower: the same fields stacked, so nothing runs off the side. */}
            <div className="lg:hidden grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([['Date', cell.date], ['Students', cell.students], ['Subject', cell.subject],
                 ['Time In', cell.timeIn], ['Time Out', cell.timeOut],
                 ['Topic', cell.topic], ['Subtopic', cell.subtopic],
                 ['Remark', cell.remark], ['Venue', cell.venue], ['Meet link', cell.link]] as const).map(([l, node]) => (
                <div key={l}>
                  <label className="text-xs font-medium muted block mb-1">{l}</label>
                  {node}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <button
                className="btn-primary !py-1.5 !px-6 text-sm ml-auto whitespace-nowrap"
                disabled={save.isPending}
                onClick={() => (problem ? setError(problem) : save.mutate())}
              >
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>

            {/* Only after someone presses Save — an empty line is not a mistake
                until it is submitted, so nothing nags before then. */}
            {error && <div className="text-sm mt-2 text-red-500">{error}</div>}
          </>
        )}
      </Section>

      {/* The same columns, already filled in — what has been logged. */}
      <Section title={forAdmin ? 'Lectures by this teacher' : 'My lectures'}>
        {lectures.isLoading ? <Spinner /> : classes.length === 0 ? (
          <p className="muted text-sm">Nothing logged yet — the line above saves into here.</p>
        ) : (
          <Table head={['Date', 'Time', 'Subject / Topic', { label: 'Hours', align: 'right' }, 'Students on this lecture', '']}>
            {classes.map((c) => (
              <tr key={c.id}>
                <td className="table-td whitespace-nowrap">{fmtDate(String(c.session_date).slice(0, 10))}</td>
                <td className="table-td whitespace-nowrap">{clock(c.time_in)} – {clock(c.time_out)}</td>
                <td className="table-td">
                  <span className="font-semibold">{c.subject_name || '—'}</span>
                  {(c.topic || c.remark) && (
                    <span className="block text-xs muted break-words">
                      {[c.topic, c.remark].filter(Boolean).join(' — ')}
                    </span>
                  )}
                </td>
                <td className="table-td text-right tabular-nums whitespace-nowrap">{hrs(c.total_hours)}</td>
                <td className="table-td">
                  <div className="flex flex-wrap gap-1">
                    {(c.attendees || []).map((a: any) => (
                      <span key={a.id} className="inline-flex items-center gap-1 text-xs rounded-md px-1.5 py-0.5" style={{ background: 'var(--color-card-alt)' }}>
                        {a.form_no != null && <span className="font-mono muted">{a.form_no}</span>}
                        {a.name}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="table-td">
                  <div className="flex items-center gap-1.5 justify-end">
                    <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => setEditing(c)}>Edit</button>
                    {forAdmin && (
                      <button
                        className="!py-1 !px-2.5 text-xs rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 transition-colors"
                        onClick={() => setDeleting(c)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {deleting && (
        <ConfirmModal
          title="Delete lecture"
          message={`Delete the ${fmtDate(String(deleting.session_date).slice(0, 10))} lecture (${hrs(deleting.total_hours)})? The hours go back to the students on it.`}
          confirmLabel="Delete"
          danger
          busy={removeLecture.isPending}
          onConfirm={() => removeLecture.mutate(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}

      {editing && (
        <LectureEditModal
          lecture={{ ...editing, lecture_id: editing.id, no_of_hours: editing.total_hours }}
          attendees={editing.attendees || []}
          roster={roster.data || []}
          onClose={() => setEditing(null)}
          // The dialog changed the students, so the line behind it is stale.
          onSaved={() => setEditing(null)}
        />
      )}
    </div>
  );
}
