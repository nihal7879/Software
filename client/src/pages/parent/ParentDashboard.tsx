import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api, hrs, num } from '../../api/client';
import { Section, StatusBadge, Table, Spinner } from '../../components/ui';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMonth = (m?: string) => {
  if (!m) return '—';
  const [y, mm] = m.split('-');
  return `${MON[Number(mm) - 1] ?? mm}-${y.slice(2)}`;
};

export default function ParentDashboard() {
  const { user } = useAuth();
  const id = user?.studentId;

  const student = useQuery({ queryKey: ['student', id], queryFn: () => api.get(`/students/${id}`).then((r) => r.data), enabled: !!id });
  const ledger = useQuery({ queryKey: ['ledger', id], queryFn: () => api.get(`/fees/ledger/${id}`).then((r) => r.data), enabled: !!id });
  const lectures = useQuery({ queryKey: ['lectures', id], queryFn: () => api.get('/lectures', { params: { studentId: id } }).then((r) => r.data.data), enabled: !!id });
  const tx = useQuery({ queryKey: ['tx', id], queryFn: () => api.get(`/fees/transactions/${id}`).then((r) => r.data.data), enabled: !!id });

  // Month-wise total hours used + fees received.
  const monthly = useMemo(() => {
    const map: Record<string, { hours: number; fees: number }> = {};
    (lectures.data || []).forEach((x: any) => { if (x.month) (map[x.month] ||= { hours: 0, fees: 0 }).hours += Number(x.hours_consumed || 0); });
    (tx.data || []).forEach((f: any) => { if (f.month) (map[f.month] ||= { hours: 0, fees: 0 }).fees += Number(f.amount || 0); });
    return Object.keys(map).sort().map((m) => ({ month: m, label: fmtMonth(m), ...map[m] }));
  }, [lectures.data, tx.data]);

  if (!id) return <p className="muted p-6">No student linked to this parent account.</p>;
  if (student.isLoading || ledger.isLoading) return <Spinner />;

  const s = student.data;
  const allLecs = lectures.data || [];
  const loadingCharts = lectures.isLoading || tx.isLoading;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{s.full_name}</h1>
          <StatusBadge status={s.status} />
        </div>
        <p className="muted text-sm mt-0.5">
          {s.year_grade} · {s.exam_board}{s.form_no ? ` · Form ${s.form_no}` : ''}
        </p>
      </div>

      {/* Recent lecture history — preview, click to open full list */}
      <Link to="/parent/lectures" className="block hover:opacity-90 transition-opacity">
        <Section title="Recent Lecture History" action={<span className="btn-ghost !py-1 !px-2.5 text-xs">View all →</span>}>
          {lectures.isLoading ? <Spinner /> : allLecs.length === 0 ? (
            <p className="muted text-sm">No lectures recorded yet.</p>
          ) : (
            <Table head={['Date', 'Subject', 'Topic', { label: 'Hours', align: 'right' }]}>
              {allLecs.slice(0, 3).map((r: any) => (
                <tr key={r.id}>
                  <td className="table-td">{r.session_date}</td>
                  <td className="table-td">{r.subject_name || '—'}</td>
                  <td className="table-td">{r.topic || '—'}</td>
                  <td className="table-td text-right tabular-nums">{hrs(r.hours_consumed)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Section>
      </Link>

      {/* Month-wise hours used + fees received — preview, click to open tracker */}
      <Link to="/parent/fees" className="block hover:opacity-90 transition-opacity">
        <Section title="Month-wise Hours & Fees" action={<span className="btn-ghost !py-1 !px-2.5 text-xs">View all →</span>}>
          {loadingCharts ? <Spinner /> : monthly.length === 0 ? (
            <p className="muted text-sm">No activity recorded yet.</p>
          ) : (
            <Table head={['Month', { label: 'Hours Used', align: 'right' }, { label: 'Fees Received (AED)', align: 'right' }]}>
              {[...monthly].reverse().slice(0, 3).map((r) => (
                <tr key={r.month}>
                  <td className="table-td font-semibold whitespace-nowrap">{r.label}</td>
                  <td className="table-td text-right tabular-nums">{hrs(r.hours)}</td>
                  <td className="table-td text-right tabular-nums text-emerald-600">{num(r.fees)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Section>
      </Link>
    </div>
  );
}
