import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { api, rs, hrs, num } from '../../api/client';
import { KpiCard, Section, Table, HoursValue, Spinner } from '../../components/ui';

// Shared by student & parent. Parent additionally sees a (disabled) Pay Now button.
export default function StudentFees() {
  const { user } = useAuth();
  const id = user?.studentId;

  const ledger = useQuery({ queryKey: ['ledger', id], queryFn: () => api.get(`/fees/ledger/${id}`).then((r) => r.data), enabled: !!id });
  const tx = useQuery({ queryKey: ['tx', id], queryFn: () => api.get(`/fees/transactions/${id}`).then((r) => r.data.data), enabled: !!id });

  if (ledger.isLoading) return <Spinner />;
  const l = ledger.data;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Fees</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Total Hours" value={hrs(l.total_hours_credited)} accent="blue" />
        <KpiCard label="Total Hours Delivered" value={hrs(l.total_hours_consumed)} accent="indigo" />
        <KpiCard label="Balance Hours" value={<HoursValue value={l.hours_left} />} accent={Number(l.hours_left) <= 0 ? 'red' : 'emerald'} />
        <KpiCard label="Pending Fees" value={rs(l.pending_fees)} accent="red" />
      </div>


      <Section title="Payment History">
        {tx.isLoading ? <Spinner /> : (
          <Table head={['Date', { label: 'Amount (AED)', align: 'right' }, 'Source', 'Reference', 'Notes']}>
            {(tx.data || []).map((t: any) => (
              <tr key={t.id}>
                <td className="table-td">{t.payment_date}</td>
                <td className="table-td text-right tabular-nums font-semibold text-emerald-600">{num(t.amount)}</td>
                <td className="table-td">{t.payment_source || '—'}</td>
                <td className="table-td font-mono text-xs">{t.transaction_reference || '—'}</td>
                <td className="table-td max-w-[260px] truncate" title={t.notes}>{t.notes || '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}
