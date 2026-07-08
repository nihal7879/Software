import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { api, hrs } from '../../api/client';
import { StatusBadge, Spinner } from '../../components/ui';
import LectureCalendar from '../../components/LectureCalendar';

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
  const left = Number(L.hours_left) || 0;

  return (
    <div className="space-y-6">
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
