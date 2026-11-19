import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, StickyNote, Check, Undo2, ChevronDown, ChevronRight, X, Copy, Pencil, MessageSquareText } from 'lucide-react';
import { api, fmtDate } from '../../api/client';
import { Spinner, HoursValue } from '../../components/ui';
import { toast } from '../../components/Toast';
import { ReminderWording } from '../../components/ReminderWording';
import { useAuth } from '../../auth/AuthContext';

/**
 * Reminders — the fee-chasing list.
 *
 * Before this, the only thing that noticed a student running out of hours was
 * the student's own dashboard. Nothing reached the office, so the first the
 * institute heard of an empty package was a parent already three classes into
 * an overdraft.
 *
 * Day by day, newest first, done and not done together. The office works down
 * it: ring the parent, type what they said, tick it.
 *
 * Deliberately NOT here, all asked for by the client on 18 November 2026:
 *
 *  - No figures across the top. The client did not want a dashboard; they
 *    wanted a list of calls to make.
 *  - No phone numbers. The name opens the student, where the numbers live
 *    beside everything else about them.
 *  - No WhatsApp button. Messages are sent by hand for now; the Business API
 *    is a separate decision with its own cost.
 *  - No grade. The form number is what the office actually uses to find
 *    somebody, so that is what a row carries.
 *
 * "Done" means a person SPOKE TO THE PARENT — never that somebody opened the
 * screen. On a shared front-office login a read flag would be set by whoever
 * looked first, and the parent would never be called.
 */

type Row = {
  id: number;
  student_id: number;
  tier: number;
  /** The balance when the reminder fired. */
  hours_left: string;
  /** The balance right now — the same figure Student Hours shows. */
  hours_now: string;
  message: string;
  raised_at: string;
  done_at: string | null;
  done_by_name: string | null;
  follow_up_id: number | null;
  /** Set when a person has reworded this one — usually to add the package amount. */
  message_edited_at: string | null;
  message_edited_by_name: string | null;
  note: string | null;
  note_at: string | null;
  note_by_name: string | null;
  form_no: string;
  full_name: string;
};

type State = 'all' | 'open' | 'done';

const STATES: { key: State; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Not done' },
  { key: 'done', label: 'Done' },
];

const RANGES = [
  { key: '7', label: 'Last 7 days' },
  { key: '30', label: 'Last 30 days' },
  { key: 'all', label: 'Everything' },
];

/** '2026-11-18 09:12:04' → '09:12 AM'. Never toISOString: that is UTC. */
function clock(v: string) {
  const [, time = ''] = String(v).split(/[ T]/);
  const [hRaw, m] = time.split(':');
  const h = Number(hRaw);
  if (Number.isNaN(h)) return '';
  return `${String(h % 12 || 12).padStart(2, '0')}:${m ?? '00'} ${h >= 12 ? 'PM' : 'AM'}`;
}
const dayOf = (v: string) => String(v).split(/[ T]/)[0];
const dayTime = (v?: string | null) => (v ? `${fmtDate(dayOf(v))}, ${clock(v)}` : '');

/** The day heading: TODAY, YESTERDAY, then the weekday. */
function dayLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const gap = Math.round((midnight.getTime() - d.getTime()) / 86400000);
  const long = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  if (gap === 0) return `TODAY · ${long}`;
  if (gap === 1) return `YESTERDAY · ${long}`;
  return `${d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase()} · ${long}`;
}

/** What the step is called on the row. The number is the hours, not a code. */
/**
 * The badge names the CONDITION, not the threshold.
 *
 * It used to print the step — "5 HOURS LEFT" — on a student who actually had
 * one hour left, because 5 is where the rule fires, not where the student is.
 * Two different numbers for the same student on the same row is how a screen
 * loses an office's trust. The real balance is on the row already, beside the
 * form number, so the badge says what kind of call this is and nothing more.
 */
function tierLabel(tier: number) {
  if (tier > 0) return 'RUNNING LOW';
  if (tier === 0) return 'OUT OF HOURS';
  return 'OVERDRAWN';
}
function tierStyle(tier: number) {
  if (tier > 0) return { background: 'rgb(249 115 22 / 0.12)', color: 'var(--color-primary)' };
  if (tier === 0) return { background: 'rgb(239 68 68 / 0.12)', color: '#B91C1C' };
  return { background: 'rgb(185 28 28 / 0.15)', color: '#991B1B' };
}

export default function Reminders() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [state, setState] = useState<State>('all');
  const [days, setDays] = useState('30');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  // Which rows have their earlier reminders open, and which is being noted.
  const [openPrev, setOpenPrev] = useState<Record<number, boolean>>({});
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [editingMsg, setEditingMsg] = useState<number | null>(null);
  const [msgDraft, setMsgDraft] = useState('');
  const [showWording, setShowWording] = useState(false);

  // The bank details and sign-off that go under every fee message the
  // institute sends. Kept out of the row — the office knows their own bank
  // account by heart and does not need to read it 33 times — but added back
  // when the message is copied, so what lands in WhatsApp is complete.
  const config = useQuery({
    queryKey: ['reminders-config'],
    queryFn: () => api.get('/reminders/config').then((r) => r.data as { signature: string }),
    staleTime: 5 * 60_000,
  });

  const copyMessage = async (r: Row) => {
    const sig = config.data?.signature?.trim();
    const full = sig ? `${r.message}\n\n${sig}` : r.message;
    try {
      await navigator.clipboard.writeText(full);
      toast('Message copied');
    } catch {
      // Clipboard access is refused on an insecure origin and in some
      // embedded browsers; falling back keeps the button honest.
      window.prompt('Copy the message:', full);
    }
  };

  const list = useQuery({
    queryKey: ['reminders', state, days, search],
    queryFn: () =>
      api.get('/reminders', { params: { state, days, search: search.trim() || undefined } })
        .then((r) => r.data as { data: Row[]; counts: Record<State, number> }),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['reminders'] });
    qc.invalidateQueries({ queryKey: ['reminders-open'] });
    // The note lands on the student too, so Student Hours must not keep a stale copy.
    qc.invalidateQueries({ queryKey: ['follow-ups'] });
  };

  const setDone = useMutation({
    mutationFn: ({ id, done }: { id: number; done: boolean }) =>
      done ? api.post(`/reminders/${id}/done`) : api.delete(`/reminders/${id}/done`),
    onSuccess: (_d, v) => { refresh(); toast(v.done ? 'Marked done' : 'Back to not done'); },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not change it', 'error'),
  });

  // Rewording one reminder before it goes out. The commonest reason is the
  // package amount, which the system cannot know — AED 4200 for 30 hours for
  // most families, but not all of them.
  const saveMessage = useMutation({
    mutationFn: ({ id, message }: { id: number; message: string }) => api.put(`/reminders/${id}/message`, { message }),
    onSuccess: () => { setEditingMsg(null); setMsgDraft(''); refresh(); toast('Message saved'); },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not save the message', 'error'),
  });
  const resetMessage = useMutation({
    mutationFn: (id: number) => api.delete(`/reminders/${id}/message`),
    onSuccess: () => { setEditingMsg(null); setMsgDraft(''); refresh(); toast('Wording restored'); },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not restore it', 'error'),
  });

  const saveNote = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) => api.post(`/reminders/${id}/note`, { note }),
    // Short on purpose: the row itself says "Saved to Follow-ups … also on this
    // student in Student Hours" underneath, and says it permanently. A toast
    // that repeats what is already on screen is just something to read twice.
    onSuccess: () => { setEditing(null); setDraft(''); refresh(); toast('Note saved'); },
    onError: (e: any) => toast(e?.response?.data?.error || 'Could not save the note', 'error'),
  });

  const rows = list.data?.data || [];
  const counts = list.data?.counts;

  // Grouped by the day it was raised; the server already sorted it.
  const groups = useMemo(() => {
    const out: { day: string; rows: Row[] }[] = [];
    for (const r of rows) {
      const d = dayOf(r.raised_at);
      const last = out[out.length - 1];
      if (last && last.day === d) last.rows.push(r);
      else out.push({ day: d, rows: [r] });
    }
    return out;
  }, [rows]);

  /** Everything this student was told before this row — the history on the call. */
  const earlier = (r: Row) =>
    rows.filter((x) => x.student_id === r.student_id && (x.raised_at < r.raised_at || (x.raised_at === r.raised_at && x.id < r.id)));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[240px]">
          <h1 className="text-2xl font-bold">Reminders</h1>
          <p className="muted text-sm mt-1">
            Raised on their own when an active student runs low on hours. Day by day, newest first.
          </p>
        </div>
        {/* Only the super admin, who is the only one who can change it. An
            admin opening a panel to find every field disabled learns nothing
            except that the button was not for them. */}
        {user?.role === 'superadmin' && (
          <button className="btn-ghost" onClick={() => setShowWording(true)}>
            <MessageSquareText size={16} />
            Wording
          </button>
        )}
      </div>
      {showWording && <ReminderWording onClose={() => setShowWording(false)} />}

      <div className="card overflow-hidden">
        {/* Filters. The counts are for the whole range, not the page — a button
            that says how many it would show has to mean it. */}
        <div
          className="flex flex-wrap items-center gap-3 px-4 py-3 border-b"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-card-alt)' }}
        >
          {/* How many are on screen sits on the left, on its own. The things
              that CHANGE what is on screen — search, state, how far back — are
              grouped together on the right, so the bar reads as one fact and
              one set of controls rather than four unrelated boxes in a row. */}
          <span className="text-xs muted whitespace-nowrap">{rows.length} shown</span>

          <div className="ml-auto flex flex-wrap items-center gap-3">
            {/* A magnifier until it is wanted: most days the office works
                straight down the day groups and never searches at all, and an
                empty box sitting open pushed everything else apart. Typing
                keeps it open; emptying it and clicking away folds it back. */}
            {searchOpen || search ? (
              <div className="relative w-[240px]">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 muted" />
                <input
                  className="input !pl-9 !pr-8"
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onBlur={() => { if (!search.trim()) setSearchOpen(false); }}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setSearch(''); setSearchOpen(false); } }}
                  placeholder="Name, parent or form number…"
                />
                {search && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 muted hover:opacity-70"
                    title="Clear"
                    onClick={() => { setSearch(''); setSearchOpen(false); }}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            ) : (
              <button className="btn-ghost !px-2.5 !py-2" title="Find a student" onClick={() => setSearchOpen(true)}>
                <Search size={16} />
              </button>
            )}

            <div className="inline-flex gap-1 rounded-lg p-1" style={{ background: 'var(--color-card)' }}>
              {STATES.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setState(s.key)}
                  className="px-3 py-1.5 rounded-md text-sm font-semibold transition-colors"
                  style={
                    state === s.key
                      ? { background: 'var(--color-primary)', color: '#fff' }
                      : { color: 'var(--color-muted)' }
                  }
                >
                  {s.label}
                  {counts ? <span className="ml-1.5 opacity-70">{counts[s.key]}</span> : null}
                </button>
              ))}
            </div>

            <select className="input !w-auto" value={days} onChange={(e) => setDays(e.target.value)}>
              {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </div>
        </div>

        {list.isLoading ? (
          <Spinner />
        ) : !groups.length ? (
          <div className="py-14 text-center muted text-sm">
            {search || state !== 'all'
              ? 'Nothing matches. Change the filter, or clear the search.'
              : 'Nothing to chase. Every active student has hours left.'}
          </div>
        ) : (
          groups.map((g) => {
            const left = g.rows.filter((r) => !r.done_at).length;
            return (
              <div key={g.day}>
                <div
                  className="flex items-center gap-3 px-4 py-2.5 border-y"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-card-alt)' }}
                >
                  <span className="text-[12px] font-bold tracking-[0.05em]">{dayLabel(g.day)}</span>
                  <span
                    className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: 'var(--color-card)', color: 'var(--color-muted)' }}
                  >
                    {g.rows.length}
                  </span>
                  <span className="ml-auto text-xs muted">{left ? `${left} still to do` : 'all done'}</span>
                </div>

                {g.rows.map((r) => {
                  const prev = earlier(r);
                  const shown = openPrev[r.id];
                  const isDone = !!r.done_at;
                  return (
                    <div
                      key={r.id}
                      className="px-4 py-4 border-b"
                      style={{
                        borderColor: isDone ? 'var(--color-reminder-done-line, #F5E6B3)' : 'var(--color-border)',
                        // Pale yellow for done, as the client asked — light enough
                        // to read black text on, strong enough to pick out down a
                        // long day of rows.
                        background: isDone ? 'var(--color-reminder-done, #FEF8E1)' : undefined,
                      }}
                    >
                      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                        <span className="text-xs muted tnum w-16 pt-1 shrink-0">{clock(r.raised_at)}</span>

                        <div className="w-44 shrink-0">
                          {/* The name opens the student — that is where the phone
                              numbers are, beside everything else about them. */}
                          <a
                            href={`/admin/student/${r.student_id}`}
                            className="font-semibold hover:underline"
                            style={{ color: isDone ? 'var(--color-text)' : undefined }}
                          >
                            {r.full_name}
                          </a>
                          <div className="text-xs muted tnum mt-0.5">Form <b>{r.form_no}</b></div>
                          {/* The hours as they stand now — the same figure, from
                              the same expression, as Student Hours. Somebody
                              about to ring a parent needs what is true at the
                              moment they dial, not what was true when the
                              reminder fired. When those differ the row says so,
                              because a balance that has slipped another three
                              hours since Monday changes how the call goes. */}
                          <div className="mt-1 text-xs tnum">
                            <HoursValue value={r.hours_now} />
                            <span className="muted"> left</span>
                            {Math.abs(Number(r.hours_now) - Number(r.hours_left)) >= 0.01 && (
                              <span className="muted"> · was {Number(r.hours_left).toFixed(2)} h</span>
                            )}
                          </div>
                        </div>

                        <div className="flex-1 min-w-[260px]">
                          <div className="flex flex-wrap items-center gap-2 mb-1.5">
                            <span
                              className="text-[11px] font-bold tracking-[0.02em] px-2 py-0.5 rounded-full"
                              style={tierStyle(r.tier)}
                            >
                              {tierLabel(r.tier)}
                            </span>
                            {isDone && (
                              <span
                                className="text-[11px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                                style={{ background: 'rgb(245 158 11 / 0.18)', color: '#92610B' }}
                              >
                                <Check size={11} strokeWidth={3} /> Done
                              </span>
                            )}
                          </div>

                          {/* whitespace-pre-line: the message is written the way
                              it will be sent, greeting on its own line and a
                              blank line before the request. Flattening it here
                              would hide what the parent is actually going to
                              see. */}
                          {editingMsg === r.id ? (
                            <div>
                              <textarea
                                className="input"
                                rows={7}
                                maxLength={4000}
                                autoFocus
                                value={msgDraft}
                                onChange={(e) => setMsgDraft(e.target.value)}
                              />
                              {/* The bank block, shown but not editable: the
                                  person rewording this has to see the whole
                                  message they are about to send, or they will
                                  paste the bank details in again and the
                                  parent will get them twice. It is one shared
                                  setting, changed under Wording, not per row. */}
                              {config.data?.signature?.trim() && (
                                <div
                                  className="mt-2 rounded-lg px-3 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-line"
                                  style={{ background: 'var(--color-card-alt)', color: 'var(--color-muted)' }}
                                >
                                  <div className="text-[10px] font-bold tracking-[0.08em] uppercase mb-1.5">
                                    Added automatically when you copy
                                  </div>
                                  {config.data.signature.trim()}
                                </div>
                              )}
                              <div className="flex flex-wrap items-center gap-2 mt-2">
                                <span className="text-xs muted">
                                  Same for everyone — change it under <b>Wording</b>.
                                </span>
                                <span className="flex-1" />
                                <button
                                  className="btn-ghost !py-1.5 !px-3 text-xs"
                                  title="Put the system's own wording back"
                                  onClick={() => resetMessage.mutate(r.id)}
                                >
                                  Restore wording
                                </button>
                                <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={() => { setEditingMsg(null); setMsgDraft(''); }}>
                                  Cancel
                                </button>
                                <button
                                  className="btn-primary !py-1.5 !px-3 text-xs"
                                  disabled={!msgDraft.trim() || saveMessage.isPending}
                                  onClick={() => saveMessage.mutate({ id: r.id, message: msgDraft.trim() })}
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p
                                className="text-sm leading-relaxed whitespace-pre-line cursor-text"
                                title="Click to edit this message"
                                onClick={() => { setEditingMsg(r.id); setMsgDraft(r.message); }}
                              >
                                {r.message}
                              </p>
                              {r.message_edited_at && (
                                <div className="text-[11px] muted mt-1">
                                  Reworded{r.message_edited_by_name ? ` by ${r.message_edited_by_name}` : ''} · {dayTime(r.message_edited_at)}
                                </div>
                              )}
                            </>
                          )}

                          {prev.length > 0 ? (
                            <div className="mt-2">
                              <button
                                className="text-xs font-semibold inline-flex items-center gap-1"
                                style={{ color: 'var(--color-primary)' }}
                                onClick={() => setOpenPrev((p) => ({ ...p, [r.id]: !p[r.id] }))}
                              >
                                {shown ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                {shown ? 'Hide' : 'Show'} {prev.length} earlier reminder{prev.length > 1 ? 's' : ''}
                              </button>
                              {shown && (
                                <div className="mt-2 pl-3 border-l-2" style={{ borderColor: 'var(--color-border)' }}>
                                  {prev.map((p) => (
                                    <div key={p.id} className="py-1.5 text-xs muted leading-relaxed">
                                      <span className="block tnum" style={{ opacity: 0.8 }}>
                                        {dayTime(p.raised_at)} · {tierLabel(p.tier)} · {p.done_at ? 'done' : 'not done'}
                                      </span>
                                      {p.message}
                                      {p.note ? <div className="mt-1" style={{ color: 'var(--color-primary)' }}>Note: {p.note}</div> : null}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="mt-2 text-xs muted">First reminder for this student.</div>
                          )}

                          {r.note && editing !== r.id && (
                            <div
                              className="mt-2.5 rounded-lg px-3 py-2.5 text-sm"
                              style={{ background: 'rgb(29 78 216 / 0.07)', color: 'var(--color-text)' }}
                            >
                              <div className="text-[10px] font-bold tracking-[0.08em] uppercase mb-1" style={{ color: 'var(--color-primary)' }}>
                                Note from the call
                              </div>
                              {r.note}
                              <div className="text-[11px] muted mt-1.5">
                                Saved to Follow-ups{r.note_by_name ? ` by ${r.note_by_name}` : ''}
                                {r.note_at ? ` · ${dayTime(r.note_at)}` : ''} — also on this student in Student Hours
                              </div>
                            </div>
                          )}

                          {editing === r.id && (
                            <div className="mt-2.5">
                              <textarea
                                className="input"
                                rows={3}
                                maxLength={500}
                                autoFocus
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                placeholder="What did the parent say? e.g. will transfer on Thursday, asked to call after 6pm…"
                              />
                              <div className="flex flex-wrap items-center gap-2 mt-2">
                                <span className="text-xs muted">
                                  Saved to Follow-ups for Form {r.form_no}, and shown on the student in Student Hours.
                                </span>
                                <span className="flex-1" />
                                <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={() => { setEditing(null); setDraft(''); }}>
                                  Cancel
                                </button>
                                <button
                                  className="btn-primary !py-1.5 !px-3 text-xs"
                                  disabled={!draft.trim() || saveNote.isPending}
                                  onClick={() => saveNote.mutate({ id: r.id, note: draft.trim() })}
                                >
                                  Save note
                                </button>
                              </div>
                            </div>
                          )}

                          {isDone && (
                            <div className="mt-2 text-xs font-semibold inline-flex items-center gap-1.5" style={{ color: '#92610B' }}>
                              <Check size={13} strokeWidth={3} />
                              Done{r.done_by_name ? ` by ${r.done_by_name}` : ''} · {dayTime(r.done_at)}
                            </div>
                          )}
                        </div>

                        {/* In the order the job is actually done: copy the
                            message, write down what the parent said, reword it
                            if this family needs something different next time,
                            and tick it off. The tick is last because it is the
                            only one that ends the row. */}
                        <div className="flex gap-2 ml-auto shrink-0">
                          <button
                            className="btn-ghost !px-2.5 !py-2"
                            title="Copy the message with the bank details"
                            onClick={() => copyMessage(r)}
                          >
                            <Copy size={16} />
                          </button>
                          <button
                            className="btn-ghost !px-2.5 !py-2"
                            title={r.note ? 'Edit the note' : 'Add a note'}
                            onClick={() => { setEditing(r.id); setDraft(r.note || ''); }}
                          >
                            <StickyNote size={16} />
                          </button>
                          <button
                            className="btn-ghost !px-2.5 !py-2"
                            title="Reword this message"
                            onClick={() => { setEditingMsg(r.id); setMsgDraft(r.message); }}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            className="btn-ghost !px-2.5 !py-2"
                            title={isDone ? 'Not done after all' : 'Mark done — the parent was spoken to'}
                            disabled={setDone.isPending}
                            onClick={() => setDone.mutate({ id: r.id, done: !isDone })}
                          >
                            {isDone ? <Undo2 size={16} /> : <Check size={17} strokeWidth={2.4} />}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
