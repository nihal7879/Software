import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, MapPin, Printer, QrCode as QrCodeIcon, Trash2, UserPlus, X } from 'lucide-react';
import { api, fmtDate, hrs, todayIso } from '../api/client';
import { useMasters } from '../api/masters';
import { DateTile, Section, Spinner, Table, useWide } from './ui';
import { Select } from './Select';
import { TimePicker } from './TimePicker';
import { CalendarPicker } from './CalendarPicker';
import { ConfirmModal } from './ConfirmModal';
import { QrCode } from './QrCode';
import { DictateButton } from './DictateButton';
import { toast } from './Toast';
import { printQrCards, scanUrl } from '../lib/qr';

/**
 * Scanned check-ins waiting to be turned into lectures.
 *
 * Laid out like the lecture sheet, because it is the same work: one line across
 * per student, under the same headings, in the same order. What the scan already
 * knows — who, and the times — sits on the first line; what the teacher adds sits
 * on the second, exactly where Topic, Subtopic, Remark and Venue sit when a
 * lecture is typed in by hand.
 *
 * One row per student, never a batch. Nothing here has touched anybody's hours:
 * confirming is what writes the lecture, and each row charges that student their
 * own time in to time out — 4:15 to 5:20 is 1.08 hours for them, whatever the
 * rest of the room did.
 *
 * A student who came without a phone never scanned, so the teacher puts them in
 * by hand on the top line and their row joins the others.
 */

type Row = {
  id: number;
  session_date: string;
  in_at: string;
  out_at: string | null;
  hours: number | null;
  status: string;
  subject_id: number | null;
  topic: string | null;
  subtopic: string | null;
  remark: string | null;
  venue: string | null;
  meeting_link: string | null;
  student_id: number;
  student_name: string;
  form_no: string | null;
  teacher_id: number;
  teacher_name: string;
  subject_name: string | null;
  added_by_hand: number;
};

type Student = { id: number; full_name: string; form_no?: string | number };

type Edit = {
  subject_id: string;
  topic: string;
  subtopic: string;
  remark: string;
  venue: string;
  meeting_link: string;
  in_time: string;
  out_time: string;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** A server timestamp ('2026-09-24 16:15:00') to the HH:MM:SS a TimePicker wants. */
const timeOf = (v: any) => (v ? String(v).slice(11, 19) : '');

/** '16:15:00' to '4:15 PM'. */
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

const endOf = (start: string, hours: number) => {
  const [h, m] = String(start).split(':').map(Number);
  if (!Number.isFinite(h)) return '';
  const mins = h * 60 + (m || 0) + hours * 60;
  return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}:00`;
};

const seed = (r: Row): Edit => ({
  subject_id: r.subject_id ? String(r.subject_id) : '',
  topic: r.topic || '',
  subtopic: r.subtopic || '',
  remark: r.remark || '',
  // JLT unless the row says otherwise — nearly every class is there, the same
  // default the lecture sheet starts with.
  venue: r.venue || 'JLT',
  meeting_link: r.meeting_link || '',
  in_time: timeOf(r.in_at),
  out_time: timeOf(r.out_at),
});

// The same two lines as the lecture sheet: the class on top, what was taught
// underneath. The two lines want different widths, but they belong to the same
// student and have to stay in one table to sit together — so the table is laid
// out on a grid of twenty narrow columns and each field takes the span it needs.
// Both lines add up to twenty, so every student lines up down the page.
// A class that ran this long is almost always a student who forgot to scan out
// at the end and scanned hours later. The line says so before it is confirmed,
// because once confirmed those hours are charged.
const LONG_HOURS = 3;

const GRID = Array.from({ length: 20 }, () => '5%');
const ROW_ONE = [4, 4, 3, 3, 6];   // Student · Subject · In · Out · hours and buttons
const ROW_TWO = [4, 4, 4, 3, 5];   // Topic · Subtopic · Remark · Venue · Meet link
const ADD_ROW = [4, 6, 3, 3, 4];   // Date · Students · In · Out · Add

/** The second line carries on from the first, so no rule between them. */
const JOINED = { borderTop: 'none' } as const;

export function AttendanceInbox({
  admin = false,
  teacherId,
  teacherName,
  specialization,
}: {
  admin?: boolean;
  teacherId?: number;
  teacherName?: string;
  specialization?: string | null;
}) {
  const qc = useQueryClient();
  const forAdmin = admin;
  // An admin looking at every teacher at once has no single code to print, and
  // nobody to add a missing student to.
  const oneTeacher = !forAdmin || teacherId != null;

  const masters = useMasters();
  const [status, setStatus] = useState<'Pending' | 'Confirmed'>('Pending');
  const [dateFilter, setDateFilter] = useState('');
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [bulk, setBulk] = useState({ subject_id: '', topic: '', subtopic: '', venue: 'JLT', meeting_link: '' });
  const [discarding, setDiscarding] = useState<Row | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const wide = useWide();
  // Phone cards whose venue / link section is unfolded.
  const [openMore, setOpenMore] = useState<Set<number>>(new Set());
  const [longWarning, setLongWarning] = useState<{ row?: Row; ids?: number[]; n: number; hours: number } | null>(null);

  // ---- the "did not scan" line --------------------------------------------
  const [addDate, setAddDate] = useState(todayIso());
  const [addIn, setAddIn] = useState('');
  const [addOut, setAddOut] = useState('');
  const [addStudents, setAddStudents] = useState<number[]>([]);
  const [search, setSearch] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [addError, setAddError] = useState('');

  const me = useQuery({
    queryKey: ['teacher-me'],
    queryFn: () => api.get('/teachers/me').then((r) => r.data),
    enabled: !forAdmin,
  });
  const roster = useQuery({
    queryKey: forAdmin ? ['teacher-students', teacherId] : ['me-students', 'lecture'],
    enabled: oneTeacher,
    queryFn: () =>
      (forAdmin
        ? api.get(`/teachers/${teacherId}/students`)
        : api.get('/teachers/me/students', { params: { for: 'lecture' } })
      ).then((r) => r.data.data as Student[]),
  });
  const subjects = useQuery({
    queryKey: ['subjects'],
    queryFn: () => api.get('/teachers/subjects').then((r) => r.data.data),
  });
  const myQr = useQuery({
    queryKey: ['qr-code', teacherId ?? 'me'],
    enabled: oneTeacher,
    queryFn: () => api.get(forAdmin ? `/teachers/${teacherId}/qr` : '/teachers/me/qr').then((r) => r.data),
  });
  const inbox = useQuery({
    queryKey: ['checkin-inbox', teacherId ?? 'me', status, dateFilter],
    queryFn: () =>
      api
        .get('/checkin/inbox', { params: { status, teacherId, date: dateFilter || undefined } })
        .then((r) => r.data.data as Row[]),
  });

  // Only what this teacher teaches, the same filter the lecture sheet applies.
  const spec = String((forAdmin ? specialization : me.data?.specialization) || '')
    .split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const subjectList = (subjects.data || []).filter(
    (s: any) => spec.length === 0 || spec.includes(String(s.name).toLowerCase())
  );
  const subjectOptions = useMemo(
    () => subjectList.map((s: any) => ({ value: String(s.id), label: s.name })),
    [subjects.data, me.data?.specialization, specialization]
  );

  const rows = inbox.data || [];
  const editOf = (r: Row) => edits[r.id] || seed(r);
  const setEdit = (r: Row, patch: Partial<Edit>) =>
    setEdits((prev) => ({ ...prev, [r.id]: { ...(prev[r.id] || seed(r)), ...patch } }));

  /** What a row sends, leaving out any time the teacher did not touch. */
  function payloadOf(r: Row) {
    const e = editOf(r);
    const base = seed(r);
    const body: any = {
      subject_id: e.subject_id ? Number(e.subject_id) : null,
      topic: e.topic || null,
      subtopic: e.subtopic || null,
      remark: e.remark || null,
      venue: e.venue || null,
      meeting_link: e.meeting_link || null,
    };
    if (e.in_time && e.in_time !== base.in_time) body.in_time = e.in_time.slice(0, 5);
    if (e.out_time && e.out_time !== base.out_time) body.out_time = e.out_time.slice(0, 5);
    return body;
  }

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['checkin-inbox'] });
    setPicked(new Set());
  };
  const refreshLectures = () =>
    ['ledger', 'ledger-all', 'lectures', 'workload', 'teacher-lectures', 'hours'].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k] })
    );

  const addManual = useMutation({
    mutationFn: () =>
      api.post('/checkin/manual', {
        student_ids: addStudents,
        session_date: addDate,
        in_time: addIn.slice(0, 5),
        out_time: addOut.slice(0, 5),
        ...(forAdmin ? { teacher_id: teacherId } : {}),
      }),
    onSuccess: (r: any) => {
      const { added, skipped } = r.data;
      toast(skipped?.length ? `${added} added. ${skipped[0].reason}.` : `${added} student(s) added.`,
        skipped?.length ? 'info' : 'success');
      setAddStudents([]); setSearch(''); setAddError('');
      if (!skipped?.length) setAddOpen(false);
      qc.invalidateQueries({ queryKey: ['checkin-inbox'] });
    },
    onError: (e: any) => setAddError(e?.response?.data?.error || 'Could not add them.'),
  });

  const save = useMutation({
    mutationFn: (r: Row) => api.patch(`/checkin/${r.id}`, payloadOf(r)),
    onSuccess: () => { toast('Saved.'); qc.invalidateQueries({ queryKey: ['checkin-inbox'] }); },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not save that row.', 'error'),
  });

  const confirmRow = useMutation({
    mutationFn: async (r: Row) => {
      await api.patch(`/checkin/${r.id}`, payloadOf(r));
      await api.post(`/checkin/${r.id}/confirm`);
    },
    onSuccess: () => { toast('Lecture created.'); refresh(); refreshLectures(); },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not confirm that row.', 'error'),
  });

  const applyBulk = useMutation({
    mutationFn: (ids: number[]) =>
      api.post('/checkin/apply', {
        ids,
        subject_id: bulk.subject_id ? Number(bulk.subject_id) : null,
        ...(bulk.topic ? { topic: bulk.topic } : {}),
        ...(bulk.subtopic ? { subtopic: bulk.subtopic } : {}),
        ...(bulk.venue ? { venue: bulk.venue } : {}),
        ...(bulk.meeting_link ? { meeting_link: bulk.meeting_link } : {}),
      }),
    onSuccess: (r: any) => {
      toast(`Applied to ${r.data.applied} row(s).`);
      setEdits({});
      qc.invalidateQueries({ queryKey: ['checkin-inbox'] });
    },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not apply that.', 'error'),
  });

  const confirmMany = useMutation({
    mutationFn: (ids: number[]) => api.post('/checkin/confirm', { ids }),
    onSuccess: (r: any) => {
      const { confirmed, skipped } = r.data;
      toast(
        skipped?.length
          ? `${confirmed} confirmed, ${skipped.length} left: ${skipped[0]?.reason || 'not ready'}`
          : `${confirmed} lecture(s) created.`,
        skipped?.length ? 'info' : 'success'
      );
      refresh(); refreshLectures();
    },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not confirm those.', 'error'),
  });

  const discard = useMutation({
    mutationFn: (r: Row) => api.delete(`/checkin/${r.id}`),
    onSuccess: () => { toast('Discarded.'); setDiscarding(null); refresh(); },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not discard that.', 'error'),
  });

  // Rows by day, newest first — a day is worked through together.
  const days = useMemo(() => {
    const by = new Map<string, Row[]>();
    for (const r of rows) {
      const d = String(r.session_date).slice(0, 10);
      if (!by.has(d)) by.set(d, []);
      by.get(d)!.push(r);
    }
    return [...by.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [rows]);

  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  /** The hours on a row as it stands, counting a time the teacher has retyped. */
  const hoursOn = (r: Row) => {
    const e = editOf(r);
    return hoursBetween(e.in_time, e.out_time) || Number(r.hours || 0);
  };

  // Confirming is what charges the student, so a sitting longer than a usual
  // class stops for a yes first. Almost always it is a forgotten scan out.
  const askConfirmRow = (r: Row) => {
    const h = hoursOn(r);
    if (h >= LONG_HOURS) setLongWarning({ row: r, n: 1, hours: h });
    else confirmRow.mutate(r);
  };
  const askConfirmMany = (ids: number[]) => {
    const longs = rows.filter((r) => ids.includes(r.id) && hoursOn(r) >= LONG_HOURS);
    if (longs.length) setLongWarning({ ids, n: longs.length, hours: Math.max(...longs.map(hoursOn)) });
    else confirmMany.mutate(ids);
  };

  const pickedIds = [...picked];
  const busy = save.isPending || confirmRow.isPending || applyBulk.isPending || confirmMany.isPending;

  const term = search.trim().toLowerCase();
  const matches = (roster.data || [])
    .filter((s) => !addStudents.includes(s.id))
    .filter((s) => !term || s.full_name?.toLowerCase().includes(term) || String(s.form_no).includes(term));
  const byId = useMemo(() => new Map((roster.data || []).map((s) => [s.id, s])), [roster.data]);
  const addHours = hoursBetween(addIn, addOut);
  const addProblem = !addDate ? 'Pick a date'
    : addStudents.length === 0 ? 'Add at least one student'
    : !addIn || !addOut ? 'Enter the start and end time'
    : addHours <= 0 ? 'End time must be after the start'
    : '';

  // ---- the cells of the "did not scan" line, shared by both layouts --------
  const addCell = {
    date: <CalendarPicker className="w-full" value={addDate} onChange={setAddDate} placeholder="Date" />,
    students: (
      <div className="relative">
        <div className="m-control flex flex-wrap items-center gap-1 rounded-lg border px-2 py-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}>
          {addStudents.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 text-xs rounded px-1.5 py-0.5 max-lg:text-[13px] max-lg:rounded-full max-lg:pl-2.5 max-lg:pr-1 max-lg:py-1" style={{ background: 'var(--color-card-alt)' }}>
              {byId.get(id)?.full_name || 'Student'}
              <button type="button" className="muted hover:text-red-500 max-lg:grid max-lg:place-items-center max-lg:w-6 max-lg:h-6 max-lg:rounded-full" aria-label="Remove"
                onClick={() => setAddStudents(addStudents.filter((x) => x !== id))}>
                <X size={11} />
              </button>
            </span>
          ))}
          <input
            className="bg-transparent outline-none text-sm flex-1 min-w-[6rem] py-0.5"
            placeholder={addStudents.length ? 'Add…' : 'Type a name…'}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setListOpen(true); }}
            onFocus={() => setListOpen(true)}
            onBlur={() => setTimeout(() => setListOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches.length) { e.preventDefault(); setAddStudents([...addStudents, matches[0].id]); setSearch(''); setAddError(''); }
              if (e.key === 'Backspace' && !search && addStudents.length) setAddStudents(addStudents.slice(0, -1));
            }}
          />
        </div>
        {listOpen && matches.length > 0 && (
          <div className="absolute z-30 mt-1 w-full lg:w-72 card p-0 shadow-lg overflow-hidden">
            <div className="text-[11px] muted px-3 py-1.5 border-b" style={{ borderColor: 'var(--color-border)' }}>
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
                  onClick={() => { setAddStudents([...addStudents, s.id]); setSearch(''); setAddError(''); }}
                >
                  {s.full_name} <span className="muted text-xs">{s.form_no}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    ),
    timeIn: <TimePicker value={addIn} onChange={(v) => { setAddIn(v); if (!addOut) setAddOut(endOf(v, 1)); }} placeholder="In" />,
    timeOut: <TimePicker value={addOut} onChange={setAddOut} placeholder="Out" />,
    action: (
      <div className="flex items-center gap-2">
        <span className="text-sm tabular-nums muted whitespace-nowrap">{addHours ? hrs(addHours) : ''}</span>
        <button
          className="btn-primary !py-1.5 !px-5 text-sm ml-auto whitespace-nowrap"
          disabled={addManual.isPending}
          onClick={() => (addProblem ? setAddError(addProblem) : addManual.mutate())}
        >
          {addManual.isPending ? 'Adding…' : 'Add'}
        </button>
      </div>
    ),
  };

  return (
    <div className="space-y-4">

      <Section
        title={status === 'Pending' ? 'Scanned check-ins' : 'Confirmed check-ins'}
        // Phones get their own toolbar below; five small buttons do not fit a row.
        action={!wide ? undefined :
          <>
            {oneTeacher && status === 'Pending' && (
              <button
                className={addOpen ? 'btn-primary !py-1 !px-2.5 text-xs' : 'btn-outline !py-1 !px-2.5 text-xs'}
                onClick={() => { setAddOpen((v) => !v); setAddError(''); }}
              >
                <UserPlus className="w-3.5 h-3.5" /> {addOpen ? 'Close' : 'Did not scan'}
              </button>
            )}
            {oneTeacher && (
              <button
                className={showQr ? 'btn-primary !py-1 !px-2.5 text-xs' : 'btn-outline !py-1 !px-2.5 text-xs'}
                onClick={() => setShowQr((v) => !v)}
              >
                <QrCodeIcon className="w-3.5 h-3.5" /> QR code
              </button>
            )}
            <CalendarPicker value={dateFilter} onChange={setDateFilter} placeholder="Any date" align="right" />
            {dateFilter && (
              <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => setDateFilter('')}>Clear</button>
            )}
            <button
              className="btn-ghost !py-1 !px-2.5 text-xs"
              onClick={() => { setStatus(status === 'Pending' ? 'Confirmed' : 'Pending'); setPicked(new Set()); }}
            >
              {status === 'Pending' ? 'Show confirmed' : 'Show pending'}
            </button>
          </>
        }
      >
        {/* Phone / tablet toolbar: which list, which day, and the two extras. */}
        {!wide && (
          <div className="space-y-2 mb-4">
            <div className="flex p-1 rounded-xl" style={{ background: 'var(--color-card-alt)' }} role="tablist">
              {(['Pending', 'Confirmed'] as const).map((s) => (
                <button key={s} role="tab" aria-selected={status === s}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${status === s ? 'shadow-sm' : 'muted'}`}
                  style={status === s ? { background: 'var(--color-card)', color: 'var(--color-primary)' } : {}}
                  onClick={() => { setStatus(s); setPicked(new Set()); }}>
                  {s === 'Pending' ? 'Waiting' : 'Confirmed'}
                </button>
              ))}
            </div>
            <div className="m-form flex gap-2">
              <div className="flex-1 min-w-0">
                <CalendarPicker stretch value={dateFilter} onChange={setDateFilter} placeholder="Any date" />
              </div>
              {dateFilter && (
                <button className="btn-ghost m-control !px-3 text-sm shrink-0" onClick={() => setDateFilter('')} aria-label="Clear date">
                  <X size={16} />
                </button>
              )}
              {oneTeacher && status === 'Pending' && (
                <button className={`${addOpen ? 'btn-primary' : 'btn-ghost'} m-control !px-3 shrink-0`}
                  onClick={() => { setAddOpen((v) => !v); setAddError(''); }} aria-label="Add a student who did not scan" aria-pressed={addOpen}>
                  <UserPlus size={17} />
                </button>
              )}
              {oneTeacher && (
                <button className={`${showQr ? 'btn-primary' : 'btn-ghost'} m-control !px-3 shrink-0`}
                  onClick={() => setShowQr((v) => !v)} aria-label="Show my desk QR code" aria-pressed={showQr}>
                  <QrCodeIcon size={17} />
                </button>
              )}
            </div>
          </div>
        )}

        {status === 'Pending' && (
          <p className="muted text-sm mb-3">
            {wide
              ? <>Each line is one student. Fill in the subject and topic and press Confirm —
                that is when it becomes a lecture and counts against their hours.</>
              : <>Each card is one student. Add the subject and topic, then Confirm — that is
                when it becomes a lecture and counts against their hours.</>}
          </p>
        )}

        {/* The desk card, only when asked for: it is set up once and then
            reprinted only if a card goes missing. */}
        {showQr && oneTeacher && (
          <div className="rounded-xl border p-3 mb-4 max-lg:rounded-2xl max-lg:p-3.5" style={{ borderColor: 'var(--color-border)' }}>
            {myQr.data?.code ? (
              <div className="flex flex-col items-center text-center lg:flex-row lg:flex-wrap lg:items-center lg:text-left gap-5">
                <QrCode text={scanUrl(myQr.data.code)} size={180} />
                <div className="text-sm flex flex-col items-center lg:block">
                  <div className="font-display font-bold text-lg">{myQr.data.name}</div>
                  <div className="font-mono tracking-widest text-base mt-1">{myQr.data.code}</div>
                  <p className="muted mt-2 max-w-sm">
                    Print this and keep it on the desk. Students scan it when the class
                    starts and again when it ends. The code never changes.
                  </p>
                  <button
                    className="btn-outline !py-1 !px-2.5 text-xs mt-2 max-lg:!py-2 max-lg:!px-4 max-lg:text-sm"
                    disabled={!myQr.data?.code}
                    onClick={() => { printQrCards([{ name: myQr.data.name, code: myQr.data.code }]); }}
                  >
                    <Printer className="w-3.5 h-3.5" /> Print this card
                  </button>
                </div>
              </div>
            ) : (
              <Spinner />
            )}
          </div>
        )}

        {/* Someone who came without a phone never scanned. Opened from the
            button above, and it closes again once they are added. */}
        {addOpen && oneTeacher && status === 'Pending' && (
          <div className="rounded-xl border p-3 mb-4 max-lg:rounded-2xl max-lg:p-3.5" style={{ borderColor: 'var(--color-border)' }}>
            <div className="text-sm font-semibold mb-2">Student who did not scan</div>
          {roster.isLoading ? <Spinner /> : (roster.data || []).length === 0 ? (
            <p className="muted text-sm">
              {forAdmin
                ? `No active students assigned to ${teacherName || 'this teacher'} yet.`
                : 'No active students assigned to you yet. Your admin assigns students to you.'}
            </p>
          ) : (
            <>
              <div className="hidden lg:block">
                <table className="w-full table-fixed border-collapse">
                  <colgroup>{GRID.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                  <thead>
                    <tr>
                      {['Date', 'Students', 'Time In', 'Time Out', ''].map((h, i) => (
                        <th key={i} className="table-th" colSpan={ADD_ROW[i]}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {[addCell.date, addCell.students, addCell.timeIn, addCell.timeOut, addCell.action].map((node, i) => (
                        <td key={i} className="table-td align-top" colSpan={ADD_ROW[i]}>{node}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="lg:hidden m-form space-y-2">
                <CalendarPicker stretch value={addDate} onChange={setAddDate} placeholder="Date" />
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="m-label">Came in</label>{addCell.timeIn}</div>
                  <div><label className="m-label">Left</label>{addCell.timeOut}</div>
                </div>
                <div><label className="m-label">Students</label>{addCell.students}</div>
                <button
                  className="btn-primary w-full !py-2.5 !rounded-xl"
                  disabled={addManual.isPending}
                  onClick={() => (addProblem ? setAddError(addProblem) : addManual.mutate())}
                >
                  {addManual.isPending ? 'Adding…' : addHours ? `Add · ${hrs(addHours)}` : 'Add'}
                </button>
              </div>

              <p className="muted text-xs mt-2">
                Their row joins the list below, where the subject and topic are filled in
                the same as a scanned one.
              </p>
              {addError && <div className="text-sm mt-2 text-red-500">{addError}</div>}
            </>
          )}
          </div>
        )}

        {/* Several at once: the same lesson to several students on the same day
            only needs typing once. */}
        {status === 'Pending' && pickedIds.length > 0 && (
          <div className="rounded-xl border p-3 mb-4 m-form max-lg:rounded-2xl" style={{ borderColor: wide ? 'var(--color-border)' : 'var(--color-primary)' }}>
            <div className="text-sm font-semibold mb-2">
              {wide ? `${pickedIds.length} line(s) selected` : `${pickedIds.length} selected — fill once for all of them`}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
              <Select compact value={bulk.subject_id} onChange={(v) => setBulk({ ...bulk, subject_id: v })}
                options={subjectOptions} placeholder="Subject…" />
              <input className="input !py-1.5" placeholder="Topic" value={bulk.topic}
                onChange={(e) => setBulk({ ...bulk, topic: e.target.value })} />
              <input className="input !py-1.5" placeholder="Subtopic" value={bulk.subtopic}
                onChange={(e) => setBulk({ ...bulk, subtopic: e.target.value })} />
              <Select compact allowCustom value={bulk.venue} onChange={(v) => setBulk({ ...bulk, venue: v })}
                options={masters.venues.map((v) => ({ value: v, label: v }))} placeholder="Venue…" />
              <input className="input !py-1.5" placeholder="Meet link" value={bulk.meeting_link}
                onChange={(e) => setBulk({ ...bulk, meeting_link: e.target.value })} />
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3 max-lg:grid max-lg:grid-cols-3">
              <button className="btn-ghost !py-1 !px-2.5 text-xs max-lg:!py-2.5 max-lg:text-sm" onClick={() => setPicked(new Set())}>
                {wide ? 'Clear selection' : 'Clear'}
              </button>
              <button
                className="btn-outline !py-1 !px-2.5 text-xs ml-auto max-lg:!py-2.5 max-lg:ml-0 max-lg:text-sm"
                disabled={busy || (!bulk.subject_id && !bulk.topic && !bulk.subtopic && !bulk.venue && !bulk.meeting_link)}
                onClick={() => applyBulk.mutate(pickedIds)}
              >
                Apply to {pickedIds.length}
              </button>
              <button className="btn-primary !py-1 !px-2.5 text-xs max-lg:!py-2.5 max-lg:text-sm" disabled={busy}
                onClick={() => askConfirmMany(pickedIds)}>
                <Check className="w-3.5 h-3.5" /> Confirm {pickedIds.length}
              </button>
            </div>
          </div>
        )}

        {inbox.isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <p className="muted text-sm">
            {status === 'Pending'
              ? 'Nothing waiting — scans show up here as students arrive.'
              : 'Nothing confirmed yet.'}
          </p>
        ) : status === 'Confirmed' && !wide ? (
          // Phones: already lectures, as the same cards the lecture list uses.
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {rows.map((r) => (
              <li key={r.id} className="rounded-2xl p-3.5 flex gap-3" style={{ background: 'var(--color-card-alt)' }}>
                <DateTile iso={String(r.session_date).slice(0, 10)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold leading-snug break-words">
                      {r.student_name}{r.form_no != null && <span className="font-normal muted text-xs ml-1.5">{r.form_no}</span>}
                    </div>
                    <span className="shrink-0 text-sm font-bold tnum" style={{ color: 'var(--color-primary)' }}>{hrs(r.hours || 0)}</span>
                  </div>
                  <div className="text-xs muted tnum mt-0.5">{clock(timeOf(r.in_at))} – {clock(timeOf(r.out_at))}</div>
                  <div className="text-sm mt-1.5"><span className="font-medium">{r.subject_name || 'No subject'}</span>{r.topic && <span className="muted"> · {r.topic}</span>}</div>
                  {r.remark && <div className="text-xs muted italic mt-0.5">{r.remark}</div>}
                </div>
              </li>
            ))}
          </ul>
        ) : status === 'Confirmed' ? (
          // Already lectures: the same columns as the logged-lecture list.
          <Table head={['Date', 'Student', 'Time', { label: 'Hours', align: 'right' }, 'Subject / Topic']}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="table-td whitespace-nowrap">{fmtDate(String(r.session_date).slice(0, 10))}</td>
                <td className="table-td">
                  {r.student_name} {r.form_no != null && <span className="font-mono muted text-xs">{r.form_no}</span>}
                </td>
                <td className="table-td whitespace-nowrap">{clock(timeOf(r.in_at))} – {clock(timeOf(r.out_at))}</td>
                <td className="table-td text-right tabular-nums whitespace-nowrap">{hrs(r.hours || 0)}</td>
                <td className="table-td">
                  <span className="font-semibold">{r.subject_name || '—'}</span>
                  {(r.topic || r.remark) && (
                    <span className="block text-xs muted break-words">
                      {[r.topic, r.remark].filter(Boolean).join(' — ')}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <div className="space-y-5">
            {days.map(([day, dayRows]) => {
              const ids = dayRows.map((r) => r.id);
              const allPicked = ids.every((id) => picked.has(id));
              return (
                <div key={day}>
                  <div className="flex flex-wrap items-center gap-2 mb-1 max-lg:mb-2.5">
                    <h4 className="font-semibold text-sm">
                      {wide ? fmtDate(day) : day === todayIso() ? 'Today' : new Date(day + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </h4>
                    <span className="muted text-xs">{dayRows.length} student{dayRows.length === 1 ? '' : 's'}</span>
                    <button
                      className="btn-ghost !py-0.5 !px-2 text-[11px] ml-auto max-lg:!py-1.5 max-lg:!px-3 max-lg:text-xs"
                      onClick={() =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          ids.forEach((id) => (allPicked ? next.delete(id) : next.add(id)));
                          return next;
                        })
                      }
                    >
                      {allPicked ? 'Unselect this day' : 'Select this day'}
                    </button>
                  </div>

                  {/* Wide: two lines per student, under the lecture headings. */}
                  <div className="hidden lg:block">
                    <table className="w-full table-fixed border-collapse">
                      <colgroup>{GRID.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                      <thead>
                        <tr>
                          {['Student', 'Subject', 'Time In', 'Time Out', ''].map((h, i) => (
                            <th key={i} className="table-th" colSpan={ROW_ONE[i]}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dayRows.map((r) => {
                          const e = editOf(r);
                          const live = hoursBetween(e.in_time, e.out_time);
                          return [
                            <tr key={`${r.id}-a`}>
                              <td className="table-td align-top" colSpan={ROW_ONE[0]}>
                                <label className="flex items-start gap-2 cursor-pointer">
                                  <input type="checkbox" className="mt-1" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                                  <span>
                                    <span className="font-semibold">{r.student_name}</span>
                                    {r.form_no != null && <span className="font-mono muted text-xs ml-1">{r.form_no}</span>}
                                    {forAdmin && teacherId == null && (
                                      <span className="block text-xs muted">with {r.teacher_name}</span>
                                    )}
                                    {!r.out_at && <span className="block text-xs text-amber-600">no scan out</span>}
                                    {(editOf(r).in_time && editOf(r).out_time
                                      ? hoursBetween(editOf(r).in_time, editOf(r).out_time)
                                      : Number(r.hours || 0)) >= LONG_HOURS && (
                                      <span className="block text-xs text-red-600">
                                        {hrs(hoursBetween(editOf(r).in_time, editOf(r).out_time) || Number(r.hours || 0))} — check the time out
                                      </span>
                                    )}
                                    {!!r.added_by_hand && <span className="block text-xs muted">added by hand</span>}
                                  </span>
                                </label>
                              </td>
                              <td className="table-td align-top" colSpan={ROW_ONE[1]}>
                                <Select compact value={e.subject_id} onChange={(v) => setEdit(r, { subject_id: v })}
                                  options={subjectOptions} placeholder="Subject…" />
                              </td>
                              <td className="table-td align-top" colSpan={ROW_ONE[2]}>
                                <TimePicker value={e.in_time} onChange={(v) => setEdit(r, { in_time: v })} placeholder="In" />
                              </td>
                              <td className="table-td align-top" colSpan={ROW_ONE[3]}>
                                <TimePicker value={e.out_time} onChange={(v) => setEdit(r, { out_time: v })} placeholder="Out" />
                              </td>
                              <td className="table-td align-top" colSpan={ROW_ONE[4]}>
                                <div className="flex items-center gap-1.5 justify-end">
                                  <span
                                    className={`text-sm tabular-nums whitespace-nowrap mr-1 ${(live || Number(r.hours || 0)) >= LONG_HOURS ? 'text-red-600 font-semibold' : ''}`}
                                    title={(live || Number(r.hours || 0)) >= LONG_HOURS ? 'Longer than a usual class — check the time out before confirming' : undefined}
                                  >
                                    {hrs(live || Number(r.hours || 0))}
                                  </span>
                                  <button className="btn-ghost !py-1 !px-2.5 text-xs" disabled={busy} onClick={() => save.mutate(r)}>
                                    Save
                                  </button>
                                  <button className="btn-primary !py-1 !px-2.5 text-xs" disabled={busy || !live}
                                    onClick={() => askConfirmRow(r)}>
                                    Confirm
                                  </button>
                                  <button
                                    className="!py-1 !px-2.5 text-xs rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 transition-colors"
                                    disabled={busy}
                                    onClick={() => setDiscarding(r)}
                                  >
                                    Discard
                                  </button>
                                </div>
                              </td>
                            </tr>,
                            <tr key={`${r.id}-b`}>
                              <td className="table-td align-top pt-0" colSpan={ROW_TWO[0]} style={JOINED}>
                                <input className="input !py-1.5 w-full" placeholder="Topic" value={e.topic}
                                  onChange={(ev) => setEdit(r, { topic: ev.target.value })} />
                              </td>
                              <td className="table-td align-top pt-0" colSpan={ROW_TWO[1]} style={JOINED}>
                                <input className="input !py-1.5 w-full" placeholder="Subtopic" value={e.subtopic}
                                  onChange={(ev) => setEdit(r, { subtopic: ev.target.value })} />
                              </td>
                              <td className="table-td align-top pt-0" colSpan={ROW_TWO[2]} style={JOINED}>
                                <div className="relative">
                                  <input className="input !py-1.5 w-full pr-8" placeholder="Remark" value={e.remark}
                                    onChange={(ev) => setEdit(r, { remark: ev.target.value })} />
                                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2">
                                    <DictateButton icon value={e.remark} onChange={(v) => setEdit(r, { remark: v })} />
                                  </span>
                                </div>
                              </td>
                              <td className="table-td align-top pt-0" colSpan={ROW_TWO[3]} style={JOINED}>
                                <Select compact allowCustom value={e.venue} onChange={(v) => setEdit(r, { venue: v })}
                                  options={masters.venues.map((v) => ({ value: v, label: v }))} placeholder="Venue…" />
                              </td>
                              <td className="table-td align-top pt-0" colSpan={ROW_TWO[4]} style={JOINED}>
                                <input className="input !py-1.5 w-full" placeholder="Meet link" value={e.meeting_link}
                                  onChange={(ev) => setEdit(r, { meeting_link: ev.target.value })} />
                              </td>
                            </tr>,
                          ];
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Phones and tablets: one card per student — who and when on
                      top, what was taught in the middle, the three actions at the foot. */}
                  <div className="lg:hidden space-y-3">
                    {dayRows.map((r) => {
                      const e = editOf(r);
                      const live = hoursBetween(e.in_time, e.out_time);
                      const h = live || Number(r.hours || 0);
                      const long = h >= LONG_HOURS;
                      const on = picked.has(r.id);
                      const open = openMore.has(r.id);
                      return (
                        <div key={r.id} className="rounded-2xl border overflow-hidden transition-colors"
                          style={{ borderColor: on ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-card)' }}>
                          <label className="flex items-center gap-3 p-3.5 cursor-pointer"
                            style={{ background: on ? 'var(--color-accent-soft)' : 'var(--color-card-alt)' }}>
                            <input type="checkbox" className="w-5 h-5 shrink-0 accent-[var(--color-primary)]" checked={on} onChange={() => toggle(r.id)}
                              aria-label={`Select ${r.student_name}`} />
                            <span className="grid place-items-center w-10 h-10 rounded-full text-xs font-bold shrink-0"
                              style={{ background: 'var(--color-card)', color: 'var(--color-primary)' }}>
                              {String(r.student_name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold leading-snug break-words">
                                {r.student_name}
                                {r.form_no != null && <span className="font-normal muted text-xs ml-1.5">{r.form_no}</span>}
                              </span>
                              <span className="block text-xs muted tnum mt-0.5">
                                {clock(timeOf(r.in_at))} → {r.out_at ? clock(timeOf(r.out_at)) : '…'}
                                {forAdmin && teacherId == null && ` · with ${r.teacher_name}`}
                              </span>
                            </span>
                            <span className={`shrink-0 text-sm font-bold tnum px-2 py-0.5 rounded-full ${long ? 'bg-red-500/15 text-red-600 dark:text-red-400' : ''}`}
                              style={long ? {} : { color: h ? 'var(--color-primary)' : 'var(--color-muted)' }}>
                              {h ? hrs(h) : '—'}
                            </span>
                          </label>

                          {(!r.out_at || long || !!r.added_by_hand) && (
                            <div className="flex flex-wrap gap-1.5 px-3.5 pt-3">
                              {!r.out_at && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400">No scan out — set the time it ended</span>}
                              {long && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-500/15 text-red-600 dark:text-red-400">Longer than a class — check the time out</span>}
                              {!!r.added_by_hand && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full muted" style={{ background: 'var(--color-card-alt)' }}>Added by hand</span>}
                            </div>
                          )}

                          <div className="m-form p-3.5 space-y-2">
                            <div><label className="m-label">Subject</label>
                              <Select compact value={e.subject_id} onChange={(v) => setEdit(r, { subject_id: v })} options={subjectOptions} placeholder="Choose a subject" /></div>
                            <div className="grid grid-cols-2 gap-2">
                              <div><label className="m-label">Came in</label>
                                <TimePicker value={e.in_time} onChange={(v) => setEdit(r, { in_time: v })} placeholder="In" /></div>
                              <div><label className="m-label">Left</label>
                                <TimePicker value={e.out_time} onChange={(v) => setEdit(r, { out_time: v })} placeholder="Set time" /></div>
                            </div>
                            <div><label className="m-label">Topic</label>
                              <input className="input !py-1.5 w-full" placeholder="e.g. Electromagnetic induction" value={e.topic} onChange={(ev) => setEdit(r, { topic: ev.target.value })} /></div>
                            <div className="grid grid-cols-2 gap-2">
                              <div><label className="m-label">Subtopic</label>
                                <input className="input !py-1.5 w-full" placeholder="Optional" value={e.subtopic} onChange={(ev) => setEdit(r, { subtopic: ev.target.value })} /></div>
                              <div><label className="m-label">Remark</label>
                                <div className="relative">
                                  <input className="input !py-1.5 w-full pr-9" placeholder="Optional — or tap the mic" value={e.remark}
                                    onChange={(ev) => setEdit(r, { remark: ev.target.value })} />
                                  <span className="absolute right-2 top-1/2 -translate-y-1/2">
                                    <DictateButton icon value={e.remark} onChange={(v) => setEdit(r, { remark: v })} />
                                  </span>
                                </div></div>
                            </div>
                            <button type="button" className="w-full flex items-center gap-2 pt-1 text-sm font-medium text-left"
                              onClick={() => setOpenMore((prev) => { const n = new Set(prev); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
                              aria-expanded={open}>
                              <MapPin size={14} style={{ color: 'var(--color-primary)' }} />
                              <span className="flex-1">Venue and meeting link</span>
                              <span className="muted text-xs">{e.venue || 'No venue'}{e.meeting_link ? ' · link' : ''}</span>
                              <ChevronDown size={15} className={`muted transition-transform ${open ? 'rotate-180' : ''}`} />
                            </button>
                            {open && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <div><label className="m-label">Venue</label>
                                  <Select compact allowCustom value={e.venue} onChange={(v) => setEdit(r, { venue: v })} options={masters.venues.map((v) => ({ value: v, label: v }))} placeholder="Venue…" /></div>
                                <div><label className="m-label">Meet link</label>
                                  <input className="input !py-1.5 w-full" placeholder="For an online class" value={e.meeting_link} onChange={(ev) => setEdit(r, { meeting_link: ev.target.value })} /></div>
                              </div>
                            )}
                          </div>

                          <div className="grid grid-cols-[auto_1fr_1.4fr] gap-2 px-3.5 pb-3.5">
                            <button
                              className="grid place-items-center w-11 rounded-xl border border-red-500/30 text-red-600 dark:text-red-400 disabled:opacity-50"
                              disabled={busy}
                              onClick={() => setDiscarding(r)}
                              aria-label={`Discard ${r.student_name}'s check-in`}
                            >
                              <Trash2 size={16} />
                            </button>
                            <button className="btn-ghost !py-2.5 !rounded-xl" disabled={busy} onClick={() => save.mutate(r)}>Save</button>
                            <button className="btn-primary !py-2.5 !rounded-xl" disabled={busy || !live} onClick={() => askConfirmRow(r)}>
                              <Check size={16} /> Confirm
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>


      {longWarning && (
        <ConfirmModal
          danger
          title="That is a long class"
          message={
            longWarning.n === 1
              ? `This line charges ${hrs(longWarning.hours)}, longer than a usual class. It usually means the student forgot to scan out and scanned hours later. Check the time out before confirming.`
              : `${longWarning.n} of the selected lines are longer than a usual class, the longest ${hrs(longWarning.hours)}. That usually means a forgotten scan out. Confirm them anyway?`
          }
          confirmLabel="Confirm anyway"
          cancelLabel="Go back and fix"
          busy={confirmRow.isPending || confirmMany.isPending}
          onConfirm={() => {
            if (longWarning.row) confirmRow.mutate(longWarning.row);
            else if (longWarning.ids) confirmMany.mutate(longWarning.ids);
            setLongWarning(null);
          }}
          onClose={() => setLongWarning(null)}
        />
      )}

      {discarding && (
        <ConfirmModal
          danger
          title="Discard this check-in"
          message={`${discarding.student_name} on ${fmtDate(String(discarding.session_date).slice(0, 10))} will be marked discarded. It stays on record but never becomes a lecture.`}
          confirmLabel="Discard"
          busy={discard.isPending}
          onConfirm={() => discard.mutate(discarding)}
          onClose={() => setDiscarding(null)}
        />
      )}
    </div>
  );
}










