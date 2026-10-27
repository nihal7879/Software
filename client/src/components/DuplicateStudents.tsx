import { AlertTriangle } from 'lucide-react';

/**
 * "This student may already be on the system."
 *
 * Shown when adding a student whose name or email matches somebody already
 * here. It is deliberately a warning and not a rule: two children do share a
 * name, and one family does share one address between them. So the office is
 * shown exactly who matched — form number, status, when they joined — and then
 * decides. What it stops is the silent second record, which is only ever found
 * later, by somebody reconciling fees against a child who has two balances.
 */

export type DuplicateStudent = {
  id: number;
  form_no: string | number;
  full_name: string;
  status: string;
  student_type?: string;
  email?: string | null;
  year_grade?: string | null;
  parent_mobile?: string | null;
  student_mobile?: string | null;
  date_of_joining?: string | null;
  same_name?: number;
  same_email?: number;
};

export function DuplicateStudents({
  message,
  duplicates,
  busy = false,
  onAddAnyway,
  onCancel,
}: {
  message: string;
  duplicates: DuplicateStudent[];
  busy?: boolean;
  onAddAnyway: () => void;
  onCancel: () => void;
}) {
  if (!duplicates.length) return null;
  return (
    <div
      className="rounded-lg p-3 text-sm border"
      style={{ borderColor: 'rgba(245, 158, 11, 0.4)', background: 'rgba(251, 191, 36, 0.10)' }}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
        <p className="font-semibold">{message}</p>
      </div>

      <div className="mt-2 space-y-1.5">
        {duplicates.map((d) => (
          <div key={d.id} className="rounded-md px-2 py-1.5" style={{ background: 'var(--color-card)' }}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold">Form {d.form_no}</span>
              <span>{d.full_name}</span>
              <span className="muted text-xs">
                {[d.status, d.student_type, d.year_grade].filter(Boolean).join(' · ')}
              </span>
            </div>
            <div className="muted text-xs">
              {[
                d.email || null,
                d.parent_mobile || d.student_mobile || null,
                d.date_of_joining ? `joined ${String(d.date_of_joining).slice(0, 10)}` : null,
                // Which of the two actually matched, so it is not left to be
                // worked out by reading the row against the form.
                Number(d.same_name) && Number(d.same_email) ? 'same name and email'
                  : Number(d.same_name) ? 'same name'
                  : Number(d.same_email) ? 'same email'
                  : null,
              ].filter(Boolean).join(' · ')}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mt-2.5">
        <button type="button" className="btn-ghost !py-1 !px-2.5 text-xs" onClick={onCancel} disabled={busy}>
          Go back and check
        </button>
        <button
          type="button"
          className="btn-primary !py-1 !px-2.5 text-xs !bg-amber-600 hover:!bg-amber-700"
          onClick={onAddAnyway}
          disabled={busy}
        >
          {busy ? 'Adding…' : 'Add anyway — this is a different person'}
        </button>
      </div>
    </div>
  );
}
