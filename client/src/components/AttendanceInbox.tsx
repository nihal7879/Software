import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Printer, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { Section, Spinner } from './ui';
import { Select } from './Select';
import { TimePicker } from './TimePicker';
import { CalendarPicker } from './CalendarPicker';
import { ConfirmModal } from './ConfirmModal';
import { QrCode } from './QrCode';
import { toast } from './Toast';
import { printQrCards, scanUrl } from '../lib/qr';

/**
 * Scanned check-ins waiting to be turned into lectures.
 *
 * One row per student, the way an imported payment waits in Finance. Nothing
 * here has touched anybody's hours yet: the teacher fills in the subject and
 * topic, on one row or on several of the same day at once, and confirms. Each
 * confirmed row becomes its own lecture charging that student their own time in
 * to time out, so a student who sat from 4:15 to 5:20 is charged 1.08 hours
 * whatever the rest of the room did.
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
};

type Edit = {
  subject_id: string;
  topic: string;
  subtopic: string;
  venue: string;
  remark: string;
  in_time: string;  // HH:MM:SS, only sent when the teacher changes it
  out_time: string;
};

/** A server timestamp to the HH:MM:SS a TimePicker wants. */
function timeOf(v: any) {
  if (!v) return '';
  const s = String(v);
  return s.includes('T') ? s.slice(11, 19) : s.slice(11, 19);
}

function clock(v: any) {
  const t = timeOf(v);
  if (!t) return '--';
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h)) return '--';
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function dayName(d: string) {
  const date = new Date(`${String(d).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(d).slice(0, 10);
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Hours between two HH:MM:SS times, 0 when they do not make sense. */
function hoursBetween(from: string, to: string) {
  if (!from || !to) return 0;
  const [h1, m1] = from.split(':').map(Number);
  const [h2, m2] = to.split(':').map(Number);
  if ([h1, m1, h2, m2].some(Number.isNaN)) return 0;
  const mins = h2 * 60 + m2 - (h1 * 60 + m1);
  return mins > 0 ? Math.round((mins / 60) * 100) / 100 : 0;
}

function seed(r: Row): Edit {
  return {
    subject_id: r.subject_id ? String(r.subject_id) : '',
    topic: r.topic || '',
    subtopic: r.subtopic || '',
    venue: r.venue || '',
    remark: r.remark || '',
    in_time: timeOf(r.in_at),
    out_time: timeOf(r.out_at),
  };
}

export function AttendanceInbox({
  admin = false,
  teacherId,
  teacherName,
}: {
  admin?: boolean;
  teacherId?: number;
  teacherName?: string;
}) {
  const qc = useQueryClient();
  const forAdmin = admin;
  // An admin looking at every teacher at once has no single code to print.
  const showQrCard = !forAdmin || teacherId != null;

  const [status, setStatus] = useState<'Pending' | 'Confirmed'>('Pending');
  const [date, setDate] = useState('');
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [bulk, setBulk] = useState({ subject_id: '', topic: '', subtopic: '', venue: '' });
  const [discarding, setDiscarding] = useState<Row | null>(null);
  const [showQr, setShowQr] = useState(false);

  const subjects = useQuery({
    queryKey: ['subjects'],
    queryFn: () => api.get('/teachers/subjects').then((r) => r.data.data as any[]),
  });

  // The teacher's own printed code, so it can be reprinted without hunting for it.
  const myQr = useQuery({
    queryKey: ['qr-code', teacherId ?? 'me'],
    enabled: showQrCard,
    queryFn: () =>
      api.get(forAdmin ? `/teachers/${teacherId}/qr` : '/teachers/me/qr').then((r) => r.data),
  });

  const inbox = useQuery({
    queryKey: ['checkin-inbox', teacherId ?? 'me', status, date],
    queryFn: () =>
      api
        .get('/checkin/inbox', { params: { status, teacherId, date: date || undefined } })
        .then((r) => r.data.data as Row[]),
  });

  const rows = inbox.data || [];
  const subjectOptions = useMemo(
    () => (subjects.data || []).map((s: any) => ({ value: String(s.id), label: s.name })),
    [subjects.data]
  );

  const editOf = (r: Row) => edits[r.id] || seed(r);
  const setEdit = (r: Row, patch: Partial<Edit>) =>
    setEdits((prev) => ({ ...prev, [r.id]: { ...(prev[r.id] || seed(r)), ...patch } }));

  /** What a row sends to the server, leaving out anything untouched. */
  function payloadOf(r: Row) {
    const e = editOf(r);
    const base = seed(r);
    const body: any = {
      subject_id: e.subject_id ? Number(e.subject_id) : null,
      topic: e.topic || null,
      subtopic: e.subtopic || null,
      venue: e.venue || null,
      remark: e.remark || null,
    };
    if (e.in_time && e.in_time !== base.in_time) body.in_time = e.in_time.slice(0, 5);
    if (e.out_time && e.out_time !== base.out_time) body.out_time = e.out_time.slice(0, 5);
    return body;
  }

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['checkin-inbox'] });
    setPicked(new Set());
  };
  const refreshLectures = () => {
    ['ledger', 'ledger-all', 'lectures', 'workload', 'teacher-lectures', 'hours'].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k] })
    );
  };

  const save = useMutation({
    mutationFn: (r: Row) => api.patch(`/checkin/${r.id}`, payloadOf(r)),
    onSuccess: () => { toast('Saved.'); refresh(); },
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
      refresh();
      refreshLectures();
    },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not confirm those.', 'error'),
  });

  const discard = useMutation({
    mutationFn: (r: Row) => api.delete(`/checkin/${r.id}`),
    onSuccess: () => { toast('Discarded.'); setDiscarding(null); refresh(); },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not discard that.', 'error'),
  });

  // Rows by day, newest day first, so a day can be handled together.
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

  const pickedIds = [...picked];
  const busy = save.isPending || confirmRow.isPending || applyBulk.isPending || confirmMany.isPending;

  const label = (text: string, node: any) => (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide muted mb-1">{text}</div>
      {node}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* The printed code. Folded away by default: it is set up once and then
          only reprinted when a card goes missing. */}
      {showQrCard && (
      <Section
        title={forAdmin ? `QR code for ${teacherName || 'this teacher'}` : 'My QR code'}
        action={
          <>
            <button className="btn-outline !py-1 !px-2.5 text-xs" onClick={() => setShowQr((v) => !v)}>
              {showQr ? 'Hide' : 'Show'}
            </button>
            <button
              className="btn-outline !py-1 !px-2.5 text-xs"
              disabled={!myQr.data?.code}
              onClick={() => { printQrCards([{ name: myQr.data.name, code: myQr.data.code }]); }}
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
          </>
        }
      >
        {showQr ? (
          myQr.data?.code ? (
            <div className="flex flex-wrap items-center gap-5">
              <QrCode text={scanUrl(myQr.data.code)} size={200} />
              <div className="text-sm">
                <div className="font-display font-bold text-lg">{myQr.data.name}</div>
                <div className="font-mono tracking-widest text-base mt-1">{myQr.data.code}</div>
                <p className="muted mt-2 max-w-sm">
                  Print this and keep it on the desk. Students scan it when the class
                  starts and again when it ends. The code never changes.
                </p>
              </div>
            </div>
          ) : (
            <Spinner />
          )
        ) : (
          <p className="muted text-sm">
            The fixed code for the desk. Students scan it at the start and end of the class.
          </p>
        )}
      </Section>
      )}

      <Section
        title={status === 'Pending' ? 'Scanned check-ins' : 'Confirmed check-ins'}
        action={
          <>
            <CalendarPicker value={date} onChange={setDate} placeholder="Any date" align="right" />
            {date && (
              <button className="btn-outline !py-1 !px-2.5 text-xs" onClick={() => setDate('')}>
                Clear
              </button>
            )}
            <button
              className="btn-outline !py-1 !px-2.5 text-xs"
              onClick={() => { setStatus(status === 'Pending' ? 'Confirmed' : 'Pending'); setPicked(new Set()); }}
            >
              {status === 'Pending' ? 'Show confirmed' : 'Show pending'}
            </button>
          </>
        }
      >
        <p className="muted text-sm mb-3">
          {status === 'Pending'
            ? 'Each scan is one student. Fill in the subject and topic, then confirm — that is when it becomes a lecture and counts against their hours.'
            : 'Already turned into lectures.'}
        </p>

        {/* Several rows at once: the same lesson taught to several students on
            the same day only needs typing once. */}
        {status === 'Pending' && pickedIds.length > 0 && (
          <div className="rounded-xl border p-3 mb-4 space-y-3" style={{ borderColor: 'var(--color-border)' }}>
            <div className="text-sm font-semibold">{pickedIds.length} row(s) selected</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
              {label('Subject', (
                <Select
                  compact
                  value={bulk.subject_id}
                  onChange={(v) => setBulk({ ...bulk, subject_id: v })}
                  options={subjectOptions}
                  placeholder="Subject"
                />
              ))}
              {label('Topic', (
                <input className="input" value={bulk.topic} onChange={(e) => setBulk({ ...bulk, topic: e.target.value })} />
              ))}
              {label('Subtopic', (
                <input className="input" value={bulk.subtopic} onChange={(e) => setBulk({ ...bulk, subtopic: e.target.value })} />
              ))}
              {label('Venue', (
                <input className="input" value={bulk.venue} onChange={(e) => setBulk({ ...bulk, venue: e.target.value })} />
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-outline !py-1 !px-2.5 text-xs"
                disabled={busy || (!bulk.subject_id && !bulk.topic && !bulk.subtopic && !bulk.venue)}
                onClick={() => applyBulk.mutate(pickedIds)}
              >
                Apply to {pickedIds.length}
              </button>
              <button
                className="btn-primary !py-1 !px-2.5 text-xs"
                disabled={busy}
                onClick={() => confirmMany.mutate(pickedIds)}
              >
                <Check className="w-3.5 h-3.5" /> Confirm {pickedIds.length}
              </button>
              <button className="btn-outline !py-1 !px-2.5 text-xs ml-auto" onClick={() => setPicked(new Set())}>
                Clear selection
              </button>
            </div>
          </div>
        )}

        {inbox.isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <p className="muted text-sm">
            {status === 'Pending' ? 'Nothing waiting. Scans show up here as students arrive.' : 'Nothing confirmed yet.'}
          </p>
        ) : (
          <div className="space-y-5">
            {days.map(([day, dayRows]) => {
              const ids = dayRows.map((r) => r.id);
              const allPicked = ids.every((id) => picked.has(id));
              return (
                <div key={day} className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-semibold text-sm">{dayName(day)}</h4>
                    <span className="muted text-xs">{dayRows.length} student(s)</span>
                    {status === 'Pending' && (
                      <button
                        className="btn-outline !py-0.5 !px-2 text-[11px] ml-auto"
                        onClick={() =>
                          setPicked((prev) => {
                            const next = new Set(prev);
                            ids.forEach((id) => (allPicked ? next.delete(id) : next.add(id)));
                            return next;
                          })
                        }
                      >
                        {allPicked ? 'Unselect day' : 'Select this day'}
                      </button>
                    )}
                  </div>

                  {dayRows.map((r) => {
                    const e = editOf(r);
                    const live = hoursBetween(e.in_time, e.out_time);
                    const missingOut = !r.out_at;
                    return (
                      <div key={r.id} className="card p-3 space-y-3">
                        {/* What the scan itself recorded: not editable except the
                            times, which a missed scan leaves for the teacher. */}
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          {status === 'Pending' && (
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={picked.has(r.id)}
                              onChange={() => toggle(r.id)}
                            />
                          )}
                          <span className="font-semibold">{r.student_name}</span>
                          {r.form_no && <span className="muted text-xs">#{r.form_no}</span>}
                          {forAdmin && teacherId == null && (
                            <span className="text-xs muted">with {r.teacher_name}</span>
                          )}
                          <span className="text-xs muted">
                            In {clock(r.in_at)} &middot; Out {r.out_at ? clock(r.out_at) : '--'}
                          </span>
                          <span className="tnum text-sm font-semibold ml-auto">
                            {(live || Number(r.hours || 0)).toFixed(2)} h
                          </span>
                          {missingOut && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600">
                              no scan out
                            </span>
                          )}
                        </div>

                        {status === 'Pending' ? (
                          <>
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
                              {label('Subject', (
                                <Select
                                  compact
                                  value={e.subject_id}
                                  onChange={(v) => setEdit(r, { subject_id: v })}
                                  options={subjectOptions}
                                  placeholder="Subject"
                                />
                              ))}
                              {label('Topic', (
                                <input className="input" value={e.topic} onChange={(ev) => setEdit(r, { topic: ev.target.value })} />
                              ))}
                              {label('Subtopic', (
                                <input className="input" value={e.subtopic} onChange={(ev) => setEdit(r, { subtopic: ev.target.value })} />
                              ))}
                              {label('Venue', (
                                <input className="input" value={e.venue} onChange={(ev) => setEdit(r, { venue: ev.target.value })} />
                              ))}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
                              {label('Time in', (
                                <TimePicker value={e.in_time} onChange={(v) => setEdit(r, { in_time: v })} />
                              ))}
                              {label(missingOut ? 'Time out (they did not scan)' : 'Time out', (
                                <TimePicker value={e.out_time} onChange={(v) => setEdit(r, { out_time: v })} />
                              ))}
                              <div className="sm:col-span-2">
                                {label('Remark', (
                                  <input className="input" value={e.remark} onChange={(ev) => setEdit(r, { remark: ev.target.value })} />
                                ))}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs muted">
                                Charges {r.student_name.split(' ')[0]} {(live || Number(r.hours || 0)).toFixed(2)} hours.
                              </span>
                              <button
                                className="btn-outline !py-1 !px-2.5 text-xs ml-auto"
                                disabled={busy}
                                onClick={() => save.mutate(r)}
                              >
                                Save for later
                              </button>
                              <button
                                className="btn-primary !py-1 !px-2.5 text-xs"
                                disabled={busy || !live}
                                onClick={() => confirmRow.mutate(r)}
                              >
                                <Check className="w-3.5 h-3.5" /> Confirm
                              </button>
                              <button
                                className="!py-1 !px-2.5 text-xs rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10"
                                disabled={busy}
                                onClick={() => setDiscarding(r)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="text-sm muted">
                            {r.subject_name || 'No subject'}
                            {r.topic ? ` - ${r.topic}` : ''}
                            {r.subtopic ? ` / ${r.subtopic}` : ''}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {discarding && (
        <ConfirmModal
          danger
          title="Discard this check-in?"
          message={`${discarding.student_name} on ${dayName(discarding.session_date)} will be marked discarded. It stays on record but never becomes a lecture.`}
          confirmLabel="Discard"
          busy={discard.isPending}
          onConfirm={() => discard.mutate(discarding)}
          onClose={() => setDiscarding(null)}
        />
      )}
    </div>
  );
}
