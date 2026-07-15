import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

// Dropdown of months present in the data (fees + lectures). "" = All months.
export function MonthSelector({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const { data } = useQuery({ queryKey: ['months'], queryFn: () => api.get('/management/months').then((r) => r.data.data) });
  return (
    <select className="input max-w-[170px]" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All months</option>
      {(data || []).map((m: string) => (
        <option key={m} value={m}>{m}</option>
      ))}
    </select>
  );
}

export const roleLabel = (role: string) =>
  role === 'admin' ? 'Admin' : role.charAt(0).toUpperCase() + role.slice(1);
