import { pool, query, queryOne } from '../db';
import { audit } from './audit';
import { notify, superAdminUserIds } from './push';
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

export type ApprovalKind =
  | 'hours_add' | 'hours_deduct' | 'hours_edit' | 'hours_delete'
  | 'fee_entry' | 'fee_edit' | 'fee_delete'
  | 'student_delete';

/** What each kind is called on screen and in a message to the office. */
export const KIND_LABEL: Record<ApprovalKind, string> = {
  hours_add: 'hours added',
  hours_deduct: 'hours deducted',
  hours_edit: 'an hours entry changed',
  hours_delete: 'an hours entry removed',
  fee_entry: 'a fee entry with a discount',
  fee_edit: 'a payment changed',
  fee_delete: 'a payment removed',
  student_delete: 'a student removed',
};

export function needsApproval(role?: string) {
  return role !== 'superadmin';
}

/** Who asked — their own name where we have one, their login otherwise. */
async function askerName(userId: number): Promise<string> {
  const r = await queryOne<any>(
    `SELECT COALESCE(NULLIF(u.display_name, ''), t.name, u.email) AS name
       FROM users u LEFT JOIN teachers t ON t.user_id = u.id
      WHERE u.id = ?`,
    [userId]
  );
  return r?.name || 'The office';
}

/**
 * Telling people a request is waiting.
 *
 * A request that nobody looks at is worse than no request at all: the office
 * believes the change is made, the family's statement says otherwise, and the
 * only sign is a number on a menu the super admin has to be looking at. So the
 * super admin is told, and the admin who asked gets the same notice in their
 * own bell — their one record that it was sent, since the queue itself is the
 * super admin's alone.
 *
 * Deliberately without the amount or the student's name: utils/push.ts explains
 * why (a notification is read off a lock screen). The figures are in the queue,
 * behind the sign-in.
 */
async function announceRequest(kind: ApprovalKind, userId: number) {
  const label = KIND_LABEL[kind];
  const who = await askerName(userId);

  await notify(await superAdminUserIds(), {
    kind: 'approval_request',
    title: 'Waiting for your approval',
    body: `${who} has sent a request: ${label}.`,
    url: '/admin/approvals',
  });

  await notify([userId], {
    kind: 'approval_request',
    title: 'Sent for approval',
    body: `You sent ${label}. It takes effect once the super admin approves it.`,
    url: '/admin/notifications',
  });
}

/**
 * Telling the office what was decided.
 *
 * The queue is the super admin's screen, so without this the office never
 * learns the answer — they would have to go and look at the statement to guess.
 * A rejection carries the super admin's own words, because that reason is the
 * whole message and there is nowhere else the office can read it.
 */
async function announceDecision(row: any, approved: boolean, note?: string | null) {
  const label = KIND_LABEL[row.kind as ApprovalKind] || 'your request';
  const why = String(note || '').trim();
  await notify([row.requested_by], {
    kind: 'approval_decided',
    title: approved ? 'Approved' : 'Not approved',
    body: approved
      ? `The super admin approved your request: ${label}.`
      : why
        ? `Your request was not approved: ${label} — ${why}`
        : `Your request was not approved: ${label}. Please ask the super admin why.`,
    url: '/admin/notifications',
    studentId: row.student_id ?? null,
  });
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
  await announceRequest(opts.kind, opts.userId);
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

/**
 * Change a payment, keeping the hours it credited in step.
 *
 * The same code runs whether a super admin made the change directly or it came
 * out of the queue — if these two ever drifted apart, an approved edit would
 * land differently from the one the office previewed.
 */
export async function applyFeeEdit(conn: any, txId: number | string, p: any) {
  const [[before]]: any = await conn.query(
    'SELECT * FROM fee_transactions WHERE id = ? AND is_deleted = FALSE', [txId]);
  if (!before) throw new Error('gone');

  // `before` is the snapshot the queue displays and `request_note` the case the
  // office made; neither is a column on fee_transactions.
  const { request_note, before: _snapshot, ...b } = p;
  const fields: string[] = [];
  const params: any[] = [];
  for (const [k, v] of Object.entries(b)) { fields.push(`${k} = ?`); params.push(v); }
  if (b.payment_date) { fields.push('month = ?'); params.push(deriveMonth(b.payment_date)); }
  if (fields.length) {
    params.push(txId);
    await conn.query(`UPDATE fee_transactions SET ${fields.join(', ')} WHERE id = ?`, params);
  }

  // Keep the linked hours package in sync so the student's statement reflects
  // the edit. Merged (new ?? old) values.
  const merged = { ...before, ...b };
  const hrs = merged.course_package_hours != null ? Number(merged.course_package_hours) : 0;
  const disc = merged.discount_hours != null ? Number(merged.discount_hours) : 0;
  const amount = Number(merged.amount) || 0;
  const date = merged.payment_date ? String(merged.payment_date).slice(0, 10) : null;
  // A transaction can have picked up more than one package row over the years;
  // the live one is the one to keep in sync, not a retired duplicate.
  const [[existingPkg]]: any = await conn.query(
    'SELECT id FROM fee_packages WHERE transaction_id = ? ORDER BY is_deleted ASC, is_active DESC, id DESC LIMIT 1',
    [txId]
  );
  if (hrs > 0 || disc > 0) {
    const rate = amount && hrs ? amount / hrs : 0;
    if (existingPkg) {
      // student_id moves with the transaction: re-assigning a payment from one
      // student to another has to carry the credited hours across, or the old
      // student keeps hours they never paid for and the new one shows none.
      await conn.query(
        `UPDATE fee_packages SET student_id = ?, package_hours = ?, discount_hours = ?, rate_per_hour = ?,
                start_date = ?, is_active = TRUE, is_deleted = FALSE WHERE id = ?`,
        [merged.student_id, hrs, disc, rate, date, existingPkg.id]
      );
    } else {
      await conn.query(
        `INSERT INTO fee_packages (student_id,transaction_id,package_hours,discount_hours,rate_per_hour,start_date)
         VALUES (?,?,?,?,?,?)`,
        [merged.student_id, txId, hrs, disc, rate, date]
      );
    }
  } else if (existingPkg) {
    // Hours cleared on the transaction → retire the credit.
    await conn.query('UPDATE fee_packages SET is_active = FALSE, is_deleted = TRUE WHERE id = ?', [existingPkg.id]);
  }
  return { type: 'fee_transaction', id: Number(txId) };
}

/**
 * Remove a payment — and the hours it bought with it.
 *
 * Both halves matter. A payment taken off the statement while its package stays
 * live leaves the student holding hours nobody paid for, which is the kind of
 * mistake that is only noticed months later on a balance that will not add up.
 */
export async function applyFeeDelete(conn: any, txId: number | string) {
  const [[live]]: any = await conn.query(
    'SELECT id FROM fee_transactions WHERE id = ? AND is_deleted = FALSE', [txId]);
  if (!live) throw new Error('gone');
  await conn.query('UPDATE fee_transactions SET is_deleted = TRUE WHERE id = ?', [txId]);
  await conn.query('UPDATE fee_packages SET is_active = FALSE, is_deleted = TRUE WHERE transaction_id = ?', [txId]);
  return { type: 'fee_transaction', id: Number(txId) };
}

/**
 * Remove a student record.
 *
 * Soft, like everything here: the row stays and can be put back. What it is
 * not is a cascade — their lectures, their payments and their attendance rows
 * are left exactly as they are. A removal says "this record should not be on
 * the list", not "none of this happened", and a delete that quietly took a
 * term of paid lectures with it would be unrecoverable in practice.
 *
 * All four switches go together. Marking the student removed while leaving
 * either `is_active` on reads as a live student to half the screens, and
 * leaving the login on means the account still opens — the same split that has
 * cost this project hours before: a record showing Active whose sign-in says
 * the credentials are invalid.
 */
export async function applyStudentDelete(conn: any, studentId: number | string) {
  const [[live]]: any = await conn.query(
    'SELECT id, user_id FROM students WHERE id = ? AND is_deleted = FALSE', [studentId]);
  if (!live) throw new Error('gone');
  await conn.query(
    "UPDATE students SET is_deleted = TRUE, is_active = FALSE, status = 'Inactive' WHERE id = ?",
    [studentId]
  );
  if (live.user_id) {
    await conn.query('UPDATE users SET is_active = FALSE WHERE id = ?', [live.user_id]);
  }
  return { type: 'student', id: Number(studentId) };
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
      // Both of these throw 'gone' if the payment was removed while the request
      // waited, which rolls the transaction back and tells the super admin.
      case 'fee_edit':
        result = await applyFeeEdit(conn, row.target_id, p);
        break;
      case 'fee_delete':
        result = await applyFeeDelete(conn, row.target_id);
        break;
      // Throws 'gone' if the student was removed while the request waited,
      // which rolls back and tells the super admin rather than reporting a
      // second removal that did nothing.
      case 'student_delete':
        result = await applyStudentDelete(conn, row.target_id ?? row.student_id);
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
    // After the commit: the change is real whether or not the notice goes out.
    await announceDecision(row, true);
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
  await announceDecision(row, false, note);
  return { ok: true as const };
}
