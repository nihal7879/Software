import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { api, rs, hrs } from '../../api/client';
import { KpiCard, Section, StatusBadge, Table, HoursValue, Spinner } from '../../components/ui';

// Shared by student & parent. Parent additionally sees a (disabled) Pay Now button.
export default function StudentFees() {
  const { user } = useAuth();
  const id = user?.studentId;
  const isParent = user?.role === 'parent';

  const ledger = useQuery({ queryKey: ['ledger', id], queryFn: () => api.get(`/fees/ledger/${id}`).then((r) => r.data), enabled: !!id });
  const tx = useQuery({ queryKey: ['tx', id], queryFn: () => api.get(`/fees/transactions/${id}`).then((r) => r.data.data), enabled: !!id });
  const pkg = useQuery({ queryKey: ['pkg', id], queryFn: () => api.get(`/fees/packages/${id}`).then((r) => r.data.data), enabled: !!id });

  if (ledger.isLoading) return <Spinner />;
  const l = ledger.data;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Fees</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Hours Remaining" value={<HoursValue value={l.hours_left} />} accent={Number(l.hours_left) < 0 ? 'red' : 'emerald'} />
        <KpiCard label="Pending Fees" value={rs(l.pending_fees)} accent="red" />
        <KpiCard label="Extra Credit" value={rs(l.extra_amount_left)} accent="purple" />
        <KpiCard label="Rate / Hour" value={rs(l.rate_per_hour)} accent="orange" />
      </div>

      <div className="flex items-center gap-3">
        <StatusBadge status={l.fee_status} />
        {isParent && (
          <button
            className="btn-primary opacity-60 cursor-not-allowed"
            title="Online payment coming soon (Razorpay/Stripe). Please pay via bank transfer for now."
            onClick={(e) => { e.preventDefault(); alert('Online payment integration coming soon. Please pay via bank transfer.'); }}
          >
            Pay Now (coming soon)
          </button>
        )}
      </div>

      <Section title="Package Details">
        {pkg.isLoading ? <Spinner /> : (
          <Table head={['Course', 'Pkg Hours', 'Discount', 'Adjusted', 'Rate', 'Active']}>
            {(pkg.data || []).map((p: any) => (
              <tr key={p.id}>
                <td className="table-td">{p.course_name || '—'}</td>
                <td className="table-td">{hrs(p.package_hours)}</td>
                <td className="table-td">{hrs(p.discount_hours)}</td>
                <td className="table-td">{hrs(p.adjusted_hours)}</td>
                <td className="table-td">{rs(p.rate_per_hour)}</td>
                <td className="table-td">{p.is_active ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Payment History">
        {tx.isLoading ? <Spinner /> : (
          <Table head={['Date', 'Amount', 'Source', 'Reference', 'Notes']}>
            {(tx.data || []).map((t: any) => (
              <tr key={t.id}>
                <td className="table-td">{t.payment_date}</td>
                <td className="table-td font-semibold text-emerald-600">{rs(t.amount)}</td>
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
