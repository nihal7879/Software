import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { Spinner } from '../../components/ui';
import { LectureSheet } from '../../components/LectureSheet';

// An admin logging a class on a teacher's behalf — the same sheet the teacher
// uses, on a page of its own rather than in a dialog over the teacher list.
export default function AdminLectureEntry() {
  const { teacherId } = useParams();
  const teachers = useQuery({ queryKey: ['teachers'], queryFn: () => api.get('/teachers').then((r) => r.data.data as any[]) });
  const teacher = (teachers.data || []).find((t) => String(t.id) === String(teacherId));

  if (teachers.isLoading) return <Spinner />;
  if (!teacher) return <p className="muted p-6">That teacher no longer exists.</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/admin/teachers" className="btn-ghost !py-1.5 !px-3 text-sm">← Teachers</Link>
        <div>
          <h1 className="text-2xl font-bold">Lecture Entry</h1>
          <p className="muted text-sm">
            Recorded under <b>{teacher.name}</b> — use this when the teacher is busy.
          </p>
        </div>
      </div>
      <LectureSheet teacherId={teacher.id} teacherName={teacher.name} specialization={teacher.specialization} />
    </div>
  );
}
