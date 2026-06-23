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
      'SELECT * FROM fee_transactions WHERE student_id = ? AND is_deleted = FALSE ORDER BY payment_date DESC',
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
    let where = 'WHERE ft.is_deleted = FALSE';
    if (month) { where += ' AND ft.month = ?'; params.push(month); }
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

// Edit a payment (admin). Recomputes `month` when payment_date changes.
router.put(
  '/transactions/:id',
  requireRole('admin'),
  wrap(async (req, res) => {
    const b = txSchema.partial().parse(req.body);
    const before = await queryOne('SELECT * FROM fee_transactions WHERE id = ? AND is_deleted = FALSE', [req.params.id]);
    if (!before) return res.status(404).json({ error: 'Transaction not found' });

    const fields: string[] = [];
    const params: any[] = [];
    for (const [k, v] of Object.entries(b)) { fields.push(`${k} = ?`); params.push(v); }
    if (b.payment_date) { fields.push('month = ?'); params.push(deriveMonth(b.payment_date)); }
    if (fields.length) {
      params.push(req.params.id);
      await query(`UPDATE fee_transactions SET ${fields.join(', ')} WHERE id = ?`, params);
    }
    await audit(req.user!.userId, 'UPDATE', 'fee_transaction', req.params.id, before, b);
    res.json({ ok: true });
  })
);

// Delete a payment (admin).
router.delete(
  '/transactions/:id',
  requireRole('admin'),
  wrap(async (req, res) => {
    const before = await queryOne('SELECT * FROM fee_transactions WHERE id = ? AND is_deleted = FALSE', [req.params.id]);
    if (!before) return res.status(404).json({ error: 'Transaction not found' });
    await query('UPDATE fee_transactions SET is_deleted = TRUE WHERE id = ?', [req.params.id]); // soft delete
    await audit(req.user!.userId, 'DELETE', 'fee_transaction', req.params.id, before, null);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------
// EXCEL IMPORT — rows are parsed in the browser and posted here as JSON.
// Each row is matched to a student (by form_no, else exact/unique name). A row
// that matches AND has a valid amount + date is inserted as a real transaction.
// Anything else is parked in fee_import_drafts for the admin to assign later.
// ---------------------------------------------------------------------------
const normDate = (v: any): string | null => {
  if (v == null || v === '') return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const importRowSchema = z.object({
  form_no: z.string().optional().nullable(),
  student_name: z.string().optional().nullable(),
  amount: z.union([z.number(), z.string()]).optional().nullable(),
  payment_date: z.string().optional().nullable(),
  transaction_reference: z.string().optional().nullable(),
  payment_source: z.string().optional().nullable(),
  parent_name: z.string().optional().nullable(),
  course_package_hours: z.union([z.number(), z.string()]).optional().nullable(),
  notes: z.string().optional().nullable(),
  raw: z.any().optional(),
});

async function matchStudent(formNo?: string | null, name?: string | null): Promise<number | null> {
  if (formNo) {
    const s = await queryOne<any>('SELECT id FROM students WHERE form_no = ?', [String(formNo).trim()]);
    if (s) return s.id;
  }
  if (name) {
    const exact = await queryOne<any>('SELECT id FROM students WHERE full_name = ?', [name.trim()]);
    if (exact) return exact.id;
    const like = await query<any>('SELECT id FROM students WHERE full_name LIKE ? LIMIT 2', [`%${name.trim()}%`]);
    if (like.length === 1) return like[0].id; // accept only an unambiguous match
  }
  return null;
}

router.post(
  '/import',
  requireRole('admin'),
  wrap(async (req, res) => {
    const body = z.object({ rows: z.array(importRowSchema).max(5000) }).parse(req.body);
    let imported = 0;
    let drafted = 0;

    for (const row of body.rows) {
      const amount = row.amount == null || row.amount === '' ? NaN : Number(row.amount);
      const date = normDate(row.payment_date);
      const pkgHours = row.course_package_hours ? Number(row.course_package_hours) : null;
      const studentId = await matchStudent(row.form_no, row.student_name);
      const month = date ? deriveMonth(date) : null;

      const amountOk = Number.isFinite(amount) && amount > 0;
      const ready = studentId != null && amountOk && !!date;

      if (ready) {
        await query(
          `INSERT INTO fee_transactions
            (student_id,parent_name,amount,payment_date,month,transaction_reference,payment_source,course_package_hours,notes,created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [studentId, row.parent_name || null, amount, date, month, row.transaction_reference || null,
           row.payment_source || null, pkgHours, row.notes || null, req.user!.userId]
        );
        imported++;
      } else {
        const reason = studentId == null ? 'No matching student'
          : !amountOk ? 'Missing / invalid amount'
          : !date ? 'Missing / invalid date'
          : 'Needs review';
        await query(
          `INSERT INTO fee_import_drafts
            (student_id,guessed_form_no,guessed_student_name,amount,payment_date,month,
             transaction_reference,payment_source,parent_name,course_package_hours,notes,reason,raw_json,created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [studentId, row.form_no || null, row.student_name || null,
           Number.isFinite(amount) ? amount : null, date, month,
           row.transaction_reference || null, row.payment_source || null, row.parent_name || null,
           pkgHours, row.notes || null, reason, JSON.stringify(row.raw ?? row), req.user!.userId]
        );
        drafted++;
      }
    }

    await audit(req.user!.userId, 'IMPORT', 'fee_transaction', 'bulk', null, { imported, drafted, total: body.rows.length });
    res.json({ imported, drafted, total: body.rows.length });
  })
);

// List unresolved import drafts (admin)
router.get(
  '/drafts',
  requireRole('admin'),
  wrap(async (_req, res) => {
    const rows = await query(
      `SELECT d.*, s.full_name AS matched_student_name, s.form_no AS matched_form_no
       FROM fee_import_drafts d
       LEFT JOIN students s ON s.id = d.student_id
       WHERE d.status = 'draft'
       ORDER BY d.created_at DESC, d.id DESC`
    );
    res.json({ data: rows });
  })
);

// Assign a student to a draft → creates the real transaction, marks it imported.
router.post(
  '/drafts/:id/assign',
  requireRole('admin'),
  wrap(async (req, res) => {
    const b = z
      .object({
        student_id: z.number().int(),
        amount: z.number().optional(),
        payment_date: z.string().optional(),
        parent_name: z.string().optional().nullable(),
        transaction_reference: z.string().optional().nullable(),
        payment_source: z.string().optional().nullable(),
        course_package_hours: z.number().optional().nullable(),
        notes: z.string().optional().nullable(),
      })
      .parse(req.body);

    const draft = await queryOne<any>("SELECT * FROM fee_import_drafts WHERE id = ? AND status = 'draft'", [req.params.id]);
    if (!draft) return res.status(404).json({ error: 'Draft not found or already imported' });

    const amount = b.amount ?? Number(draft.amount);
    const date = b.payment_date ?? (draft.payment_date ? String(draft.payment_date).slice(0, 10) : null);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'A valid amount is required' });
    if (!date) return res.status(400).json({ error: 'A valid payment date is required' });

    const r: any = await query(
      `INSERT INTO fee_transactions
        (student_id,parent_name,amount,payment_date,month,transaction_reference,payment_source,course_package_hours,notes,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        b.student_id, b.parent_name ?? draft.parent_name ?? null, amount, date, deriveMonth(date),
        b.transaction_reference ?? draft.transaction_reference ?? null,
        b.payment_source ?? draft.payment_source ?? null,
        b.course_package_hours ?? (draft.course_package_hours != null ? Number(draft.course_package_hours) : null),
        b.notes ?? draft.notes ?? null, req.user!.userId,
      ]
    );
    await query("UPDATE fee_import_drafts SET status = 'imported', student_id = ? WHERE id = ?", [b.student_id, req.params.id]);
    await audit(req.user!.userId, 'ASSIGN_IMPORT', 'fee_transaction', (r as any).insertId, draft, b);
    res.status(201).json({ id: (r as any).insertId });
  })
);

// Discard a draft (admin)
router.delete(
  '/drafts/:id',
  requireRole('admin'),
  wrap(async (req, res) => {
    await query('DELETE FROM fee_import_drafts WHERE id = ?', [req.params.id]);
    await audit(req.user!.userId, 'DELETE', 'fee_import_draft', req.params.id, null, null);
    res.json({ ok: true });
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
