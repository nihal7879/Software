import { useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, Clock, BookOpen, MapPin, Video } from 'lucide-react';
import { hrs, fmtDate, todayIso, dubaiNow } from '../api/client';
import { useStackDepth, stackTop } from './ui';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

// Each subject keeps one colour everywhere in the agenda, so a week of Physics
// reads as a stripe of the same colour. Picked by the name, not stored.
// No red, amber or green: those mean Absent / Late / Present on the same card.
const SUBJECT_COLOURS = ['#f97316', '#8b5cf6', '#0ea5e9', '#6366f1', '#14b8a6', '#c026d3'];
export function subjectColour(name?: string) {
  let h = 0;
  for (const c of String(name || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SUBJECT_COLOURS[h % SUBJECT_COLOURS.length];
}

/** "16:30:00" → ["4:30", "PM"]. Lecture times are stored as 24-hour HH:MM(:SS). */
function clock12(t?: string | null): [string, string] | null {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  return [`${h % 12 || 12}:${m[2]}`, h >= 12 ? 'PM' : 'AM'];
}

const ATTENDANCE: Record<string, string> = {
  Absent: 'bg-red-500/15 text-red-600 dark:text-red-400',
  Late: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  Present: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
};

/**
 * The lecture detail below the calendar on phones and tablets: a timeline per
 * day — time on the left, the class on the right with its subject's colour.
 */
function Agenda({ shown, selectedDay, title, onWholeMonth }: {
  shown: any[]; selectedDay: string | null; title: string; onWholeMonth: () => void;
}) {
  // Group by day, keeping the order the lectures came in (newest first).
  const days: [string, any[]][] = [];
  for (const r of shown) {
    const last = days[days.length - 1];
    if (last && last[0] === r.session_date) last[1].push(r);
    else days.push([r.session_date, [r]]);
  }
  const total = shown.reduce((a, l) => a + Number(l.hours_consumed || 0), 0);
  const stackRef = useRef<HTMLDivElement>(null);
  useStackDepth(stackRef, [shown, selectedDay]);
  // Day-month order, as the day headings below — the shared title is US order.
  const heading = selectedDay
    ? new Date(selectedDay + 'T00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    : title;

  return (
    <div className="lg:hidden">
      <div className="flex items-end justify-between gap-3 pb-3 mb-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="min-w-0">
          <div className="text-xs muted">{selectedDay ? 'Classes on' : 'All classes in'}</div>
          <h4 className="font-display font-bold text-lg leading-tight truncate">{heading}</h4>
        </div>
        {selectedDay ? (
          <button className="btn-ghost !py-1.5 !px-3 text-xs shrink-0" onClick={onWholeMonth}>Whole month</button>
        ) : shown.length > 0 && (
          <div className="text-right shrink-0">
            <div className="font-display font-bold tnum" style={{ color: 'var(--color-primary)' }}>{hrs(total)}</div>
            <div className="text-[11px] muted">{shown.length} class{shown.length === 1 ? '' : 'es'}</div>
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="text-center py-10">
          <div className="mx-auto mb-3 grid place-items-center w-12 h-12 rounded-2xl" style={{ background: 'var(--color-card-alt)', color: 'var(--color-muted)' }}>
            <CalendarDays size={22} />
          </div>
          <p className="font-medium">No classes {selectedDay ? 'on this day' : 'this month'}</p>
          <p className="muted text-sm mt-0.5">Days with classes are marked on the calendar.</p>
        </div>
      ) : (
        // Stacking, as on the teacher's recent classes: each date pins under the
        // top bar and its classes pile up beneath it; when the day's last class
        // has gone, the date and its pile leave together.
        <div ref={stackRef} className="space-y-5">
          {days.map(([date, lecs]) => (
            <section key={date} className="space-y-2.5">
              {!selectedDay && (
                <div data-day className="sticky z-10 flex items-baseline justify-between py-2"
                  style={{ top: 'calc(3.5rem + env(safe-area-inset-top))', background: 'var(--color-card)' }}>
                  <h5 className="text-sm font-semibold">
                    {new Date(date + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </h5>
                  <span className="text-xs muted tnum">{hrs(lecs.reduce((a, l) => a + Number(l.hours_consumed || 0), 0))}</span>
                </div>
              )}
              <ol className="space-y-2.5">
                {lecs.map((r: any, i: number) => {
                  const colour = subjectColour(r.subject_name);
                  const tin = clock12(r.time_in), tout = clock12(r.time_out);
                  const att = r.attendance_status || 'Present';
                  return (
                    // Solid row, so the time column of the card on top hides the one beneath.
                    <li key={r.id} data-stack className="stack-card flex gap-3"
                      style={{ top: stackTop(i), background: 'var(--color-card)' }}>
                      {/* Time rail */}
                      <div className="w-[3.25rem] shrink-0 text-right pt-3 leading-tight">
                        {tin ? (
                          <>
                            <div className="text-sm font-semibold tnum">{tin[0]}<span className="text-[10px] font-medium muted ml-0.5">{tin[1]}</span></div>
                            {tout && <div className="text-[11px] muted tnum mt-0.5">{tout[0]} {tout[1]}</div>}
                          </>
                        ) : <div className="text-xs muted">No time</div>}
                      </div>

                      {/* The class */}
                      <div className="relative flex-1 min-w-0 rounded-2xl p-3.5 pl-4 overflow-hidden"
                        style={{
                          background: `linear-gradient(${colour}12, ${colour}12), var(--color-card)`,
                          border: `1px solid ${colour}30`,
                          boxShadow: '0 -8px 20px -14px rgba(0,0,0,0.35)',
                        }}>
                        <span className="absolute left-0 inset-y-0 w-1" style={{ background: colour }} aria-hidden />
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-semibold leading-snug min-w-0 break-words">{r.subject_name || 'Lecture'}</div>
                          <span className="shrink-0 text-xs font-bold tnum px-2 py-0.5 rounded-full text-white" style={{ background: colour }}>
                            {hrs(r.hours_consumed)}
                          </span>
                        </div>
                        {(r.topic || r.subtopic) && (
                          <div className="mt-1.5 text-sm leading-snug">
                            {r.topic && <div className="font-medium">{r.topic}</div>}
                            {r.subtopic && <div className="muted">{r.subtopic}</div>}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2.5 text-xs">
                          <span className={`px-2 py-0.5 rounded-full font-semibold ${ATTENDANCE[att] || ATTENDANCE.Present}`}>{att}</span>
                          {r.venue && <span className="inline-flex items-center gap-1 muted"><MapPin size={12} /> {r.venue}</span>}
                          {r.meeting_link && (
                            <a className="inline-flex items-center gap-1 font-semibold" style={{ color: colour }} href={r.meeting_link} target="_blank" rel="noreferrer">
                              <Video size={13} /> Join link
                            </a>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Modern month calendar showing a student's lecture activity.
 * Navigate month/year, days with classes are highlighted with hours,
 * click a day to view that day's lectures in the side panel.
 */
export default function LectureCalendar({ lectures }: { lectures: any[] }) {
  const all = lectures || [];

  // group lectures by their date string (YYYY-MM-DD)
  const byDate = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const l of all) if (l.session_date) (m[l.session_date] ||= []).push(l);
    return m;
  }, [all]);

  // start on the most recent lecture's month, else today
  const latest = all[0]?.session_date as string | undefined;
  const init = latest ? new Date(latest) : dubaiNow();
  const [viewY, setViewY] = useState(init.getFullYear());
  const [viewM, setViewM] = useState(init.getMonth()); // 0-11
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const monthKey = `${viewY}-${pad(viewM + 1)}`;
  const firstWeekday = new Date(viewY, viewM, 1).getDay();
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
  const todayStr = todayIso();

  const step = (delta: number) => { setSelectedDay(null); const d = new Date(viewY, viewM + delta, 1); setViewY(d.getFullYear()); setViewM(d.getMonth()); };
  const stepYear = (delta: number) => { setSelectedDay(null); setViewY((y) => y + delta); };

  const monthLectures = all.filter((l) => l.session_date?.startsWith(monthKey));
  const monthHours = monthLectures.reduce((a, l) => a + Number(l.hours_consumed || 0), 0);
  const totalHours = all.reduce((a, l) => a + Number(l.hours_consumed || 0), 0);
  const dayHours = (ds: string) => (byDate[ds] || []).reduce((a, l) => a + Number(l.hours_consumed || 0), 0);

  const shown = selectedDay ? (byDate[selectedDay] || []) : monthLectures;
  const shownTitle = selectedDay
    ? new Date(selectedDay).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
    : `${MONTHS[viewM]} ${viewY}`;

  return (
    <div className="card p-4 sm:p-5">
      {/* Header — month/year navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <CalendarDays size={18} style={{ color: 'var(--color-primary)' }} />
          <h3 className="font-display font-bold text-lg">{MONTHS[viewM]} {viewY}</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <button className="btn-ghost !px-2 !py-1.5" title="Previous year" onClick={() => stepYear(-1)}><span className="text-xs font-bold">«</span></button>
          <button className="btn-ghost !px-2 !py-1.5" title="Previous month" onClick={() => step(-1)}><ChevronLeft size={16} /></button>
          <button className="btn-ghost !px-3 !py-1.5 text-xs font-semibold" onClick={() => { const t = dubaiNow(); setViewY(t.getFullYear()); setViewM(t.getMonth()); setSelectedDay(null); }}>Today</button>
          <button className="btn-ghost !px-2 !py-1.5" title="Next month" onClick={() => step(1)}><ChevronRight size={16} /></button>
          <button className="btn-ghost !px-2 !py-1.5" title="Next year" onClick={() => stepYear(1)}><span className="text-xs font-bold">»</span></button>
        </div>
      </div>

      {/* Month summary chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg" style={{ background: 'var(--color-card-alt)' }}>
          <BookOpen size={13} /> {monthLectures.length} class{monthLectures.length === 1 ? '' : 'es'}
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg" style={{ background: 'var(--color-card-alt)', color: 'var(--color-primary)' }}>
          <Clock size={13} /> {hrs(monthHours)} this month
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg lg:ml-auto" style={{ background: 'var(--color-card-alt)' }}>
          {all.length} total · {hrs(totalHours)} overall
        </span>
      </div>

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-5">
        {/* Calendar grid */}
        <div>
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {WEEKDAYS.map((w) => <div key={w} className="text-[11px] font-bold muted text-center py-1">{w}</div>)}
            {Array.from({ length: firstWeekday }).map((_, i) => <div key={`b${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const ds = `${monthKey}-${pad(day)}`;
              const dayLecs = byDate[ds];
              const has = !!dayLecs?.length;
              const isSel = selectedDay === ds;
              const isToday = ds === todayStr;
              return (
                <button
                  key={ds}
                  disabled={!has}
                  onClick={() => setSelectedDay(isSel ? null : ds)}
                  title={has ? `${dayLecs.length} class(es) · ${hrs(dayHours(ds))}` : ''}
                  className={`relative aspect-square sm:aspect-auto sm:h-14 lg:aspect-square lg:h-auto rounded-xl flex flex-col items-center justify-center transition-all text-sm
                    ${isSel ? 'text-white font-bold shadow-md scale-[1.03]' : has ? 'font-semibold hover:scale-[1.03] hover:shadow-sm' : 'muted opacity-40 cursor-default'}
                    ${isToday && !isSel ? 'ring-2' : ''}`}
                  style={{
                    background: isSel ? 'var(--color-primary)' : has ? 'var(--color-card-alt)' : 'transparent',
                    ...(isToday && !isSel ? { '--tw-ring-color': 'var(--color-primary)' } as any : {}),
                  }}
                >
                  <span>{day}</span>
                  {has && (
                    <span className="text-[9px] leading-none mt-0.5 font-bold" style={{ color: isSel ? '#fff' : 'var(--color-primary)' }}>
                      {hrs(dayHours(ds))}
                    </span>
                  )}
                  {has && (
                    // Laptop only: in a phone-sized cell the dot sits on the number.
                    <span className="hidden lg:block absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full" style={{ background: isSel ? '#fff' : 'var(--color-accent)' }} />
                  )}
                </button>
              );
            })}
          </div>
          <p className="muted text-xs mt-3">Days with classes are highlighted with their total hours. Click a day for details.</p>
        </div>

        {/* Detail panel — phones and tablets: an agenda, one timeline per day. */}
        <Agenda
          shown={shown}
          selectedDay={selectedDay}
          title={shownTitle}
          onWholeMonth={() => setSelectedDay(null)}
        />

        {/* Detail panel — laptop and up, unchanged. */}
        <div className="hidden lg:block rounded-xl p-3 sm:p-4 min-h-[240px]" style={{ background: 'var(--color-card-alt)' }}>
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-display font-bold text-sm">{shownTitle}</h4>
            {selectedDay && (
              <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => setSelectedDay(null)}>Whole month</button>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="muted text-sm py-8 text-center">No lectures {selectedDay ? 'on this day' : 'this month'}.</p>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {shown.map((r: any) => (
                <div key={r.id} className="rounded-lg p-3" style={{ background: 'var(--color-card)' }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{r.subject_name || 'Lecture'}</div>
                    </div>
                    <span className="shrink-0 text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--color-card-alt)', color: 'var(--color-primary)' }}>
                      {hrs(r.hours_consumed)}
                    </span>
                  </div>

                  {/* Subject / topic / subtopic — always shown so the detail is visible */}
                  <div className="mt-2 space-y-1 text-xs">
                    <div className="flex gap-1.5"><span className="muted shrink-0 w-16">Subject</span><span className="font-medium min-w-0">{r.subject_name || '—'}</span></div>
                    <div className="flex gap-1.5"><span className="muted shrink-0 w-16">Topic</span><span className="font-medium min-w-0">{r.topic || '—'}</span></div>
                    <div className="flex gap-1.5"><span className="muted shrink-0 w-16">Subtopic</span><span className="font-medium min-w-0">{r.subtopic || '—'}</span></div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 pt-2 border-t text-[11px] muted" style={{ borderColor: 'var(--color-border)' }}>
                    {!selectedDay && <span>{fmtDate(r.session_date)}</span>}
                    {(r.time_in || r.time_out) && <span>{r.time_in || '—'} – {r.time_out || '—'}</span>}
                    {r.venue && <span>📍 {r.venue}</span>}
                    <span className={`px-1.5 py-0.5 rounded-full font-semibold ${
                      r.attendance_status === 'Absent' ? 'bg-red-500/15 text-red-600'
                      : r.attendance_status === 'Late' ? 'bg-amber-500/15 text-amber-600'
                      : 'bg-emerald-500/15 text-emerald-600'}`}>
                      {r.attendance_status || 'Present'}
                    </span>
                    {r.meeting_link && <a className="text-blue-500 underline" href={r.meeting_link} target="_blank" rel="noreferrer">Link</a>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
