import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

/**
 * Who paid this fee.
 *
 * The profile used to ask for one "parent", and Finance wrote that name down.
 * It now records the father, the mother and a guardian separately, any of whom
 * may be the one who actually sends the money — and in most families more than
 * one of them is named.
 *
 * So the rule is: if the profile names exactly one person there is nothing to
 * decide and it is filled in; if it names two or three, the admin says which.
 * Guessing is what was happening before — the first name on the form was taken
 * silently — and a fee recorded against the wrong parent is a complaint from
 * the family, not a tidy-up.
 *
 * The name is still free text underneath. An uncle, a company, an elder sibling
 * does sometimes pay, and the profile will never list them.
 */

export type PayerRole = 'Father' | 'Mother' | 'Guardian';
export type Payer = { role: PayerRole; name: string };

const txt = (v: any) => String(v ?? '').trim();

/** The people this student's profile names, in the order the form asks. */
export function payersOf(s: any): Payer[] {
  return (
    [
      { role: 'Father', name: txt(s?.father_name) },
      { role: 'Mother', name: txt(s?.mother_name) },
      { role: 'Guardian', name: txt(s?.guardian_name) },
    ] as Payer[]
  ).filter((p) => p.name);
}

/**
 * Read from the student's own record rather than the row in whatever list the
 * screen happens to be showing: Finance searches students 50 at a time, and the
 * one being paid for is often not among them.
 */
export function useStudentPayers(studentId: any) {
  const id = String(studentId || '');
  const q = useQuery({
    queryKey: ['student-payers', id],
    queryFn: () => api.get(`/students/${id}`).then((r) => r.data),
    enabled: !!id,
    staleTime: 60_000,
  });
  return { student: q.data, payers: payersOf(q.data), loading: q.isFetching };
}

export function PayerField({
  studentId,
  value,
  onPick,
  compact = false,
}: {
  studentId: any;
  /** The payer name as it stands — typed or chosen. */
  value: string;
  onPick: (name: string) => void;
  /** For the bank-statement row, where space is tight. */
  compact?: boolean;
}) {
  const { payers } = useStudentPayers(studentId);
  const chosen = txt(value).toLowerCase();
  const matched = payers.some((p) => p.name.toLowerCase() === chosen);

  // One name on file and nothing filled in yet: there is no choice to make.
  // Never overwrites what is already there — on an edit that would quietly
  // rewrite who the family was recorded as having paid.
  useEffect(() => {
    if (!studentId) return;
    if (payers.length === 1 && !txt(value)) onPick(payers[0].name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, payers.length, value]);

  if (!studentId) return null;
  // The profile names nobody. Said out loud rather than left blank, so it reads
  // as "there is nothing on file" and not as a control that failed to load.
  if (payers.length === 0) {
    return (
      <p className="muted text-xs mt-1">
        Nobody is named on this profile — type the name above.
      </p>
    );
  }

  return (
    <div className="mt-1">
      {/* No heading. The chips say "Father · name" and "Mother · name", which
          is the question and the answer in one line; a label above them only
          repeated it. */}
      <div className="flex flex-wrap gap-1.5">
        {payers.map((p) => {
          const on = p.name.toLowerCase() === chosen;
          return (
            <button
              key={p.role}
              type="button"
              aria-pressed={on}
              title={`Record this payment as paid by ${p.name}`}
              // Chosen reads as chosen without a block of solid colour: the
              // same quiet tint the rest of the app uses, not a highlight that
              // pulls the eye away from the amount.
              className={`text-xs rounded-md px-2 py-1 border transition ${
                on
                  ? 'border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 font-semibold'
                  : 'border-[var(--color-border)] muted hover:bg-black/5 dark:hover:bg-white/5'
              }`}
              onClick={() => onPick(p.name)}
            >
              <span className={on ? 'opacity-80' : 'muted'}>{p.role}</span> · {p.name}
            </button>
          );
        })}
      </div>
      {payers.length > 1 && !matched && (
        <p className="muted text-xs mt-1">
          Pick one, or type another name above.
        </p>
      )}
    </div>
  );
}
