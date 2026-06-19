import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { audit } from '../utils/audit';

const router = Router();
router.use(requireAuth);

// List teachers
router.get(
  '/',
  wrap(async (_req, res) => {
    const rows = await query('SELECT * FROM teachers ORDER BY name');
    res.json({ data: rows });
  })
);

// Subjects helper
router.get(
  '/subjects',
  wrap(async (_req, res) => {
    res.json({ data: await query('SELECT * FROM subjects ORDER BY name') });
  })
);

const teacherSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().nullable().or(z.literal('')),
  mobile: z.string().optional().nullable(),
  specialization: z.string().optional().nullable(),
  branch_id: z.number().int().optional().nullable(),
});

router.post(
  '/',
  requireRole('admin'),
  wrap(async (req, res) => {
    const b = teacherSchema.parse(req.body);
    const r: any = await query(
      'INSERT INTO teachers (name,email,mobile,specialization,branch_id) VALUES (?,?,?,?,?)',
      [b.name, b.email || null, b.mobile || null, b.specialization || null, b.branch_id ?? null]
    );
    await audit(req.user!.userId, 'CREATE', 'teacher', (r as any).insertId, null, b);
    res.status(201).json({ id: (r as any).insertId });
  })
);

// Assign teacher to a student (per subject)
router.post(
  '/assign',
  requireRole('admin', 'faculty'),
  wrap(async (req, res) => {
    const b = z
      .object({
        student_id: z.number().int(),
        teacher_id: z.number().int(),
        subject_id: z.number().int(),
        package_hours: z.number().optional(),
      })
      .parse(req.body);
    await query(
      `INSERT INTO student_teacher_mapping (student_id,teacher_id,subject_id,package_hours)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE package_hours = VALUES(package_hours)`,
      [b.student_id, b.teacher_id, b.subject_id, b.package_hours ?? 0]
    );
    await audit(req.user!.userId, 'ASSIGN', 'student_teacher', b.student_id, null, b);
    res.status(201).json({ ok: true });
  })
);

// Teachers assigned to a student
router.get(
  '/of-student/:studentId',
  wrap(async (req, res) => {
    const rows = await query(
      `SELECT m.id, t.id AS teacher_id, t.name AS teacher_name, sub.name AS subject_name, m.package_hours
       FROM student_teacher_mapping m
       JOIN teachers t ON t.id = m.teacher_id
       JOIN subjects sub ON sub.id = m.subject_id
       WHERE m.student_id = ?`,
      [req.params.studentId]
    );
    res.json({ data: rows });
  })
);

// Students assigned to a teacher
router.get(
  '/:teacherId/students',
  requireRole('admin', 'faculty'),
  wrap(async (req, res) => {
    const rows = await query(
      `SELECT DISTINCT s.id, s.form_no, s.full_name, s.year_grade, s.status, sub.name AS subject_name
       FROM student_teacher_mapping m
       JOIN students s ON s.id = m.student_id
       JOIN subjects sub ON sub.id = m.subject_id
       WHERE m.teacher_id = ?
       ORDER BY s.full_name`,
      [req.params.teacherId]
    );
    res.json({ data: rows });
  })
);

export default router;
