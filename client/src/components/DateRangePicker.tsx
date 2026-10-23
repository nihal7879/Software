import { ReactNode } from 'react';
import { CalendarPicker } from './CalendarPicker';
import { useWide } from './ui';

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
  const wide = useWide();
  return (
    // Below lg the two dates split the row evenly and fill it.
    <div className="card p-4 flex flex-wrap items-end gap-3 max-lg:grid max-lg:grid-cols-2 m-form">
      <div>
        <label className="text-xs font-medium muted block mb-1">From</label>
        <CalendarPicker stretch={!wide} value={from} onChange={onFrom} placeholder="From date" />
      </div>
      <div>
        <label className="text-xs font-medium muted block mb-1">To</label>
        <CalendarPicker stretch={!wide} value={to} onChange={onTo} placeholder="To date" align={wide ? 'left' : 'right'} />
      </div>
      {wide ? children : children && <div className="col-span-2">{children}</div>}
    </div>
  );
}
