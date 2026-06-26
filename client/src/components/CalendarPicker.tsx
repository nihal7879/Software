import { RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';

// Reusable single-date calendar popover — the same look used in the student
// Lecture History. Pass value as 'YYYY-MM-DD' ('' = none). `highlight` is an
// optional set of dates that get a dot marker.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

// Anchors a fixed-position popover to a trigger button so it escapes overflow
// containers (tables/drawers), flips upward when low on space, and follows the
// trigger while the page/table scrolls.
function useAnchoredMenu(open: boolean, btnRef: RefObject<HTMLElement>, menuW: number, align: 'left' | 'right') {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });

  const reposition = () => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    let left = align === 'right' ? r.right - menuW : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - menuW - 8));
    const spaceBelow = window.innerHeight - r.bottom;
    const MENU_MAX = 360;
    if (spaceBelow < MENU_MAX && r.top > spaceBelow) setPos({ left, bottom: window.innerHeight - r.top + 4 });
    else setPos({ left, top: r.bottom + 4 });
  };

  useLayoutEffect(() => { if (open) reposition(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onMove = () => reposition();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => { window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', onMove); };
  }, [open]);

  return pos;
}

export function CalendarPicker({
  value,
  onChange,
  placeholder = 'Select date',
  highlight,
  className = '',
  align = 'left',
}: {
  value: string;
  onChange: (d: string) => void;
  placeholder?: string;
  highlight?: Set<string> | string[];
  className?: string;
  align?: 'left' | 'right';
}) {
  const init = value ? new Date(value) : new Date();
  const [viewY, setViewY] = useState(init.getFullYear());
  const [viewM, setViewM] = useState(init.getMonth()); // 0-11
  const [open, setOpen] = useState(false);
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
        <span className="font-medium whitespace-nowrap">{value || placeholder}</span>
        <ChevronDown size={15} className="muted shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="card p-3 fixed z-[61] w-[260px] overflow-y-auto thin-scroll" style={{ left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: 360 }}>
            <div className="flex items-center justify-between mb-3">
              <button type="button" className="btn-ghost !py-1.5 !px-3" onClick={prevMonth}>‹</button>
              <div className="font-display font-bold">{MONTHS[viewM]} {viewY}</div>
              <button type="button" className="btn-ghost !py-1.5 !px-3" onClick={nextMonth}>›</button>
            </div>

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
  const init = from ? new Date(from) : new Date();
  const [viewY, setViewY] = useState(init.getFullYear());
  const [viewM, setViewM] = useState(init.getMonth());
  const [open, setOpen] = useState(false);
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

  const label = from ? (to ? `${from} → ${to}` : `${from} → …`) : placeholder;

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
          <div className="card p-3 fixed z-[61] w-[280px] overflow-y-auto thin-scroll" style={{ left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: 360 }}>
            <div className="flex items-center justify-between mb-3">
              <button type="button" className="btn-ghost !py-1.5 !px-3" onClick={prevMonth}>‹</button>
              <div className="font-display font-bold">{MONTHS[viewM]} {viewY}</div>
              <button type="button" className="btn-ghost !py-1.5 !px-3" onClick={nextMonth}>›</button>
            </div>

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
          </div>
        </>
      )}
    </div>
  );
}
