import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, Clock, BookOpen } from 'lucide-react';
import { hrs } from '../api/client';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

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
  const init = latest ? new Date(latest) : new Date();
  const [viewY, setViewY] = useState(init.getFullYear());
  const [viewM, setViewM] = useState(init.getMonth()); // 0-11
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const monthKey = `${viewY}-${pad(viewM + 1)}`;
  const firstWeekday = new Date(viewY, viewM, 1).getDay();
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
  const todayStr = `${new Date().getFullYear()}-${pad(new Date().getMonth() + 1)}-${pad(new Date().getDate())}`;

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
          <button className="btn-ghost !px-3 !py-1.5 text-xs font-semibold" onClick={() => { const t = new Date(); setViewY(t.getFullYear()); setViewM(t.getMonth()); setSelectedDay(null); }}>Today</button>
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
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg ml-auto" style={{ background: 'var(--color-card-alt)' }}>
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
                  className={`relative aspect-square rounded-xl flex flex-col items-center justify-center transition-all text-sm
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
                    <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full" style={{ background: isSel ? '#fff' : 'var(--color-accent)' }} />
                  )}
                </button>
              );
            })}
          </div>
          <p className="muted text-xs mt-3">Days with classes are highlighted with their total hours. Click a day for details.</p>
        </div>

        {/* Detail panel */}
        <div className="rounded-xl p-3 sm:p-4 min-h-[240px]" style={{ background: 'var(--color-card-alt)' }}>
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

                  {/* Subject / topic / subtopic / remark — always shown so the detail is visible */}
                  <div className="mt-2 space-y-1 text-xs">
                    <div className="flex gap-1.5"><span className="muted shrink-0 w-16">Subject</span><span className="font-medium min-w-0">{r.subject_name || '—'}</span></div>
                    <div className="flex gap-1.5"><span className="muted shrink-0 w-16">Topic</span><span className="font-medium min-w-0">{r.topic || '—'}</span></div>
                    <div className="flex gap-1.5"><span className="muted shrink-0 w-16">Subtopic</span><span className="font-medium min-w-0">{r.subtopic || '—'}</span></div>
                    <div className="flex gap-1.5"><span className="muted shrink-0 w-16">Remark</span><span className="min-w-0">{r.remark || '—'}</span></div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 pt-2 border-t text-[11px] muted" style={{ borderColor: 'var(--color-border)' }}>
                    {!selectedDay && <span>{r.session_date}</span>}
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
