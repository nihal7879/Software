import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { audit } from '../utils/audit';
import { mailConfigured, sendMail, hoursStatementEmail } from '../utils/mailer';

const router = Router();
router.use(requireAuth, requireRole('admin'));

const looksLikeEmail = (v: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? '').trim());

// Where a student's statement can go. Parent emails come first; the student's own
// email is offered last, labelled, because on some records it is really the
// parent's address. The admin can always type another one.
router.get(
  '/recipients/:studentId',
  wrap(async (req, res) => {
    const student = await queryOne<any>('SELECT id, form_no, full_name, email FROM students WHERE id = ? AND is_deleted = FALSE', [req.params.studentId]);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const parents = await query<any>(
      `SELECT p.name, p.relationship, p.email, u.email AS login
         FROM parents p LEFT JOIN users u ON u.id = p.user_id
        WHERE p.student_id = ? AND p.is_deleted = FALSE`,
      [student.id]
    );
    const out: { email: string; label: string }[] = [];
    const add = (email: unknown, label: string) => {
      const e = String(email ?? '').trim();
      if (looksLikeEmail(e) && !out.some((o) => o.email.toLowerCase() === e.toLowerCase())) out.push({ email: e, label });
    };
    for (const p of parents) {
      const who = [p.relationship || 'Parent', p.name].filter(Boolean).join(' · ');
      add(p.email, who);
      add(p.login, `${who} (login)`);
    }
    add(student.email, "Email on the student's record");
    res.json({ data: out, configured: mailConfigured() });
  })
);

// Email a student's hours statement to a parent. The workbook is built in the
// browser — the same file "Export Excel" downloads — and sent here as base64.
router.post(
  '/hours-statement',
  wrap(async (req, res) => {
    const b = z
      .object({
        student_id: z.number().int(),
        to: z.array(z.string().trim().email('Enter a valid email address')).min(1, 'Add at least one email address').max(5),
        filename: z.string().min(1).max(160),
        file_base64: z.string().min(1),
      })
      .parse(req.body);

    const student = await queryOne<any>('SELECT id, form_no, full_name FROM students WHERE id = ? AND is_deleted = FALSE', [b.student_id]);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const content = Buffer.from(b.file_base64, 'base64');
    if (content.length === 0 || content.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'The statement file is empty or too large.' });
    // Only ever an .xlsx named like a statement — never a path or another type.
    const filename = b.filename.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/\.xlsx$/i, '') + '.xlsx';

    const mail = hoursStatementEmail({ studentName: student.full_name, formNo: student.form_no });
    const result = await sendMail({
      kind: 'hours_statement',
      to: b.to,
      ...mail,
      attachments: [{ filename, content }],
      studentId: student.id,
      sentBy: req.user!.userId,
    });
    await audit(req.user!.userId, 'EMAIL_HOURS_STATEMENT', 'student', student.id, null, { to: b.to, status: result.status, filename });
    res.status(result.status === 'failed' ? 502 : 200).json(result);
  })
);

export default router;
