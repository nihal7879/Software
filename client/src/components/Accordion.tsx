import { ReactNode, useState } from 'react';

export interface AccordionItem {
  key: string;
  title: string;
  subtitle?: string;
  icon?: string;
  badge?: ReactNode;
  content: ReactNode;
}

// Click a section header to expand/collapse it.
export function Accordion({ items, defaultOpen }: { items: AccordionItem[]; defaultOpen?: string }) {
  const [open, setOpen] = useState<string | null>(defaultOpen ?? items[0]?.key ?? null);

  return (
    <div className="space-y-3">
      {items.map((it) => {
        const isOpen = open === it.key;
        return (
          <div key={it.key} className="card overflow-hidden">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : it.key)}
              className="w-full flex items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-[var(--color-card-alt)]"
            >
              {it.icon && <span className="text-xl">{it.icon}</span>}
              <div className="flex-1">
                <div className="font-display font-bold">{it.title}</div>
                {it.subtitle && <div className="muted text-xs mt-0.5">{it.subtitle}</div>}
              </div>
              {it.badge}
              <span
                className="text-lg muted transition-transform duration-200"
                style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
              >
                ›
              </span>
            </button>
            <div
              className="grid transition-all duration-300 ease-in-out"
              style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
            >
              <div className="overflow-hidden">
                <div className="px-5 pb-5 pt-1 border-t" style={{ borderColor: 'var(--color-border)' }}>
                  {it.content}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
