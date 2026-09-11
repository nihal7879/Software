import { Router } from 'express';
import { z } from 'zod';
import { pool, query, queryOne } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { audit } from '../utils/audit';
import { claimFormNo } from '../utils/formNo';

// Student self-registrations waiting for an administrator. A registration is
// only a request (see POST /auth/register): approving it is what creates the
// login and the student record, as a Trial or an Enrolment — so the right kind
// of form number is claimed at that moment and never needs renumbering.
const router = Router();
router.use(requireAuth, requireRole('admin'));

// How many are waiting. `unseen` counts only those newer than ?since= (the last
// registration id this admin has already looked at), which is what the sidebar
// badge shows — a notification that clears once seen, while `pending` is the
// full to-do count shown beside the Registrations button.
router.get(
  '/count',
  wrap(async (req, res) => {
    const since = Math.max(0, Number(req.query.since) || 0);
    const r = await queryOne<any>(
      `SELECT COUNT(*) AS pending, COALESCE(SUM(id > ?), 0) AS unseen
         FROM student_registrations WHERE status = 'Pending'`,
      [since]
    );
    res.json({ pending: Number(r?.pending || 0), unseen: Number(r?.unseen || 0) });
  })
);

// The list. Pending by default; the password hash never leaves the server.
router.get(
  '/',
  wrap(async (req, res) => {
    const status = ['Pending', 'Approved', 'Rejected'].includes(String(req.query.status))
      ? String(req.query.status)
      : 'Pending';
    const rows = await query(
      `SELECT r.id, r.first_name, r.last_name, r.email, r.username, r.mobile, r.status, r.approved_as,
              r.reject_reason, r.created_at, r.reviewed_at, r.student_id, s.form_no
         FROM student_registrations r
         LEFT JOIN students s ON s.id = r.student_id
        WHERE r.status = ?
        ORDER BY r.created_at ${status === 'Pending' ? 'ASC' : 'DESC'}
        LIMIT 500`,
      [status]
    );
    res.json({ data: rows });
  })
);

// Approve → create the login + student record, as a Trial or an Enrolment.
router.post(
  '/:id/approve',
  wrap(async (req, res) => {
    const b = z
      .object({
        student_type: z.enum(['Trial', 'Enrolled']),
        // Free hours for a trial — the same package-at-zero-cost the admin's own
        // "Add Student" gives a trial, so the hours ledger counts it down.
        trial_hours: z.number().positive().optional(),
      })
      .parse(req.body);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Locked, so two admins approving the same request cannot create it twice.
      const [[reg]]: any = await conn.query(
        "SELECT * FROM student_registrations WHERE id = ? AND status = 'Pending' FOR UPDATE",
        [req.params.id]
      );
      if (!reg) {
        await conn.rollback();
        return res.status(404).json({ error: 'This registration is no longer waiting — it may already have been handled.' });
      }
      // The login is the username they chose. A request from before usernames
      // existed has none, and signs in with its email as it always would have.
      const login = reg.username || reg.email;
      const [[taken]]: any = await conn.query('SELECT id FROM users WHERE email = ?', [login]);
      if (taken) {
        await conn.rollback();
        return res.status(409).json({ error: `The login "${login}" already exists. Reject this request, or remove the other account first.` });
      }

      const fullName = [reg.first_name, reg.last_name].filter(Boolean).join(' ').trim();
      const [u]: any = await conn.query(
        `INSERT INTO users (role, email, password_hash, display_name, registration_ip, registration_gps, registration_device)
         VALUES ('student', ?, ?, ?, ?, ?, ?)`,
        [login, reg.password_hash, fullName, reg.registration_ip, reg.registration_gps, reg.registration_device]
      );
      const isTrial = b.student_type === 'Trial';
      // form_no gets a temporary unique value, then the real one is claimed —
      // a T-number for a trial, the next enrolment number otherwise.
      const [st]: any = await conn.query(
        `INSERT INTO students
          (form_no, status, student_type, date_of_joining, trial_started_on,
           first_name, last_name, full_name, email, student_mobile, user_id, profile_completed)
         VALUES (UUID(), 'Active', ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)`,
        [
          b.student_type,
          isTrial ? null : new Date().toISOString().slice(0, 10),
          isTrial ? new Date().toISOString().slice(0, 10) : null,
          reg.first_name, reg.last_name, fullName, reg.email, reg.mobile, u.insertId,
        ]
      );
      const formNo = await claimFormNo(st.insertId, b.student_type, conn);
      if (isTrial && b.trial_hours) {
        await conn.query(
          `INSERT INTO fee_packages (student_id, course_name, package_hours, rate_per_hour, start_date)
           VALUES (?, 'Trial', ?, 0, CURDATE())`,
          [st.insertId, b.trial_hours]
        );
      }
      await conn.query(
        `UPDATE student_registrations
            SET status = 'Approved', approved_as = ?, student_id = ?, reviewed_by = ?, reviewed_at = NOW()
          WHERE id = ?`,
        [b.student_type, st.insertId, req.user!.userId, reg.id]
      );
      await conn.commit();
      await audit(req.user!.userId, 'APPROVE_REGISTRATION', 'student_registration', reg.id, { email: reg.email },
        { student_id: st.insertId, form_no: formNo, student_type: b.student_type, trial_hours: b.trial_hours ?? null });
      res.json({ ok: true, student_id: st.insertId, form_no: formNo, username: login });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  })
);

// Reject → the request is kept (with the reason) so the decision is on record;
// the person is told at sign-in that it was not approved.
router.post(
  '/:id/reject',
  wrap(async (req, res) => {
    const b = z.object({ reason: z.string().max(255).optional().nullable() }).parse(req.body);
    const reg = await queryOne<any>("SELECT id, email FROM student_registrations WHERE id = ? AND status = 'Pending'", [req.params.id]);
    if (!reg) return res.status(404).json({ error: 'This registration is no longer waiting — it may already have been handled.' });
    await query(
      `UPDATE student_registrations
          SET status = 'Rejected', reject_reason = ?, reviewed_by = ?, reviewed_at = NOW()
        WHERE id = ?`,
      [b.reason?.trim() || null, req.user!.userId, reg.id]
    );
    await audit(req.user!.userId, 'REJECT_REGISTRATION', 'student_registration', reg.id, { email: reg.email }, { reason: b.reason ?? null });
    res.json({ ok: true });
  })
);

export default router;
