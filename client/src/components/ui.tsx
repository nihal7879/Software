import { ReactNode } from 'react';
import { Select } from './Select';

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
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </div>
      {children}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Active: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
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
type Col = string | { label: string; align?: 'left' | 'right' | 'center' };
const alignClass = (a?: 'left' | 'right' | 'center') => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : '');

export function Table({ head, children }: { head: Col[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {head.map((h, i) => {
              const label = typeof h === 'string' ? h : h.label;
              const cls = typeof h === 'string' ? '' : alignClass(h.align);
              return <th key={i} className={`table-th ${cls}`}>{label}</th>;
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
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

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mt-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {onPageSize && (
          <label className="flex items-center gap-1.5 muted">
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
          </label>
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
  );
}
