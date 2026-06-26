import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';

export type Option = { value: string | number; label: string };

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
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number }>({ left: 0, width: 0 });

  const selected = options.find((o) => String(o.value) === String(value));

  const filtered = useMemo(() => {
    // Server-side search mode: parent already filtered `options`, don't re-filter.
    if (onSearch) return options;
    if (!q.trim()) return options;
    const needle = q.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [q, options, onSearch]);

  // Position the fixed menu relative to the trigger; flip upward if needed.
  const reposition = () => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const MENU_MAX = 300;
    if (spaceBelow < MENU_MAX && r.top > spaceBelow) {
      setPos({ left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4 });
    } else {
      setPos({ left: r.left, width: r.width, top: r.bottom + 4 });
    }
  };

  useLayoutEffect(() => { if (open) reposition(); }, [open]);

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
        className="input flex items-center justify-between gap-2 w-full text-left"
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
              width: Math.max(pos.width, 200),
              top: pos.top,
              bottom: pos.bottom,
              maxHeight: 300,
            }}
          >
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
            <div className="overflow-y-auto thin-scroll">
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
                      <span className="truncate">{o.label}</span>
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
