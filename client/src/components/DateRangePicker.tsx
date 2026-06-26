import { ReactNode } from 'react';
import { CalendarPicker } from './CalendarPicker';

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
        <label className="text-xs font-medium muted block mb-1">From</label>
        <CalendarPicker value={from} onChange={onFrom} placeholder="From date" />
      </div>
      <div>
        <label className="text-xs font-medium muted block mb-1">To</label>
        <CalendarPicker value={to} onChange={onTo} placeholder="To date" />
      </div>
      {children}
    </div>
  );
}
