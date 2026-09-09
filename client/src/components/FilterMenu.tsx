import { ReactNode, useRef, useState } from 'react';
import { SlidersHorizontal, ChevronDown } from 'lucide-react';
import { useAnchoredMenu } from './anchoredMenu';

// One "Filters" button that opens a panel holding the filter fields, instead of
// a row of dropdowns sitting permanently in the toolbar. The badge on the button
// says how many are on, so a narrowed list never looks like the whole list.
//
// Fields are passed as children, each wrapped in <FilterField label="…">, and
// they apply as they change — there is no Apply button, because the table
// behind the panel updates while it is open.
export function FilterMenu({
  count,
  onClear,
  children,
  width = 260,
  align = 'right',
  label = 'Filters',
}: {
  /** How many filters are currently set — shown as a badge, drives "Clear all". */
  count: number;
  onClear: () => void;
  children: ReactNode;
  width?: number;
  align?: 'left' | 'right';
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const pos = useAnchoredMenu(open, btnRef, width, align);

  return (
    <div className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        className="btn-ghost flex items-center gap-2 whitespace-nowrap"
        onClick={() => setOpen((o) => !o)}
        title={count > 0 ? `${count} filter${count === 1 ? '' : 's'} applied` : 'Filter this list'}
      >
        <SlidersHorizontal size={16} className={count > 0 ? '' : 'muted'} />
        <span className="font-medium">{label}</span>
        {count > 0 && (
          <span
            // Square footprint (min-width equal to height) so a single digit
            // draws a true circle rather than the oval that horizontal padding
            // alone produces. Only a 3-digit count would stretch it to a pill.
            className="inline-flex items-center justify-center h-[18px] min-w-[18px] px-1 text-[11px] font-bold leading-none text-white rounded-full tabular-nums"
            style={{ background: 'var(--color-primary)' }}
          >
            {count}
          </span>
        )}
        <ChevronDown size={15} className="muted shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div
            className="card p-3 fixed z-[61] overflow-y-auto thin-scroll"
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width, maxHeight: 360 }}
          >
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="font-display font-bold text-sm">{label}</span>
              <button
                type="button"
                className="text-xs muted hover:opacity-70 transition-opacity disabled:opacity-40"
                onClick={onClear}
                disabled={count === 0}
              >
                Clear all
              </button>
            </div>
            <div className="space-y-3">{children}</div>
          </div>
        </>
      )}
    </div>
  );
}

/** One labelled row inside a FilterMenu. */
export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium muted block mb-1">{label}</label>
      {children}
    </div>
  );
}
