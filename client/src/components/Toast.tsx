import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Info } from 'lucide-react';

// Tiny dependency-free toast. Call toast('message') anywhere; mount <Toaster />
// once (in Layout) to render them.
export type ToastType = 'success' | 'error' | 'info';
type Toast = { id: number; message: string; type: ToastType };

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<(t: Toast[]) => void>();
const emit = () => listeners.forEach((l) => l(toasts));

export function toast(message: string, type: ToastType = 'success') {
  const id = nextId++;
  toasts = [...toasts, { id, message, type }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 3000);
}

const ICON = { success: CheckCircle2, error: XCircle, info: Info };
const COLOR = {
  success: 'text-emerald-600 border-emerald-500/30',
  error: 'text-red-600 border-red-500/30',
  info: 'text-blue-600 border-blue-500/30',
};

export function Toaster() {
  const [items, setItems] = useState<Toast[]>(toasts);
  useEffect(() => {
    listeners.add(setItems);
    return () => { listeners.delete(setItems); };
  }, []);

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-[360px]">
      {items.map((t) => {
        const Icon = ICON[t.type];
        return (
          <div
            key={t.id}
            className={`card border px-4 py-3 flex items-center gap-2.5 text-sm font-medium shadow-lg animate-slide-in ${COLOR[t.type]}`}
          >
            <Icon size={18} className="shrink-0" />
            <span className="text-[var(--color-text)]">{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}


