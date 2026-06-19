import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { requireAuth, requireRole, ensureOwnStudent } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { deriveMonth } from '../utils/hours';
import { audit } from '../utils/audit';

const router = Router();
router.use(requireAuth);

// Hours ledger summary for one student (from the VIEW)
router.get(
  '/ledger/:id',
  ensureOwnStudent,
  wrap(async (req, res) => {
    const row = await queryOne('SELECT * FROM student_hours_summary WHERE student_id = ?', [
      req.params.id,
    ]);
    if (!row) return res.status(404).json({ error: 'No ledger for student' });
    res.json(row);
  })
);

// Full ledger table (admin) — the 154-Summary screen
router.get(
  '/ledger',
  requireRole('admin', 'faculty'),
  wrap(async (_req, res) => {
    const rows = await query(
      'SELECT * FROM student_hours_summary ORDER BY CAST(form_no AS UNSIGNED)'
    );
    res.json({ data: rows });
  })
);

// Transactions for a student
router.get(
  '/transactions/:id',
  ensureOwnStudent,
  wrap(async (req, res) => {
    const rows = await query(
      'SELECT * FROM fee_transactions WHERE student_id = ? ORDER BY payment_date DESC',
      [req.params.id]
    );
    res.json({ data: rows });
  })
);

// All transactions (admin) — Finance Tracker
router.get(
  '/transactions',
  requireRole('admin'),
  wrap(async (req, res) => {
    const month = req.query.month as string;
    const params: any[] = [];
    let where = '';
    if (month) { where = 'WHERE ft.month = ?'; params.push(month); }
    const rows = await query(
      `SELECT ft.*, s.full_name AS student_name, s.form_no
       FROM fee_transactions ft JOIN students s ON s.id = ft.student_id
       ${where} ORDER BY ft.payment_date DESC`,
      params
    );
    res.json({ data: rows });
  })
);

const txSchema = z.object({
  student_id: z.number().int(),
  parent_name: z.string().optional().nullable(),
  amount: z.number(),
  payment_date: z.string(),
  transaction_reference: z.string().optional().nullable(),
  payment_source: z.string().optional().nullable(),
  course_package_hours: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// Record a payment (admin)
router.post(
  '/transactions',
  requireRole('admin'),
  wrap(async (req, res) => {
    const b = txSchema.parse(req.body);
    const r: any = await query(
      `INSERT INTO fee_transactions
        (student_id,parent_name,amount,payment_date,month,transaction_reference,payment_source,course_package_hours,notes,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        b.student_id, b.parent_name || null, b.amount, b.payment_date,
        deriveMonth(b.payment_date), b.transaction_reference || null,
        b.payment_source || null, b.course_package_hours ?? null, b.notes || null,
        req.user!.userId,
      ]
    );
    await audit(req.user!.userId, 'CREATE', 'fee_transaction', (r as any).insertId, null, b);
    res.status(201).json({ id: (r as any).insertId });
  })
);

// Packages for a student
router.get(
  '/packages/:id',
  ensureOwnStudent,
  wrap(async (req, res) => {
    const rows = await query('SELECT * FROM fee_packages WHERE student_id = ?', [req.params.id]);
    res.json({ data: rows });
  })
);

const packageSchema = z.object({
  student_id: z.number().int(),
  course_name: z.string().optional().nullable(),
  package_hours: z.number(),
  rate_per_hour: z.number().optional(),
  discount_hours: z.number().optional(),
  adjusted_hours: z.number().optional(),
  start_date: z.string().optional().nullable(),
});

router.post(
  '/packages',
  requireRole('admin'),
  wrap(async (req, res) => {
    const b = packageSchema.parse(req.body);
    const r: any = await query(
      `INSERT INTO fee_packages
        (student_id,course_name,package_hours,rate_per_hour,discount_hours,adjusted_hours,start_date)
       VALUES (?,?,?,?,?,?,?)`,
      [
        b.student_id, b.course_name || null, b.package_hours, b.rate_per_hour ?? 0,
        b.discount_hours ?? 0, b.adjusted_hours ?? 0, b.start_date || null,
      ]
    );
    await audit(req.user!.userId, 'CREATE', 'fee_package', (r as any).insertId, null, b);
    res.status(201).json({ id: (r as any).insertId });
  })
);

// Adjust ledger (pending fees / discount / adjusted) — admin only
router.put(
  '/ledger/:id/adjust',
  requireRole('admin'),
  wrap(async (req, res) => {
    const b = z
      .object({
        pending_fees: z.number().optional(),
        extra_amount_left: z.number().optional(),
        amount_credited: z.number().optional(),
        discount_hours: z.number().optional(),
        adjusted_hours: z.number().optional(),
      })
      .parse(req.body);

    // Upsert ledger_adjustments
    await query(
      `INSERT INTO ledger_adjustments (student_id, amount_credited, pending_fees, extra_amount_left)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE
         amount_credited = COALESCE(VALUES(amount_credited), amount_credited),
         pending_fees = COALESCE(VALUES(pending_fees), pending_fees),
         extra_amount_left = COALESCE(VALUES(extra_amount_left), extra_amount_left)`,
      [req.params.id, b.amount_credited ?? null, b.pending_fees ?? null, b.extra_amount_left ?? null]
    );

    // Discount/adjusted live on the active package
    if (b.discount_hours != null || b.adjusted_hours != null) {
      await query(
        `UPDATE fee_packages SET
           discount_hours = COALESCE(?, discount_hours),
           adjusted_hours = COALESCE(?, adjusted_hours)
         WHERE student_id = ? AND is_active = TRUE`,
        [b.discount_hours ?? null, b.adjusted_hours ?? null, req.params.id]
      );
    }
    await audit(req.user!.userId, 'ADJUST', 'ledger', req.params.id, null, b);
    res.json({ ok: true });
  })
);

// Payment stub — gateway NOT integrated yet (Razorpay/Stripe later)
router.post(
  '/pay/:id',
  ensureOwnStudent,
  wrap(async (_req, res) => {
    res.status(501).json({
      error: 'Online payment not yet enabled',
      message: 'Payment gateway (Razorpay/Stripe) integration is planned. Please pay via bank transfer for now.',
    });
  })
);

export default router;
