import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { LectureWorkspace } from '../../components/LectureWorkspace';

// A teacher's one place for lectures: their scans to confirm and their log.
// The screen itself is shared with the office's page for one teacher.
export default function LectureEntry() {
  const me = useQuery({ queryKey: ['teacher-me'], queryFn: () => api.get('/teachers/me').then((r) => r.data) });

  return (
    <LectureWorkspace
      heading={
        <>
          <h1 className="text-2xl font-bold">Lecture Entry</h1>
          <p className="muted text-sm">
            Logged as <b>{me.data?.name || 'teacher'}</b>. Confirm the scanned check-ins,
            or add a lecture by hand.
          </p>
        </>
      }
    />
  );
}
