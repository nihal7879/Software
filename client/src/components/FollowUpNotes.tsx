import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquarePlus, Trash2 } from 'lucide-react';
import { api, fmtDate, todayIso } from '../api/client';
import { Overlay } from './Overlay';
import { CalendarPicker } from './CalendarPicker';
import { toast } from './Toast';

const today = () => todayIso();
const day = (v?: string | null) => (v ? fmtDate(String(v).slice(0, 10)) : '');

// '2026-09-16 10:56:38' → '16-09-26, 10:56 AM' — a note says when it was written,
// not only on which day: several calls in a day are common while chasing a fee.
const dayTime = (v?: string | null) => {
  if (!v) return '';
  const [date, time = ''] = String(v).split(/[ T]/);
  const [hRaw, m] = time.split(':');
  const h = Number(hRaw);
  if (Number.isNaN(h)) return day(date);
  return `${day(date)}, ${h % 12 || 12}:${m ?? '00'} ${h >= 12 ? 'PM' : 'AM'}`;
};

/**
 * The follow-up notes on one student — the record of chasing a fee: who was
 * called, what they said, when to come back to them. Every note is kept, so the
 * next person picking the student up sees the whole story, not just the last line.
 */
export function FollowUpNotesDialog({
  studentId,
  studentName,
  formNo,
  onClose,
}: {
  studentId: number;
  studentName: string;
  formNo?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [error, setError] = useState('');

  const notes = useQuery({
    queryKey: ['follow-ups', studentId],
    queryFn: () => api.get(`/follow-ups/${studentId}`).then((r) => r.data.data as any[]),
  });
  // The list behind this dialog shows the latest note, so it refreshes too.
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['follow-ups', studentId] });
    qc.invalidateQueries({ queryKey: ['ledger-all'] });
  };

  const add = useMutation({
    mutationFn: () => api.post(`/follow-ups/${studentId}`, { note: note.trim(), follow_up_on: dueOn || null }),
    onSuccess: () => { setNote(''); setDueOn(''); setError(''); refresh(); toast('Note added'); },
    onError: (e: any) => setError(e?.response?.data?.error || 'Could not add the note.'),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/follow-ups/note/${id}`),
    onSuccess: () => { refresh(); toast('Note deleted'); },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not delete the note', 'error'),
  });

  const rows = notes.data || [];

  return (
    <Overlay align="center" onClose={onClose}>
      {/* Capped to the screen, with the history the only part that scrolls — a
          student with many notes used to push the heading and Close off-screen. */}
      <div className="card w-full max-w-lg p-6 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-1 shrink-0">Follow-up notes</h2>
        <p className="muted text-sm mb-4 shrink-0">{studentName}{formNo ? ` · Form ${formNo}` : ''}</p>

        <div className="rounded-xl p-3 mb-4 shrink-0" style={{ background: 'var(--color-card-alt)' }}>
          <label className="text-xs font-medium muted">New note</label>
          <textarea
            className="input mt-1"
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap items-end gap-2 mt-2">
            <div className="w-full sm:w-52">
              <label className="text-xs font-medium muted block mb-1">Follow up on (optional)</label>
              <CalendarPicker value={dueOn} onChange={setDueOn} placeholder="Pick a date…" />
            </div>
            {dueOn && (
              <button className="btn-ghost !py-1.5 !px-3 text-sm" onClick={() => setDueOn('')}>Clear date</button>
            )}
            <button
              className="btn-primary !py-2 ml-auto"
              disabled={!note.trim() || add.isPending}
              onClick={() => add.mutate()}
            >
              {add.isPending ? 'Saving…' : 'Add note'}
            </button>
          </div>
          {error && <div className="text-sm text-red-500 mt-2">{error}</div>}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto thin-scroll -mx-1 px-1">
          {notes.isLoading ? (
            <p className="muted text-sm">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="muted text-sm">No notes yet — the first one goes above.</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((n) => {
                const due = n.follow_up_on ? String(n.follow_up_on).slice(0, 10) : '';
                return (
                  <li key={n.id} className="card p-3">
                    <div className="flex items-start gap-2">
                      <p className="text-sm flex-1 whitespace-pre-wrap break-words">{n.note}</p>
                      <button
                        className="text-red-500 hover:bg-red-500/10 rounded-lg p-1 shrink-0"
                        title="Delete this note"
                        aria-label="Delete this note"
                        disabled={del.isPending}
                        onClick={() => del.mutate(n.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="text-xs muted mt-1 flex flex-wrap gap-x-2">
                      <span>{dayTime(n.created_at)}</span>
                      {n.created_by_name && <span>· {n.created_by_name}</span>}
                      {due && (
                        <span className={due <= today() ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''}>
                          · follow up {day(due)}{due <= today() ? ' (due)' : ''}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <button className="btn-ghost w-full mt-4 shrink-0" onClick={onClose}>Close</button>
      </div>
    </Overlay>
  );
}

/**
 * The Follow-up cell in the students list: how many notes there are, when the
 * last one was written, and the follow-up date if set (highlighted once due).
 * The note text itself is not shown — a long note stretched the column — and is
 * one click away in the full history.
 */
export function FollowUpCell({ row, onOpen }: { row: any; onOpen: () => void }) {
  const due = row.last_note_due ? String(row.last_note_due).slice(0, 10) : '';
  const overdue = due && due <= today();
  return (
    <button
      type="button"
      className="text-left w-full group"
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      title={row.last_note ? 'View and add follow-up notes' : 'Add a follow-up note'}
    >
      {row.last_note ? (
        <>
          <span className="block text-sm font-medium group-hover:underline whitespace-nowrap">
            {Number(row.note_count) || 1} note{Number(row.note_count) === 1 ? '' : 's'}
          </span>
          <span className="block text-xs muted whitespace-nowrap">
            last {day(row.last_note_at)}
            {due && (
              <span className={overdue ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''}>
                {' '}· follow up {day(due)}{overdue ? ' (due)' : ''}
              </span>
            )}
          </span>
        </>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs muted group-hover:text-[var(--color-primary)]">
          <MessageSquarePlus size={14} /> Add note
        </span>
      )}
    </button>
  );
}
