import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Section, StatusBadge, Table, Spinner, type Sort } from '../../components/ui';
import { Select } from '../../components/Select';

// Faculty: VIEW ONLY — see the students the admin has assigned to me.
// Teacher→student assignment is managed by the admin (Students → Report).
//
// Filtering and sorting are done here rather than on the server: a teacher has
// tens of students, not thousands, and the list is already in hand.
export default function FacultyStudents() {
  const mine = useQuery({ queryKey: ['me-students'], queryFn: () => api.get('/teachers/me/students').then((r) => r.data.data) });

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');       // Active / Inactive
  const [type, setType] = useState('');           // Trial / Enrolled
  // Form number first: it is the number the office and the teachers say out loud.
  const [sort, setSort] = useState<Sort>({ key: 'form_no', dir: 'asc' });

  const all = mine.data || [];

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const out = all.filter((s: any) =>
      (!status || s.status === status) &&
      (!type || s.student_type === type) &&
      (!term ||
        String(s.full_name || '').toLowerCase().includes(term) ||
        String(s.form_no || '').toLowerCase().includes(term))
    );

    const val = (s: any) => {
      if (sort.key === 'form_no') {
        // A form number is a number when it can be, so 9 comes before 10 —
        // but a trial number (T3) is not, so those sort after, by their text.
        const n = Number(s.form_no);
        return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
      }
      return String(s[sort.key] ?? '').toLowerCase();
    };

    return [...out].sort((a, b) => {
      const x = val(a), y = val(b);
      // Trial numbers all share one sort value, so fall back to the text.
      const same = x === y;
      const cmp = same
        ? String(a.form_no ?? '').localeCompare(String(b.form_no ?? ''))
        : x < y ? -1 : 1;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [all, search, status, type, sort]);

  const onSort = (key: string) =>
    setSort((p) => ({ key, dir: p.key === key && p.dir === 'asc' ? 'desc' : 'asc' }));

  const counts = useMemo(() => ({
    active: all.filter((s: any) => s.status === 'Active').length,
    trial: all.filter((s: any) => s.student_type === 'Trial').length,
  }), [all]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">My Students</h1>
        <p className="muted text-sm">Students assigned to you by the institute.</p>
      </div>

      <Section
        title={
          rows.length === all.length
            ? `${all.length} students`
            : `${rows.length} of ${all.length} students`
        }
        action={
          <>
            <input
              className="input !py-1.5 w-44"
              placeholder="Name or form no…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="w-36">
              <Select
                compact
                value={status}
                onChange={setStatus}
                placeholder="All statuses"
                options={[{ value: 'Active', label: `Active (${counts.active})` },
                          { value: 'Inactive', label: `Inactive (${all.length - counts.active})` }]}
              />
            </div>
            <div className="w-36">
              <Select
                compact
                value={type}
                onChange={setType}
                placeholder="Trial & enrolled"
                options={[{ value: 'Enrolled', label: `Enrolled (${all.length - counts.trial})` },
                          { value: 'Trial', label: `Trial (${counts.trial})` }]}
              />
            </div>
            {(search || status || type) && (
              <button
                className="btn-ghost !py-1.5 !px-3 text-sm"
                onClick={() => { setSearch(''); setStatus(''); setType(''); }}
              >
                Clear
              </button>
            )}
          </>
        }
      >
        {mine.isLoading ? <Spinner /> : (
          <Table
            sort={sort}
            onSort={onSort}
            head={[
              { label: 'Form', sortKey: 'form_no' },
              { label: 'Student', sortKey: 'full_name' },
              { label: 'Grade', sortKey: 'year_grade' },
              'School',
              'Subjects',
              { label: 'Status', sortKey: 'status' },
              '',
            ]}
          >
            {rows.length === 0 ? (
              <tr>
                <td className="table-td muted" colSpan={7}>
                  {all.length === 0
                    ? 'No students assigned to you yet. Your admin will assign students to you.'
                    : 'No students match this filter.'}
                </td>
              </tr>
            ) : rows.map((s: any) => (
              <tr key={s.id}>
                <td className="table-td font-mono">{s.form_no}</td>
                <td className="table-td font-medium">{s.full_name}</td>
                <td className="table-td">{s.year_grade || '—'}</td>
                <td className="table-td">{s.school_name || '—'}</td>
                <td className="table-td">{s.subjects || '—'}</td>
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
