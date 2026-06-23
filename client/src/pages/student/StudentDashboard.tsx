import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api, hrs } from '../../api/client';
import { KpiCard, Section, StatusBadge, Table, HoursValue, Spinner } from '../../components/ui';

export default function StudentDashboard() {
  const { user } = useAuth();
  const id = user?.studentId;
  const nav = useNavigate();
  const [showPopup, setShowPopup] = useState(false);

  const student = useQuery({ queryKey: ['student', id], queryFn: () => api.get(`/students/${id}`).then((r) => r.data), enabled: !!id });
  const ledger = useQuery({ queryKey: ['ledger', id], queryFn: () => api.get(`/fees/ledger/${id}`).then((r) => r.data), enabled: !!id });
  const teachers = useQuery({ queryKey: ['teachers-of', id], queryFn: () => api.get(`/teachers/of-student/${id}`).then((r) => r.data.data), enabled: !!id });
  const lectures = useQuery({ queryKey: ['lectures', id], queryFn: () => api.get('/lectures', { params: { studentId: id } }).then((r) => r.data.data), enabled: !!id });

  // New user → show the "Complete your profile" popup once.
  useEffect(() => {
    if (student.data && !student.data.profile_completed) setShowPopup(true);
  }, [student.data]);

  if (!id) return <p className="muted p-6">No student linked to this account.</p>;
  if (student.isLoading || ledger.isLoading) return <Spinner />;

  const s = student.data;
  const l = ledger.data;
  const recent = (lectures.data || []).slice(0, 6);
  const goProfile = () => { setShowPopup(false); nav('/student/profile'); };

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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard label="Hours Purchased" value={hrs(l.total_hours_credited)} accent="blue" />
        <KpiCard label="Hours Consumed" value={hrs(l.total_hours_consumed)} accent="indigo" />
        <KpiCard label="Hours Remaining" value={<HoursValue value={l.hours_left} />} accent={Number(l.hours_left) < 0 ? 'red' : 'emerald'} />
      </div>

      <div className="flex flex-wrap gap-3">
        <Link to="/student/tracker" className="btn-primary">📊 Open Tracker</Link>
        <Link to="/student/lectures" className="btn-ghost">Lecture History</Link>
      </div>

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

        <Section title="Assigned Teachers & Subjects">
          {teachers.isLoading ? <Spinner /> : (
            <Table head={['Teacher', 'Subject']}>
              {(teachers.data || []).map((t: any) => (
                <tr key={t.id}><td className="table-td">{t.teacher_name}</td><td className="table-td">{t.subject_name}</td></tr>
              ))}
            </Table>
          )}
        </Section>
      </div>

      <Section title="Recent Classes">
        {lectures.isLoading ? <Spinner /> : (
          <Table head={['Date', 'Teacher', 'Subject', 'Topic', 'Hours', 'Venue']}>
            {recent.map((r: any) => (
              <tr key={r.id}>
                <td className="table-td">{r.session_date}</td>
                <td className="table-td">{r.teacher_name || '—'}</td>
                <td className="table-td">{r.subject_name || '—'}</td>
                <td className="table-td">{r.topic || '—'}</td>
                <td className="table-td">{hrs(r.hours_consumed)}</td>
                <td className="table-td">{r.venue || '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}
