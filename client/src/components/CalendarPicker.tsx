import { useEffect, useRef, useState } from 'react';
import { useAnchoredMenu } from './anchoredMenu';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { fmtDate, dubaiNow} from '../api/client';

// Reusable single-date calendar popover — the same look used in the student
// Lecture History. Pass value as 'YYYY-MM-DD' ('' = none). `highlight` is an
// optional set of dates that get a dot marker.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');
// Far enough back for any student's or parent's date of birth.
const THIS_YEAR = dubaiNow().getFullYear();
const YEARS = Array.from({ length: THIS_YEAR + 5 - 1940 + 1 }, (_, i) => 1940 + i);

type View = 'days' | 'months' | 'years';

// Same cell as a day in the grid, so the month and year pickers look like part
// of the calendar rather than the browser's own grey dropdown list.
const cell = (selected: boolean) =>
  `h-9 rounded-lg text-xs flex items-center justify-center transition ${
    selected ? 'text-white font-bold' : 'font-semibold hover:bg-[var(--color-card-alt)]'
  }`;
const cellStyle = (selected: boolean) => (selected ? { background: 'var(--color-primary)' } : {});

/**
 * The calendar's top line. Month and year are buttons: click the month for a
 * grid of months, the year for a grid of years — reaching a date of birth one
 * month at a time with the arrows took well over a hundred clicks.
 */
function CalendarHead({
  viewY, viewM, view, setView, prevMonth, nextMonth,
}: {
  viewY: number; viewM: number; view: View; setView: (v: View) => void;
  prevMonth: () => void; nextMonth: () => void;
}) {
  const toggle = (v: View) => setView(view === v ? 'days' : v);
  const label = (on: boolean) =>
    `font-display font-bold text-sm rounded-lg px-2 py-1 inline-flex items-center gap-1 transition ${
      on ? 'bg-[var(--color-card-alt)]' : 'hover:bg-[var(--color-card-alt)]'
    }`;
  return (
    <div className="flex items-center justify-between gap-1 mb-3">
      <button type="button" className={`btn-ghost !py-1.5 !px-2.5 ${view === 'days' ? '' : 'invisible'}`} onClick={prevMonth} aria-label="Previous month">‹</button>
      <div className="flex items-center gap-0.5">
        <button type="button" className={label(view === 'months')} onClick={() => toggle('months')} aria-label="Pick a month">
          {MONTHS[viewM].slice(0, 3)} <ChevronDown size={13} className="muted" />
        </button>
        <button type="button" className={label(view === 'years')} onClick={() => toggle('years')} aria-label="Pick a year">
          {viewY} <ChevronDown size={13} className="muted" />
        </button>
      </div>
      <button type="button" className={`btn-ghost !py-1.5 !px-2.5 ${view === 'days' ? '' : 'invisible'}`} onClick={nextMonth} aria-label="Next month">›</button>
    </div>
  );
}

/** Twelve months, or every year, in place of the day grid. Picking one goes back to the days. */
function MonthYearGrid({
  view, viewY, viewM, setViewY, setViewM, setView,
}: {
  view: View; viewY: number; viewM: number;
  setViewY: (y: number) => void; setViewM: (m: number) => void; setView: (v: View) => void;
}) {
  const current = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // Open the year list at the year being viewed, not at 1940. Only the list
  // scrolls — scrollIntoView would drag the page behind the popover too.
  useEffect(() => {
    const box = list.current, btn = current.current;
    if (box && btn) box.scrollTop = btn.offsetTop - box.offsetTop - box.clientHeight / 2 + btn.clientHeight / 2;
  }, [view]);

  if (view === 'months') {
    return (
      <div className="grid grid-cols-3 gap-1">
        {MONTHS.map((m, i) => (
          <button key={m} type="button" className={cell(i === viewM)} style={cellStyle(i === viewM)}
            onClick={() => { setViewM(i); setView('days'); }}>
            {m.slice(0, 3)}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div ref={list} className="grid grid-cols-4 gap-1 max-h-[232px] overflow-y-auto thin-scroll pr-0.5">
      {YEARS.map((y) => (
        <button key={y} ref={y === viewY ? current : undefined} type="button" className={cell(y === viewY)} style={cellStyle(y === viewY)}
          onClick={() => { setViewY(y); setView('months'); }}>
          {y}
        </button>
      ))}
    </div>
  );
}

export function CalendarPicker({
  value,
  onChange,
  placeholder = 'Select date',
  highlight,
  className = '',
  align = 'left',
  openYear,
}: {
  value: string;
  onChange: (d: string) => void;
  placeholder?: string;
  highlight?: Set<string> | string[];
  className?: string;
  align?: 'left' | 'right';
  /** Year the calendar opens on while empty — a date of birth starts years back, not at today. */
  openYear?: number;
}) {
  const init = value ? new Date(value) : openYear ? new Date(openYear, 0, 1) : dubaiNow();
  const [viewY, setViewY] = useState(init.getFullYear());
  const [viewM, setViewM] = useState(init.getMonth()); // 0-11
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('days');
  useEffect(() => { if (open) setView('days'); }, [open]);
  const btnRef = useRef<HTMLButtonElement>(null);
  const pos = useAnchoredMenu(open, btnRef, 260, align);

  const marked = highlight instanceof Set ? highlight : new Set(highlight || []);
  const monthKey = `${viewY}-${pad(viewM + 1)}`;
  const firstWeekday = new Date(viewY, viewM, 1).getDay();
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();

  const prevMonth = () => { const d = new Date(viewY, viewM - 1, 1); setViewY(d.getFullYear()); setViewM(d.getMonth()); };
  const nextMonth = () => { const d = new Date(viewY, viewM + 1, 1); setViewY(d.getFullYear()); setViewM(d.getMonth()); };

  return (
    <div className={`relative inline-block ${className}`}>
      <button ref={btnRef} type="button" className="btn-ghost flex items-center gap-2 whitespace-nowrap" onClick={() => setOpen((o) => !o)}>
        <CalendarDays size={16} className="muted shrink-0" />
        <span className="font-medium whitespace-nowrap">{value ? fmtDate(value) : placeholder}</span>
        <ChevronDown size={15} className="muted shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="card p-3 fixed z-[61] w-[260px] overflow-y-auto thin-scroll" style={{ left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight ?? 360 }}>
            <CalendarHead viewY={viewY} viewM={viewM} view={view} setView={setView} prevMonth={prevMonth} nextMonth={nextMonth} />

            {view !== 'days' ? (
              <MonthYearGrid view={view} viewY={viewY} viewM={viewM} setViewY={setViewY} setViewM={setViewM} setView={setView} />
            ) : (
            <>
            <div className="grid grid-cols-7 gap-1 text-center">
              {WEEKDAYS.map((w) => <div key={w} className="text-[11px] font-bold muted py-1">{w}</div>)}
              {Array.from({ length: firstWeekday }).map((_, i) => <div key={`b${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const ds = `${monthKey}-${pad(day)}`;
                const isSel = value === ds;
                const has = marked.has(ds);
                return (
                  <button
                    type="button"
                    key={ds}
                    onClick={() => { onChange(isSel ? '' : ds); setOpen(false); }}
                    className={`h-9 rounded-lg text-xs flex flex-col items-center justify-center transition
                      ${isSel ? 'text-white font-bold' : 'font-semibold hover:bg-[var(--color-card-alt)]'}`}
                    style={isSel ? { background: 'var(--color-primary)' } : has ? { background: 'var(--color-card-alt)' } : {}}
                    title={has ? 'Has activity' : ''}
                  >
                    {day}
                    {has && <span className="w-1.5 h-1.5 rounded-full mt-0.5" style={{ background: isSel ? '#fff' : 'var(--color-accent)' }} />}
                  </button>
                );
              })}
            </div>

            {value && (
              <button type="button" className="btn-ghost w-full mt-3 !py-1.5 text-sm" onClick={() => { onChange(''); setOpen(false); }}>
                Clear
              </button>
            )}
            </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Range variant — pick a start and end date. A "This month" shortcut selects the
// whole visible month. Returns from/to as 'YYYY-MM-DD' ('' when cleared).
export function CalendarRangePicker({
  from,
  to,
  onChange,
  placeholder = 'Select range',
  className = '',
  align = 'left',
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  placeholder?: string;
  className?: string;
  align?: 'left' | 'right';
}) {
  const init = from ? new Date(from) : dubaiNow();
  const [viewY, setViewY] = useState(init.getFullYear());
  const [viewM, setViewM] = useState(init.getMonth());
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('days');
  useEffect(() => { if (open) setView('days'); }, [open]);
  const btnRef = useRef<HTMLButtonElement>(null);
  const pos = useAnchoredMenu(open, btnRef, 280, align);

  const monthKey = `${viewY}-${pad(viewM + 1)}`;
  const firstWeekday = new Date(viewY, viewM, 1).getDay();
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();

  const prevMonth = () => { const d = new Date(viewY, viewM - 1, 1); setViewY(d.getFullYear()); setViewM(d.getMonth()); };
  const nextMonth = () => { const d = new Date(viewY, viewM + 1, 1); setViewY(d.getFullYear()); setViewM(d.getMonth()); };

  const pick = (ds: string) => {
    // No start yet, or a full range already chosen → start a new range.
    if (!from || (from && to)) { onChange(ds, ''); return; }
    // Have a start, choosing the end (order them).
    if (ds < from) onChange(ds, from);
    else onChange(from, ds);
    setOpen(false);
  };

  const selectMonth = () => {
    const first = `${monthKey}-01`;
    const last = `${monthKey}-${pad(daysInMonth)}`;
    onChange(first, last);
    setOpen(false);
  };

  const label = from ? (to ? `${fmtDate(from)} → ${fmtDate(to)}` : `${fmtDate(from)} → …`) : placeholder;

  return (
    <div className={`relative inline-block ${className}`}>
      <button ref={btnRef} type="button" className="btn-ghost flex items-center gap-2 whitespace-nowrap" onClick={() => setOpen((o) => !o)}>
        <CalendarDays size={16} className="muted shrink-0" />
        <span className="font-medium whitespace-nowrap">{label}</span>
        <ChevronDown size={15} className="muted shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="card p-3 fixed z-[61] w-[280px] overflow-y-auto thin-scroll" style={{ left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight ?? 360 }}>
            <CalendarHead viewY={viewY} viewM={viewM} view={view} setView={setView} prevMonth={prevMonth} nextMonth={nextMonth} />

            {view !== 'days' ? (
              <MonthYearGrid view={view} viewY={viewY} viewM={viewM} setViewY={setViewY} setViewM={setViewM} setView={setView} />
            ) : (
            <>
            <div className="grid grid-cols-7 gap-1 text-center">
              {WEEKDAYS.map((w) => <div key={w} className="text-[11px] font-bold muted py-1">{w}</div>)}
              {Array.from({ length: firstWeekday }).map((_, i) => <div key={`b${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const ds = `${monthKey}-${pad(day)}`;
                const isEnd = ds === from || ds === to;
                const inRange = from && to && ds > from && ds < to;
                return (
                  <button
                    type="button"
                    key={ds}
                    onClick={() => pick(ds)}
                    className={`h-9 rounded-lg text-xs flex items-center justify-center transition
                      ${isEnd ? 'text-white font-bold' : inRange ? 'font-semibold' : 'font-semibold hover:bg-[var(--color-card-alt)]'}`}
                    style={isEnd ? { background: 'var(--color-primary)' } : inRange ? { background: 'var(--color-card-alt)' } : {}}
                  >
                    {day}
                  </button>
                );
              })}
            </div>

            <button type="button" className="btn-ghost w-full mt-3 !py-1.5 text-sm" onClick={selectMonth}>
              Select whole month
            </button>
            {(from || to) && (
              <button type="button" className="btn-ghost w-full mt-2 !py-1.5 text-sm" onClick={() => { onChange('', ''); setOpen(false); }}>
                Clear
              </button>
            )}
            <p className="muted text-xs mt-2">Click a start date, then an end date — or use “Select whole month”.</p>
            </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
