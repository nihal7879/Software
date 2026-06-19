import { Router, Request } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { audit } from '../utils/audit';

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
    const rows = await query(
      `SELECT DISTINCT s.id, s.form_no, s.full_name, s.year_grade, s.status, s.parent_mobile,
              GROUP_CONCAT(DISTINCT sub.name SEPARATOR ', ') AS subjects,
              hs.hours_left, hs.fee_status
       FROM student_teacher_mapping m
       JOIN students s ON s.id = m.student_id
       JOIN subjects sub ON sub.id = m.subject_id
       LEFT JOIN student_hours_summary hs ON hs.student_id = s.id
       WHERE m.teacher_id = ?
       GROUP BY s.id, s.form_no, s.full_name, s.year_grade, s.status, s.parent_mobile, hs.hours_left, hs.fee_status
       ORDER BY s.full_name`,
      [tid]
    );
    res.json({ data: rows, teacherId: tid });
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

    // student basics + HOURS ONLY (no fee fields exposed)
    const student = await queryOne(
      `SELECT s.id, s.form_no, s.full_name, s.status, s.year_grade, s.exam_board, s.school_name,
              s.student_mobile, s.parent_mobile,
              hs.total_hours_credited, hs.total_hours_consumed, hs.hours_left, hs.last_attended_lecture
       FROM students s LEFT JOIN student_hours_summary hs ON hs.student_id = s.id
       WHERE s.id = ?`,
      [sid]
    );
    if (!student) return res.status(404).json({ error: 'Student not found' });

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

// Assign teacher to a student (per subject).
// Faculty can ONLY assign themselves — teacher_id is forced to their own id.
router.post(
  '/assign',
  requireRole('admin', 'faculty'),
  wrap(async (req, res) => {
    const b = z
      .object({
        student_id: z.number().int(),
        teacher_id: z.number().int().optional(),
        subject_id: z.number().int(),
        package_hours: z.number().optional(),
      })
      .parse(req.body);

    let teacherId = b.teacher_id;
    if (req.user!.role === 'faculty') {
      teacherId = (await myTeacherId(req)) ?? undefined;
      if (!teacherId) return res.status(403).json({ error: 'No teacher record linked to this account' });
    }
    if (!teacherId) return res.status(400).json({ error: 'teacher_id required' });

    await query(
      `INSERT INTO student_teacher_mapping (student_id,teacher_id,subject_id,package_hours)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE package_hours = VALUES(package_hours)`,
      [b.student_id, teacherId, b.subject_id, b.package_hours ?? 0]
    );
    await audit(req.user!.userId, 'ASSIGN', 'student_teacher', b.student_id, null, { ...b, teacher_id: teacherId });
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
