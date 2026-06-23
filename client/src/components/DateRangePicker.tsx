import { ReactNode } from 'react';

// Shared From/To date-range picker used across admin, faculty, student & parent.
export function DateRangePicker({
  from,
  to,
  onFrom,
  onTo,
  children,
}: {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="card p-4 flex flex-wrap items-end gap-3">
      <div>
        <label className="text-xs font-medium muted">From</label>
        <input type="date" className="input mt-1" value={from} onChange={(e) => onFrom(e.target.value)} />
      </div>
      <div>
        <label className="text-xs font-medium muted">To</label>
        <input type="date" className="input mt-1" value={to} onChange={(e) => onTo(e.target.value)} />
      </div>
      {children}
    </div>
  );
}
