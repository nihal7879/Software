import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Section, StatusBadge, Table, HoursValue, Spinner } from '../../components/ui';

// Faculty: VIEW ONLY — see the students the admin has assigned to me.
// Teacher→student assignment is managed by the admin (Students → Report).
export default function FacultyStudents() {
  const mine = useQuery({ queryKey: ['me-students'], queryFn: () => api.get('/teachers/me/students').then((r) => r.data.data) });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">My Students</h1>
        <p className="muted text-sm">Students assigned to you by the institute.</p>
      </div>

      <Section title={`${(mine.data || []).length} students`}>
        {mine.isLoading ? <Spinner /> : (
          <Table head={['Form', 'Student', 'Grade', 'Subjects', { label: 'Hours Left', align: 'right' }, 'Status', '']}>
            {(mine.data || []).length === 0 ? (
              <tr><td className="table-td muted" colSpan={7}>No students assigned to you yet. Your admin will assign students to you.</td></tr>
            ) : mine.data.map((s: any) => (
              <tr key={s.id}>
                <td className="table-td font-mono">{s.form_no}</td>
                <td className="table-td font-medium">{s.full_name}</td>
                <td className="table-td">{s.year_grade || '—'}</td>
                <td className="table-td">{s.subjects || '—'}</td>
                <td className="table-td text-right tabular-nums">{s.hours_left != null ? <HoursValue value={s.hours_left} /> : '—'}</td>
                <td className="table-td"><StatusBadge status={s.status} /></td>
                <td className="table-td"><Link to={`/faculty/student/${s.id}`} className="btn-ghost !py-1 !px-2.5 text-xs whitespace-nowrap">View →</Link></td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}
