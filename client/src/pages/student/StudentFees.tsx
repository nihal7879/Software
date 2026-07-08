import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { api, hrs } from '../../api/client';
import { Section, Table, Spinner, KpiCard } from '../../components/ui';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMonth = (m?: string) => {
  if (!m) return '—';
  const [y, mm] = m.split('-');
  return `${MON[Number(mm) - 1] ?? mm}-${y.slice(2)}`;
};

// Shared by student & parent — hours-only view (credited / used / remaining).
// Deliberately shows NO payment or money information.
export default function StudentFees() {
  const { user } = useAuth();
  const id = user?.studentId;

  const ledger = useQuery({ queryKey: ['ledger', id], queryFn: () => api.get(`/fees/ledger/${id}`).then((r) => r.data), enabled: !!id });
  const lectures = useQuery({ queryKey: ['lectures', id], queryFn: () => api.get('/lectures', { params: { studentId: id } }).then((r) => r.data.data), enabled: !!id });

  // Month-wise hours consumed, derived from the lecture list.
  const monthly = useMemo(() => {
    const map: Record<string, number> = {};
    (lectures.data || []).forEach((x: any) => {
      const m = x.month || x.session_date?.slice(0, 7);
      if (m) map[m] = (map[m] || 0) + Number(x.hours_consumed || 0);
    });
    return Object.keys(map).sort().reverse().map((m) => ({ month: m, label: fmtMonth(m), hours: map[m] }));
  }, [lectures.data]);

  if (!id) return <p className="muted p-6">No student linked to this account.</p>;
  if (ledger.isLoading) return <Spinner />;

  const L = ledger.data || {};
  const credited = Number(L.total_hours_credited) || 0;
  const consumed = Number(L.total_hours_consumed) || 0;
  const left = Number(L.hours_left) || 0;
  const pct = credited > 0 ? Math.max(0, Math.min(100, (consumed / credited) * 100)) : 0;
  const lowOnHours = left <= 5;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Hours Info</h1>

      {/* Headline hour figures */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Total hours credited" value={hrs(credited)} accent="blue" />
        <KpiCard label="Hours used" value={hrs(consumed)} accent="indigo" />
        <KpiCard label="Hours remaining" value={hrs(left)} accent={lowOnHours ? 'orange' : 'emerald'} />
        <KpiCard label="Last class" value={L.last_attended_lecture || '—'} accent="orange" />
      </div>

      {/* Usage bar */}
      <Section title="Hours Usage">
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="muted">{hrs(consumed)} used of {hrs(credited)} credited</span>
            <span className="font-semibold">{hrs(left)} hrs left</span>
          </div>
          <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--color-card-alt)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: lowOnHours ? 'var(--color-accent)' : 'var(--color-primary)' }} />
          </div>
          {lowOnHours && (
            <p className="text-sm font-medium" style={{ color: 'var(--color-accent)' }}>
              ⚠️ You are running low on hours. Please contact the institute to add more.
            </p>
          )}
        </div>
      </Section>

      {/* How the credited hours are made up */}
      <Section title="Credited Hours Breakdown">
        <Table head={['Type', { label: 'Hours', align: 'right' }]}>
          <tr><td className="table-td">Package hours</td><td className="table-td text-right tabular-nums">{hrs(L.hours_committed)}</td></tr>
          <tr><td className="table-td">Discount hours</td><td className="table-td text-right tabular-nums">{hrs(L.discount_hours)}</td></tr>
          <tr><td className="table-td">Adjusted hours</td><td className="table-td text-right tabular-nums">{hrs(L.adjusted_hours)}</td></tr>
          <tr className="font-semibold" style={{ background: 'var(--color-card-alt)' }}>
            <td className="table-td">Total credited</td><td className="table-td text-right tabular-nums">{hrs(credited)}</td>
          </tr>
        </Table>
      </Section>

      {/* Month-wise hours statement */}
      <Section title="Month-wise Hours Used">
        {lectures.isLoading ? <Spinner /> : monthly.length === 0 ? (
          <p className="muted text-sm">No hours used yet.</p>
        ) : (
          <Table head={['Month', { label: 'Hours Used', align: 'right' }]}>
            {monthly.map((r) => (
              <tr key={r.month}>
                <td className="table-td font-semibold whitespace-nowrap">{r.label}</td>
                <td className="table-td text-right tabular-nums">{hrs(r.hours)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}
