import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api, aed, hrs } from '../../api/client';
import { KpiCard, Section, StatusBadge, Table, HoursValue, Spinner } from '../../components/ui';

export default function ParentDashboard() {
  const { user } = useAuth();
  const id = user?.studentId;

  const student = useQuery({ queryKey: ['student', id], queryFn: () => api.get(`/students/${id}`).then((r) => r.data), enabled: !!id });
  const ledger = useQuery({ queryKey: ['ledger', id], queryFn: () => api.get(`/fees/ledger/${id}`).then((r) => r.data), enabled: !!id });
  const lectures = useQuery({ queryKey: ['lectures', id], queryFn: () => api.get('/lectures', { params: { studentId: id } }).then((r) => r.data.data), enabled: !!id });
  const teachers = useQuery({ queryKey: ['teachers-of', id], queryFn: () => api.get(`/teachers/of-student/${id}`).then((r) => r.data.data), enabled: !!id });

  if (!id) return <p className="muted p-6">No student linked to this parent account.</p>;
  if (student.isLoading || ledger.isLoading) return <Spinner />;

  const s = student.data;
  const l = ledger.data;
  const attended = (lectures.data || []).filter((x: any) => x.attendance_status !== 'Absent').length;
  const totalLec = (lectures.data || []).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">{s.full_name}</h1>
        <StatusBadge status={s.status} />
        <span className="muted text-sm">({s.year_grade} · {s.exam_board})</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Hours Remaining" value={<HoursValue value={l.hours_left} />} accent={Number(l.hours_left) < 0 ? 'red' : 'emerald'} />
        <KpiCard label="Consumed" value={hrs(l.total_hours_consumed)} accent="indigo" />
        <KpiCard label="Pending Fees" value={aed(l.pending_fees)} accent="red" />
        <KpiCard label="Attendance" value={`${attended}/${totalLec}`} accent="blue" />
        <KpiCard label="Teachers" value={(teachers.data || []).length} accent="emerald" />
      </div>

      <div className="flex gap-3">
        <Link to="/parent/lectures" className="btn-ghost">View Lectures</Link>
        <Link to="/parent/fees" className="btn-ghost">View Fees & Pay</Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Teacher Information">
          {teachers.isLoading ? <Spinner /> : (
            <Table head={['Teacher', 'Subject']}>
              {(teachers.data || []).map((t: any) => (
                <tr key={t.id}><td className="table-td">{t.teacher_name}</td><td className="table-td">{t.subject_name}</td></tr>
              ))}
            </Table>
          )}
        </Section>

        <Section title="Recent Lecture History">
          {lectures.isLoading ? <Spinner /> : (
            <Table head={['Date', 'Subject', 'Topic', 'Hours']}>
              {(lectures.data || []).slice(0, 8).map((r: any) => (
                <tr key={r.id}>
                  <td className="table-td">{r.session_date}</td>
                  <td className="table-td">{r.subject_name || '—'}</td>
                  <td className="table-td">{r.topic_remark || '—'}</td>
                  <td className="table-td">{hrs(r.hours_consumed)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Section>
      </div>
    </div>
  );
}
