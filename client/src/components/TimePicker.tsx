import { useRef, useState } from 'react';
import { useAnchoredMenu } from './anchoredMenu';
import { Clock } from 'lucide-react';

const pad = (n: number) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
// Lectures start and end on the quarter hour, so those are the only minutes
// offered — scrolling past 60 rows to reach :30 was the slow part of the form.
const QUARTERS = [0, 15, 30, 45];
const MENU_W = 210;
// The short popup, as it has always been: about six rows and scroll for the
// rest. It shrinks further when the field sits near the bottom of the screen.
const COL_H = 180;

/**
 * The columns and their rows are declared here, outside the picker, and that
 * matters: a component declared inside another is a NEW component type on every
 * render, so React throws the old element away and mounts a fresh one. The
 * column lost its scroll position each time it happened — and since the popup
 * repositions itself on every scroll event, including the column's own, each
 * notch of the wheel sent the list straight back to the top. That was "it stops
 * at 6": the scrolling worked, it was just being undone as fast as it happened.
 */
const Col = ({ maxHeight, children }: { maxHeight: number; children: React.ReactNode }) => (
  <div className="flex flex-col gap-0.5 overflow-y-auto thin-scroll px-0.5 w-14" style={{ maxHeight }}>{children}</div>
);

const Item = ({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) => (
  <button
    type="button"
    onClick={onClick}
    className={`py-1.5 rounded-lg text-sm text-center transition ${active ? 'text-white font-semibold' : 'hover:bg-[var(--color-card-alt)]'}`}
    style={active ? { background: 'var(--color-primary)' } : {}}
  >
    {label}
  </button>
);

// 12-hour time picker (hour / minute / AM-PM columns). Stores value as
// 'HH:MM:SS' (24-hour) so the server can parse it.
function parse(v: string) {
  if (!v) return null;
  const [H, M] = v.split(':').map(Number);
  if (Number.isNaN(H)) return null;
  return { h12: H % 12 || 12, m: M || 0, ampm: H < 12 ? 'AM' : 'PM' as 'AM' | 'PM' };
}

export function TimePicker({ value, onChange, placeholder = 'Select time' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  // Anchored to the button and positioned from the viewport, the same way the
  // date picker and the dropdowns are. As a plain absolute box it was placed
  // against whatever happened to be positioned above it, which inside a table
  // landed it over the next cell instead of under its own.
  const btnRef = useRef<HTMLButtonElement>(null);
  const pos = useAnchoredMenu(open, btnRef, MENU_W, 'left');
  const cur = parse(value) || { h12: 12, m: 0, ampm: 'AM' as 'AM' | 'PM' };
  const has = !!parse(value);
  // An existing record can hold an odd minute (an older entry, or a time typed
  // before this list was narrowed). It is kept in the column so the value stays
  // visible and re-selectable instead of silently vanishing.
  const minutes = QUARTERS.includes(cur.m) ? QUARTERS : [...QUARTERS, cur.m].sort((a, b) => a - b);

  const emit = (h12: number, m: number, ampm: 'AM' | 'PM') => {
    const h24 = ampm === 'PM' ? (h12 % 12) + 12 : h12 % 12;
    onChange(`${pad(h24)}:${pad(m)}:00`);
  };

  const label = has ? `${pad(cur.h12)}:${pad(cur.m)} ${cur.ampm}` : placeholder;

  // Short by default, and never taller than the room the popup actually got —
  // a column taller than its own box hides its last rows below the clip.
  const colMax = Math.max(96, Math.min(COL_H, (pos.maxHeight ?? COL_H + 16) - 16));

  return (
    <div className="relative">
      <button ref={btnRef} type="button" className="input flex items-center gap-2 w-full text-left" onClick={() => setOpen((o) => !o)}>
        <Clock size={15} className="muted shrink-0" />
        <span className={`whitespace-nowrap ${has ? '' : 'muted'}`}>{label}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div data-anchored-menu className="card p-2 fixed z-[61] flex gap-1" style={{ left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}>
            <Col maxHeight={colMax}>{HOURS.map((h) => <Item key={h} active={has && cur.h12 === h} onClick={() => emit(h, cur.m, cur.ampm)} label={pad(h)} />)}</Col>
            <Col maxHeight={colMax}>{minutes.map((m) => <Item key={m} active={has && cur.m === m} onClick={() => emit(cur.h12, m, cur.ampm)} label={pad(m)} />)}</Col>
            <div className="flex flex-col gap-0.5 w-14">
              {(['AM', 'PM'] as const).map((a) => <Item key={a} active={has && cur.ampm === a} onClick={() => emit(cur.h12, cur.m, a)} label={a} />)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
