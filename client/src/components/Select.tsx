import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';

export type Option = { value: string | number; label: string; sub?: string };

// Custom themed dropdown — replaces native <select> so the option list matches
// the app theme. The menu is position:fixed so it escapes any overflow/scroll
// container (tables, drawers), opens upward when there's little room below, is
// scrollable, and always has a search box.
export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  className = '',
  allowCustom = false,
  onSearch,
  searchable = true,
  compact = false,
  maxVisible,
}: {
  value: string | number | '';
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  allowCustom?: boolean;
  // When provided, filtering is delegated to the server (the parent refetches
  // `options` from the search term). Used for large lists (e.g. 3000 students)
  // that can't all be loaded into the dropdown.
  onSearch?: (q: string) => void;
  /** Hide the search box on short, self-evident lists (e.g. rows-per-page). */
  searchable?: boolean;
  /** Tighter trigger, for inline controls like the pagination bar. */
  compact?: boolean;
  /** Cap the option list to roughly this many rows; the rest scrolls. */
  maxVisible?: number;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [rowH, setRowH] = useState(0);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number }>({ left: 0, width: 0 });

  const selected = options.find((o) => String(o.value) === String(value));

  // Cap the list at exactly `maxVisible` rows. The height is measured from a
  // real rendered option rather than assumed: padding, font size and browser
  // zoom all move it, and guessing low leaves a seventh row peeking through.
  const listMaxHeight = maxVisible && rowH ? maxVisible * rowH : undefined;

  const filtered = useMemo(() => {
    // Server-side search mode: parent already filtered `options`, don't re-filter.
    if (onSearch) return options;
    if (!q.trim()) return options;
    const needle = q.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(needle) || (o.sub || '').toLowerCase().includes(needle));
  }, [q, options, onSearch]);

  // Position the fixed menu relative to the trigger; flip upward if needed.
  const reposition = () => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    // Clamp the menu inside the viewport so it never causes horizontal scroll.
    // Compact pickers hold short values (page numbers, row counts) and would
    // look absurd stretched to the 200px a labelled list needs.
    const minWidth = compact ? r.width : 200;
    const width = Math.min(Math.max(r.width, minWidth), window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - r.bottom;
    const MENU_MAX = 300;
    if (spaceBelow < MENU_MAX && r.top > spaceBelow) {
      setPos({ left, width, bottom: window.innerHeight - r.top + 4 });
    } else {
      setPos({ left, width, top: r.bottom + 4 });
    }
  };

  useLayoutEffect(() => { if (open) reposition(); }, [open]);

  // Measure one option once the menu is on screen.
  useLayoutEffect(() => {
    if (!open || !maxVisible) return;
    const first = listRef.current?.firstElementChild as HTMLElement | null;
    if (first?.offsetHeight) setRowH(first.offsetHeight);
  }, [open, maxVisible, filtered.length]);

  // Keep the menu glued to the trigger while the page/table scrolls or resizes.
  useEffect(() => {
    if (!open) return;
    const onMove = () => reposition();
    window.addEventListener('scroll', onMove, true); // capture → catches inner scroll containers
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  const close = () => { setOpen(false); setQ(''); };

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
        type="button"
        className={`input flex items-center justify-between gap-2 w-full text-left ${compact ? '!py-1 !px-2' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`truncate ${selected || (allowCustom && value) ? '' : 'muted'}`}>{selected ? selected.label : (allowCustom && value ? String(value) : placeholder)}</span>
        <ChevronDown size={16} className="muted shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={close} />
          <div
            className="card p-1.5 fixed z-[61] flex flex-col"
            style={{
              left: pos.left,
              width: pos.width,
              top: pos.top,
              bottom: pos.bottom,
              maxHeight: 300,
            }}
          >
            {searchable && (
            <div className="flex items-center gap-2 px-2 py-1.5 mb-1 shrink-0" style={{ background: 'var(--color-card)' }}>
              <Search size={14} className="muted shrink-0" />
              <input
                autoFocus
                className="bg-transparent outline-none text-sm w-full"
                placeholder="Search…"
                value={q}
                onChange={(e) => { setQ(e.target.value); onSearch?.(e.target.value); }}
              />
            </div>
            )}
            <div
              ref={listRef}
              className="flex-1 min-h-0 overflow-y-auto thin-scroll"
              style={listMaxHeight ? { maxHeight: listMaxHeight } : undefined}
            >
              {allowCustom && q.trim() && !options.some((o) => o.label.toLowerCase() === q.trim().toLowerCase()) && (
                <button
                  type="button"
                  onClick={() => { onChange(q.trim()); close(); }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-[var(--color-card-alt)] transition"
                >
                  Use “<span className="font-semibold">{q.trim()}</span>”
                </button>
              )}
              {filtered.length === 0 && !(allowCustom && q.trim()) ? (
                <div className="px-3 py-2 text-sm muted">No matches.</div>
              ) : (
                filtered.map((o) => {
                  const isSel = String(o.value) === String(value);
                  return (
                    <button
                      type="button"
                      key={o.value}
                      onClick={() => { onChange(String(o.value)); close(); }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between gap-2 transition
                        ${isSel ? 'text-white font-semibold' : 'hover:bg-[var(--color-card-alt)]'}`}
                      style={isSel ? { background: 'var(--color-primary)' } : {}}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{o.label}</span>
                        {o.sub && <span className={`block truncate text-xs ${isSel ? 'text-white/80' : 'muted'}`}>{o.sub}</span>}
                      </span>
                      {isSel && <Check size={15} className="shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
