import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api, rs, hrs, num } from '../../api/client';
import { KpiCard, Section, StatusBadge, Table, HoursValue, Spinner } from '../../components/ui';

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
  const teachers = useQuery({ queryKey: ['teachers-of', id], queryFn: () => api.get(`/teachers/of-student/${id}`).then((r) => r.data.data), enabled: !!id });
  const tx = useQuery({ queryKey: ['tx', id], queryFn: () => api.get(`/fees/transactions/${id}`).then((r) => r.data.data), enabled: !!id });

  // Month-wise total hours used + fees received (rows, newest first).
  const monthly = useMemo(() => {
    const map: Record<string, { hours: number; fees: number }> = {};
    (lectures.data || []).forEach((x: any) => { if (x.month) (map[x.month] ||= { hours: 0, fees: 0 }).hours += Number(x.hours_consumed || 0); });
    (tx.data || []).forEach((f: any) => { if (f.month) (map[f.month] ||= { hours: 0, fees: 0 }).fees += Number(f.amount || 0); });
    return Object.keys(map).sort().reverse().map((m) => ({ month: m, ...map[m] }));
  }, [lectures.data, tx.data]);

  if (!id) return <p className="muted p-6">No student linked to this parent account.</p>;
  if (student.isLoading || ledger.isLoading) return <Spinner />;

  const s = student.data;
  const l = ledger.data;
  const attended = (lectures.data || []).filter((x: any) => x.attendance_status !== 'Absent').length;
  const totalLec = (lectures.data || []).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">{s.full_name}</h1>
        <StatusBadge status={s.status} />
        <span className="muted text-sm">({s.year_grade} · {s.exam_board})</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <KpiCard label="Total Hours" value={hrs(l.total_hours_credited)} accent="blue" />
        <KpiCard label="Total Hours Delivered" value={hrs(l.total_hours_consumed)} accent="indigo" />
        <KpiCard label="Balance Hours" value={<HoursValue value={l.hours_left} />} accent={Number(l.hours_left) <= 0 ? 'red' : 'emerald'} />
        <KpiCard label="Pending Fees" value={rs(l.pending_fees)} accent="red" />
        <KpiCard label="Attendance" value={`${attended}/${totalLec}`} accent="blue" />
        <KpiCard label="Teachers" value={(teachers.data || []).length} accent="emerald" />
      </div>

      <div className="flex flex-wrap gap-3">
        <Link to="/parent/tracker" className="btn-primary">📊 Open Tracker</Link>
        <Link to="/parent/lectures" className="btn-ghost">View Lectures</Link>
        <Link to="/parent/fees" className="btn-ghost">View Fees & Pay</Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Teacher Information">
          {teachers.isLoading ? <Spinner /> : (
            <Table head={['Teacher', 'Subject']}>
              {(teachers.data || []).map((t: any) => (
                <tr key={t.id}><td className="table-td">{t.teacher_name}</td><td className="table-td">{t.subject_name}</td></tr>
              ))}
            </Table>
          )}
        </Section>

        <Section title="Recent Lecture History">
          {lectures.isLoading ? <Spinner /> : (
            <Table head={['Date', 'Subject', 'Topic', 'Subtopic', { label: 'Hours', align: 'right' }]}>
              {(lectures.data || []).slice(0, 8).map((r: any) => (
                <tr key={r.id}>
                  <td className="table-td">{r.session_date}</td>
                  <td className="table-td">{r.subject_name || '—'}</td>
                  <td className="table-td">{r.topic || '—'}</td>
                  <td className="table-td">{r.subtopic || '—'}</td>
                  <td className="table-td text-right tabular-nums">{hrs(r.hours_consumed)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Section>
      </div>

      {/* Month-wise total hours used + fees received */}
      <Section title="Month-wise Hours & Fees" action={<Link to="/parent/tracker" className="btn-ghost !py-1 !px-2.5 text-xs">Full Tracker →</Link>}>
        {lectures.isLoading || tx.isLoading ? <Spinner /> : monthly.length === 0 ? (
          <p className="muted text-sm">No activity recorded yet.</p>
        ) : (
          <div className="max-h-[360px] overflow-y-auto">
            <Table head={['Month', { label: 'Hours Used', align: 'right' }, { label: 'Fees Received (AED)', align: 'right' }]}>
              {monthly.map((r) => (
                <tr key={r.month}>
                  <td className="table-td font-semibold whitespace-nowrap">{fmtMonth(r.month)}</td>
                  <td className="table-td text-right tabular-nums">{hrs(r.hours)}</td>
                  <td className="table-td text-right tabular-nums text-emerald-600">{num(r.fees)}</td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </Section>
    </div>
  );
}
