import { useQuery } from '@tanstack/react-query';
import { api, rs } from '../../api/client';
import { Section, StatusBadge, Table, HoursValue, Spinner } from '../../components/ui';

export default function HoursLedger() {
  const { data, isLoading } = useQuery({
    queryKey: ['ledger'],
    queryFn: () => api.get('/fees/ledger').then((r) => r.data.data),
  });
  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Student Hours Ledger</h1>
      <p className="muted text-sm">The 154-Summary view. Negative “Hours Left” = overconsumption → Payment Required.</p>
      <Section title="Per-student ledger">
        <Table head={['Form', 'Student', 'Status', 'Credited', 'Discount', 'Adjusted', 'Consumed', 'Hours Left', 'Rate', 'Pending', 'Extra Left', 'Fee Status', 'Last Lecture']}>
          {data.map((r: any) => (
            <tr key={r.student_id}>
              <td className="table-td font-mono">{r.form_no}</td>
              <td className="table-td font-medium">{r.student_name}</td>
              <td className="table-td"><StatusBadge status={r.status} /></td>
              <td className="table-td">{Number(r.total_hours_credited).toFixed(1)}</td>
              <td className="table-td">{Number(r.discount_hours).toFixed(1)}</td>
              <td className="table-td">{Number(r.adjusted_hours).toFixed(1)}</td>
              <td className="table-td">{Number(r.total_hours_consumed).toFixed(1)}</td>
              <td className="table-td"><HoursValue value={r.hours_left} /></td>
              <td className="table-td">{rs(r.rate_per_hour)}</td>
              <td className="table-td">{rs(r.pending_fees)}</td>
              <td className="table-td">{rs(r.extra_amount_left)}</td>
              <td className="table-td"><StatusBadge status={r.fee_status} /></td>
              <td className="table-td">{r.last_attended_lecture || '—'}</td>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  );
}
