import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { requireAuth, requireSuperAdmin } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { approve, reject, KIND_LABEL } from '../utils/approvals';
import { CREDITED_EXPR, CONSUMED_EXPR } from '../utils/hoursSummary';

/**
 * The approval queue.
 *
 * The office enters a change as it always did; anything that moves a family's
 * balance waits here until the super admin approves it. This queue is the super
 * admin's alone — the office is told their change was sent when they save it,
 * and sees the result on the statement once it is approved.
 *
 * Each waiting request carries the student's hours as they stand and what they
 * would become, plus that student's recent entries — the decision is about
 * whether the figure is right for that student, which cannot be judged from the
 * number alone.
 */
const router = Router();
router.use(requireAuth);

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const hoursText = (n: any) => `${signed(Number(n))} h`;
const dateText = (v: any) => (v ? String(v).slice(0, 10) : 'not set');
const textOf = (v: any) => (v && String(v).trim() ? String(v) : 'none');

/**
 * What this request would actually change, field by field.
 *
 * An edit is usually not about the hours at all - the office is correcting the
 * date an entry belongs to, or the note beside it. Showing "5 -> 5" for the
 * hours and nothing else would tell the super admin nothing, so only the fields
 * that really move are listed, and a request that changes nothing says so.
 */
function changesFor(kind: string, p: any): { label: string; from?: string; to?: string; value?: string }[] {
  switch (kind) {
    case 'hours_add':
    case 'hours_deduct':
      return [
        { label: 'Hours', value: hoursText(p.delta) },
        { label: 'Date it belongs to', value: dateText(p.adjusted_on) },
        { label: 'Reason', value: textOf(p.reason) },
      ];

    case 'hours_edit': {
      const was = p.before || {};
      const out: { label: string; from: string; to: string }[] = [];
      if (Number(was.delta) !== Number(p.delta)) {
        out.push({ label: 'Hours', from: hoursText(was.delta), to: hoursText(p.delta) });
      }
      if (dateText(was.adjusted_on) !== dateText(p.adjusted_on)) {
        out.push({ label: 'Date it belongs to', from: dateText(was.adjusted_on), to: dateText(p.adjusted_on) });
      }
      if (textOf(was.reason) !== textOf(p.reason)) {
        out.push({ label: 'Reason', from: textOf(was.reason), to: textOf(p.reason) });
      }
      // Sent without changing anything - worth saying rather than showing a
      // blank panel the super admin has to puzzle over.
      return out.length ? out : [{ label: 'Nothing changes', value: 'the entry is the same' }];
    }

    case 'hours_delete':
      return [
        { label: 'Entry being removed', value: hoursText(p.delta) },
        { label: 'Date it belongs to', value: dateText(p.adjusted_on) },
        { label: 'Reason', value: textOf(p.reason) },
      ];

    case 'fee_entry':
      return [
        { label: 'Amount', value: `${Number(p.amount || 0).toLocaleString()} AED` },
        { label: 'Paid hours', value: `${Number(p.course_package_hours || 0)} h` },
        { label: 'Discount hours', value: `${Number(p.discount_hours || 0)} h` },
        { label: 'Payment date', value: dateText(p.payment_date) },
        ...(p.payment_source ? [{ label: 'Source', value: String(p.payment_source) }] : []),
        ...(p.transaction_reference ? [{ label: 'Reference', value: String(p.transaction_reference) }] : []),
      ];

    default:
      return [];
  }
}

const LIST_COLUMNS = `
  a.id, a.kind, a.summary, a.request_note, a.status, a.payload, a.target_id,
  a.requested_at, a.decided_at, a.decision_note, a.result_type, a.result_id,
  a.student_id, s.full_name AS student_name, s.form_no,
  COALESCE(rt.name, ru.email) AS requested_by_name,
  COALESCE(dt.name, du.email) AS decided_by_name`;

const LIST_FROM = `
  FROM approvals a
  JOIN students s ON s.id = a.student_id
  LEFT JOIN users ru ON ru.id = a.requested_by
  LEFT JOIN teachers rt ON rt.user_id = ru.id
  LEFT JOIN users du ON du.id = a.decided_by
  LEFT JOIN teachers dt ON dt.user_id = du.id`;

/**
 * The queue. Pending by default; an admin sees only what they sent.
 *
 * The hours figures are read now rather than when the request was made, because
 * the student may have attended more lectures since — the super admin should
 * approve against today's position, not a stale one.
 */
router.get(
  '/',
  requireSuperAdmin,
  wrap(async (req, res) => {
    const status = ['Pending', 'Approved', 'Rejected'].includes(String(req.query.status))
      ? String(req.query.status) : 'Pending';

    const where = ['a.is_deleted = FALSE', 'a.status = ?'];
    const params: any[] = [status];

    const rows = await query<any>(
      `SELECT ${LIST_COLUMNS},
              ${CREDITED_EXPR} AS credited,
              ${CONSUMED_EXPR} AS consumed
         ${LIST_FROM}
        WHERE ${where.join(' AND ')}
        ORDER BY a.requested_at DESC
        LIMIT 200`,
      params
    );

    res.json({
      data: rows.map((r) => {
        const payload = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
        const left = Math.round((Number(r.credited) - Number(r.consumed)) * 100) / 100;
        // What approving it would do to the balance, worked out here so the
        // screen never has to guess from the wording.
        const change =
          r.kind === 'hours_add' || r.kind === 'hours_deduct' ? Number(payload.delta || 0)
          : r.kind === 'hours_delete' ? -Number(payload.delta || 0)
          // An edit moves the balance only by the difference between the two.
          : r.kind === 'hours_edit' ? Number(payload.delta || 0) - Number(payload.before?.delta || 0)
          : r.kind === 'fee_entry' ? Number(payload.course_package_hours || 0) + Number(payload.discount_hours || 0)
          : 0;
        return {
          ...r,
          payload,
          label: KIND_LABEL[r.kind as keyof typeof KIND_LABEL],
          // Exactly what moves, so the decision is not made off a summary line.
          changes: changesFor(r.kind, payload),
          hours_left: left,
          hours_change: change,
          hours_after: Math.round((left + change) * 100) / 100,
        };
      }),
    });
  })
);

/** How many are waiting — for the badge on the menu. */
router.get(
  '/count',
  requireSuperAdmin,
  wrap(async (_req, res) => {
    const row = await queryOne<any>(
      "SELECT COUNT(*) AS n FROM approvals WHERE is_deleted = FALSE AND status = 'Pending'");
    res.json({ count: Number(row?.n || 0) });
  })
);

/**
 * That student's recent hours entries, so the decision is made against their
 * history rather than a bare number.
 */
router.get(
  '/student/:studentId/history',
  requireSuperAdmin,
  wrap(async (req, res) => {
    const adjustments = await query(
      `SELECT id, delta, reason, adjusted_on, created_at
         FROM hours_adjustments
        WHERE student_id = ? AND is_deleted = FALSE
        ORDER BY COALESCE(adjusted_on, created_at) DESC, id DESC
        LIMIT 20`,
      [req.params.studentId]
    );
    const packages = await query(
      `SELECT p.id, p.package_hours, p.discount_hours, p.rate_per_hour, p.start_date,
              t.amount, t.payment_date
         FROM fee_packages p
         LEFT JOIN fee_transactions t ON t.id = p.transaction_id
        WHERE p.student_id = ? AND p.is_deleted = FALSE
        ORDER BY p.start_date DESC, p.id DESC
        LIMIT 10`,
      [req.params.studentId]
    );
    const summary = await queryOne<any>(
      `SELECT ${CREDITED_EXPR} AS credited, ${CONSUMED_EXPR} AS consumed
         FROM students s WHERE s.id = ?`,
      [req.params.studentId]
    );
    const credited = Number(summary?.credited || 0);
    const consumed = Number(summary?.consumed || 0);
    res.json({
      adjustments,
      packages,
      credited,
      consumed,
      hours_left: Math.round((credited - consumed) * 100) / 100,
    });
  })
);

router.post(
  '/:id/approve',
  requireSuperAdmin,
  wrap(async (req, res) => {
    const r = await approve(Number(req.params.id), req.user!.userId);
    if (!r.ok) return res.status(400).json({ error: r.reason });
    res.json({ ok: true });
  })
);

router.post(
  '/:id/reject',
  requireSuperAdmin,
  wrap(async (req, res) => {
    const { note } = z.object({ note: z.string().trim().max(255).optional().nullable() }).parse(req.body ?? {});
    const r = await reject(Number(req.params.id), req.user!.userId, note);
    if (!r.ok) return res.status(400).json({ error: r.reason });
    res.json({ ok: true });
  })
);

export default router;
