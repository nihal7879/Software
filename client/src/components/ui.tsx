import { ReactNode } from 'react';

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
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display font-bold text-base accent-underline">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Active: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    Inactive: 'bg-slate-500/15 text-slate-500',
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





