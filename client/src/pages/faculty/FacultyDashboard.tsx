import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, hrs } from '../../api/client';
import { KpiCard, Section, Table, Spinner } from '../../components/ui';

export default function FacultyDashboard() {
  const workload = useQuery({ queryKey: ['workload'], queryFn: () => api.get('/analytics/teacher-workload').then((r) => r.data.data) });
  // Faculty sees the institute-wide ledger summary as a quick reference
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.get('/analytics/overview').then((r) => r.data) });

  if (overview.isLoading) return <Spinner />;
  const o = overview.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Faculty Dashboard</h1>
        <Link to="/faculty/lecture" className="btn-primary">+ Lecture Entry</Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Students" value={o.students.total} accent="blue" />
        <KpiCard label="Active" value={o.students.active} accent="emerald" />
        <KpiCard label="Hours Consumed" value={hrs(o.hours.consumed)} accent="indigo" />
        <KpiCard label="Hours Remaining" value={hrs(o.hours.remaining)} accent="orange" />
      </div>

      <Section title="Teacher Workload" action={<Link to="/faculty/students" className="btn-ghost text-sm">My Students</Link>}>
        {workload.isLoading ? <Spinner /> : (
          <Table head={['Teacher', 'Students', 'Hours Taught', 'This Month']}>
            {workload.data.map((t: any) => (
              <tr key={t.id}>
                <td className="table-td font-medium">{t.name}</td>
                <td className="table-td">{t.total_students}</td>
                <td className="table-td">{hrs(t.total_hours_taught)}</td>
                <td className="table-td">{hrs(t.month_hours)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}
