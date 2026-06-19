import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { api, hrs } from '../../api/client';
import { Section, Table, Spinner, KpiCard } from '../../components/ui';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

// Shared by student & parent — backend scopes to the logged-in user's student.
export default function LectureHistory() {
  const { user } = useAuth();
  const id = user?.studentId;
  const lectures = useQuery({
    queryKey: ['lectures', id],
    queryFn: () => api.get('/lectures', { params: { studentId: id } }).then((r) => r.data.data),
    enabled: !!id,
  });

  const all: any[] = lectures.data || [];

  // group lectures by date string
  const byDate = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const l of all) (m[l.session_date] ||= []).push(l);
    return m;
  }, [all]);

  // initialise the calendar at the most recent lecture's month (or today)
  const latest = all[0]?.session_date as string | undefined;
  const init = latest ? new Date(latest) : new Date();
  const [viewY, setViewY] = useState(init.getFullYear());
  const [viewM, setViewM] = useState(init.getMonth()); // 0-11
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const monthKey = `${viewY}-${pad(viewM + 1)}`;
  const firstWeekday = new Date(viewY, viewM, 1).getDay();
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();

  const prevMonth = () => { setSelectedDay(null); const d = new Date(viewY, viewM - 1, 1); setViewY(d.getFullYear()); setViewM(d.getMonth()); };
  const nextMonth = () => { setSelectedDay(null); const d = new Date(viewY, viewM + 1, 1); setViewY(d.getFullYear()); setViewM(d.getMonth()); };

  // lectures shown in the list: selected day, else whole visible month
  const monthLectures = all.filter((l) => l.session_date?.startsWith(monthKey));
  const shown = selectedDay ? (byDate[selectedDay] || []) : monthLectures;
  const monthHours = monthLectures.reduce((a, l) => a + Number(l.hours_consumed || 0), 0);

  if (lectures.isLoading) return <Spinner />;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Lecture History</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="This month — classes" value={monthLectures.length} accent="blue" />
        <KpiCard label="This month — hours" value={hrs(monthHours)} accent="indigo" />
        <KpiCard label="Total classes" value={all.length} accent="emerald" />
        <KpiCard label="Selected day" value={selectedDay ? (byDate[selectedDay]?.length || 0) : '—'} accent="orange" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[360px,1fr] gap-5">
        {/* Calendar */}
        <Section title="Calendar">
          <div className="flex items-center justify-between mb-3">
            <button className="btn-ghost !py-1.5 !px-3" onClick={prevMonth}>‹</button>
            <div className="font-display font-bold">{MONTHS[viewM]} {viewY}</div>
            <button className="btn-ghost !py-1.5 !px-3" onClick={nextMonth}>›</button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((w) => <div key={w} className="text-[11px] font-bold muted py-1">{w}</div>)}
            {Array.from({ length: firstWeekday }).map((_, i) => <div key={`b${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const ds = `${monthKey}-${pad(day)}`;
              const dayLecs = byDate[ds];
              const has = !!dayLecs?.length;
              const isSel = selectedDay === ds;
              return (
                <button
                  key={ds}
                  disabled={!has}
                  onClick={() => setSelectedDay(isSel ? null : ds)}
                  className={`aspect-square rounded-lg text-sm flex flex-col items-center justify-center transition
                    ${isSel ? 'text-white font-bold' : has ? 'font-semibold hover:bg-[var(--color-card-alt)]' : 'muted opacity-50 cursor-default'}`}
                  style={isSel ? { background: 'var(--color-primary)' } : has ? { background: 'var(--color-card-alt)' } : {}}
                  title={has ? `${dayLecs.length} class(es)` : ''}
                >
                  {day}
                  {has && <span className="w-1.5 h-1.5 rounded-full mt-0.5" style={{ background: isSel ? '#fff' : 'var(--color-accent)' }} />}
                </button>
              );
            })}
          </div>

          {selectedDay && (
            <button className="btn-ghost w-full mt-3 !py-1.5 text-sm" onClick={() => setSelectedDay(null)}>
              Show whole month
            </button>
          )}
          <p className="muted text-xs mt-3">Highlighted days have classes. Click a day to see that day’s lectures.</p>
        </Section>

        {/* List */}
        <Section title={selectedDay ? `Lectures on ${selectedDay}` : `${MONTHS[viewM]} ${viewY} — all lectures`}>
          {shown.length === 0 ? (
            <p className="muted text-sm">No lectures {selectedDay ? 'on this day' : 'this month'}.</p>
          ) : (
            <Table head={['Date', 'Teacher', 'Subject', 'Topic', 'Subtopic', 'Remark', 'Duration', 'Venue', 'Link']}>
              {shown.map((r: any) => (
                <tr key={r.id}>
                  <td className="table-td whitespace-nowrap">{r.session_date}</td>
                  <td className="table-td">{r.teacher_name || '—'}</td>
                  <td className="table-td">{r.subject_name || '—'}</td>
                  <td className="table-td">{r.topic || '—'}</td>
                  <td className="table-td">{r.subtopic || '—'}</td>
                  <td className="table-td">{r.remark || '—'}</td>
                  <td className="table-td">{hrs(r.hours_consumed)}</td>
                  <td className="table-td">{r.venue || '—'}</td>
                  <td className="table-td">{r.meeting_link ? <a className="text-blue-500 underline" href={r.meeting_link} target="_blank">Link</a> : '—'}</td>
                </tr>
              ))}
            </Table>
          )}
        </Section>
      </div>
    </div>
  );
}
