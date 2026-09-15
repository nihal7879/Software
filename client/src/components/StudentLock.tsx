import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Lock, UserRound, KeyRound } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from './ui';

/** Whether an admin has student dashboards locked (Settings → Student access). */
export function useStudentAccess(enabled = true) {
  return useQuery({
    queryKey: ['student-access'],
    queryFn: () => api.get('/settings/student-access').then((r) => !!r.data.locked),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Wraps a student data page. While student dashboards are locked, the student
 * sees a locked screen instead — they are signed in, and can still complete
 * their profile and change their password. The server refuses the same data on
 * its side too, so this is the friendly face of the lock, not the lock itself.
 */
export function StudentGate({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  const isStudent = user?.role === 'student';
  const access = useStudentAccess(isStudent);
  if (!isStudent) return children;
  if (access.isLoading) return <Spinner />;
  // If the check itself fails, err towards locked: that is the admin's setting today.
  if (access.data !== false) return <StudentLockedScreen />;
  return children;
}

function StudentLockedScreen() {
  const { user } = useAuth();
  const id = user?.studentId;
  // Profile stays open while locked, so it is safe to read here.
  const student = useQuery({
    queryKey: ['student', id],
    queryFn: () => api.get(`/students/${id}`).then((r) => r.data),
    enabled: !!id,
  });
  const s = student.data;
  const first = String(s?.first_name || s?.full_name || user?.displayName || '').split(/\s+/)[0];

  return (
    <div className="min-h-[70vh] grid place-items-center p-4">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-4 grid place-items-center w-16 h-16 rounded-full" style={{ background: 'var(--color-card-alt)', color: 'var(--color-primary)' }}>
          <Lock size={28} />
        </div>
        <h1 className="font-display text-2xl font-bold mb-2">
          {first ? `Hi ${first}, your dashboard is locked for now` : 'Your dashboard is locked for now'}
        </h1>
        <p className="muted text-sm mb-6">
          The institute will open your hours, fees and lectures here soon. Your account is ready — until then you can
          complete your profile and change your password.
        </p>

        {s && !s.profile_completed && (
          <div className="text-sm rounded-lg px-3 py-2 mb-4 bg-amber-500/15 text-amber-700 dark:text-amber-400">
            Your profile is not complete yet — please fill it in.
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <Link to="/student/profile" className="btn-primary inline-flex items-center justify-center gap-2">
            <UserRound size={16} /> {s && !s.profile_completed ? 'Complete profile' : 'My profile'}
          </Link>
          <Link to="/student/profile" state={{ tab: 'password' }} className="btn-ghost inline-flex items-center justify-center gap-2">
            <KeyRound size={16} /> Change password
          </Link>
        </div>
      </div>
    </div>
  );
}
