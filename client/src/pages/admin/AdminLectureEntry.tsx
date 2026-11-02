import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { Spinner } from '../../components/ui';
import { LectureWorkspace } from '../../components/LectureWorkspace';

// The office's page for one teacher — the same screen the teacher has: their
// scans to confirm, their lectures, and a class logged on their behalf when
// they are busy. This replaced the separate Attendance menu item: the office
// reaches a teacher's scans from Teachers, where a count shows who has some waiting.
export default function AdminLectureEntry() {
  const { teacherId } = useParams();
  const teachers = useQuery({ queryKey: ['teachers'], queryFn: () => api.get('/teachers').then((r) => r.data.data as any[]) });
  const teacher = (teachers.data || []).find((t) => String(t.id) === String(teacherId));

  if (teachers.isLoading) return <Spinner />;
  if (!teacher) return <p className="muted p-6">That teacher no longer exists.</p>;

  return (
    <LectureWorkspace
      key={teacher.id}
      teacherId={teacher.id}
      teacherName={teacher.name}
      specialization={teacher.specialization}
      headingOnPhone
      heading={
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/admin/teachers" className="btn-ghost !py-1.5 !px-3 text-sm">← Teachers</Link>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">Lecture Entry</h1>
            <p className="muted text-sm">
              <b>{teacher.name}</b> — confirm their scanned check-ins, or add a lecture when they are busy.
            </p>
          </div>
        </div>
      }
    />
  );
}
