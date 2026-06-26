import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Check, Search, X } from 'lucide-react';

export type Option = { value: string; label: string };

// Multi-select dropdown. `value` is a comma-separated string (so it drops into a
// plain form field / text column), `onChange` returns the same. Pick one or more
// options; `allowCustom` lets the user add a value not in the list.
export function MultiSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  className = '',
  allowCustom = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  allowCustom?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number }>({ left: 0, width: 0 });

  const selected = useMemo(
    () => value.split(',').map((s) => s.trim()).filter(Boolean),
    [value]
  );
  const has = (v: string) => selected.some((s) => s.toLowerCase() === v.toLowerCase());

  const toggle = (v: string) => {
    if (has(v)) onChange(selected.filter((s) => s.toLowerCase() !== v.toLowerCase()).join(', '));
    else onChange([...selected, v].join(', '));
  };

  const filtered = useMemo(() => {
    if (!q.trim()) return options;
    const needle = q.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [q, options]);

  const reposition = () => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    // Clamp inside the viewport so the menu never causes horizontal scroll.
    const width = Math.min(Math.max(r.width, 200), window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - r.bottom;
    const MENU_MAX = 300;
    if (spaceBelow < MENU_MAX && r.top > spaceBelow) setPos({ left, width, bottom: window.innerHeight - r.top + 4 });
    else setPos({ left, width, top: r.bottom + 4 });
  };
  useLayoutEffect(() => { if (open) reposition(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onMove = () => reposition();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => { window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', onMove); };
  }, [open]);

  const close = () => { setOpen(false); setQ(''); };

  return (
    <div className={`relative ${className}`}>
      <button ref={btnRef} type="button" className="input flex items-center justify-between gap-2 w-full text-left min-h-[42px]" onClick={() => setOpen((o) => !o)}>
        <span className="flex flex-wrap gap-1 items-center">
          {selected.length === 0 ? (
            <span className="muted">{placeholder}</span>
          ) : selected.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--color-card-alt)' }}>
              {s}
              <X size={12} className="muted hover:text-red-500" onClick={(e) => { e.stopPropagation(); toggle(s); }} />
            </span>
          ))}
        </span>
        <ChevronDown size={16} className="muted shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={close} />
          <div className="card p-1.5 fixed z-[61] flex flex-col" style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: 300 }}>
            <div className="flex items-center gap-2 px-2 py-1.5 mb-1 shrink-0" style={{ background: 'var(--color-card)' }}>
              <Search size={14} className="muted shrink-0" />
              <input autoFocus className="bg-transparent outline-none text-sm w-full" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto thin-scroll">
              {allowCustom && q.trim() && !options.some((o) => o.label.toLowerCase() === q.trim().toLowerCase()) && (
                <button type="button" onClick={() => { toggle(q.trim()); setQ(''); }} className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-[var(--color-card-alt)] transition">
                  Add “<span className="font-semibold">{q.trim()}</span>”
                </button>
              )}
              {filtered.length === 0 && !(allowCustom && q.trim()) ? (
                <div className="px-3 py-2 text-sm muted">No matches.</div>
              ) : (
                filtered.map((o) => {
                  const isSel = has(String(o.value));
                  return (
                    <button type="button" key={o.value} onClick={() => toggle(String(o.value))}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between gap-2 transition ${isSel ? 'font-semibold' : 'hover:bg-[var(--color-card-alt)]'}`}
                      style={isSel ? { background: 'var(--color-card-alt)' } : {}}>
                      <span className="truncate">{o.label}</span>
                      {isSel && <Check size={15} className="shrink-0" style={{ color: 'var(--color-primary)' }} />}
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
