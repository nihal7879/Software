import { ReactNode, RefObject, useEffect, useState } from 'react';

/**
 * True from the lg breakpoint (1024px) up — laptop and wider. For the few places
 * a phone layout needs different props, not just different classes.
 */
export function useWide() {
  const query = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => typeof window === 'undefined' || window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Select } from './Select';
import { Overlay } from './Overlay';

const ACCENTS: Record<string, string> = {
  blue: '#f97316',   // orange (brand)
  purple: '#7c6cf0',
  emerald: '#10b981',
  orange: '#f59e0b', // amber — data viz only
  red: '#ef4444',
  indigo: '#6366f1',
};

export function KpiCard({
  label,
  value,
  sub,
  accent = 'blue',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: keyof typeof ACCENTS | string;
}) {
  const color = ACCENTS[accent] || accent;
  return (
    <div className="card p-5 relative overflow-hidden transition-shadow duration-150 hover:shadow-md">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 rounded-full" style={{ background: color }} />
        <span className="text-[11px] font-semibold uppercase tracking-wide muted">{label}</span>
      </div>
      <div className="font-display text-2xl font-bold tnum" style={{ color: 'var(--color-text)' }}>
        {value}
      </div>
      {sub && <div className="text-xs muted mt-1.5">{sub}</div>}
    </div>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h3 className="font-display font-bold text-base accent-underline">{title}</h3>
        {/* Full width on a phone, so a search box in here can fill the row. */}
        {action && <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">{action}</div>}
      </div>
      {children}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Active: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    // Fee status: still has paid hours left. Same green as an active enrolment,
    // but a distinct word, so the two columns cannot be read as the same thing.
    'In Credit': 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    Inactive: 'bg-slate-500/15 text-slate-500',
    Trial: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
    'Payment Required': 'bg-red-500/15 text-red-600 dark:text-red-400',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || 'bg-slate-500/15'}`}>
      {status}
    </span>
  );
}

export function HoursValue({ value }: { value: number | string }) {
  const n = Number(value);
  return <span className={`whitespace-nowrap tabular-nums ${n <= 0 ? 'text-red-500 font-semibold' : ''}`}>{n.toFixed(2)} h</span>;
}

// A column header is either a plain label (left-aligned) or an object that can
// request right alignment — used for numeric / money / hours columns so the
// figures (and the trailing "h") line up vertically, finance-app style.
// A column carrying a `sortKey` becomes clickable, provided the table was given
// an `onSort`. The arrow shows on every sortable column (faint until it is the
// one in use) so it is visible that the column can be clicked at all.
type Col = string | { label: string; align?: 'left' | 'right' | 'center'; sortKey?: string };
export type Sort = { key: string; dir: 'asc' | 'desc' };
const alignClass = (a?: 'left' | 'right' | 'center') => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : '');

export function Table({
  head,
  children,
  sort,
  onSort,
}: {
  head: Col[];
  children: ReactNode;
  sort?: Sort;
  onSort?: (key: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {head.map((h, i) => {
              const label = typeof h === 'string' ? h : h.label;
              const cls = typeof h === 'string' ? '' : alignClass(h.align);
              const sortKey = typeof h === 'string' ? undefined : h.sortKey;
              if (!sortKey || !onSort) return <th key={i} className={`table-th ${cls}`}>{label}</th>;
              const active = sort?.key === sortKey;
              return (
                <th key={i} className={`table-th ${cls}`}>
                  <button
                    type="button"
                    onClick={() => onSort(sortKey)}
                    className="inline-flex items-center gap-1 hover:opacity-70 transition-opacity"
                    title={`Sort by ${label}`}
                  >
                    <span>{label}</span>
                    <span className={`text-[10px] leading-none ${active ? '' : 'opacity-25'}`}>
                      {active && sort?.dir === 'desc' ? '▼' : '▲'}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * Stacking cards, shared by the teacher's recent classes and the student's
 * calendar list. Inside `ref`, each <section> is one day: its [data-day] header
 * is sticky and its [data-stack] cards (class `stack-card`, top using
 * var(--day-h)) pin beneath it. This measures the header height into --day-h
 * (0 when a list has no day headers) and, per day, how many cards lie over each
 * one into --depth, which the CSS turns into a slight shrink and dim.
 */
export function useStackDepth(ref: RefObject<HTMLElement>, deps: unknown[]) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const head = root.querySelector<HTMLElement>('[data-day]');
      root.style.setProperty('--day-h', `${head ? head.offsetHeight : 0}px`);
      root.querySelectorAll('section').forEach((day) => {
        const cards = [...day.querySelectorAll<HTMLElement>('[data-stack]')];
        const rects = cards.map((c) => c.getBoundingClientRect());
        cards.forEach((c, i) => {
          let depth = 0;
          for (let j = i + 1; j < cards.length; j++) if (rects[j].top < rects[i].bottom - 12) depth++;
          c.style.setProperty('--depth', String(Math.min(depth, 3)));
        });
      });
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(frame);
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The sticky top for the i-th card of a day: under the app bar and the day header, a little lower each time. */
export const stackTop = (i: number) => `calc(3.5rem + env(safe-area-inset-top) + var(--day-h, 0px) + ${Math.min(i, 3) * 0.5}rem)`;

/** '16:30' or '16:30:00' → '4:30 PM', the way every phone list shows a time. */
export function fmtTime(t?: string | null) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A calendar-leaf date for phone lists: day large, month small. Reads a YYYY-MM-DD string, no Date parsing. */
export function DateTile({ iso }: { iso?: string | null }) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return (
    <div className="shrink-0 w-12 rounded-xl text-center py-1.5 self-start" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
      <div className="text-[10px] font-semibold leading-none" style={{ color: 'var(--color-primary)' }}>{m ? MON[Number(m[2]) - 1] : '—'}</div>
      <div className="font-display text-lg font-bold leading-tight tnum">{m ? Number(m[3]) : '?'}</div>
    </div>
  );
}

export function Spinner() {
  return <div className="muted text-sm p-6">Loading…</div>;
}






// Every list in the admin area shares this footer, so the page-size and
// jump-to-page controls behave identically wherever they appear.
//
// The sizes stop at "All" = 1000 rows. That is a real "all" for this data —
// the largest paginated list is 358 payments — and it keeps a stray click from
// pulling an unbounded result set once the tables have grown.
const PAGE_SIZES = [15, 20, 50, 100];
export const ALL_ROWS = 1000;

export function Pagination({
  page,
  pages,
  total,
  pageSize,
  onPage,
  onPageSize,
  noun = 'rows',
  note,
}: {
  page: number;
  pages: number;
  total?: number;
  pageSize: number;
  onPage: (p: number) => void;
  /** Omit to hide the rows-per-page picker on lists with a fixed size. */
  onPageSize?: (n: number) => void;
  noun?: string;
  /** Extra context appended after the counts, e.g. what a totals row covers. */
  note?: string;
}) {
  // A list that is still loading reports 0 pages; the picker always needs one.
  const pageCount = Math.max(1, pages);
  const current = Math.min(page, pageCount);

  // Both pickers use the themed Select rather than a native <select>: the
  // native option list is drawn by the OS, so it ignores the app theme, and at
  // 80 pages it renders an unbroken column the height of the screen. Select's
  // menu is capped and scrolls, and its search box makes a long page list
  // usable — type "47" instead of dragging to it.
  const sizeOptions = [
    ...PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) })),
    { value: String(ALL_ROWS), label: 'All' },
  ];
  const pageOptions = Array.from({ length: pageCount }, (_, i) => ({
    value: String(i + 1),
    label: String(i + 1),
  }));

  // Both labels below are <span>, never <label>. A <label> forwards stray
  // clicks to the control inside it, so clicking away to dismiss the menu
  // bubbled up and reopened it instantly — the picker looked impossible to
  // close without choosing something.

  return (
    <>
    <PhonePager page={current} pages={pageCount} total={total} noun={noun} note={note}
      pageSize={pageSize} onPage={onPage} onPageSize={onPageSize} sizeOptions={sizeOptions} />
    <div className="hidden lg:flex flex-wrap items-center justify-between gap-2 mt-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {onPageSize && (
          <span className="flex items-center gap-1.5 muted">
            Rows
            <div className="w-[72px]">
              <Select
                compact
                searchable={false}
                value={String(pageSize)}
                options={sizeOptions}
                onChange={(v) => {
                  // Resetting here rather than at each call site: page 10 of 2
                  // is unreachable, and every list would otherwise need the fix.
                  onPageSize(Number(v));
                  onPage(1);
                }}
              />
            </div>
          </span>
        )}
        <span className="flex items-center gap-1.5 muted">
          Page
          {pageCount <= 1 ? (
            <span className="font-semibold" style={{ color: 'var(--color-text)' }}>1</span>
          ) : (
            <div className="w-[76px]">
              <Select
                compact
                // The search box earns its place once the list outgrows a glance.
                searchable={pageCount > 12}
                maxVisible={6}
                value={String(current)}
                options={pageOptions}
                onChange={(v) => onPage(Number(v))}
              />
            </div>
          )}
          / {pageCount}
          {total != null && <> · {total} {noun}</>}
          {note && <> · {note}</>}
        </span>
      </div>
      <div className="flex gap-2">
        <button className="btn-ghost" disabled={current <= 1} onClick={() => onPage(current - 1)}>Prev</button>
        <button className="btn-ghost" disabled={current >= pageCount} onClick={() => onPage(current + 1)}>Next</button>
      </div>
    </div>
    </>
  );
}

/**
 * The same pager for phones and tablets: one pill with the arrows either side.
 * Tapping the middle opens a sheet with every page as a button and the rows
 * choice — no tiny dropdowns to aim at.
 */
function PhonePager({ page, pages, total, noun, note, pageSize, onPage, onPageSize, sizeOptions }: {
  page: number; pages: number; total?: number; noun: string; note?: string; pageSize: number;
  onPage: (p: number) => void; onPageSize?: (n: number) => void; sizeOptions: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const arrow = 'grid place-items-center w-11 h-11 rounded-xl shrink-0 transition disabled:opacity-35';
  const go = (p: number) => { onPage(p); setOpen(false); };
  return (
    <div className="lg:hidden mt-4">
      <div className="flex items-center gap-1.5 p-1.5 rounded-2xl" style={{ background: 'var(--color-card-alt)' }}>
        <button className={arrow} style={{ background: 'var(--color-card)' }} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft size={18} />
        </button>
        <button className="flex-1 min-w-0 text-center py-1 rounded-xl" onClick={() => setOpen(true)} aria-label="Choose a page">
          <div className="text-sm font-semibold tnum">Page {page} <span className="muted font-normal">of {pages}</span></div>
          {(total != null || note) && (
            <div className="text-[11px] muted truncate">{[total != null ? `${total} ${noun}` : null, note].filter(Boolean).join(' · ')}</div>
          )}
        </button>
        <button className={arrow} style={{ background: 'var(--color-card)' }} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight size={18} />
        </button>
      </div>

      {open && (
        <Overlay align="bottom" onClose={() => setOpen(false)}>
          <div className="w-full rounded-t-3xl px-5 pt-3 animate-sheet-up max-h-[80vh] overflow-y-auto thin-scroll"
            style={{ background: 'var(--color-card)', paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Choose a page">
            <div className="mx-auto mb-4 w-10 h-1.5 rounded-full" style={{ background: 'var(--color-border)' }} />
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="font-display font-bold">Go to page</h3>
              {total != null && <span className="text-xs muted">{total} {noun}</span>}
            </div>
            <div className="grid grid-cols-5 sm:grid-cols-8 gap-2">
              {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                <button key={p} onClick={() => go(p)}
                  className={`h-11 rounded-xl text-sm font-semibold tnum transition ${p === page ? 'text-white' : ''}`}
                  style={p === page ? { background: 'var(--color-primary)' } : { background: 'var(--color-card-alt)' }}
                  aria-current={p === page ? 'page' : undefined}>
                  {p}
                </button>
              ))}
            </div>
            {onPageSize && (
              <>
                <h3 className="font-display font-bold mt-5 mb-3">Rows on a page</h3>
                <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--color-card-alt)' }}>
                  {sizeOptions.map((o) => {
                    const on = Number(o.value) === pageSize;
                    return (
                      <button key={o.value} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${on ? 'shadow-sm' : 'muted'}`}
                        style={on ? { background: 'var(--color-card)', color: 'var(--color-primary)' } : {}}
                        onClick={() => { onPageSize(Number(o.value)); go(1); }}>
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </Overlay>
      )}
    </div>
  );
}





