import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router-dom';
import { Lock, BookOpen, UserRound } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from './ui';

export type TeacherArea = 'teacher_dashboard' | 'teacher_students' | 'teacher_lecture';

/** Every lock the institute has thrown (Dashboard access, in the super admin). */
export function usePanelAccess(enabled = true) {
  return useQuery({
    queryKey: ['panel-access'],
    queryFn: () => api.get('/settings/panel-access').then((r) => r.data as Record<string, boolean>),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Wraps one teacher screen. While that screen is locked the teacher sees a
 * short explanation instead — they are still signed in, and whichever of the
 * three screens is open to them still works.
 *
 * The server refuses the same data on its side too, so this is the friendly
 * face of the lock, not the lock itself.
 */
export function TeacherGate({ area, children, lockedTo }: {
  area: TeacherArea;
  children: JSX.Element;
  /**
   * Where to send them instead of the explanation. The dashboard uses it:
   * while locked it is off the menu, so signing in lands on Lecture Entry —
   * the reason they opened the app — not on a page saying there is nothing here.
   */
  lockedTo?: string;
}) {
  const { user } = useAuth();
  // An admin opening a teacher's screen is doing the office's work; the locks
  // are for the teachers themselves.
  const isFaculty = user?.role === 'faculty';
  const access = usePanelAccess(isFaculty);
  if (!isFaculty) return children;
  if (access.isLoading) return <Spinner />;
  // If the check itself fails, err towards open: a teacher who cannot reach
  // the settings must still be able to enter today's class, and the server
  // refuses anything that is genuinely locked.
  if (!access.data?.[area]) return children;
  if (lockedTo) return <Navigate to={lockedTo} replace />;
  return <TeacherLockedScreen area={area} openElsewhere={!access.data?.teacher_lecture} />;
}

const SAYS: Record<TeacherArea, { title: string; body: string }> = {
  teacher_dashboard: {
    title: 'Your dashboard is locked for now',
    body: 'The office is correcting the hours behind it. Everything else in your app still works.',
  },
  teacher_students: {
    title: 'My Students is locked for now',
    body: 'The office is correcting the hours on it. You can still enter a class — picking students works as usual.',
  },
  teacher_lecture: {
    title: 'Lecture Entry is locked for now',
    body: 'Classes cannot be entered until the office opens it again. Please tell the front desk what you taught so nothing is lost.',
  },
};

function TeacherLockedScreen({ area, openElsewhere }: { area: TeacherArea; openElsewhere: boolean }) {
  const { user } = useAuth();
  const first = String(user?.displayName || '').split(/\s+/)[0];
  const s = SAYS[area];

  return (
    <div className="min-h-[70vh] grid place-items-center p-4">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-4 grid place-items-center w-16 h-16 rounded-full"
          style={{ background: 'var(--color-card-alt)', color: 'var(--color-primary)' }}>
          <Lock size={28} />
        </div>
        <h1 className="font-display text-2xl font-bold mb-2">
          {first ? `${first}, ${s.title.charAt(0).toLowerCase()}${s.title.slice(1)}` : s.title}
        </h1>
        <p className="muted text-sm mb-6">{s.body} Ask the office if you need it today.</p>

        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          {openElsewhere && area !== 'teacher_lecture' && (
            <Link to="/faculty/lecture" className="btn-primary inline-flex items-center justify-center gap-2">
              <BookOpen size={16} /> Lecture Entry
            </Link>
          )}
          <Link to="/faculty/settings" className="btn-ghost inline-flex items-center justify-center gap-2">
            <UserRound size={16} /> My profile
          </Link>
        </div>
      </div>
    </div>
  );
}
