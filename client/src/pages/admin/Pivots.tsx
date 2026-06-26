import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Wallet, Clock } from 'lucide-react';
import { api } from '../../api/client';
import { Section, Spinner } from '../../components/ui';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

type View = 'finance' | 'hours';

export default function Pivots() {
  const [view, setView] = useState<View>('finance');
  const [year, setYear] = useState<number | null>(null); // null = server's latest
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const valueKey = view === 'finance' ? 'amount' : 'hours';
  const fmt = view === 'finance'
    ? (n: number) => n.toLocaleString('en-AE', { maximumFractionDigits: 0 })
    : (n: number) => n.toLocaleString('en-AE', { maximumFractionDigits: 1 });

  const q = useQuery({
    queryKey: ['pivot', view, year, search, page],
    queryFn: () => api.get(`/analytics/${view}-pivot`, { params: { year: year ?? undefined, search, page, limit: 20 } }).then((r) => r.data),
  });

  const data = q.data;
  const curYear = data?.year ?? year ?? new Date().getFullYear();
  const total = data?.total || 0;
  const pages = Math.ceil(total / 20) || 1;
  const unit = view === 'finance' ? '(AED)' : '(h)';

  // Build student rows × month cells for the current page.
  const { studentRows, monthKeys, monthTotals, grand } = useMemo(() => {
    const monthKeys = MONTHS.map((_, i) => `${curYear}-${pad(i + 1)}`);
    const byForm: Record<string, any> = {};
    for (const st of data?.students || []) {
      byForm[st.form_no] = { form_no: st.form_no, student_name: st.student_name, cells: {} as Record<string, number> };
    }
    for (const r of data?.rows || []) {
      if (byForm[r.form_no]) byForm[r.form_no].cells[r.month] = Number(r[valueKey]) || 0;
    }
    const studentRows = Object.values(byForm) as any[];
    const totalsMap: Record<string, number> = {};
    for (const m of data?.monthTotals || []) totalsMap[m.month] = Number(m[valueKey]) || 0;
    const monthTotals = monthKeys.map((m) => totalsMap[m] || 0);
    const grand = monthTotals.reduce((a, b) => a + b, 0);
    return { studentRows, monthKeys, monthTotals, grand };
  }, [data, curYear, valueKey]);

  const switchView = (v: View) => { setView(v); setPage(1); };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Pivots</h1>

        <div className="flex flex-wrap items-center gap-3">
          {/* View toggle */}
          <div className="inline-flex rounded-xl p-1" style={{ background: 'var(--color-card-alt)' }}>
            <button className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition ${view === 'finance' ? 'text-white' : 'muted'}`}
              style={view === 'finance' ? { background: 'var(--color-primary)' } : {}} onClick={() => switchView('finance')}>
              <Wallet size={15} /> Finance
            </button>
            <button className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition ${view === 'hours' ? 'text-white' : 'muted'}`}
              style={view === 'hours' ? { background: 'var(--color-primary)' } : {}} onClick={() => switchView('hours')}>
              <Clock size={15} /> Hours
            </button>
          </div>

          {/* Student search (server-side) */}
          <input className="input w-full sm:w-56" placeholder="Search student…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />

          {/* Year stepper */}
          <div className="inline-flex items-center gap-1 rounded-xl px-1 py-1" style={{ background: 'var(--color-card-alt)' }}>
            <button className="btn-ghost !p-1.5" onClick={() => { setYear(curYear - 1); setPage(1); }} title="Previous year"><ChevronLeft size={16} /></button>
            <span className="font-display font-bold w-14 text-center">{curYear}</span>
            <button className="btn-ghost !p-1.5" onClick={() => { setYear(curYear + 1); setPage(1); }} title="Next year"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>

      <Section title={view === 'finance' ? `Fees received (AED) — student × month · ${curYear}` : `Hours consumed — student × month · ${curYear}`}>
        {q.isLoading ? <Spinner /> : studentRows.length === 0 ? (
          <p className="muted text-sm">No {view === 'finance' ? 'fee' : 'lecture'} data for {curYear}{search ? ' matching your search' : ''}.</p>
        ) : (
          <>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide muted sm:sticky sm:left-0 sm:z-10" style={{ background: 'var(--color-card)' }}>Form</th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide muted sm:sticky sm:left-[56px] sm:z-10" style={{ background: 'var(--color-card)' }}>Student</th>
                  {MONTHS.map((m) => <th key={m} className="px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide muted whitespace-nowrap">{m}</th>)}
                  <th className="px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--color-primary)' }}>Total {unit}</th>
                </tr>
              </thead>
              <tbody>
                {studentRows.map((s, i) => {
                  const rowTotal = monthKeys.reduce((a, m) => a + (s.cells[m] || 0), 0);
                  const stripe = i % 2 ? 'var(--color-card-alt)' : 'var(--color-card)';
                  return (
                    <tr key={s.form_no} style={{ background: i % 2 ? 'var(--color-card-alt)' : 'transparent' }}>
                      <td className="px-3 py-2 font-mono sm:sticky sm:left-0 sm:z-10" style={{ background: stripe }}>{s.form_no}</td>
                      <td className="px-3 py-2 font-medium whitespace-nowrap sm:sticky sm:left-[56px] sm:z-10" style={{ background: stripe }}>{s.student_name}</td>
                      {monthKeys.map((m) => (
                        <td key={m} className={`px-3 py-2 text-right tabular-nums ${s.cells[m] ? '' : 'muted'}`}>{s.cells[m] ? fmt(s.cells[m]) : '—'}</td>
                      ))}
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{fmt(rowTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-3 py-2.5 font-bold sm:sticky sm:left-0 sm:z-10" style={{ background: 'var(--color-card)' }}>All students</td>
                  <td className="px-3 py-2.5 sm:sticky sm:left-[56px] sm:z-10" style={{ background: 'var(--color-card)' }} />
                  {monthTotals.map((t, idx) => (
                    <td key={idx} className="px-3 py-2.5 text-right font-bold tabular-nums">{t ? fmt(t) : '—'}</td>
                  ))}
                  <td className="px-3 py-2.5 text-right font-bold tabular-nums" style={{ color: 'var(--color-primary)' }}>{fmt(grand)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="flex items-center justify-between mt-3 text-sm">
            <span className="muted">Page {page} / {pages} · {total} students · totals row covers all of {curYear}</span>
            <div className="flex gap-2">
              <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
              <button className="btn-ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </div>
          </>
        )}
      </Section>
    </div>
  );
}
