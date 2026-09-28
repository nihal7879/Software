import { pool, query, queryOne } from '../db';
import { audit } from './audit';
import { deriveMonth } from './hours';

/**
 * Approvals — the office proposes, the super admin decides.
 *
 * An admin enters a change exactly as they always did. If it moves a family's
 * balance, nothing is written to the live tables: the whole change is parked
 * here and applied only when the super admin approves it.
 *
 * Holding the change here, rather than writing a "pending" row into
 * hours_adjustments or fee_transactions, is the point. The hours formula reads
 * packages, attendee rows and adjustments from a dozen places; a pending row
 * hidden in any of those would have to be excluded from every one of them, and
 * the first query that forgot would quietly credit hours nobody approved.
 *
 * The super admin is the approver, so their own changes apply at once.
 */

export type ApprovalKind = 'hours_add' | 'hours_deduct' | 'hours_edit' | 'hours_delete' | 'fee_entry';

/** What each kind is called on screen and in a message to the office. */
export const KIND_LABEL: Record<ApprovalKind, string> = {
  hours_add: 'hours added',
  hours_deduct: 'hours deducted',
  hours_edit: 'an hours entry changed',
  hours_delete: 'an hours entry removed',
  fee_entry: 'a fee entry with a discount',
};

export function needsApproval(role?: string) {
  return role !== 'superadmin';
}

/**
 * Park a change for the super admin. Nothing else is written.
 *
 * `note` is the case the office makes for the change, read by the super admin
 * and nobody else. It is deliberately separate from the reason that goes on the
 * student's statement: the family reads that one.
 */
export async function requestApproval(opts: {
  kind: ApprovalKind;
  studentId: number;
  payload: any;
  summary: string;
  note: string;
  targetType?: string | null;
  targetId?: number | null;
  userId: number;
}) {
  const r: any = await query(
    `INSERT INTO approvals (kind, student_id, payload, target_type, target_id, summary, request_note, requested_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [opts.kind, opts.studentId, JSON.stringify(opts.payload), opts.targetType ?? null,
     opts.targetId ?? null, opts.summary, opts.note, opts.userId]
  );
  await audit(opts.userId, 'REQUEST_APPROVAL', 'approval', r.insertId, null,
    { kind: opts.kind, student_id: opts.studentId, summary: opts.summary, note: opts.note });
  return r.insertId as number;
}

/**
 * The office must say why. Returned as an error when they have not, so the
 * super admin never receives a bare figure with no case behind it.
 */
export function noteProblem(note: unknown): string | null {
  const t = String(note ?? '').trim();
  if (t.length < 5) return 'Please write why you need this change. Only the super admin will see it.';
  if (t.length > 500) return 'Keep the reason under 500 characters.';
  return null;
}

// ---------------------------------------------------------------------------
// Carrying a change out.
//
// These are the only places any of these rows are written, whether the change
// came straight from a super admin or through the queue. One path, so an
// approved change and a direct one cannot drift apart.
// ---------------------------------------------------------------------------

export async function applyHoursAdd(conn: any, studentId: number, p: any, userId: number) {
  const r: any = await conn.query(
    'INSERT INTO hours_adjustments (student_id, delta, reason, adjusted_on, created_by) VALUES (?,?,?,?,?)',
    [studentId, p.delta, p.reason || null, p.adjusted_on || null, userId]
  );
  return { type: 'hours_adjustment', id: r[0].insertId as number };
}

export async function applyHoursEdit(conn: any, adjId: number, p: any) {
  await conn.query(
    'UPDATE hours_adjustments SET delta = ?, reason = ?, adjusted_on = ? WHERE id = ?',
    [p.delta, p.reason || null, p.adjusted_on || null, adjId]
  );
  return { type: 'hours_adjustment', id: adjId };
}

export async function applyHoursDelete(conn: any, adjId: number) {
  await conn.query('UPDATE hours_adjustments SET is_deleted = TRUE WHERE id = ?', [adjId]);
  return { type: 'hours_adjustment', id: adjId };
}

/**
 * A payment and, when hours were entered with it, the package they credit.
 * The package is linked to the transaction so removing the payment later can
 * remove the hours it bought.
 */
export async function applyFeeEntry(conn: any, p: any, userId: number) {
  const r: any = await conn.query(
    `INSERT INTO fee_transactions
      (student_id,parent_name,amount,payment_date,month,transaction_reference,transaction_narration,payment_source,course_package_hours,discount_hours,notes,created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      p.student_id, p.parent_name || null, p.amount, p.payment_date,
      deriveMonth(p.payment_date), p.transaction_reference || null, p.transaction_narration || null,
      p.payment_source || null, p.course_package_hours ?? null, p.discount_hours ?? null,
      p.notes || null, userId,
    ]
  );
  const txId = r[0].insertId as number;

  if ((p.course_package_hours && p.course_package_hours > 0) || (p.discount_hours && p.discount_hours > 0)) {
    const hrs = p.course_package_hours || 0;
    const rate = p.amount && hrs ? p.amount / hrs : 0;
    await conn.query(
      'INSERT INTO fee_packages (student_id,transaction_id,package_hours,discount_hours,rate_per_hour,start_date) VALUES (?,?,?,?,?,?)',
      [p.student_id, txId, hrs, p.discount_hours || 0, rate, p.payment_date]
    );
  }
  return { type: 'fee_transaction', id: txId };
}

/** Approve one request and carry it out, in a single transaction. */
export async function approve(id: number, userId: number) {
  const row = await queryOne<any>(
    "SELECT * FROM approvals WHERE id = ? AND is_deleted = FALSE AND status = 'Pending'", [id]);
  if (!row) return { ok: false as const, reason: 'That request is no longer waiting.' };

  const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let result: { type: string; id: number };
    switch (row.kind as ApprovalKind) {
      case 'hours_add':
      case 'hours_deduct':
        result = await applyHoursAdd(conn, row.student_id, p, row.requested_by);
        break;
      case 'hours_edit': {
        // The entry may have been removed while the request waited.
        const [live]: any = await conn.query(
          'SELECT id FROM hours_adjustments WHERE id = ? AND is_deleted = FALSE', [row.target_id]);
        if (!live.length) throw new Error('gone');
        result = await applyHoursEdit(conn, row.target_id, p);
        break;
      }
      case 'hours_delete': {
        const [live]: any = await conn.query(
          'SELECT id FROM hours_adjustments WHERE id = ? AND is_deleted = FALSE', [row.target_id]);
        if (!live.length) throw new Error('gone');
        result = await applyHoursDelete(conn, row.target_id);
        break;
      }
      case 'fee_entry':
        result = await applyFeeEntry(conn, p, row.requested_by);
        break;
      default:
        throw new Error(`Unknown approval kind ${row.kind}`);
    }

    await conn.query(
      `UPDATE approvals SET status = 'Approved', decided_by = ?, decided_at = NOW(),
                            result_type = ?, result_id = ? WHERE id = ?`,
      [userId, result.type, result.id, row.id]
    );
    await conn.commit();

    // Recorded against the thing that changed, in the name of the person who
    // approved it — and the request it came from, so the trail joins up.
    await audit(userId, 'APPROVE', result.type, result.id, null,
      { approval_id: row.id, kind: row.kind, requested_by: row.requested_by, payload: p });
    return { ok: true as const, result };
  } catch (e: any) {
    await conn.rollback();
    if (e?.message === 'gone') {
      return { ok: false as const, reason: 'The entry this was about has since been removed.' };
    }
    throw e;
  } finally {
    conn.release();
  }
}

/** Turn one down. Nothing changes; the reason is kept for the office to read. */
export async function reject(id: number, userId: number, note?: string | null) {
  const row = await queryOne<any>(
    "SELECT * FROM approvals WHERE id = ? AND is_deleted = FALSE AND status = 'Pending'", [id]);
  if (!row) return { ok: false as const, reason: 'That request is no longer waiting.' };

  await query(
    `UPDATE approvals SET status = 'Rejected', decided_by = ?, decided_at = NOW(), decision_note = ?
      WHERE id = ?`,
    [userId, note || null, row.id]
  );
  await audit(userId, 'REJECT', 'approval', row.id, row, { note: note || null });
  return { ok: true as const };
}
