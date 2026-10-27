import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Section, StatusBadge, Table, Spinner, type Sort } from '../../components/ui';
import { Select } from '../../components/Select';
import { ChevronRight } from 'lucide-react';

// Faculty: VIEW ONLY — see the students the admin has assigned to me.
// Teacher→student assignment is managed by the admin (Students → Report).
//
// Filtering and sorting are done here rather than on the server: a teacher has
// tens of students, not thousands, and the list is already in hand.
export default function FacultyStudents() {
  const mine = useQuery({ queryKey: ['me-students'], queryFn: () => api.get('/teachers/me/students').then((r) => r.data.data) });

  const [search, setSearch] = useState('');
  // Opens on the students the teacher actually teaches. A roster that includes
  // everyone who ever left is a list they have to filter before it is useful,
  // every time. Inactive is one click away in the same control.
  const [status, setStatus] = useState('Active'); // Active / Inactive
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
              className="input !py-1.5 w-full sm:w-44"
              placeholder="Name or form no…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex-1 min-w-[8rem] sm:flex-none sm:w-36">
              <Select
                compact
                value={status}
                onChange={setStatus}
                placeholder="All statuses"
                // Listed, not left to the placeholder: the page now opens on
                // Active, and this control cannot be emptied once it holds a
                // value — without this row there is no way back to everyone.
                options={[{ value: '', label: `All statuses (${all.length})` },
                          { value: 'Active', label: `Active (${counts.active})` },
                          { value: 'Inactive', label: `Inactive (${all.length - counts.active})` }]}
              />
            </div>
            <div className="flex-1 min-w-[8rem] sm:flex-none sm:w-36">
              <Select
                compact
                value={type}
                onChange={setType}
                placeholder="Trial & enrolled"
                options={[{ value: 'Enrolled', label: `Enrolled (${all.length - counts.trial})` },
                          { value: 'Trial', label: `Trial (${counts.trial})` }]}
              />
            </div>
            {(search || status !== 'Active' || type) && (
              <button
                className="btn-ghost !py-1.5 !px-3 text-sm"
                // Back to the view the page opens on, not to no filter at all.
                onClick={() => { setSearch(''); setStatus('Active'); setType(''); }}
              >
                Clear
              </button>
            )}
          </>
        }
      >
        {mine.isLoading ? <Spinner /> : (
          <>
          {/* Phones and tablets: the whole card opens the student. */}
          <div className="lg:hidden grid grid-cols-1 gap-2 sm:grid-cols-2">
            {rows.length === 0 && (
              <p className="muted text-sm py-4 text-center col-span-full">
                {all.length === 0
                  ? 'No students assigned to you yet. Your admin will assign students to you.'
                  : 'No students match this filter.'}
              </p>
            )}
            {rows.map((s: any) => (
              <Link key={s.id} to={`/faculty/student/${s.id}`}
                className="tap flex items-center gap-3 rounded-2xl p-3.5" style={{ background: 'var(--color-card-alt)' }}>
                <span className="grid place-items-center w-11 h-11 rounded-full text-sm font-bold shrink-0"
                  style={{ background: 'var(--color-accent-soft)', color: 'var(--color-primary)' }}>
                  {String(s.full_name || '?').split(/\s+/).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-semibold leading-snug break-words">{s.full_name}</span>
                    <StatusBadge status={s.status} />
                  </div>
                  <div className="text-xs muted truncate mt-0.5">
                    Form {s.form_no}{s.year_grade ? ` · ${s.year_grade}` : ''}{s.subjects ? ` · ${s.subjects}` : ''}
                  </div>
                </div>
                <ChevronRight size={18} className="muted shrink-0" />
              </Link>
            ))}
          </div>
          <div className="hidden lg:block">
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
          </div>
          </>
        )}
      </Section>
    </div>
  );
}
