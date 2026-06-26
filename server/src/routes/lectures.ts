import { Router, Request } from 'express';
import { z } from 'zod';
import { pool, query, queryOne } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { timeToDecimalHours, deriveMonth } from '../utils/hours';
import { audit } from '../utils/audit';

const router = Router();
router.use(requireAuth);

async function myTeacherId(req: Request): Promise<number | null> {
  if (req.user?.teacherId) return req.user.teacherId;
  const t = await queryOne<any>('SELECT id FROM teachers WHERE user_id = ?', [req.user!.userId]);
  return t?.id ?? null;
}

const lectureSchema = z.object({
  // Must be a strict ISO date (YYYY-MM-DD). A free-form / locale date would either
  // fail the DATE NOT NULL insert or store 0000-00-00 and vanish from every report.
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'session_date must be YYYY-MM-DD'),
  teacher_id: z.number().int().nullable().optional(),
  subject_id: z.number().int().nullable().optional(),
  time_in: z.string().optional().nullable(),
  time_out: z.string().optional().nullable(),
  total_hours: z.number().optional(),
  topic: z.string().optional().nullable(),
  subtopic: z.string().optional().nullable(),
  remark: z.string().optional().nullable(),
  venue: z.string().optional().nullable(),
  meeting_link: z.string().optional().nullable(),
  branch_id: z.number().int().optional().nullable(),
  // one or more attendees (group lecture). Defaults hours to session total.
  attendees: z
    .array(
      z.object({
        student_id: z.number().int(),
        hours_consumed: z.number().optional(),
        attendance_status: z.enum(['Present', 'Absent', 'Late']).optional(),
        homework: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
        performance_rating: z.number().int().min(1).max(5).optional().nullable(),
      })
    )
    .min(1),
});

// LIST lectures — supports ?studentId=, ?month=YYYY-MM, ?from=&to= (date range)
router.get(
  '/',
  wrap(async (req, res) => {
    const u = req.user!;
    let studentId = req.query.studentId ? Number(req.query.studentId) : undefined;
    if ((u.role === 'student' || u.role === 'parent')) {
      studentId = u.studentId ?? -1; // force own scope
    }
    const where: string[] = [];
    const params: any[] = [];
    if (studentId) { where.push('a.student_id = ?'); params.push(studentId); }
    // Faculty only ever see their own lectures.
    if (u.role === 'faculty') {
      const tid = await myTeacherId(req);
      where.push('l.teacher_id = ?'); params.push(tid ?? -1);
    }
    if (req.query.month) { where.push('l.month = ?'); params.push(req.query.month); }
    if (req.query.from) { where.push('l.session_date >= ?'); params.push(req.query.from); }
    if (req.query.to) { where.push('l.session_date <= ?'); params.push(req.query.to); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await query(
      `SELECT l.id, l.session_date, l.month, l.time_in, l.time_out, l.total_hours,
              l.hours_rounded, l.topic, l.subtopic, l.remark, l.venue, l.meeting_link,
              t.name AS teacher_name, sub.name AS subject_name,
              a.student_id, s.form_no, s.full_name AS student_name, a.hours_consumed,
              a.attendance_status, a.homework, a.notes, a.performance_rating
       FROM lecture_sessions l
       JOIN lecture_attendees a ON a.lecture_id = l.id
       JOIN students s ON s.id = a.student_id
       LEFT JOIN teachers t ON t.id = l.teacher_id
       LEFT JOIN subjects sub ON sub.id = l.subject_id
       ${whereSql}
       ORDER BY l.session_date DESC, l.id DESC
       LIMIT 1000`,
      params
    );
    res.json({ data: rows });
  })
);

// CREATE lecture (faculty/admin). Auto-calc duration; decrement happens via the
// hours view (consumption = SUM of attendee hours), so we just record attendees.
router.post(
  '/',
  requireRole('admin', 'faculty'),
  wrap(async (req, res) => {
    const b = lectureSchema.parse(req.body);
    // Faculty can only log lectures under their own teacher id.
    let teacherId = b.teacher_id ?? null;
    if (req.user!.role === 'faculty') {
      teacherId = await myTeacherId(req);
      if (!teacherId) return res.status(403).json({ error: 'No teacher record linked to this account' });
    }
    let totalHours = b.total_hours;
    if (totalHours == null && b.time_in && b.time_out) {
      totalHours = timeToDecimalHours(b.time_in, b.time_out);
    }
    totalHours = totalHours ?? 0;
    const month = deriveMonth(b.session_date);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [r]: any = await conn.query(
        `INSERT INTO lecture_sessions
          (session_date,month,teacher_id,subject_id,time_in,time_out,total_hours,hours_rounded,topic,subtopic,remark,venue,meeting_link,branch_id,created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          b.session_date, month, teacherId, b.subject_id ?? null,
          b.time_in || null, b.time_out || null, totalHours, Math.round(totalHours * 2) / 2,
          b.topic || null, b.subtopic || null, b.remark || null, b.venue || null,
          b.meeting_link || null, b.branch_id ?? null, req.user!.userId,
        ]
      );
      const lectureId = r.insertId;
      for (const a of b.attendees) {
        await conn.query(
          `INSERT INTO lecture_attendees
            (lecture_id,student_id,hours_consumed,attendance_status,homework,notes,performance_rating)
           VALUES (?,?,?,?,?,?,?)`,
          [
            lectureId, a.student_id, a.hours_consumed ?? totalHours,
            a.attendance_status || 'Present', a.homework || null,
            a.notes || null, a.performance_rating ?? null,
          ]
        );
      }
      await conn.commit();
      await audit(req.user!.userId, 'CREATE', 'lecture', lectureId, null, b);
      res.status(201).json({ id: lectureId, total_hours: totalHours });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  })
);

// Upcoming / today's classes for a teacher
router.get(
  '/teacher/:teacherId',
  requireRole('admin', 'faculty'),
  wrap(async (req, res) => {
    const rows = await query(
      `SELECT l.*, sub.name AS subject_name,
              GROUP_CONCAT(s.full_name SEPARATOR ', ') AS students
       FROM lecture_sessions l
       LEFT JOIN subjects sub ON sub.id = l.subject_id
       JOIN lecture_attendees a ON a.lecture_id = l.id
       JOIN students s ON s.id = a.student_id
       WHERE l.teacher_id = ?
       GROUP BY l.id
       ORDER BY l.session_date DESC LIMIT 100`,
      [req.params.teacherId]
    );
    res.json({ data: rows });
  })
);

export default router;
