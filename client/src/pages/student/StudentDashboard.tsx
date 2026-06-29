import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api, hrs, num } from '../../api/client';
import { Section, StatusBadge, Table, Spinner } from '../../components/ui';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMonth = (m?: string) => {
  if (!m) return '—';
  const [y, mm] = m.split('-');
  return `${MON[Number(mm) - 1] ?? mm}-${y.slice(2)}`;
};

export default function StudentDashboard() {
  const { user } = useAuth();
  const id = user?.studentId;
  const nav = useNavigate();
  const [showPopup, setShowPopup] = useState(false);

  const student = useQuery({ queryKey: ['student', id], queryFn: () => api.get(`/students/${id}`).then((r) => r.data), enabled: !!id });
  const ledger = useQuery({ queryKey: ['ledger', id], queryFn: () => api.get(`/fees/ledger/${id}`).then((r) => r.data), enabled: !!id });
  const lectures = useQuery({ queryKey: ['lectures', id], queryFn: () => api.get('/lectures', { params: { studentId: id } }).then((r) => r.data.data), enabled: !!id });
  const tx = useQuery({ queryKey: ['tx', id], queryFn: () => api.get(`/fees/transactions/${id}`).then((r) => r.data.data), enabled: !!id });

  // New user → show the "Complete your profile" popup once.
  useEffect(() => {
    if (student.data && !student.data.profile_completed) setShowPopup(true);
  }, [student.data]);

  // Month-wise total hours used + fees received.
  const monthly = useMemo(() => {
    const map: Record<string, { hours: number; fees: number }> = {};
    (lectures.data || []).forEach((x: any) => { if (x.month) (map[x.month] ||= { hours: 0, fees: 0 }).hours += Number(x.hours_consumed || 0); });
    (tx.data || []).forEach((f: any) => { if (f.month) (map[f.month] ||= { hours: 0, fees: 0 }).fees += Number(f.amount || 0); });
    return Object.keys(map).sort().map((m) => ({ month: m, label: fmtMonth(m), ...map[m] }));
  }, [lectures.data, tx.data]);

  if (!id) return <p className="muted p-6">No student linked to this account.</p>;
  if (student.isLoading || ledger.isLoading) return <Spinner />;

  const s = student.data;
  const allLecs = lectures.data || [];
  const recent = allLecs.slice(0, 8);
  const goProfile = () => { setShowPopup(false); nav('/student/profile'); };
  const loadingCharts = lectures.isLoading || tx.isLoading;

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
      <Link to="/student/lectures" className="block hover:opacity-90 transition-opacity">
        <Section title="Recent Lecture History" action={<span className="btn-ghost !py-1 !px-2.5 text-xs">View all →</span>}>
          {lectures.isLoading ? <Spinner /> : recent.length === 0 ? (
            <p className="muted text-sm">No lectures recorded yet.</p>
          ) : (
            <Table head={['Date', 'Subject', 'Topic', { label: 'Hours', align: 'right' }, 'Venue']}>
              {recent.slice(0, 3).map((r: any) => (
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
      </Link>

      {/* Month-wise hours used + fees received — preview, click to open tracker */}
      <Link to="/student/fees" className="block hover:opacity-90 transition-opacity">
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
