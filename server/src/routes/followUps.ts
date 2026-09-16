import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { audit } from '../utils/audit';

// Follow-up notes on a student — written from Student Hours while chasing fees.
// Every note is kept, so the history of chasing shows, not only the last line.
const router = Router();
router.use(requireAuth, requireRole('admin'));

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// A student's notes, newest first.
router.get(
  '/:studentId',
  wrap(async (req, res) => {
    const rows = await query(
      `SELECT f.id, f.note, f.follow_up_on, f.created_at, u.display_name AS created_by_name
         FROM student_follow_ups f
         LEFT JOIN users u ON u.id = f.created_by
        WHERE f.student_id = ? AND f.is_deleted = FALSE
        ORDER BY f.id DESC
        LIMIT 100`,
      [req.params.studentId]
    );
    res.json({ data: rows });
  })
);

// Add a note.
router.post(
  '/:studentId',
  wrap(async (req, res) => {
    const b = z
      .object({
        note: z.string().trim().min(1, 'Write the note first').max(500),
        follow_up_on: z.string().regex(ISO_DATE).optional().nullable().or(z.literal('')),
      })
      .parse(req.body);
    const student = await queryOne<any>('SELECT id FROM students WHERE id = ? AND is_deleted = FALSE', [req.params.studentId]);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const r: any = await query(
      'INSERT INTO student_follow_ups (student_id, note, follow_up_on, created_by) VALUES (?,?,?,?)',
      [student.id, b.note, b.follow_up_on || null, req.user!.userId]
    );
    await audit(req.user!.userId, 'ADD_FOLLOW_UP', 'student', student.id, null, { note: b.note, follow_up_on: b.follow_up_on || null });
    res.status(201).json({ id: r.insertId });
  })
);

// Remove a note written by mistake — marked removed, not deleted, so the row
// stays on record (and in the audit log) and can be put back.
router.delete(
  '/note/:id',
  wrap(async (req, res) => {
    const note = await queryOne<any>('SELECT * FROM student_follow_ups WHERE id = ? AND is_deleted = FALSE', [req.params.id]);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    await query('UPDATE student_follow_ups SET is_deleted = TRUE WHERE id = ?', [note.id]);
    await audit(req.user!.userId, 'DELETE_FOLLOW_UP', 'student', note.student_id, note, null);
    res.json({ ok: true });
  })
);

export default router;
