import { Router, Request } from 'express';
import { z } from 'zod';
import { pool, query, queryOne } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { timeToDecimalHours, deriveMonth } from '../utils/hours';
import { audit } from '../utils/audit';
import { blockLockedStudents } from '../utils/settings';

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
// (A student's request is refused while student dashboards are locked.)
router.get(
  '/',
  blockLockedStudents,
  wrap(async (req, res) => {
    const u = req.user!;
    let studentId = req.query.studentId ? Number(req.query.studentId) : undefined;
    if ((u.role === 'student' || u.role === 'parent')) {
      studentId = u.studentId ?? -1; // force own scope
    }
    const where: string[] = ['l.is_deleted = FALSE'];
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
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const rows = await query(
      `SELECT l.id, l.session_date, l.month, l.time_in, l.time_out, l.total_hours,
              l.hours_rounded, l.topic, l.subtopic, l.remark, l.venue, l.meeting_link,
              t.name AS teacher_name, sub.name AS subject_name,
              a.student_id, s.form_no, s.full_name AS student_name, a.hours_consumed,
              a.attendance_status, a.homework, a.notes, a.performance_rating
       FROM lecture_sessions l
       JOIN lecture_attendees a ON a.lecture_id = l.id AND a.is_deleted = FALSE
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

// One lecture and its attendees, written on an open transaction. Shared by the
// single create below and the batch save the entry grid uses.
async function insertLecture(conn: any, b: any, teacherId: number | null, userId: number) {
  let totalHours = b.total_hours;
  if (totalHours == null && b.time_in && b.time_out) {
    totalHours = timeToDecimalHours(b.time_in, b.time_out);
  }
  totalHours = totalHours ?? 0;
  const month = deriveMonth(b.session_date);

  const [r]: any = await conn.query(
    `INSERT INTO lecture_sessions
      (session_date,month,teacher_id,subject_id,time_in,time_out,total_hours,hours_rounded,topic,subtopic,remark,venue,meeting_link,branch_id,created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      b.session_date, month, teacherId, b.subject_id ?? null,
      b.time_in || null, b.time_out || null, totalHours, Math.round(totalHours * 2) / 2,
      b.topic || null, b.subtopic || null, b.remark || null, b.venue || null,
      b.meeting_link || null, b.branch_id ?? null, userId,
    ]
  );
  const lectureId = r.insertId;
  for (const a of b.attendees) {
    // A student taken off this lecture before is only marked removed, and the
    // (lecture, student) pair is unique — so putting them back updates that
    // same row rather than failing on the key.
    await conn.query(
      `INSERT INTO lecture_attendees
        (lecture_id,student_id,hours_consumed,attendance_status,homework,notes,performance_rating)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         hours_consumed = VALUES(hours_consumed),
         attendance_status = VALUES(attendance_status),
         homework = VALUES(homework),
         notes = VALUES(notes),
         performance_rating = VALUES(performance_rating),
         is_deleted = FALSE`,
      [
        lectureId, a.student_id, a.hours_consumed ?? totalHours,
        a.attendance_status || 'Present', a.homework || null,
        a.notes || null, a.performance_rating ?? null,
      ]
    );
  }
  return { id: lectureId, total_hours: totalHours };
}

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

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const made = await insertLecture(conn, b, teacherId, req.user!.userId);
      await conn.commit();
      await audit(req.user!.userId, 'CREATE', 'lecture', made.id, null, b);
      res.status(201).json(made);
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  })
);

// CREATE several lectures at once — the entry grid, where a teacher fills a
// day's classes as rows and saves them together. All or nothing: a row that
// fails takes the whole save with it, so the grid is never half written and the
// teacher never has to work out which rows got through.
router.post(
  '/batch',
  requireRole('admin', 'faculty'),
  wrap(async (req, res) => {
    const rows = z.array(lectureSchema).min(1, 'Add at least one row').max(50).parse(req.body?.lectures);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const made = [];
      for (const b of rows) {
        let teacherId = b.teacher_id ?? null;
        if (req.user!.role === 'faculty') {
          teacherId = await myTeacherId(req);
          if (!teacherId) {
            await conn.rollback();
            return res.status(403).json({ error: 'No teacher record linked to this account' });
          }
        }
        made.push(await insertLecture(conn, b, teacherId, req.user!.userId));
      }
      await conn.commit();
      for (const m of made) await audit(req.user!.userId, 'CREATE', 'lecture', m.id, null, { batch: true });
      res.status(201).json({
        created: made.length,
        total_hours: made.reduce((a, m) => a + Number(m.total_hours || 0), 0),
        ids: made.map((m) => m.id),
      });
    } catch (e: any) {
      await conn.rollback();
      // A student or teacher that has since gone is the one failure the grid can
      // reach; say so plainly rather than handing back the database's wording.
      if (e?.code === 'ER_NO_REFERENCED_ROW_2' || e?.code === 'ER_NO_REFERENCED_ROW') {
        return res.status(400).json({ error: 'A student or teacher on one of the rows no longer exists — nothing was saved.' });
      }
      throw e;
    } finally {
      conn.release();
    }
  })
);

// EDIT a lecture (admin). Times drive the duration, so changing them re-derives
// total_hours — and with it every attendee's hours_consumed, which is what the
// student's ledger actually reads. Attendees themselves are not edited here;
// this is the "I typed the wrong time / topic / teacher" repair.
const lectureEditSchema = lectureSchema.omit({ attendees: true }).partial();

router.put(
  '/:id',
  requireRole('admin'),
  wrap(async (req, res) => {
    const b = lectureEditSchema.parse(req.body);
    const before = await queryOne<any>('SELECT * FROM lecture_sessions WHERE id = ? AND is_deleted = FALSE', [req.params.id]);
    if (!before) return res.status(404).json({ error: 'Lecture not found' });

    const merged = { ...before, ...b };
    const timeIn = merged.time_in || null;
    const timeOut = merged.time_out || null;
    const totalHours = b.total_hours ?? (timeIn && timeOut ? timeToDecimalHours(timeIn, timeOut) : Number(before.total_hours) || 0);
    const sessionDate = String(merged.session_date).slice(0, 10);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `UPDATE lecture_sessions
            SET session_date = ?, month = ?, teacher_id = ?, subject_id = ?, time_in = ?, time_out = ?,
                total_hours = ?, hours_rounded = ?, topic = ?, subtopic = ?, remark = ?, venue = ?, meeting_link = ?
          WHERE id = ?`,
        [
          sessionDate, deriveMonth(sessionDate), merged.teacher_id ?? null, merged.subject_id ?? null,
          timeIn, timeOut, totalHours, Math.round(totalHours * 2) / 2,
          merged.topic || null, merged.subtopic || null, merged.remark || null,
          merged.venue || null, merged.meeting_link || null, req.params.id,
        ]
      );
      // Attendees are created carrying the session total, so they follow it here.
      if (Number(before.total_hours) !== totalHours) {
        await conn.query('UPDATE lecture_attendees SET hours_consumed = ? WHERE lecture_id = ? AND is_deleted = FALSE', [totalHours, req.params.id]);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    await audit(req.user!.userId, 'UPDATE', 'lecture', req.params.id, before, { ...b, total_hours: totalHours });
    res.json({ ok: true, total_hours: totalHours });
  })
);

// DELETE a lecture (admin) — soft delete. Every hours query filters on
// is_deleted, so the attendees' consumed hours come back to the students.
router.delete(
  '/:id',
  requireRole('admin'),
  wrap(async (req, res) => {
    const before = await queryOne<any>('SELECT * FROM lecture_sessions WHERE id = ? AND is_deleted = FALSE', [req.params.id]);
    if (!before) return res.status(404).json({ error: 'Lecture not found' });
    await query('UPDATE lecture_sessions SET is_deleted = TRUE WHERE id = ?', [req.params.id]);
    await audit(req.user!.userId, 'DELETE', 'lecture', req.params.id, before, null);
    res.json({ ok: true });
  })
);

// A teacher's lectures, each with the students recorded on it (admin) — for the
// Teachers page, where a wrongly added student can be taken off a lecture.
// Newest first, a page at a time (?page=&limit=); optional ?from=&to=
// (YYYY-MM-DD) narrows the dates. The totals cover every lecture in the filter,
// not just the page shown.
router.get(
  '/by-teacher/:teacherId',
  requireRole('admin'),
  wrap(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const where = ['l.teacher_id = ?', 'l.is_deleted = FALSE'];
    const params: any[] = [req.params.teacherId];
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (iso.test(String(req.query.from || ''))) { where.push('l.session_date >= ?'); params.push(req.query.from); }
    if (iso.test(String(req.query.to || ''))) { where.push('l.session_date <= ?'); params.push(req.query.to); }

    const [sessions, [totals]] = await Promise.all([
      query<any>(
        // Everything the Edit Lecture window needs, as well as what the list shows.
        `SELECT l.id, l.id AS lecture_id, l.session_date, l.time_in, l.time_out, l.total_hours,
                l.teacher_id, l.subject_id, l.topic, l.subtopic, l.remark, l.venue, l.meeting_link,
                sub.name AS subject_name
           FROM lecture_sessions l
           LEFT JOIN subjects sub ON sub.id = l.subject_id
          WHERE ${where.join(' AND ')}
          ORDER BY l.session_date DESC, l.time_in DESC, l.id DESC
          LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
      query<any>(
        `SELECT COUNT(*) AS total, COALESCE(SUM(l.total_hours), 0) AS total_hours
           FROM lecture_sessions l WHERE ${where.join(' AND ')}`,
        params
      ),
    ]);
    const meta = { page, limit, total: Number(totals.total) || 0, total_hours: Number(totals.total_hours) || 0 };
    if (sessions.length === 0) return res.json({ data: [], ...meta });

    const attendees = await query<any>(
      `SELECT a.lecture_id, a.student_id, a.hours_consumed, s.form_no, s.full_name, s.status
         FROM lecture_attendees a JOIN students s ON s.id = a.student_id
        WHERE a.lecture_id IN (?) AND a.is_deleted = FALSE
        ORDER BY s.full_name`,
      [sessions.map((l) => l.id)]
    );
    const byLecture = new Map<number, any[]>();
    for (const a of attendees) {
      if (!byLecture.has(a.lecture_id)) byLecture.set(a.lecture_id, []);
      byLecture.get(a.lecture_id)!.push(a);
    }
    res.json({ data: sessions.map((l) => ({ ...l, students: byLecture.get(l.id) || [] })), ...meta });
  })
);

// Take a student off a lecture they were wrongly recorded on (admin). Their
// hours for it come back at once — consumed hours are the sum of attendee rows.
// The last student cannot be removed: a lecture with nobody on it is not a
// lecture, so that is a job for deleting the lecture itself.
router.delete(
  '/:id/attendees/:studentId',
  requireRole('admin'),
  wrap(async (req, res) => {
    const lecture = await queryOne<any>('SELECT id, session_date, teacher_id FROM lecture_sessions WHERE id = ? AND is_deleted = FALSE', [req.params.id]);
    if (!lecture) return res.status(404).json({ error: 'Lecture not found' });
    const row = await queryOne<any>('SELECT * FROM lecture_attendees WHERE lecture_id = ? AND student_id = ? AND is_deleted = FALSE', [lecture.id, req.params.studentId]);
    if (!row) return res.status(404).json({ error: 'That student is not on this lecture.' });
    const others = await queryOne<any>('SELECT COUNT(*) AS n FROM lecture_attendees WHERE lecture_id = ? AND student_id <> ? AND is_deleted = FALSE', [lecture.id, req.params.studentId]);
    if (!Number(others?.n)) {
      return res.status(400).json({ error: 'This is the only student on the lecture. To remove it completely, delete the lecture instead.' });
    }
    // Marked removed, not deleted: the row stays for the record and can be put
    // back. Every query that counts attendance skips is_deleted rows, so the
    // student's hours come back immediately either way.
    await query('UPDATE lecture_attendees SET is_deleted = TRUE WHERE id = ?', [row.id]);
    await audit(req.user!.userId, 'REMOVE_ATTENDEE', 'lecture', lecture.id, row, { removed_student_id: row.student_id });
    res.json({ ok: true, hours_returned: Number(row.hours_consumed) || 0 });
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
       JOIN lecture_attendees a ON a.lecture_id = l.id AND a.is_deleted = FALSE
       JOIN students s ON s.id = a.student_id
       WHERE l.teacher_id = ? AND l.is_deleted = FALSE
       GROUP BY l.id
       ORDER BY l.session_date DESC LIMIT 100`,
      [req.params.teacherId]
    );
    res.json({ data: rows });
  })
);

export default router;
