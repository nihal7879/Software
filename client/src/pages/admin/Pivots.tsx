import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Section, Spinner } from '../../components/ui';

function PivotTable({ rows, months, valueKey, fmt }: { rows: any[]; months: string[]; valueKey: string; fmt: (n: number) => string }) {
  // group rows by student
  const byStudent: Record<string, any> = {};
  for (const r of rows) {
    const k = r.form_no;
    byStudent[k] = byStudent[k] || { form_no: r.form_no, student_name: r.student_name, cells: {} };
    byStudent[k].cells[r.month] = Number(r[valueKey]);
  }
  const students = Object.values(byStudent);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="table-th sticky left-0" style={{ background: 'var(--color-card)' }}>Form</th>
            <th className="table-th">Student</th>
            {months.map((m) => <th key={m} className="table-th text-right">{m}</th>)}
            <th className="table-th text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s: any) => {
            const total = months.reduce((acc, m) => acc + (s.cells[m] || 0), 0);
            return (
              <tr key={s.form_no}>
                <td className="table-td font-mono sticky left-0" style={{ background: 'var(--color-card)' }}>{s.form_no}</td>
                <td className="table-td font-medium whitespace-nowrap">{s.student_name}</td>
                {months.map((m) => (
                  <td key={m} className="table-td text-right">{s.cells[m] ? fmt(s.cells[m]) : '—'}</td>
                ))}
                <td className="table-td text-right font-semibold">{fmt(total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Pivots() {
  const finance = useQuery({ queryKey: ['finance-pivot'], queryFn: () => api.get('/analytics/finance-pivot').then((r) => r.data) });
  const hours = useQuery({ queryKey: ['hours-pivot'], queryFn: () => api.get('/analytics/hours-pivot').then((r) => r.data) });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Pivots</h1>

      <Section title="Finance Pivot — Revenue (₹) × Student × Month">
        {finance.isLoading ? <Spinner /> :
          <PivotTable rows={finance.data.rows} months={finance.data.months} valueKey="amount" fmt={(n) => n.toLocaleString()} />}
      </Section>

      <Section title="Hours Pivot — Hours Consumed × Student × Month">
        {hours.isLoading ? <Spinner /> :
          <PivotTable rows={hours.data.rows} months={hours.data.months} valueKey="hours" fmt={(n) => n.toFixed(1)} />}
      </Section>
    </div>
  );
}
