import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { useAuth } from '../../auth/AuthContext';
import { api, hrs, rs } from '../../api/client';
import { KpiCard, Section, StatusBadge, Table, HoursValue, Spinner } from '../../components/ui';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMonth = (m?: string) => {
  if (!m) return '—';
  const [y, mm] = m.split('-');
  return `${MON[Number(mm) - 1] ?? mm}-${y.slice(2)}`;
};

// Brand palette (matches ui.tsx ACCENTS)
const C = { brand: '#f97316', indigo: '#6366f1', emerald: '#10b981', amber: '#f59e0b', red: '#ef4444' };

export default function StudentDashboard() {
  const { user } = useAuth();
  const id = user?.studentId;
  const nav = useNavigate();
  const [showPopup, setShowPopup] = useState(false);

  const student = useQuery({ queryKey: ['student', id], queryFn: () => api.get(`/students/${id}`).then((r) => r.data), enabled: !!id });
  const ledger = useQuery({ queryKey: ['ledger', id], queryFn: () => api.get(`/fees/ledger/${id}`).then((r) => r.data), enabled: !!id });
  const subjects = useQuery({ queryKey: ['teachers-of', id], queryFn: () => api.get(`/teachers/of-student/${id}`).then((r) => r.data.data), enabled: !!id });
  const lectures = useQuery({ queryKey: ['lectures', id], queryFn: () => api.get('/lectures', { params: { studentId: id } }).then((r) => r.data.data), enabled: !!id });

  // New user → show the "Complete your profile" popup once.
  useEffect(() => {
    if (student.data && !student.data.profile_completed) setShowPopup(true);
  }, [student.data]);

  // Attendance breakdown for the donut.
  const attendance = useMemo(() => {
    const counts = { Present: 0, Late: 0, Absent: 0 };
    (lectures.data || []).forEach((x: any) => {
      const st = x.attendance_status || 'Present';
      if (st === 'Absent') counts.Absent++;
      else if (st === 'Late') counts.Late++;
      else counts.Present++;
    });
    return [
      { name: 'Present', value: counts.Present, color: C.emerald },
      { name: 'Late', value: counts.Late, color: C.amber },
      { name: 'Absent', value: counts.Absent, color: C.red },
    ].filter((d) => d.value > 0);
  }, [lectures.data]);

  // Month-wise hours delivered (chronological) for the bar chart.
  const monthly = useMemo(() => {
    const map: Record<string, number> = {};
    (lectures.data || []).forEach((x: any) => { if (x.month) map[x.month] = (map[x.month] || 0) + Number(x.hours_consumed || 0); });
    return Object.keys(map).sort().map((m) => ({ month: m, label: fmtMonth(m), hours: map[m] }));
  }, [lectures.data]);

  // Hours delivered per subject for the subject bar chart.
  const bySubject = useMemo(() => {
    const map: Record<string, number> = {};
    (lectures.data || []).forEach((x: any) => {
      const sub = x.subject_name || 'Other';
      map[sub] = (map[sub] || 0) + Number(x.hours_consumed || 0);
    });
    return Object.entries(map).map(([subject, hours]) => ({ subject, hours })).sort((a, b) => b.hours - a.hours);
  }, [lectures.data]);

  if (!id) return <p className="muted p-6">No student linked to this account.</p>;
  if (student.isLoading || ledger.isLoading) return <Spinner />;

  const s = student.data;
  const l = ledger.data;
  const allLecs = lectures.data || [];
  const recent = allLecs.slice(0, 6);
  const attended = allLecs.filter((x: any) => x.attendance_status !== 'Absent').length;
  const totalLec = allLecs.length;
  const attendPct = totalLec ? Math.round((attended / totalLec) * 100) : 0;
  const goProfile = () => { setShowPopup(false); nav('/student/profile'); };

  // Hours utilisation donut (used vs remaining).
  const hoursPie = [
    { name: 'Used', value: Number(l.total_hours_consumed || 0), color: C.indigo },
    { name: 'Remaining', value: Math.max(0, Number(l.hours_left || 0)), color: C.emerald },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      {/* New-user popup → routes to the Profile completion page */}
      {showPopup && !s.profile_completed && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowPopup(false)}>
          <div className="card w-full max-w-md p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-4xl mb-2">👋</div>
            <h2 className="font-display text-xl font-extrabold mb-1">Complete your profile</h2>
            <p className="muted text-sm mb-5">Welcome! Please fill in your registration details so Management has your full record.</p>
            <div className="flex gap-2">
              <button className="btn-primary flex-1" onClick={goProfile}>Complete now →</button>
              <button className="btn-ghost" onClick={() => setShowPopup(false)}>Later</button>
            </div>
          </div>
        </div>
      )}

      {!s.profile_completed && (
        <div className="card p-4 flex flex-wrap items-center justify-between gap-3" style={{ borderColor: 'var(--color-accent)' }}>
          <span className="text-sm font-medium">⚠️ Your profile is incomplete. Please complete your registration.</span>
          <button className="btn-primary !py-2" onClick={goProfile}>Complete Profile</button>
        </div>
      )}

      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">{s.full_name}</h1>
        <StatusBadge status={s.status} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard label="Hours Purchased" value={hrs(l.total_hours_credited)} accent="blue" />
        <KpiCard label="Hours Consumed" value={hrs(l.total_hours_consumed)} accent="indigo" />
        <KpiCard label="Hours Remaining" value={<HoursValue value={l.hours_left} />} accent={Number(l.hours_left) <= 0 ? 'red' : 'emerald'} />
        <KpiCard label="Attendance" value={`${attendPct}%`} sub={`${attended}/${totalLec} present`} accent="emerald" />
        <KpiCard label="Pending Fees" value={rs(l.pending_fees)} accent="red" />
      </div>

      <div className="flex flex-wrap gap-3">
        <Link to="/student/tracker" className="btn-primary">📊 Open Tracker</Link>
        <Link to="/student/lectures" className="btn-ghost">Lecture History</Link>
      </div>

      {/* Charts — attendance, hours utilisation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Attendance">
          {lectures.isLoading ? <Spinner /> : attendance.length === 0 ? (
            <p className="muted text-sm">No attendance recorded yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={attendance} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2}>
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
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={hoursPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2}>
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
      <Section title="Monthly Hours">
        {lectures.isLoading ? <Spinner /> : monthly.length === 0 ? (
          <p className="muted text-sm">No lectures recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <div style={{ minWidth: monthly.length * 56, height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ top: 8, right: 24, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="label" interval={0} tick={{ fontSize: 11, fill: 'var(--color-text-muted, #888)' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted, #888)' }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)} h`, 'Hours']} cursor={{ fill: 'rgba(99,102,241,0.08)' }} />
                  <Bar dataKey="hours" fill={C.indigo} radius={[4, 4, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Personal Information">
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            {[
              ['Form No', s.form_no], ['Grade', s.year_grade], ['School', s.school_name],
              ['Board', s.exam_board], ['Email', s.email], ['Nationality', s.nationality],
              ['Student Mobile', s.student_mobile], ['Parent Mobile', s.parent_mobile],
              ['Father', s.father_name], ['Mother', s.mother_name],
            ].map(([k, v]) => (
              <div key={k as string}><dt className="muted text-xs">{k}</dt><dd>{v || '—'}</dd></div>
            ))}
          </dl>
        </Section>

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
      </div>

      <Section title="Recent Classes">
        {lectures.isLoading ? <Spinner /> : (
          <Table head={['Date', 'Subject', 'Topic', { label: 'Hours', align: 'right' }, 'Venue']}>
            {recent.map((r: any) => (
              <tr key={r.id}>
                <td className="table-td">{r.session_date}</td>
                <td className="table-td">{r.subject_name || '—'}</td>
                <td className="table-td">{r.topic || '—'}</td>
                <td className="table-td text-right tabular-nums">{hrs(r.hours_consumed)}</td>
                <td className="table-td">{r.venue || '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}
