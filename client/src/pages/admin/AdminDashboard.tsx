import { useQuery } from '@tanstack/react-query';
import { api, aed, hrs } from '../../api/client';
import { KpiCard, Section, Spinner } from '../../components/ui';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

const PIE = ['#2563EB', '#8B5CF6', '#10B981', '#F97316', '#EF4444', '#6366F1'];

export default function AdminDashboard() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.get('/analytics/overview').then((r) => r.data) });
  const breakdown = useQuery({ queryKey: ['breakdown'], queryFn: () => api.get('/analytics/students-breakdown').then((r) => r.data) });
  const trend = useQuery({ queryKey: ['trend'], queryFn: () => api.get('/analytics/revenue-trend').then((r) => r.data.data) });
  const workload = useQuery({ queryKey: ['workload'], queryFn: () => api.get('/analytics/teacher-workload').then((r) => r.data.data) });

  if (overview.isLoading) return <Spinner />;
  const o = overview.data;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Management Dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Students" value={o.students.total} sub={`${o.students.active} active · ${o.students.sp_active} SP`} accent="blue" />
        <KpiCard label="Inactive" value={o.students.inactive} sub={`${o.students.new_admissions} new (30d)`} accent="purple" />
        <KpiCard label="Faculty" value={o.teachers.total} sub={`${o.teachers.active} active`} accent="emerald" />
        <KpiCard label="Revenue" value={aed(o.revenue.total_revenue)} sub={`${aed(o.revenue.month_revenue)} this month`} accent="orange" />
        <KpiCard label="Pending Fees" value={aed(o.pending.outstanding)} sub={`${o.pending.payment_required_count} need payment`} accent="red" />
        <KpiCard label="Hours Consumed" value={hrs(o.hours.consumed)} sub={`${hrs(o.hours.remaining)} remaining`} accent="indigo" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Revenue Trend (AED / month)">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trend.data || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="label" stroke="var(--color-muted)" fontSize={12} />
              <YAxis stroke="var(--color-muted)" fontSize={12} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#F97316" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Section>

        <Section title="Students by Board">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={breakdown.data?.byBoard || []} dataKey="value" nameKey="label" outerRadius={90} label>
                {(breakdown.data?.byBoard || []).map((_: any, i: number) => (
                  <Cell key={i} fill={PIE[i % PIE.length]} />
                ))}
              </Pie>
              <Legend />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </Section>

        <Section title="Students by Grade">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={breakdown.data?.byGrade || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="label" stroke="var(--color-muted)" fontSize={12} />
              <YAxis stroke="var(--color-muted)" fontSize={12} />
              <Tooltip />
              <Bar dataKey="value" fill="#2563EB" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Section>

        <Section title="Teacher Workload (hours taught)">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={workload.data || []} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis type="number" stroke="var(--color-muted)" fontSize={12} />
              <YAxis type="category" dataKey="name" width={120} stroke="var(--color-muted)" fontSize={11} />
              <Tooltip />
              <Bar dataKey="total_hours_taught" fill="#10B981" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Section>
      </div>
    </div>
  );
}
