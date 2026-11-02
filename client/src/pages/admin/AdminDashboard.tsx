import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Clock, GraduationCap, UserPlus, Users, Wallet } from 'lucide-react';
import { api, num, hrs, fmtDate, dubaiNow } from '../../api/client';
import { useMyPendingCount } from '../../components/MyRequests';
import { useAuth } from '../../auth/AuthContext';
import { KpiCard, Section, Spinner } from '../../components/ui';
import { NotificationPrompt } from '../../components/NotificationPrompt';
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
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

  // The same counts the menu shows, under the same keys, so this is no extra fetch.
  const regsWaiting = useQuery({
    queryKey: ['registrations-count', 'total'],
    queryFn: () => api.get('/registrations/count').then((r) => Number(r.data.total) || 0),
  });
  const approvalsWaiting = useQuery({
    queryKey: ['approvals-count'],
    queryFn: () => api.get('/approvals/count').then((r) => Number(r.data.count) || 0),
    enabled: full,
  });
  const myWaiting = useMyPendingCount(!full).data?.counts?.Pending || 0;

  // Live clock for the phone header — ticks every half minute, Dubai time.
  const [now, setNow] = useState(() => dubaiNow());
  useEffect(() => {
    const id = setInterval(() => setNow(dubaiNow()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (overview.isLoading) return <Spinner />;
  const o = overview.data;
  const waiting = pending.data || [];
  const first = String(user?.displayName || '').split(/\s+/)[0];
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const timeLabel = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // The four places the office goes to most. Not the waiting ones — those are
  // the two tiles in the header card just above, and listing them again here
  // showed the same thing twice. Students and Teachers carry their own counts:
  // on a phone these tiles are the figures, with no separate cards for them.
  const shortcuts: { to: string; label: string; icon: any; sub?: string }[] = [
    { to: '/admin/students', label: 'Students', icon: Users, sub: `${o.students.total} · ${o.students.active} active` },
    { to: '/admin/hours', label: 'Student Hours', icon: Clock },
    { to: '/admin/finance', label: 'Finance', icon: Wallet },
    { to: '/admin/teachers', label: 'Teachers', icon: GraduationCap, sub: `${o.teachers.total} · ${o.teachers.active} active` },
  ];
  const boards: { label: string; value: number }[] = breakdown.data?.byBoard || [];

  return (
    <div className="space-y-6">
      {/* Wide screens: the plain heading, as it always was. */}
      <h1 className="hidden md:block text-2xl font-bold">Dashboard</h1>

      {/* Phones: the same header card the teacher's and student's dashboards
          open with — the day, a greeting, and what is waiting for them. */}
      <div className="md:hidden !mt-0 hero-ink rounded-3xl p-5 ring-1 ring-white/[0.06]">
        <p className="text-sm text-white/60">{dateLabel} · {timeLabel}</p>
        <h1 className="text-[1.6rem] font-bold leading-tight mt-1">
          {greeting}{first ? `, ${first}` : ''}
        </h1>
        <p className="text-xs text-white/55 mt-6 mb-2">Waiting for you</p>
        <dl className="grid grid-cols-2 gap-3">
          <Link to="/admin/registrations" className="rounded-2xl bg-white/[0.07] px-4 py-3 block">
            <dt className="text-xs text-white/55">Registrations</dt>
            <dd className="font-display text-xl font-bold tnum mt-0.5">{regsWaiting.isLoading ? '…' : regsWaiting.data || 0}</dd>
          </Link>
          <Link to={full ? '/admin/approvals' : '/admin/requests'} className="rounded-2xl bg-white/[0.07] px-4 py-3 block">
            <dt className="text-xs text-white/55">{full ? 'Approvals' : 'My requests'}</dt>
            <dd className="font-display text-xl font-bold tnum mt-0.5">{full ? (approvalsWaiting.data ?? '…') : myWaiting}</dd>
          </Link>
        </dl>
      </div>

      {/* Phones: big shortcuts to where the work is, each with its count. */}
      <div className="md:hidden grid grid-cols-2 gap-3">
        {shortcuts.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.to} to={s.to} className="tap card flex items-center gap-3 p-3.5 !rounded-2xl">
              <span className="grid place-items-center w-10 h-10 rounded-xl shrink-0"
                style={{ background: 'var(--color-accent-soft)', color: 'var(--color-primary)' }}>
                <Icon size={19} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold truncate">{s.label}</span>
                {s.sub && <span className="block text-xs muted tnum truncate mt-0.5">{s.sub}</span>}
              </span>
            </Link>
          );
        })}
      </div>

      <NotificationPrompt what="a student registers" />

      {/* Phones: the student and teacher counts are on their shortcut tiles
          above, and the waiting registrations in the header card — so no
          figure cards here, except the money, which is the super admin's. */}
      <div className="md:hidden space-y-3 empty:hidden">
        {/* The money, for the super admin — kept as tiles, two to a row. */}
        {full && (
          <div className="grid grid-cols-2 gap-3">
            <KpiCard label="Revenue" value={num(o.revenue.total_revenue)} sub={`${num(o.revenue.month_revenue)} this month`} accent="orange" />
            <KpiCard label="Pending Fees" value={num(o.pending.outstanding)} sub={`${o.pending.payment_required_count} need payment`} accent="red" />
            <div className="col-span-2">
              <KpiCard label="Hours Consumed" value={hrs(o.hours.consumed)} sub={`${hrs(o.hours.remaining)} remaining`} accent="indigo" />
            </div>
          </div>
        )}
      </div>

      {/* Wide screens: the tiles as they always were. */}
      <div className={`hidden md:grid grid-cols-2 gap-3 ${full ? 'md:grid-cols-3 lg:grid-cols-6' : 'md:grid-cols-4'}`}>
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
          link into the request itself, so approving takes one click from here.
          Wide screens only — on a phone the header card's Registrations tile
          already says it, and the two together read as the same thing twice. */}
      {!full && (
        <div className="hidden md:block">
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
        </div>
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
          {boards.length === 0 ? (
            <div className="muted text-sm p-6 text-center">No exam-board data yet.</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={boards} dataKey="value" nameKey="label" innerRadius={50} outerRadius={90} paddingAngle={2}>
                    {boards.map((_, i) => (
                      <Cell key={i} fill={PIE[i % PIE.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              {/* Our own key, not the chart's: with a dozen boards the chart's
                  legend ran into three ragged lines on a phone. Two even
                  columns, each with its count, read at a glance. */}
              <ul className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 mt-3 text-sm">
                {boards.map((b, i) => (
                  <li key={b.label} className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: PIE[i % PIE.length] }} />
                    <span className="truncate flex-1">{b.label}</span>
                    <span className="tabular-nums muted">{b.value}</span>
                  </li>
                ))}
              </ul>
            </>
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
