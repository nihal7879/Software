// Per-student hours summary, computed with correlated subqueries scoped to the
// caller's WHERE (a single student, or one page of students). This replaces
// reading the `student_hours_summary` VIEW on hot paths — the view re-aggregates
// the ENTIRE lecture_attendees / fee_packages / hours_adjustments tables on every
// read, which doesn't scale. Here every subquery is an indexed lookup by
// student_id, so cost is O(rows returned), not O(all rows).
//
// All expressions assume the students table is aliased `s`.

const activePkg = (col: string) =>
  `COALESCE((SELECT SUM(${col}) FROM fee_packages WHERE student_id = s.id AND is_active = TRUE),0)`;

// total_hours_credited = package + discount + adjusted(package) + adjustments ledger
export const CREDITED_EXPR =
  `(${activePkg('package_hours')} + ${activePkg('discount_hours')} + ${activePkg('adjusted_hours')} ` +
  `+ COALESCE((SELECT SUM(delta) FROM hours_adjustments WHERE student_id = s.id),0))`;

export const CONSUMED_EXPR =
  `COALESCE((SELECT SUM(a.hours_consumed) FROM lecture_attendees a ` +
  `JOIN lecture_sessions l ON l.id = a.lecture_id WHERE a.student_id = s.id),0)`;

export const PENDING_EXPR =
  `COALESCE((SELECT pending_fees FROM ledger_adjustments WHERE student_id = s.id),0)`;

export const LAST_LECTURE_EXPR =
  `(SELECT MAX(l.session_date) FROM lecture_attendees a ` +
  `JOIN lecture_sessions l ON l.id = a.lecture_id WHERE a.student_id = s.id)`;

// Full column list matching the VIEW's output (minus hours_left / fee_status,
// which are derived in JS by deriveHours below). Prefix the SELECT with this.
export const HOURS_COLUMNS = `
  ${activePkg('package_hours')}  AS hours_committed,
  ${activePkg('discount_hours')} AS discount_hours,
  ${activePkg('adjusted_hours')} + COALESCE((SELECT SUM(delta) FROM hours_adjustments WHERE student_id = s.id),0) AS adjusted_hours,
  ${CREDITED_EXPR} AS total_hours_credited,
  ${CONSUMED_EXPR} AS total_hours_consumed,
  COALESCE((SELECT MAX(rate_per_hour) FROM fee_packages WHERE student_id = s.id AND is_active = TRUE),0) AS rate_per_hour,
  COALESCE((SELECT amount_credited   FROM ledger_adjustments WHERE student_id = s.id),0) AS amount_credited,
  ${PENDING_EXPR} AS pending_fees,
  COALESCE((SELECT extra_amount_left FROM ledger_adjustments WHERE student_id = s.id),0) AS extra_amount_left,
  ${LAST_LECTURE_EXPR} AS last_attended_lecture
`;

// Derive hours_left + fee_status from the raw aggregates — same rule as the view:
// Payment Required when pending fees > 0 OR hours_left <= 0.
export function deriveHours<T extends Record<string, any>>(row: T): T & { hours_left: number; fee_status: string } {
  const credited = Number(row.total_hours_credited) || 0;
  const consumed = Number(row.total_hours_consumed) || 0;
  const pending = Number(row.pending_fees) || 0;
  const hours_left = Math.round((credited - consumed) * 100) / 100;
  const fee_status = pending > 0 || hours_left <= 0 ? 'Payment Required' : 'Active';
  return { ...row, hours_left, fee_status };
}














