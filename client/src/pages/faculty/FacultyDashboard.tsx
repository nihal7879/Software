import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, hrs, fmtDate, dubaiNow, todayIso } from '../../api/client';
import { Section, Table, Spinner, DateTile, fmtTime, useStackDepth, stackTop } from '../../components/ui';
import { subjectColour } from '../../components/LectureCalendar';
import { NotificationPrompt } from '../../components/NotificationPrompt';

/** "Today", "Yesterday", or the weekday — with the date under it in the header. */
function dayName(iso: string) {
  const today = todayIso();
  const d = new Date(today + 'T00:00');
  d.setDate(d.getDate() - 1);
  const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (iso === today) return 'Today';
  if (iso === yesterday) return 'Yesterday';
  return new Date(iso + 'T00:00').toLocaleDateString('en-GB', { weekday: 'long' });
}

/**
 * Marks every `.reveal` inside the container as in or out of view, so each one
 * animates in on the way down and back out on the way up.
 */
function useReveal(deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.target.classList.toggle('is-in', e.isIntersecting)),
      // Trigger a little inside the bottom edge, so a card is seen arriving.
      { rootMargin: '0px 0px -6% 0px', threshold: 0.12 }
    );
    root.querySelectorAll('.reveal').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/**
 * Recent classes grouped by day, as a deck of cards that stack up under the top
 * bar as you scroll down and come apart as you scroll back. The newest day comes
 * first, but within a day the classes run in the order they happened.
 */
function RecentByDay({ lectures }: { lectures: any[] }) {
  const days: [string, any[]][] = [];
  for (const l of lectures) {
    const iso = String(l.session_date).slice(0, 10);
    const last = days[days.length - 1];
    if (last && last[0] === iso) last[1].push(l);
    else days.push([iso, [l]]);
  }

  const ref = useReveal([lectures]);

  useStackDepth(ref, [lectures]);

  // One block per day. Its date pins under the top bar and its cards pile up just
  // beneath the date. Sticky things never leave their block, so when the day's
  // last card scrolls up the date and the whole pile go with it — nothing of an
  // earlier day is left showing behind the next one.
  return (
    <div ref={ref} className="space-y-6" style={{ '--day-h': '4rem' } as any}>
      {days.map(([iso, lecs]) => {
        // A class with no time recorded goes to the end of its day, not the top.
        const sorted = [...lecs].sort((a, b) => String(a.time_in || '~').localeCompare(String(b.time_in || '~')));
        const total = lecs.reduce((a, l) => a + Number(l.total_hours || 0), 0);
        return (
          <section key={iso} className="space-y-2.5">
            {/* The day, said once. On top of its cards (z-10), solid and full width,
                so a card sliding up goes underneath it. */}
            <header data-day className="sticky z-10 flex items-center gap-3 py-2.5"
              style={{ top: 'calc(3.5rem + env(safe-area-inset-top))', background: 'var(--color-card)' }}>
              <DateTile iso={iso} />
              <div className="min-w-0 flex-1">
                <div className="font-display font-bold leading-tight">{dayName(iso)}</div>
                <div className="text-xs muted">{new Date(iso + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-bold tnum" style={{ color: 'var(--color-primary)' }}>{hrs(total)}</div>
                <div className="text-[11px] muted">{lecs.length} class{lecs.length === 1 ? '' : 'es'}</div>
              </div>
            </header>

            {sorted.map((l, i) => {
                const colour = subjectColour(l.subject_name);
                const names = String(l.students || '').split(',').map((s) => s.trim()).filter(Boolean);
                return (
                  // Sticky just under the date, each a little lower than the one
                  // before, so scrolling piles them up and scrolling back unpiles them.
                  <div key={l.id} data-stack className="stack-card"
                    style={{ top: stackTop(i) }}>
                    {/* Solid, so the card sliding over it covers it; the tint sits on top of the card colour. */}
                    <div className="reveal relative rounded-2xl p-3.5 pl-4 overflow-hidden"
                      style={{
                        background: `linear-gradient(${colour}14, ${colour}14), var(--color-card)`,
                        border: `1px solid ${colour}2e`,
                        boxShadow: '0 -8px 20px -14px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.04)',
                        transitionDelay: `${Math.min(i, 4) * 70}ms`,
                      }}>
                      <span className="absolute left-0 inset-y-0 w-1" style={{ background: colour }} aria-hidden />
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold leading-snug">{l.subject_name || 'Lecture'}</div>
                          <div className="text-xs muted tnum mt-0.5">
                            {l.time_in ? `${fmtTime(l.time_in)}${l.time_out ? ` – ${fmtTime(l.time_out)}` : ''}` : 'No time recorded'}
                            {l.venue ? ` · ${l.venue}` : ''}
                          </div>
                        </div>
                        <span className="shrink-0 text-xs font-bold tnum px-2 py-0.5 rounded-full text-white" style={{ background: colour }}>
                          {hrs(l.total_hours)}
                        </span>
                      </div>
                      {l.topic && <div className="text-sm font-medium mt-2 leading-snug">{l.topic}</div>}
                      {names.length > 0 && (
                        <div className="flex items-center gap-2 mt-2.5">
                          <div className="flex -space-x-1 shrink-0">
                            {names.slice(0, 3).map((n) => (
                              <span key={n} className="grid place-items-center w-7 h-7 rounded-full text-[10px] font-bold ring-2 tracking-tight"
                                style={{ background: 'var(--color-accent-soft)', color: 'var(--color-primary)', '--tw-ring-color': 'var(--color-card)' } as any}
                                title={n}>
                                {initials(n)}
                              </span>
                            ))}
                            {names.length > 3 && (
                              <span className="grid place-items-center w-7 h-7 rounded-full text-[10px] font-bold ring-2 muted"
                                style={{ background: 'var(--color-card-alt)', '--tw-ring-color': 'var(--color-card)' } as any}>
                                +{names.length - 3}
                              </span>
                            )}
                          </div>
                          <span className="text-xs muted truncate">{names.join(', ')}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
          </section>
        );
      })}
    </div>
  );
}

// Time-of-day greeting: morning < 12:00, afternoon < 17:00, else evening.
function greeting(h: number) {
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function FacultyDashboard() {
  const me = useQuery({ queryKey: ['teacher-me'], queryFn: () => api.get('/teachers/me').then((r) => r.data) });
  const lectures = useQuery({ queryKey: ['me-lectures'], queryFn: () => api.get('/teachers/me/lectures').then((r) => r.data.data) });

  // Live clock — ticks once a minute.
  const [now, setNow] = useState(() => dubaiNow());
  useEffect(() => {
    const id = setInterval(() => setNow(dubaiNow()), 30_000);
    return () => clearInterval(id);
  }, []);
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const timeLabel = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  if (me.isLoading) return <Spinner />;
  const t = me.data;
  const all = lectures.data || [];
  const recent = all.slice(0, 8);
  // This month at the institute, not on the teacher's device.
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonth = all.filter((l: any) => String(l.session_date || '').startsWith(monthKey));
  const monthHours = thisMonth.reduce((a: number, l: any) => a + Number(l.total_hours || 0), 0);
  const first = String(t?.name || '').split(/\s+/)[0];

  return (
    <div className="space-y-6">
      {/* Laptop and up: the original header, unchanged. */}
      <div className="hidden lg:flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{greeting(now.getHours())}, {t?.name || 'there'}</h1>
          <p className="muted text-sm mt-0.5">{dateLabel} · {timeLabel}</p>
        </div>
        <Link to="/faculty/lecture" className="btn-primary">+ Lecture Entry</Link>
      </div>

      <div className="lg:hidden !mt-0 hero-ink rounded-3xl p-5 sm:p-6 ring-1 ring-white/[0.06]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-white/60">{dateLabel} · {timeLabel}</p>
            <h1 className="text-[1.6rem] sm:text-3xl font-bold leading-tight mt-1">
              {greeting(now.getHours())}{first ? `, ${first}` : ''}
            </h1>
          </div>
        </div>
        {/* One caption over short labels: "Classes this month" wrapped at 360px
            and knocked the two figures out of line. */}
        <p className="text-xs text-white/55 mt-6 mb-2">This month</p>
        <dl className="grid grid-cols-2 gap-3 max-w-md">
          <div className="rounded-2xl bg-white/[0.07] px-4 py-3">
            <dt className="text-xs text-white/55">Classes</dt>
            <dd className="font-display text-xl sm:text-2xl font-bold tnum mt-0.5">{lectures.isLoading ? '…' : thisMonth.length}</dd>
          </div>
          <div className="rounded-2xl bg-white/[0.07] px-4 py-3">
            <dt className="text-xs text-white/55">Hours</dt>
            <dd className="font-display text-xl sm:text-2xl font-bold tnum mt-0.5 truncate">{lectures.isLoading ? '…' : hrs(monthHours)}</dd>
          </div>
        </dl>
      </div>

      <NotificationPrompt what="a student checks in" />

      <div className="grid grid-cols-1 gap-6">
        <Section title="My Recent Classes">
          {lectures.isLoading ? <Spinner /> : (
            <>
            {/* Phones and tablets: one header per day, that day's classes on a
                timeline beneath it — the date is said once, not on every card. */}
            <div className="lg:hidden">
              {recent.length === 0
                ? <p className="muted text-sm">No lectures recorded yet. Classes you log appear here.</p>
                : <RecentByDay lectures={recent} />}
            </div>
            <div className="hidden lg:block">
            <Table head={['Date', 'Subject', 'Students', 'Topic', { label: 'Hours', align: 'right' }]}>
              {recent.length === 0 ? (
                <tr><td className="table-td muted" colSpan={5}>No lectures recorded yet.</td></tr>
              ) : recent.map((l: any) => (
                <tr key={l.id}>
                  <td className="table-td whitespace-nowrap">{fmtDate(l.session_date)}</td>
                  <td className="table-td">{l.subject_name || '—'}</td>
                  <td className="table-td max-w-[160px] truncate" title={l.students}>{l.students}</td>
                  <td className="table-td">{l.topic || '—'}</td>
                  <td className="table-td text-right tabular-nums">{hrs(l.total_hours)}</td>
                </tr>
              ))}
            </Table>
            </div>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}
