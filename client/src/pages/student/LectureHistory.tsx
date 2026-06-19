import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { api, hrs } from '../../api/client';
import { Section, Table, Spinner } from '../../components/ui';

// Shared by student & parent — backend scopes to the logged-in user's student.
export default function LectureHistory() {
  const { user } = useAuth();
  const id = user?.studentId;
  const lectures = useQuery({
    queryKey: ['lectures', id],
    queryFn: () => api.get('/lectures', { params: { studentId: id } }).then((r) => r.data.data),
    enabled: !!id,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Lecture History</h1>
      <Section title="All classes">
        {lectures.isLoading ? <Spinner /> : (
          <Table head={['Date', 'Teacher', 'Subject', 'Topic', 'Duration', 'Venue', 'Link']}>
            {(lectures.data || []).map((r: any) => (
              <tr key={r.id}>
                <td className="table-td">{r.session_date}</td>
                <td className="table-td">{r.teacher_name || '—'}</td>
                <td className="table-td">{r.subject_name || '—'}</td>
                <td className="table-td">{r.topic_remark || '—'}</td>
                <td className="table-td">{hrs(r.hours_consumed)}</td>
                <td className="table-td">{r.venue || '—'}</td>
                <td className="table-td">{r.meeting_link ? <a className="text-blue-500 underline" href={r.meeting_link} target="_blank">Link</a> : '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}
