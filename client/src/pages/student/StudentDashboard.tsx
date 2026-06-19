import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { api, aed, hrs } from '../../api/client';
import { KpiCard, Section, StatusBadge, Table, HoursValue, Spinner } from '../../components/ui';

export default function StudentDashboard() {
  const { user } = useAuth();
  const id = user?.studentId;

  const student = useQuery({ queryKey: ['student', id], queryFn: () => api.get(`/students/${id}`).then((r) => r.data), enabled: !!id });
  const ledger = useQuery({ queryKey: ['ledger', id], queryFn: () => api.get(`/fees/ledger/${id}`).then((r) => r.data), enabled: !!id });
  const teachers = useQuery({ queryKey: ['teachers-of', id], queryFn: () => api.get(`/teachers/of-student/${id}`).then((r) => r.data.data), enabled: !!id });
  const lectures = useQuery({ queryKey: ['lectures', id], queryFn: () => api.get('/lectures', { params: { studentId: id } }).then((r) => r.data.data), enabled: !!id });

  if (!id) return <p className="muted p-6">No student linked to this account.</p>;
  if (student.isLoading || ledger.isLoading) return <Spinner />;

  const s = student.data;
  const l = ledger.data;
  const recent = (lectures.data || []).slice(0, 6);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">{s.full_name}</h1>
        <StatusBadge status={s.status} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Hours Purchased" value={hrs(l.total_hours_credited)} accent="blue" />
        <KpiCard label="Hours Consumed" value={hrs(l.total_hours_consumed)} accent="indigo" />
        <KpiCard label="Hours Remaining" value={<HoursValue value={l.hours_left} />} accent={Number(l.hours_left) < 0 ? 'red' : 'emerald'} />
        <KpiCard label="Pending Fees" value={aed(l.pending_fees)} sub={l.fee_status} accent="red" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Personal Information">
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            {[
              ['Form No', s.form_no], ['Grade', s.year_grade], ['School', s.school_name],
              ['Board', s.exam_board], ['Email', s.email], ['Nationality', s.nationality],
              ['Student Mobile', s.student_mobile], ['Parent Mobile', s.parent_mobile],
              ['Father', s.father_name], ['Mother', s.mother_name],
            ].map(([k, v]) => (
              <div key={k as string}><dt className="muted text-xs">{k}</dt><dd>{v || '—'}</dd></div>
            ))}
          </dl>
        </Section>

        <Section title="Assigned Teachers & Subjects">
          {teachers.isLoading ? <Spinner /> : (
            <Table head={['Teacher', 'Subject']}>
              {(teachers.data || []).map((t: any) => (
                <tr key={t.id}><td className="table-td">{t.teacher_name}</td><td className="table-td">{t.subject_name}</td></tr>
              ))}
            </Table>
          )}
        </Section>
      </div>

      <Section title="Recent Classes">
        {lectures.isLoading ? <Spinner /> : (
          <Table head={['Date', 'Teacher', 'Subject', 'Topic', 'Hours', 'Venue']}>
            {recent.map((r: any) => (
              <tr key={r.id}>
                <td className="table-td">{r.session_date}</td>
                <td className="table-td">{r.teacher_name || '—'}</td>
                <td className="table-td">{r.subject_name || '—'}</td>
                <td className="table-td">{r.topic_remark || '—'}</td>
                <td className="table-td">{hrs(r.hours_consumed)}</td>
                <td className="table-td">{r.venue || '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}
