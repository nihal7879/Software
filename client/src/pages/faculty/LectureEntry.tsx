import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { LectureSheet } from '../../components/LectureSheet';

// A teacher logging their own classes. The sheet itself is shared with the
// admin's version of this page.
export default function LectureEntry() {
  const me = useQuery({ queryKey: ['teacher-me'], queryFn: () => api.get('/teachers/me').then((r) => r.data) });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Lecture Entry</h1>
        <p className="muted text-sm hidden lg:block">
          Logged as <b>{me.data?.name || 'teacher'}</b> — fill the line and press Save. The class appears below it.
        </p>
        {/* There is no "line" on a phone — the form is stacked. */}
        <p className="muted text-sm lg:hidden">
          Logged as <b>{me.data?.name || 'teacher'}</b>. Saved classes appear under My lectures.
        </p>
      </div>
      <LectureSheet />
    </div>
  );
}
