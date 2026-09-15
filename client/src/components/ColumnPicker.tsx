import { useRef, useState } from 'react';
import { Columns3, ChevronDown, Check } from 'lucide-react';
import { useAnchoredMenu } from './anchoredMenu';

export type PickableColumn = { key: string; label: string };

/**
 * A "Columns" button that shows or hides a table's optional columns. The choice
 * is the caller's to keep (see useColumnVisibility) — this is only the menu.
 */
export function ColumnPicker({
  columns,
  visible,
  onToggle,
}: {
  columns: PickableColumn[];
  visible: Set<string>;
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const pos = useAnchoredMenu(open, btnRef, 220, 'right');
  const hidden = columns.filter((c) => !visible.has(c.key)).length;

  return (
    <div className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        // Same button as the Filters menu beside it, so the two line up.
        className="btn-ghost flex items-center gap-2 whitespace-nowrap"
        onClick={() => setOpen((o) => !o)}
        title="Show or hide columns"
      >
        <Columns3 size={16} className="muted" />
        <span className="font-medium">Columns</span>
        {hidden > 0 && <span className="text-xs muted">({hidden} hidden)</span>}
        <ChevronDown size={15} className="muted shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="card p-1.5 fixed z-[61]" style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: 220 }}>
            {columns.map((c) => {
              const on = visible.has(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => onToggle(c.key)}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-left hover:bg-[var(--color-card-alt)] transition"
                >
                  <span
                    className="grid place-items-center w-4 h-4 rounded border shrink-0"
                    style={on ? { background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: '#fff' } : { borderColor: 'var(--color-border)' }}
                  >
                    {on && <Check size={12} strokeWidth={3} />}
                  </span>
                  {c.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Which optional columns are showing — remembered in this browser (per table).
 * Until someone changes it, `defaults` decides (all columns when not given).
 */
export function useColumnVisibility(storageKey: string, all: string[], defaults: string[] = all) {
  const [visible, setVisible] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (Array.isArray(saved)) return new Set(saved.filter((k: string) => all.includes(k)));
    } catch { /* storage blocked or unreadable — use the defaults */ }
    return new Set(defaults);
  });
  const toggle = (key: string) => {
    setVisible((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /* not remembered, still works */ }
      return next;
    });
  };
  return { visible, toggle };
}
