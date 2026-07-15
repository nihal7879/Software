import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api, hrs } from '../../api/client';
import { StatusBadge, Spinner } from '../../components/ui';
import LectureCalendar from '../../components/LectureCalendar';

export default function StudentDashboard() {
  const { user } = useAuth();
  const id = user?.studentId;
  const nav = useNavigate();
  const [showPopup, setShowPopup] = useState(false);

  const student = useQuery({ queryKey: ['student', id], queryFn: () => api.get(`/students/${id}`).then((r) => r.data), enabled: !!id });
  const ledger = useQuery({ queryKey: ['ledger', id], queryFn: () => api.get(`/fees/ledger/${id}`).then((r) => r.data), enabled: !!id });
  const lectures = useQuery({ queryKey: ['lectures', id], queryFn: () => api.get('/lectures', { params: { studentId: id } }).then((r) => r.data.data), enabled: !!id });

  // New user → show the "Complete your profile" popup once.
  useEffect(() => {
    if (student.data && !student.data.profile_completed) setShowPopup(true);
  }, [student.data]);

  if (!id) return <p className="muted p-6">No student linked to this account.</p>;
  if (student.isLoading || ledger.isLoading) return <Spinner />;

  const s = student.data;
  const allLecs = lectures.data || [];
  const L = ledger.data || {};
  const left = Number(L.hours_left) || 0;
  const goProfile = () => { setShowPopup(false); nav('/student/profile'); };

  return (
    <div className="space-y-6">
      {/* New-user popup → routes to the Profile completion page */}
      {showPopup && !s.profile_completed && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowPopup(false)}>
          <div className="card w-full max-w-md p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-4xl mb-2">👋</div>
            <h2 className="font-display text-xl font-extrabold mb-1">Complete your profile</h2>
            <p className="muted text-sm mb-5">Welcome! Please fill in your registration details so the institute has your full record.</p>
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

      {/* Minimal hours summary */}
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-baseline gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: 'var(--color-card-alt)' }}>
          <span className="font-bold" style={{ color: left <= 5 ? 'var(--color-accent)' : 'var(--color-primary)' }}>{hrs(left)}</span>
          <span className="text-xs muted">hours remaining</span>
        </span>
        <span className="inline-flex items-baseline gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: 'var(--color-card-alt)' }}>
          <span className="font-bold">{hrs(L.total_hours_consumed)}</span>
          <span className="text-xs muted">used</span>
        </span>
        <span className="inline-flex items-baseline gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: 'var(--color-card-alt)' }}>
          <span className="font-bold">{hrs(L.total_hours_credited)}</span>
          <span className="text-xs muted">credited</span>
        </span>
      </div>

      {/* Modern lecture calendar — browse all lecture & hour info by month/year */}
      {lectures.isLoading ? <Spinner /> : <LectureCalendar lectures={allLecs} />}
    </div>
  );
}
