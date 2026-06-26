import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Wallet, Clock } from 'lucide-react';
import { api } from '../../api/client';
import { Section, Spinner } from '../../components/ui';
import { Select } from '../../components/Select';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

type View = 'finance' | 'hours';

export default function Pivots() {
  const [view, setView] = useState<View>('finance');

  const finance = useQuery({ queryKey: ['finance-pivot'], queryFn: () => api.get('/analytics/finance-pivot').then((r) => r.data) });
  const hours = useQuery({ queryKey: ['hours-pivot'], queryFn: () => api.get('/analytics/hours-pivot').then((r) => r.data) });

  const active = view === 'finance' ? finance : hours;
  const valueKey = view === 'finance' ? 'amount' : 'hours';
  const fmt = view === 'finance'
    ? (n: number) => n.toLocaleString('en-AE', { maximumFractionDigits: 0 })
    : (n: number) => n.toLocaleString('en-AE', { maximumFractionDigits: 1 });

  // Years present in the data (both datasets), newest first. Fallback to 2026.
  const years = useMemo(() => {
    const set = new Set<number>();
    for (const ds of [finance.data, hours.data]) {
      for (const r of ds?.rows || []) {
        const y = Number(String(r.month).slice(0, 4));
        if (y) set.add(y);
      }
    }
    return set.size ? Array.from(set).sort((a, b) => b - a) : [2026];
  }, [finance.data, hours.data]);

  const [year, setYear] = useState<number | null>(null);
  const curYear = year ?? years[0];
  const [studentFilter, setStudentFilter] = useState(''); // '' = all students

  // Distinct students (for the selector), from whichever dataset is active.
  const studentOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of active.data?.rows || []) {
      if (!seen.has(r.form_no)) seen.set(r.form_no, r.student_name);
    }
    return [
      { value: '', label: 'All students' },
      ...Array.from(seen.entries())
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([form, name]) => ({ value: form, label: `${form} — ${name}` })),
    ];
  }, [active.data]);

  // Group the active dataset into students × month cells for the selected year.
  const { students, monthKeys, monthTotals, grand } = useMemo(() => {
    const monthKeys = MONTHS.map((_, i) => `${curYear}-${pad(i + 1)}`);
    const byStudent: Record<string, any> = {};
    for (const r of active.data?.rows || []) {
      if (!String(r.month).startsWith(String(curYear))) continue;
      if (studentFilter && String(r.form_no) !== studentFilter) continue;
      const k = r.form_no;
      byStudent[k] = byStudent[k] || { form_no: r.form_no, student_name: r.student_name, cells: {} };
      byStudent[k].cells[r.month] = Number(r[valueKey]) || 0;
    }
    const students = Object.values(byStudent) as any[];
    const monthTotals = monthKeys.map((m) => students.reduce((a, s) => a + (s.cells[m] || 0), 0));
    const grand = monthTotals.reduce((a, b) => a + b, 0);
    return { students, monthKeys, monthTotals, grand };
  }, [active.data, curYear, valueKey, studentFilter]);

  const unit = view === 'finance' ? '(AED)' : '(h)';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Pivots</h1>

        <div className="flex flex-wrap items-center gap-3">
          {/* View toggle */}
          <div className="inline-flex rounded-xl p-1" style={{ background: 'var(--color-card-alt)' }}>
            <button
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition ${view === 'finance' ? 'text-white' : 'muted'}`}
              style={view === 'finance' ? { background: 'var(--color-primary)' } : {}}
              onClick={() => setView('finance')}
            >
              <Wallet size={15} /> Finance
            </button>
            <button
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition ${view === 'hours' ? 'text-white' : 'muted'}`}
              style={view === 'hours' ? { background: 'var(--color-primary)' } : {}}
              onClick={() => setView('hours')}
            >
              <Clock size={15} /> Hours
            </button>
          </div>

          {/* Student selector */}
          <div className="w-56">
            <Select value={studentFilter} onChange={setStudentFilter} options={studentOptions} placeholder="All students" />
          </div>

          {/* Year stepper */}
          <div className="inline-flex items-center gap-1 rounded-xl px-1 py-1" style={{ background: 'var(--color-card-alt)' }}>
            <button className="btn-ghost !p-1.5" onClick={() => setYear(curYear - 1)} title="Previous year"><ChevronLeft size={16} /></button>
            <span className="font-display font-bold w-14 text-center">{curYear}</span>
            <button className="btn-ghost !p-1.5" onClick={() => setYear(curYear + 1)} title="Next year"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>

      <Section title={view === 'finance' ? `Fees received (AED) — student × month · ${curYear}` : `Hours consumed — student × month · ${curYear}`}>
        {active.isLoading ? <Spinner /> : students.length === 0 ? (
          <p className="muted text-sm">No {view === 'finance' ? 'fee' : 'lecture'} data for {curYear}{studentFilter ? ' for this student' : ''}.</p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide muted sticky left-0 z-10" style={{ background: 'var(--color-card)' }}>Form</th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide muted sticky left-[56px] z-10" style={{ background: 'var(--color-card)' }}>Student</th>
                  {MONTHS.map((m) => <th key={m} className="px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide muted whitespace-nowrap">{m}</th>)}
                  <th className="px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--color-primary)' }}>Total {unit}</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s, i) => {
                  const total = monthKeys.reduce((a, m) => a + (s.cells[m] || 0), 0);
                  const stripe = i % 2 ? 'var(--color-card-alt)' : 'var(--color-card)';
                  return (
                    <tr key={s.form_no} style={{ background: i % 2 ? 'var(--color-card-alt)' : 'transparent' }}>
                      <td className="px-3 py-2 font-mono sticky left-0 z-10" style={{ background: stripe }}>{s.form_no}</td>
                      <td className="px-3 py-2 font-medium whitespace-nowrap sticky left-[56px] z-10" style={{ background: stripe }}>{s.student_name}</td>
                      {monthKeys.map((m) => (
                        <td key={m} className={`px-3 py-2 text-right tabular-nums ${s.cells[m] ? '' : 'muted'}`}>{s.cells[m] ? fmt(s.cells[m]) : '—'}</td>
                      ))}
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{fmt(total)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-3 py-2.5 font-bold sticky left-0 z-10" style={{ background: 'var(--color-card)' }}>Total</td>
                  <td className="px-3 py-2.5 sticky left-[56px] z-10" style={{ background: 'var(--color-card)' }} />
                  {monthTotals.map((t, idx) => (
                    <td key={idx} className="px-3 py-2.5 text-right font-bold tabular-nums">{t ? fmt(t) : '—'}</td>
                  ))}
                  <td className="px-3 py-2.5 text-right font-bold tabular-nums" style={{ color: 'var(--color-primary)' }}>{fmt(grand)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
