import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api/client';
import { Spinner } from '../../components/ui';
import { HoursHero } from '../../components/HoursHero';
import LectureCalendar from '../../components/LectureCalendar';
import { NotificationPrompt } from '../../components/NotificationPrompt';

// Mirrors the student dashboard — minimal header, hours summary, lecture calendar.
export default function ParentDashboard() {
  const { user } = useAuth();
  const id = user?.studentId;

  const student = useQuery({ queryKey: ['student', id], queryFn: () => api.get(`/students/${id}`).then((r) => r.data), enabled: !!id });
  const ledger = useQuery({ queryKey: ['ledger', id], queryFn: () => api.get(`/fees/ledger/${id}`).then((r) => r.data), enabled: !!id });
  const lectures = useQuery({ queryKey: ['lectures', id], queryFn: () => api.get('/lectures', { params: { studentId: id } }).then((r) => r.data.data), enabled: !!id });

  if (!id) return <p className="muted p-6">No student linked to this parent account.</p>;
  if (student.isLoading || ledger.isLoading) return <Spinner />;

  const s = student.data;
  const allLecs = lectures.data || [];
  const L = ledger.data || {};

  return (
    <div className="space-y-6">
      <HoursHero student={s} ledger={L} />

      <NotificationPrompt what="your child checks in or out of a class" />

      {/* Modern lecture calendar — browse all lecture & hour info by month/year */}
      {lectures.isLoading ? <Spinner /> : <LectureCalendar lectures={allLecs} />}
    </div>
  );
}
