import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Section, StatusBadge, Spinner } from '../../components/ui';

// HOURS section — all students, hours consumed month-by-month, with totals.
export default function HoursMonthly() {
  const { data, isLoading } = useQuery({
    queryKey: ['hours-monthly'],
    queryFn: () => api.get('/management/hours-monthly').then((r) => r.data),
  });

  if (isLoading) return <Spinner />;
  const months: string[] = data.months;

  // group rows by student
  const byStudent: Record<string, any> = {};
  for (const r of data.rows) {
    byStudent[r.form_no] = byStudent[r.form_no] || { form_no: r.form_no, student_name: r.student_name, status: r.status, cells: {} };
    byStudent[r.form_no].cells[r.month] = Number(r.hours);
  }
  const students = Object.values(byStudent);
  const monthTotal = (m: string) => students.reduce((a: number, s: any) => a + (s.cells[m] || 0), 0);
  const grandTotal = students.reduce((a: number, s: any) => a + months.reduce((b, m) => b + (s.cells[m] || 0), 0), 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Hours — Monthly</h1>
        <p className="muted text-sm">Hours consumed by every student, month by month.</p>
      </div>

      <Section title="Hours consumed · student × month">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="table-th sticky left-0" style={{ background: 'var(--color-card)' }}>Form</th>
                <th className="table-th">Student</th>
                <th className="table-th">Status</th>
                {months.map((m) => <th key={m} className="table-th text-right whitespace-nowrap">{m}</th>)}
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
                    <td className="table-td"><StatusBadge status={s.status} /></td>
                    {months.map((m) => <td key={m} className="table-td text-right">{s.cells[m] ? s.cells[m].toFixed(1) : '—'}</td>)}
                    <td className="table-td text-right font-bold">{total.toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="table-td font-bold sticky left-0" style={{ background: 'var(--color-card)' }} colSpan={3}>Monthly total</td>
                {months.map((m) => <td key={m} className="table-td text-right font-bold">{monthTotal(m).toFixed(1)}</td>)}
                <td className="table-td text-right font-extrabold" style={{ color: 'var(--color-primary)' }}>{grandTotal.toFixed(1)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>
    </div>
  );
}
