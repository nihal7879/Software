import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { api, num, hrs, fmtDate } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { KpiCard, Section, Spinner } from '../../components/ui';
import { getLastSeenRegistration } from '../../lib/registrationsSeen';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

const PIE = ['#2563EB', '#8B5CF6', '#10B981', '#F97316', '#EF4444', '#6366F1'];

/**
 * The dashboard, in two versions of itself.
 *
 * The admin's is about students: how many there are, which boards and grades
 * they sit, and who is waiting to be approved. The money — revenue, pending
 * fees, the revenue trend — and the teacher workload chart belong to the super
 * admin, whose dashboard is the full one. The figures are not merely hidden:
 * the server leaves the money out of its answer to an admin altogether.
 */
export default function AdminDashboard() {
  const { user } = useAuth();
  const full = user?.role === 'superadmin';

  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.get('/analytics/overview').then((r) => r.data) });
  const breakdown = useQuery({ queryKey: ['breakdown'], queryFn: () => api.get('/analytics/students-breakdown').then((r) => r.data) });
  const trend = useQuery({
    queryKey: ['trend'],
    queryFn: () => api.get('/analytics/revenue-trend').then((r) => r.data.data),
    enabled: full,
  });
  const workload = useQuery({
    queryKey: ['workload'],
    queryFn: () => api.get('/analytics/teacher-workload').then((r) => r.data.data),
    enabled: full,
  });
  // Students who have registered themselves and are waiting to be let in.
  const pending = useQuery({
    queryKey: ['registrations', 'Pending'],
    queryFn: () => api.get('/registrations', { params: { status: 'Pending' } }).then((r) => r.data.data as any[]),
    enabled: !full,
  });

  if (overview.isLoading) return <Spinner />;
  const o = overview.data;
  const waiting = pending.data || [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <div className={`grid grid-cols-2 gap-3 ${full ? 'md:grid-cols-3 lg:grid-cols-6' : 'md:grid-cols-4'}`}>
        <KpiCard label="Students" value={o.students.total} sub={`${o.students.active} active`} accent="blue" />
        <KpiCard label="Inactive" value={o.students.inactive} sub={`${o.students.new_admissions} new (30d)`} accent="purple" />
        <KpiCard label="Faculty" value={o.teachers.total} sub={`${o.teachers.active} active`} accent="emerald" />
        {full ? (
          <>
            <KpiCard label="Revenue" value={num(o.revenue.total_revenue)} sub={`${num(o.revenue.month_revenue)} this month`} accent="orange" />
            <KpiCard label="Pending Fees" value={num(o.pending.outstanding)} sub={`${o.pending.payment_required_count} need payment`} accent="red" />
            <KpiCard label="Hours Consumed" value={hrs(o.hours.consumed)} sub={`${hrs(o.hours.remaining)} remaining`} accent="indigo" />
          </>
        ) : (
          <KpiCard label="Registrations" value={waiting.length} sub="waiting to approve" accent="orange" />
        )}
      </div>

      {/* Waiting registrations, straight on the admin's dashboard: the name is a
          link into the request itself, so approving takes one click from here. */}
      {!full && (
        <Section
          title="New registrations"
          action={
            <Link to="/admin/registrations" className="btn-ghost !py-1.5 !px-3 text-sm whitespace-nowrap">
              Open all →
            </Link>
          }
        >
          {pending.isLoading ? (
            <Spinner />
          ) : waiting.length === 0 ? (
            <p className="muted text-sm">Nobody is waiting — new student registrations appear here.</p>
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {waiting.slice(0, 6).map((r) => (
                <li key={r.id}>
                  <Link
                    to="/admin/registrations"
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 px-1 rounded-lg hover:bg-[var(--color-card-alt)] transition"
                  >
                    <UserPlus size={15} className="muted shrink-0" />
                    <span className="font-medium">{r.first_name} {r.last_name}</span>
                    <span className="muted text-sm truncate">{r.email || r.username}</span>
                    {r.mobile && <span className="muted text-sm">{r.mobile}</span>}
                    <span className="muted text-xs ml-auto whitespace-nowrap">{fmtDate(String(r.created_at).slice(0, 10))}</span>
                  </Link>
                </li>
              ))}
              {waiting.length > 6 && (
                <li className="py-2 px-1 muted text-sm">and {waiting.length - 6} more…</li>
              )}
            </ul>
          )}
        </Section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {full && (
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
        )}

        <Section title="Students by Board">
          {(breakdown.data?.byBoard || []).length === 0 ? (
            <div className="muted text-sm p-6 text-center">No exam-board data yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={breakdown.data?.byBoard || []}
                  dataKey="value"
                  nameKey="label"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {(breakdown.data?.byBoard || []).map((_: any, i: number) => (
                    <Cell key={i} fill={PIE[i % PIE.length]} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
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

        {full && (
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
        )}
      </div>
    </div>
  );
}
