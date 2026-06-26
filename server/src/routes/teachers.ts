import { Router, Request } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { query, queryOne } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { audit } from '../utils/audit';
import { clientIp, deviceInfo, getReqCtx } from '../utils/reqContext';
import { CREDITED_EXPR, CONSUMED_EXPR, PENDING_EXPR, LAST_LECTURE_EXPR, deriveHours } from '../utils/hoursSummary';

const router = Router();
router.use(requireAuth);

// Resolve the teacher id for the logged-in faculty user (token first, then DB).
async function myTeacherId(req: Request): Promise<number | null> {
  if (req.user?.teacherId) return req.user.teacherId;
  const t = await queryOne<any>('SELECT id FROM teachers WHERE user_id = ?', [req.user!.userId]);
  return t?.id ?? null;
}

// ---- FACULTY SELF-SCOPED ENDPOINTS ("my own data only") -------------------

// My teacher profile + workload summary
router.get(
  '/me',
  requireRole('faculty', 'admin'),
  wrap(async (req, res) => {
    const tid = await myTeacherId(req);
    if (!tid) return res.status(404).json({ error: 'No teacher record linked to this account' });
    const row = await queryOne(
      `SELECT t.*,
        (SELECT COUNT(DISTINCT a.student_id)
           FROM lecture_sessions l JOIN lecture_attendees a ON a.lecture_id = l.id
           WHERE l.teacher_id = t.id) AS taught_students,
        (SELECT COUNT(DISTINCT m.student_id) FROM student_teacher_mapping m WHERE m.teacher_id = t.id) AS assigned_students,
        (SELECT COALESCE(SUM(l.total_hours),0) FROM lecture_sessions l WHERE l.teacher_id = t.id) AS total_hours,
        (SELECT COALESCE(SUM(l.total_hours),0) FROM lecture_sessions l
           WHERE l.teacher_id = t.id AND l.month = DATE_FORMAT(CURDATE(),'%Y-%m')) AS month_hours
       FROM teachers t WHERE t.id = ?`,
      [tid]
    );
    res.json(row);
  })
);

// My assigned students (only mine)
router.get(
  '/me/students',
  requireRole('faculty', 'admin'),
  wrap(async (req, res) => {
    const tid = await myTeacherId(req);
    if (!tid) return res.json({ data: [] });
    const rows = await query<any>(
      `SELECT s.id, s.form_no, s.full_name, s.year_grade, s.status, s.parent_mobile,
              GROUP_CONCAT(DISTINCT sub.name SEPARATOR ', ') AS subjects,
              ${CREDITED_EXPR} AS total_hours_credited,
              ${CONSUMED_EXPR} AS total_hours_consumed,
              ${PENDING_EXPR}  AS pending_fees
       FROM student_teacher_mapping m
       JOIN students s ON s.id = m.student_id
       JOIN subjects sub ON sub.id = m.subject_id
       WHERE m.teacher_id = ?
       GROUP BY s.id, s.form_no, s.full_name, s.year_grade, s.status, s.parent_mobile
       ORDER BY s.full_name`,
      [tid]
    );
    res.json({ data: rows.map(deriveHours), teacherId: tid });
  })
);

// My lectures only
router.get(
  '/me/lectures',
  requireRole('faculty', 'admin'),
  wrap(async (req, res) => {
    const tid = await myTeacherId(req);
    if (!tid) return res.json({ data: [] });
    const rows = await query(
      `SELECT l.id, l.session_date, l.month, l.time_in, l.time_out, l.total_hours,
              l.topic, l.subtopic, l.remark, l.venue, sub.name AS subject_name,
              GROUP_CONCAT(DISTINCT s.full_name SEPARATOR ', ') AS students
       FROM lecture_sessions l
       LEFT JOIN subjects sub ON sub.id = l.subject_id
       JOIN lecture_attendees a ON a.lecture_id = l.id
       JOIN students s ON s.id = a.student_id
       WHERE l.teacher_id = ?
       GROUP BY l.id
       ORDER BY l.session_date DESC, l.id DESC LIMIT 300`,
      [tid]
    );
    res.json({ data: rows, teacherId: tid });
  })
);

// TEACHER → one of MY students: full detail (hours + lectures, NO fees).
//   GET /teachers/me/student/:studentId?from=&to=
router.get(
  '/me/student/:studentId',
  requireRole('faculty', 'admin'),
  wrap(async (req, res) => {
    const sid = Number(req.params.studentId);
    const tid = await myTeacherId(req);
    const isFaculty = req.user!.role === 'faculty';

    if (isFaculty) {
      const m = await queryOne<any>(
        'SELECT id FROM student_teacher_mapping WHERE teacher_id = ? AND student_id = ?',
        [tid, sid]
      );
      if (!m) return res.status(403).json({ error: 'Forbidden: not your student' });
    }

    // student basics + HOURS ONLY (no fee fields exposed), computed scoped to this id
    const studentRow = await queryOne<any>(
      `SELECT s.id, s.form_no, s.full_name, s.status, s.year_grade, s.exam_board, s.school_name,
              s.student_mobile, s.parent_mobile,
              ${CREDITED_EXPR} AS total_hours_credited,
              ${CONSUMED_EXPR} AS total_hours_consumed,
              ${PENDING_EXPR}  AS pending_fees,
              ${LAST_LECTURE_EXPR} AS last_attended_lecture
       FROM students s
       WHERE s.id = ?`,
      [sid]
    );
    if (!studentRow) return res.status(404).json({ error: 'Student not found' });
    const student = deriveHours(studentRow);

    const from = (req.query.from as string) || '2000-01-01';
    const to = (req.query.to as string) || '2999-12-31';

    // faculty see only the lectures THEY took with this student
    const params: any[] = [sid, from, to];
    let teacherFilter = '';
    if (isFaculty) { teacherFilter = 'AND l.teacher_id = ?'; params.push(tid); }

    const lectures = await query(
      `SELECT l.session_date, l.month, l.time_in, l.time_out, a.hours_consumed AS no_of_hours,
              t.name AS teacher_name, sub.name AS subject_name,
              l.topic, l.subtopic, l.remark, l.venue, a.attendance_status
       FROM lecture_attendees a
       JOIN lecture_sessions l ON l.id = a.lecture_id
       LEFT JOIN teachers t ON t.id = l.teacher_id
       LEFT JOIN subjects sub ON sub.id = l.subject_id
       WHERE a.student_id = ? AND l.session_date BETWEEN ? AND ? ${teacherFilter}
       ORDER BY l.session_date`,
      params
    );

    const hoursInRange = lectures.reduce((a: number, l: any) => a + Number(l.no_of_hours), 0);
    res.json({ student, lectures, summary: { from, to, lecture_count: lectures.length, hours_in_range: Math.round(hoursInRange * 100) / 100 } });
  })
);

// List teachers
router.get(
  '/',
  wrap(async (_req, res) => {
    const rows = await query('SELECT * FROM teachers ORDER BY name');
    res.json({ data: rows });
  })
);

// Subjects helper — list active (non-deleted) subjects.
router.get(
  '/subjects',
  wrap(async (_req, res) => {
    res.json({ data: await query('SELECT * FROM subjects WHERE is_deleted = FALSE ORDER BY name') });
  })
);

// Add a subject (admin). Re-activates a soft-deleted one with the same name.
router.post(
  '/subjects',
  requireRole('admin'),
  wrap(async (req, res) => {
    const b = z.object({ name: z.string().min(1) }).parse(req.body);
    const name = b.name.trim();
    if (!name) return res.status(400).json({ error: 'Subject name is required' });

    const existing = await queryOne<any>('SELECT id, is_deleted FROM subjects WHERE name = ?', [name]);
    if (existing) {
      if (!existing.is_deleted) return res.status(409).json({ error: 'Subject already exists' });
      await query('UPDATE subjects SET is_deleted = FALSE, is_active = TRUE WHERE id = ?', [existing.id]);
      await audit(req.user!.userId, 'CREATE', 'subject', existing.id, null, { name });
      return res.status(201).json({ id: existing.id, name });
    }

    const r: any = await query('INSERT INTO subjects (name) VALUES (?)', [name]);
    await audit(req.user!.userId, 'CREATE', 'subject', r.insertId, null, { name });
    res.status(201).json({ id: r.insertId, name });
  })
);

// Soft-delete a subject (admin).
router.delete(
  '/subjects/:id',
  requireRole('admin'),
  wrap(async (req, res) => {
    await query('UPDATE subjects SET is_deleted = TRUE, is_active = FALSE WHERE id = ?', [req.params.id]);
    await audit(req.user!.userId, 'DELETE', 'subject', req.params.id, null, null);
    res.json({ ok: true });
  })
);

const teacherSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().nullable().or(z.literal('')),
  mobile: z.string().optional().nullable(),
  specialization: z.string().optional().nullable(),
  branch_id: z.number().int().optional().nullable(),
  password: z.string().min(6).optional(),
});

router.post(
  '/',
  requireRole('admin'),
  wrap(async (req, res) => {
    const b = teacherSchema.parse(req.body);

    // If an email + password are given, create the teacher's faculty login first.
    let userId: number | null = null;
    if (b.email && b.password) {
      const exists = await queryOne<any>('SELECT id FROM users WHERE email = ?', [b.email]);
      if (exists) return res.status(409).json({ error: 'A user with this email already exists' });
      const hash = await bcrypt.hash(b.password, 10);
      const ctx = getReqCtx();
      const gps = ctx?.lat != null && ctx?.lng != null ? `${ctx.lat},${ctx.lng}` : null;
      const u: any = await query(
        `INSERT INTO users (role, email, password_hash, display_name, registration_ip, registration_gps, registration_device)
         VALUES ('faculty', ?, ?, ?, ?, ?, ?)`,
        [b.email, hash, b.name, clientIp(req), gps, deviceInfo(req)]
      );
      userId = (u as any).insertId;
    }

    const r: any = await query(
      'INSERT INTO teachers (name,email,mobile,specialization,branch_id,user_id) VALUES (?,?,?,?,?,?)',
      [b.name, b.email || null, b.mobile || null, b.specialization || null, b.branch_id ?? null, userId]
    );
    await audit(req.user!.userId, 'CREATE', 'teacher', (r as any).insertId, null, { ...b, password: undefined, login_created: !!userId });
    res.status(201).json({ id: (r as any).insertId, login_created: !!userId });
  })
);

// Activate / deactivate a teacher (admin). Also toggles their faculty login.
router.post(
  '/:id/set-status',
  requireRole('admin'),
  wrap(async (req, res) => {
    const b = z.object({ is_active: z.boolean() }).parse(req.body);
    await query('UPDATE teachers SET is_active = ? WHERE id = ?', [b.is_active, req.params.id]);
    // Keep the linked login in sync so a deactivated teacher can't sign in.
    await query(
      'UPDATE users SET is_active = ? WHERE id = (SELECT user_id FROM teachers WHERE id = ?)',
      [b.is_active, req.params.id]
    );
    await audit(req.user!.userId, 'SET_STATUS', 'teacher', req.params.id, null, { is_active: b.is_active });
    res.json({ ok: true });
  })
);

// Assign a teacher to a student (per subject). ADMIN ONLY — faculty no longer
// self-assign; the institute decides who teaches whom.
router.post(
  '/assign',
  requireRole('admin'),
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

// ADMIN roster for a teacher: every student they've TAUGHT or are ASSIGNED to,
// with an is_assigned flag + hours taught with this teacher. Reconciles with the
// workload "Students" count (which is the same taught ∪ assigned union).
router.get(
  '/:teacherId/roster',
  requireRole('admin'),
  wrap(async (req, res) => {
    const tid = Number(req.params.teacherId);
    const rows = await query(
      `SELECT s.id, s.form_no, s.full_name, s.year_grade, s.status,
              (SELECT GROUP_CONCAT(DISTINCT sub.name SEPARATOR ', ')
                 FROM student_teacher_mapping m JOIN subjects sub ON sub.id = m.subject_id
                 WHERE m.teacher_id = ? AND m.student_id = s.id) AS subjects,
              EXISTS(SELECT 1 FROM student_teacher_mapping m
                       WHERE m.teacher_id = ? AND m.student_id = s.id) AS is_assigned,
              COALESCE((SELECT SUM(a.hours_consumed) FROM lecture_attendees a
                          JOIN lecture_sessions l ON l.id = a.lecture_id
                          WHERE l.teacher_id = ? AND a.student_id = s.id),0) AS hours_with_teacher
       FROM students s
       WHERE s.id IN (
         SELECT a.student_id FROM lecture_sessions l JOIN lecture_attendees a ON a.lecture_id = l.id WHERE l.teacher_id = ?
         UNION
         SELECT m.student_id FROM student_teacher_mapping m WHERE m.teacher_id = ?
       )
       ORDER BY s.full_name`,
      [tid, tid, tid, tid, tid]
    );
    res.json({ data: rows });
  })
);

// Students assigned to a teacher (faculty may only query their own id)
router.get(
  '/:teacherId/students',
  requireRole('admin', 'faculty'),
  wrap(async (req, res) => {
    if (req.user!.role === 'faculty') {
      const tid = await myTeacherId(req);
      if (Number(req.params.teacherId) !== tid) return res.status(403).json({ error: 'Forbidden: not your data' });
    }
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
