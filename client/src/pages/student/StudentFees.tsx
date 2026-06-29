import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { api, num } from '../../api/client';
import { Section, Table, Spinner } from '../../components/ui';

// Shared by student & parent — shows the payment history for the linked student.
export default function StudentFees() {
  const { user } = useAuth();
  const id = user?.studentId;

  const tx = useQuery({ queryKey: ['tx', id], queryFn: () => api.get(`/fees/transactions/${id}`).then((r) => r.data.data), enabled: !!id });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Fees Info</h1>

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
