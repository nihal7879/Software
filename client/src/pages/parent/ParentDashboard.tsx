import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
} from 'recharts';
import { useAuth } from '../../auth/AuthContext';
import { api, rs, hrs, num } from '../../api/client';
import { KpiCard, Section, StatusBadge, Table, HoursValue, Spinner } from '../../components/ui';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMonth = (m?: string) => {
  if (!m) return '—';
  const [y, mm] = m.split('-');
  return `${MON[Number(mm) - 1] ?? mm}-${y.slice(2)}`;
};

// Brand palette (matches ui.tsx ACCENTS)
const C = { brand: '#f97316', indigo: '#6366f1', emerald: '#10b981', amber: '#f59e0b', red: '#ef4444' };

export default function ParentDashboard() {
  const { user } = useAuth();
  const id = user?.studentId;

  const student = useQuery({ queryKey: ['student', id], queryFn: () => api.get(`/students/${id}`).then((r) => r.data), enabled: !!id });
  const ledger = useQuery({ queryKey: ['ledger', id], queryFn: () => api.get(`/fees/ledger/${id}`).then((r) => r.data), enabled: !!id });
  const lectures = useQuery({ queryKey: ['lectures', id], queryFn: () => api.get('/lectures', { params: { studentId: id } }).then((r) => r.data.data), enabled: !!id });
  const tx = useQuery({ queryKey: ['tx', id], queryFn: () => api.get(`/fees/transactions/${id}`).then((r) => r.data.data), enabled: !!id });
  const subjects = useQuery({ queryKey: ['teachers-of', id], queryFn: () => api.get(`/teachers/of-student/${id}`).then((r) => r.data.data), enabled: !!id });

  // Month-wise total hours used + fees received (chronological for charts, reversed for the table).
  const monthly = useMemo(() => {
    const map: Record<string, { hours: number; fees: number }> = {};
    (lectures.data || []).forEach((x: any) => { if (x.month) (map[x.month] ||= { hours: 0, fees: 0 }).hours += Number(x.hours_consumed || 0); });
    (tx.data || []).forEach((f: any) => { if (f.month) (map[f.month] ||= { hours: 0, fees: 0 }).fees += Number(f.amount || 0); });
    return Object.keys(map).sort().map((m) => ({ month: m, label: fmtMonth(m), ...map[m] }));
  }, [lectures.data, tx.data]);

  // Hours delivered per subject for the subject bar chart.
  const bySubject = useMemo(() => {
    const map: Record<string, number> = {};
    (lectures.data || []).forEach((x: any) => {
      const sub = x.subject_name || 'Other';
      map[sub] = (map[sub] || 0) + Number(x.hours_consumed || 0);
    });
    return Object.entries(map).map(([subject, hours]) => ({ subject, hours })).sort((a, b) => b.hours - a.hours);
  }, [lectures.data]);

  // Attendance breakdown for the donut.
  const attendance = useMemo(() => {
    const counts = { Present: 0, Late: 0, Absent: 0 };
    (lectures.data || []).forEach((x: any) => {
      const s = x.attendance_status || 'Present';
      if (s === 'Absent') counts.Absent++;
      else if (s === 'Late') counts.Late++;
      else counts.Present++;
    });
    return [
      { name: 'Present', value: counts.Present, color: C.emerald },
      { name: 'Late', value: counts.Late, color: C.amber },
      { name: 'Absent', value: counts.Absent, color: C.red },
    ].filter((d) => d.value > 0);
  }, [lectures.data]);

  if (!id) return <p className="muted p-6">No student linked to this parent account.</p>;
  if (student.isLoading || ledger.isLoading) return <Spinner />;

  const s = student.data;
  const l = ledger.data;
  const allLecs = lectures.data || [];
  const attended = allLecs.filter((x: any) => x.attendance_status !== 'Absent').length;
  const totalLec = allLecs.length;
  const attendPct = totalLec ? Math.round((attended / totalLec) * 100) : 0;
  const loadingCharts = lectures.isLoading || tx.isLoading;

  // Hours utilisation for the donut (used vs remaining).
  const usedHours = Number(l.total_hours_consumed || 0);
  const leftHours = Math.max(0, Number(l.hours_left || 0));
  const hoursPie = [
    { name: 'Used', value: usedHours, color: C.indigo },
    { name: 'Remaining', value: leftHours, color: C.emerald },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      {/* Student summary header */}
      <div className="card p-5 flex flex-wrap items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full text-xl font-bold text-white" style={{ background: C.brand }}>
          {String(s.full_name || '?').trim().charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{s.full_name}</h1>
            <StatusBadge status={s.status} />
          </div>
          <p className="muted text-sm mt-0.5">
            {s.year_grade} · {s.exam_board}{s.form_no ? ` · Form ${s.form_no}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link to="/parent/tracker" className="btn-primary">📊 Open Tracker</Link>
          <Link to="/parent/fees" className="btn-ghost">View Fees & Pay</Link>
        </div>
      </div>

      {/* KPI summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Total Hours" value={hrs(l.total_hours_credited)} accent="blue" />
        <KpiCard label="Hours Delivered" value={hrs(l.total_hours_consumed)} accent="indigo" />
        <KpiCard label="Balance Hours" value={<HoursValue value={l.hours_left} />} accent={Number(l.hours_left) <= 0 ? 'red' : 'emerald'} />
        <KpiCard label="Attendance" value={`${attendPct}%`} sub={`${attended}/${totalLec} present`} accent="emerald" />
        <KpiCard label="Pending Fees" value={rs(l.pending_fees)} accent="red" />
      </div>

      {/* Charts row 1 — attendance donut + hours utilisation donut */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Attendance Overview">
          {loadingCharts ? <Spinner /> : attendance.length === 0 ? (
            <p className="muted text-sm">No attendance recorded yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={attendance} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {attendance.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Pie>
                <Tooltip formatter={(v: any, n: any) => [`${v} lecture(s)`, n]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Section>

        <Section title="Hours Utilisation">
          {hoursPie.length === 0 ? (
            <p className="muted text-sm">No hours data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={hoursPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {hoursPie.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Pie>
                <Tooltip formatter={(v: any, n: any) => [`${Number(v).toFixed(2)} h`, n]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Section>
      </div>

      {/* Monthly hours — full width so every month is visible */}
      <Section title="Monthly Hours Delivered">
          {loadingCharts ? <Spinner /> : monthly.length === 0 ? (
            <p className="muted text-sm">No lectures recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <div style={{ minWidth: monthly.length * 56, height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthly} margin={{ top: 8, right: 24, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="label" interval={0} tick={{ fontSize: 12, fill: 'var(--color-text-muted, #888)' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: 'var(--color-text-muted, #888)' }} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)} h`, 'Hours']} cursor={{ fill: 'rgba(99,102,241,0.08)' }} />
                    <Bar dataKey="hours" fill={C.indigo} radius={[4, 4, 0, 0]} maxBarSize={48} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </Section>

      <Section title="Monthly Fees Received (AED)">
          {loadingCharts ? <Spinner /> : monthly.length === 0 ? (
            <p className="muted text-sm">No payments recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <div style={{ minWidth: monthly.length * 56, height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthly} margin={{ top: 8, right: 24, left: -16, bottom: 0 }}>
                    <defs>
                      <linearGradient id="feesGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.emerald} stopOpacity={0.4} />
                        <stop offset="95%" stopColor={C.emerald} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="label" interval={0} tick={{ fontSize: 12, fill: 'var(--color-text-muted, #888)' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: 'var(--color-text-muted, #888)' }} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(v: any) => [num(v), 'Fees (AED)']} cursor={{ stroke: C.emerald }} />
                    <Area type="monotone" dataKey="fees" stroke={C.emerald} strokeWidth={2} fill="url(#feesGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
      </Section>

      {/* Enrolled subjects + hours per subject */}
      <Section title="Enrolled Subjects & Hours">
        {!subjects.isLoading && (subjects.data || []).length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {(subjects.data || []).map((t: any) => (
              <span key={t.id} className="text-xs font-medium px-2.5 py-1 rounded-full bg-orange-500/15 text-orange-600 dark:text-orange-400">
                {t.subject_name}
              </span>
            ))}
          </div>
        )}
        {lectures.isLoading ? <Spinner /> : bySubject.length === 0 ? (
          <p className="muted text-sm">No subject activity recorded yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(180, bySubject.length * 44)}>
            <BarChart data={bySubject} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-text-muted, #888)' }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="subject" width={90} tick={{ fontSize: 12, fill: 'var(--color-text-muted, #888)' }} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)} h`, 'Hours']} cursor={{ fill: 'rgba(249,115,22,0.08)' }} />
              <Bar dataKey="hours" fill={C.brand} radius={[0, 4, 4, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Section>

      {/* Recent lecture history */}
      <Section title="Recent Lecture History" action={<Link to="/parent/lectures" className="btn-ghost !py-1 !px-2.5 text-xs">All Lectures →</Link>}>
        {lectures.isLoading ? <Spinner /> : (
          <Table head={['Date', 'Subject', 'Topic', 'Subtopic', { label: 'Hours', align: 'right' }]}>
            {allLecs.slice(0, 8).map((r: any) => (
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

      {/* Month-wise total hours used + fees received */}
      <Section title="Month-wise Hours & Fees" action={<Link to="/parent/tracker" className="btn-ghost !py-1 !px-2.5 text-xs">Full Tracker →</Link>}>
        {loadingCharts ? <Spinner /> : monthly.length === 0 ? (
          <p className="muted text-sm">No activity recorded yet.</p>
        ) : (
          <div className="max-h-[360px] overflow-y-auto">
            <Table head={['Month', { label: 'Hours Used', align: 'right' }, { label: 'Fees Received (AED)', align: 'right' }]}>
              {[...monthly].reverse().map((r) => (
                <tr key={r.month}>
                  <td className="table-td font-semibold whitespace-nowrap">{r.label}</td>
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
