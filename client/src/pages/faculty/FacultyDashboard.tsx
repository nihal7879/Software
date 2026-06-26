import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, hrs } from '../../api/client';
import { KpiCard, Section, StatusBadge, Table, HoursValue, Spinner } from '../../components/ui';

export default function FacultyDashboard() {
  const me = useQuery({ queryKey: ['teacher-me'], queryFn: () => api.get('/teachers/me').then((r) => r.data) });
  const students = useQuery({ queryKey: ['me-students'], queryFn: () => api.get('/teachers/me/students').then((r) => r.data.data) });
  const lectures = useQuery({ queryKey: ['me-lectures'], queryFn: () => api.get('/teachers/me/lectures').then((r) => r.data.data) });

  if (me.isLoading) return <Spinner />;
  const t = me.data;
  const recent = (lectures.data || []).slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t?.name || 'My'} Dashboard</h1>
          <p className="muted text-sm">Your students and classes only.</p>
        </div>
        <Link to="/faculty/lecture" className="btn-primary">+ Lecture Entry</Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="My Students" value={t?.assigned_students ?? 0} accent="blue" />
        <KpiCard label="Students Taught" value={t?.taught_students ?? 0} accent="emerald" />
        <KpiCard label="Total Hours Taught" value={hrs(t?.total_hours)} accent="indigo" />
        <KpiCard label="This Month" value={hrs(t?.month_hours)} accent="orange" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="My Students" action={<Link to="/faculty/students" className="btn-ghost !py-1.5 !px-3 text-sm">Manage</Link>}>
          {students.isLoading ? <Spinner /> : (
            <Table head={['Form', 'Student', 'Grade', 'Subjects', { label: 'Hours Left', align: 'right' }, 'Status']}>
              {(students.data || []).length === 0 ? (
                <tr><td className="table-td muted" colSpan={6}>No students assigned to you yet.</td></tr>
              ) : students.data.map((s: any) => (
                <tr key={s.id}>
                  <td className="table-td font-mono">{s.form_no}</td>
                  <td className="table-td font-medium">{s.full_name}</td>
                  <td className="table-td">{s.year_grade || '—'}</td>
                  <td className="table-td">{s.subjects || '—'}</td>
                  <td className="table-td text-right tabular-nums">{s.hours_left != null ? <HoursValue value={s.hours_left} /> : '—'}</td>
                  <td className="table-td"><StatusBadge status={s.status} /></td>
                </tr>
              ))}
            </Table>
          )}
        </Section>

        <Section title="My Recent Classes">
          {lectures.isLoading ? <Spinner /> : (
            <Table head={['Date', 'Subject', 'Students', 'Topic', { label: 'Hours', align: 'right' }]}>
              {recent.length === 0 ? (
                <tr><td className="table-td muted" colSpan={5}>No lectures recorded yet.</td></tr>
              ) : recent.map((l: any) => (
                <tr key={l.id}>
                  <td className="table-td whitespace-nowrap">{l.session_date}</td>
                  <td className="table-td">{l.subject_name || '—'}</td>
                  <td className="table-td max-w-[160px] truncate" title={l.students}>{l.students}</td>
                  <td className="table-td">{l.topic || '—'}</td>
                  <td className="table-td text-right tabular-nums">{hrs(l.total_hours)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Section>
      </div>
    </div>
  );
}
