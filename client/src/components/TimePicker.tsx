import { useState } from 'react';
import { Clock } from 'lucide-react';

const pad = (n: number) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i); // 0,1,…,59

// 12-hour time picker (hour / minute / AM-PM columns). Stores value as
// 'HH:MM:SS' (24-hour) so the server can parse it.
function parse(v: string) {
  if (!v) return null;
  const [H, M] = v.split(':').map(Number);
  if (Number.isNaN(H)) return null;
  return { h12: H % 12 || 12, m: M || 0, ampm: H < 12 ? 'AM' : 'PM' as 'AM' | 'PM' };
}

export function TimePicker({ value, onChange, placeholder = 'Select time' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const cur = parse(value) || { h12: 12, m: 0, ampm: 'AM' as 'AM' | 'PM' };
  const has = !!parse(value);

  const emit = (h12: number, m: number, ampm: 'AM' | 'PM') => {
    const h24 = ampm === 'PM' ? (h12 % 12) + 12 : h12 % 12;
    onChange(`${pad(h24)}:${pad(m)}:00`);
  };

  const label = has ? `${pad(cur.h12)}:${pad(cur.m)} ${cur.ampm}` : placeholder;

  const Col = ({ children }: { children: React.ReactNode }) => (
    <div className="flex flex-col gap-0.5 overflow-y-auto thin-scroll max-h-[180px] px-0.5 w-14">{children}</div>
  );
  const Item = ({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) => (
    <button
      type="button"
      onClick={onClick}
      className={`py-1.5 rounded-lg text-sm text-center transition ${active ? 'text-white font-semibold' : 'hover:bg-[var(--color-card-alt)]'}`}
      style={active ? { background: 'var(--color-primary)' } : {}}
    >
      {label}
    </button>
  );

  return (
    <div className="relative">
      <button type="button" className="input flex items-center gap-2 w-full text-left" onClick={() => setOpen((o) => !o)}>
        <Clock size={15} className="muted shrink-0" />
        <span className={has ? '' : 'muted'}>{label}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="card p-2 absolute z-[61] mt-2 flex gap-1">
            <Col>{HOURS.map((h) => <Item key={h} active={has && cur.h12 === h} onClick={() => emit(h, cur.m, cur.ampm)} label={pad(h)} />)}</Col>
            <Col>{MINUTES.map((m) => <Item key={m} active={has && cur.m === m} onClick={() => emit(cur.h12, m, cur.ampm)} label={pad(m)} />)}</Col>
            <div className="flex flex-col gap-0.5 w-14">
              {(['AM', 'PM'] as const).map((a) => <Item key={a} active={has && cur.ampm === a} onClick={() => emit(cur.h12, cur.m, a)} label={a} />)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
