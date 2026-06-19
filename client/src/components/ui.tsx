import { ReactNode } from 'react';

const ACCENTS: Record<string, string> = {
  blue: '#1e2a6e',   // navy (brand)
  purple: '#7c6cf0',
  emerald: '#10b981',
  orange: '#f7a823', // warm accent (brand)
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
    <div className="card p-5 relative overflow-hidden group hover:-translate-y-0.5 transition-transform duration-150">
      {/* soft accent glow */}
      <div className="absolute -right-6 -top-6 w-20 h-20 rounded-full opacity-10" style={{ background: color }} />
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        <span className="text-[11px] font-bold uppercase tracking-wider muted">{label}</span>
      </div>
      <div className="font-display text-2xl font-extrabold" style={{ color }}>
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
    'SP-Active': 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
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
  return <span className={n < 0 ? 'text-red-500 font-semibold' : ''}>{n.toFixed(2)} h</span>;
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} className="table-th">{h}</th>
            ))}
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
