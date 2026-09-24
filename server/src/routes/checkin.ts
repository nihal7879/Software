import { Router } from 'express';
import { z } from 'zod';
import { pool, query, queryOne } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { audit } from '../utils/audit';
import { teacherByCode } from '../utils/qrCode';
import { insertLecture } from './lectures';
import { clientIp, deviceInfo, getReqCtx } from '../utils/reqContext';

/**
 * QR check-in. A student signed into the app scans the code on their teacher's
 * desk at the start of the class, and again at the end.
 *
 * One row per student, never a batch: the first scan opens their row with the
 * time in, the second closes it with the time out. The teacher then fills in the
 * subject and topic in their inbox and confirms it, and only then does it become
 * a lecture and touch anybody's hours. A stray scan costs nothing.
 *
 * Every time here comes from the server, never the phone, so a student whose
 * clock is wrong — or deliberately changed — records the same moment as
 * everyone else. The connection runs on Dubai time.
 */
const router = Router();
router.use(requireAuth);

// A second scan within this many minutes of the first is the same tap twice,
// not the end of the class.
const DOUBLE_TAP_MINUTES = 2;

const codeSchema = z.object({ code: z.string().trim().min(4).max(32) });

router.post(
  '/',
  requireRole('student'),
  wrap(async (req, res) => {
    const { code } = codeSchema.parse(req.body);
    const studentId = req.user!.studentId;
    if (!studentId) return res.status(403).json({ error: 'This login is not linked to a student.' });

    const teacher = await teacherByCode(code);
    if (!teacher) return res.status(404).json({ error: "That isn't a class QR code." });
    if (!teacher.is_active) return res.status(400).json({ error: `${teacher.name} is no longer taking classes.` });

    const student = await queryOne<any>(
      "SELECT id, full_name, status FROM students WHERE id = ? AND is_deleted = FALSE",
      [studentId]
    );
    if (!student) return res.status(404).json({ error: 'Student not found.' });
    if (student.status !== 'Active') {
      return res.status(403).json({ error: "Your account isn't active. Please speak to the office." });
    }

    // Where the scan came from, for checking a disputed attendance later. The
    // GPS is whatever the browser gave; it is recorded, never enforced.
    const ctx = getReqCtx();
    const gps = ctx?.lat != null && ctx?.lng != null ? `${ctx.lat},${ctx.lng}` : null;
    const where = [clientIp(req), gps, deviceInfo(req)] as const;

    // Their open row with this teacher — scanned in, not yet out. Yesterday's
    // forgotten row is left alone: a new day starts a new row, and the teacher
    // sorts the old one out when confirming.
    const open = await queryOne<any>(
      `SELECT id, in_at, session_date,
              TIMESTAMPDIFF(MINUTE, in_at, NOW()) AS minutes_in
         FROM lecture_checkins
        WHERE student_id = ? AND teacher_id = ? AND out_at IS NULL
          AND status = 'Pending' AND is_deleted = FALSE
          AND session_date = CURDATE()
        ORDER BY id DESC LIMIT 1`,
      [studentId, teacher.id]
    );

    // ---- second scan: they are leaving ------------------------------------
    if (open) {
      if (Number(open.minutes_in) < DOUBLE_TAP_MINUTES) {
        return res.json({
          action: 'already_in',
          teacher: teacher.name,
          in_at: open.in_at,
          message: `You're already checked in with ${teacher.name}.`,
        });
      }
      await query(
        `UPDATE lecture_checkins
            SET out_at = NOW(),
                hours = ROUND(TIMESTAMPDIFF(MINUTE, in_at, NOW()) / 60, 2)
          WHERE id = ?`,
        [open.id]
      );
      const done = await queryOne<any>('SELECT in_at, out_at, hours FROM lecture_checkins WHERE id = ?', [open.id]);
      await audit(req.user!.userId, 'CHECK_OUT', 'student', String(studentId), null, { teacher_id: teacher.id, checkin_id: open.id });
      return res.json({
        action: 'out',
        teacher: teacher.name,
        in_at: done?.in_at,
        out_at: done?.out_at,
        hours: Number(done?.hours ?? 0),
        message: `Checked out of ${teacher.name}'s class.`,
      });
    }

    // ---- first scan: they are arriving -------------------------------------
    const r: any = await query(
      `INSERT INTO lecture_checkins
         (teacher_id, student_id, session_date, in_at, scanned_ip, scanned_gps, scanned_device)
       VALUES (?,?,CURDATE(),NOW(),?,?,?)`,
      [teacher.id, studentId, ...where]
    );
    const made = await queryOne<any>('SELECT in_at FROM lecture_checkins WHERE id = ?', [r.insertId]);
    await audit(req.user!.userId, 'CHECK_IN', 'student', String(studentId), null, { teacher_id: teacher.id, checkin_id: r.insertId });
    res.status(201).json({
      action: 'in',
      teacher: teacher.name,
      in_at: made?.in_at,
      message: `Checked in with ${teacher.name}. Scan again when the class ends.`,
    });
  })
);

/** The student's own scans today, so the screen can show where they stand. */
router.get(
  '/mine',
  requireRole('student'),
  wrap(async (req, res) => {
    const rows = await query(
      `SELECT c.id, c.session_date, c.in_at, c.out_at, c.hours, c.status, t.name AS teacher_name
         FROM lecture_checkins c JOIN teachers t ON t.id = c.teacher_id
        WHERE c.student_id = ? AND c.is_deleted = FALSE
        ORDER BY c.id DESC LIMIT 20`,
      [req.user!.studentId ?? -1]
    );
    res.json({ data: rows });
  })
);

// ---------------------------------------------------------------------------
// The teacher's inbox: scanned rows waiting to be turned into lectures.
//
// One row per student, like an imported payment waiting in Finance. The teacher
// fills the subject and topic — on one row, or on several at once — then
// confirms, and each row becomes its own lecture for that one student.
// ---------------------------------------------------------------------------

/** Whose rows: a teacher sees their own, an admin picks the teacher. */
async function inboxTeacherId(req: any): Promise<number | null> {
  if (req.user.role === 'faculty') {
    const t = await queryOne<any>('SELECT id FROM teachers WHERE user_id = ? AND is_deleted = FALSE', [req.user.userId]);
    return t?.id ?? null;
  }
  return req.query.teacherId ? Number(req.query.teacherId) : null;
}

const INBOX_COLUMNS = `
  c.id, c.session_date, c.in_at, c.out_at, c.hours, c.status,
  c.subject_id, c.topic, c.subtopic, c.remark, c.venue, c.meeting_link,
  c.student_id, s.full_name AS student_name, s.form_no,
  c.teacher_id, t.name AS teacher_name, sub.name AS subject_name,
  c.lecture_id, c.confirmed_at, c.scanned_ip, c.scanned_gps,
  -- No trace of a scan means the teacher put this student in by hand, because
  -- they came without a phone. Worth showing: it is attendance nobody scanned.
  (c.scanned_ip IS NULL AND c.scanned_device IS NULL) AS added_by_hand`;

router.get(
  '/inbox',
  requireRole('faculty', 'admin'),
  wrap(async (req, res) => {
    const teacherId = await inboxTeacherId(req);
    if (req.user!.role === 'faculty' && !teacherId) {
      return res.status(403).json({ error: 'No teacher record linked to this account' });
    }
    // Pending by default: what still needs a subject and a topic. The date
    // filter is open so yesterday's forgotten rows stay reachable.
    const status = ['Pending', 'Confirmed', 'Discarded'].includes(String(req.query.status))
      ? String(req.query.status) : 'Pending';
    const where = ['c.is_deleted = FALSE', 'c.status = ?'];
    const params: any[] = [status];
    if (teacherId) { where.push('c.teacher_id = ?'); params.push(teacherId); }
    if (req.query.date) { where.push('c.session_date = ?'); params.push(req.query.date); }

    const rows = await query(
      `SELECT ${INBOX_COLUMNS}
         FROM lecture_checkins c
         JOIN students s ON s.id = c.student_id
         JOIN teachers t ON t.id = c.teacher_id
         LEFT JOIN subjects sub ON sub.id = c.subject_id
        WHERE ${where.join(' AND ')}
        ORDER BY c.session_date DESC, c.in_at DESC
        LIMIT 500`,
      params
    );
    res.json({ data: rows });
  })
);

/**
 * A student who was in the class but never scanned — no phone, a flat battery,
 * a camera that would not open. The teacher puts them in by hand and the row
 * joins the others in the inbox, to be filled in and confirmed the same way.
 * Nothing is stamped as scanned, so the record stays honest about where it
 * came from.
 */
const manualSchema = z.object({
  student_ids: z.array(z.number().int()).min(1).max(60),
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  in_time: z.string().regex(/^\d{2}:\d{2}$/),
  out_time: z.string().regex(/^\d{2}:\d{2}$/),
  teacher_id: z.number().int().optional(),
});

router.post(
  '/manual',
  requireRole('faculty', 'admin'),
  wrap(async (req, res) => {
    const b = manualSchema.parse(req.body);
    const teacherId = req.user!.role === 'faculty' ? await inboxTeacherId(req) : b.teacher_id ?? null;
    if (!teacherId) return res.status(400).json({ error: 'Which teacher was this class with?' });

    const inAt = `${b.session_date} ${b.in_time}:00`;
    const outAt = `${b.session_date} ${b.out_time}:00`;
    const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const hours = Math.round(((mins(b.out_time) - mins(b.in_time)) / 60) * 100) / 100;
    if (!(hours > 0)) return res.status(400).json({ error: 'The end time must be after the start time.' });

    const added: number[] = [];
    const skipped: { student_id: number; reason: string }[] = [];
    for (const studentId of b.student_ids) {
      const student = await queryOne<any>(
        "SELECT id, full_name FROM students WHERE id = ? AND is_deleted = FALSE AND status = 'Active'",
        [studentId]
      );
      if (!student) { skipped.push({ student_id: studentId, reason: 'Not an active student' }); continue; }

      // They may have scanned after all, or been added twice — one row per
      // student per class, so nobody is charged the same hour twice.
      const already = await queryOne<any>(
        `SELECT id FROM lecture_checkins
          WHERE student_id = ? AND teacher_id = ? AND session_date = ?
            AND status = 'Pending' AND is_deleted = FALSE LIMIT 1`,
        [studentId, teacherId, b.session_date]
      );
      if (already) { skipped.push({ student_id: studentId, reason: `${student.full_name} is already on this day` }); continue; }

      const r: any = await query(
        `INSERT INTO lecture_checkins (teacher_id, student_id, session_date, in_at, out_at, hours)
         VALUES (?,?,?,?,?,?)`,
        [teacherId, studentId, b.session_date, inAt, outAt, hours]
      );
      await audit(req.user!.userId, 'ADD_CHECKIN', 'student', String(studentId), null,
        { teacher_id: teacherId, session_date: b.session_date, hours, by_hand: true });
      added.push(r.insertId);
    }
    res.status(added.length ? 201 : 400).json({ added: added.length, skipped, hours });
  })
);

/** The fields a teacher fills in, plus the times when a scan was missed. */
const fillSchema = z.object({
  subject_id: z.number().int().nullable().optional(),
  topic: z.string().trim().max(200).nullable().optional(),
  subtopic: z.string().trim().max(200).nullable().optional(),
  remark: z.string().trim().max(500).nullable().optional(),
  venue: z.string().trim().max(80).nullable().optional(),
  meeting_link: z.string().trim().max(255).nullable().optional(),
  // 'HH:MM' — for the student who forgot to scan out.
  in_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  out_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

/** May this person touch this row? A teacher only their own. */
async function rowFor(req: any, id: string) {
  const row = await queryOne<any>(
    'SELECT * FROM lecture_checkins WHERE id = ? AND is_deleted = FALSE',
    [id]
  );
  if (!row) return { error: 'That check-in no longer exists.' as const, row: null };
  if (req.user.role === 'faculty') {
    const mine = await inboxTeacherId(req);
    if (!mine || Number(row.teacher_id) !== mine) {
      return { error: 'You can only work on your own classes.' as const, row: null };
    }
  }
  return { error: null, row };
}

/** Record an edit with both sides of it, so an overwritten scan is not lost. */
async function auditEdit(req: any, before: any, bulk = false) {
  const after = await queryOne<any>('SELECT * FROM lecture_checkins WHERE id = ?', [before.id]);
  const timesMoved = String(before.in_at) !== String(after?.in_at) || String(before.out_at) !== String(after?.out_at);
  await audit(req.user.userId, timesMoved ? 'EDIT_CHECKIN_TIME' : 'EDIT_CHECKIN', 'student',
    String(before.student_id), before, { ...after, bulk: bulk || undefined });
}

/** Write the filled-in fields onto one row, and re-derive the hours if the times moved. */
async function applyFields(id: number, b: z.infer<typeof fillSchema>, sessionDate: string) {
  const cols: string[] = [];
  const params: any[] = [];
  for (const k of ['subject_id', 'topic', 'subtopic', 'remark', 'venue', 'meeting_link'] as const) {
    if (b[k] !== undefined) { cols.push(`${k} = ?`); params.push(b[k] === '' ? null : b[k]); }
  }
  if (b.in_time) { cols.push('in_at = ?'); params.push(`${sessionDate} ${b.in_time}:00`); }
  if (b.out_time) { cols.push('out_at = ?'); params.push(`${sessionDate} ${b.out_time}:00`); }
  if (b.in_time || b.out_time) {
    cols.push('hours = ROUND(TIMESTAMPDIFF(MINUTE, in_at, out_at) / 60, 2)');
  }
  if (!cols.length) return;
  params.push(id);
  await query(`UPDATE lecture_checkins SET ${cols.join(', ')} WHERE id = ?`, params);
}

// Fill in one row.
router.patch(
  '/:id',
  requireRole('faculty', 'admin'),
  wrap(async (req, res) => {
    const { error, row } = await rowFor(req, req.params.id);
    if (error) return res.status(403).json({ error });
    if (row.status !== 'Pending') return res.status(400).json({ error: 'This one has already been handled.' });
    const b = fillSchema.parse(req.body);
    await applyFields(row.id, b, String(row.session_date).slice(0, 10));
    await auditEdit(req, row);
    res.json({ ok: true });
  })
);

// The same subject and topic on several rows at once — the day's classes are
// usually the same lesson repeated, so they are filled in together.
router.post(
  '/apply',
  requireRole('faculty', 'admin'),
  wrap(async (req, res) => {
    const b = z.object({ ids: z.array(z.number().int()).min(1).max(100) }).and(fillSchema).parse(req.body);
    let applied = 0;
    for (const id of b.ids) {
      const { error, row } = await rowFor(req, String(id));
      if (error || row.status !== 'Pending') continue;
      await applyFields(row.id, b, String(row.session_date).slice(0, 10));
      await auditEdit(req, row, true);
      applied++;
    }
    res.json({ ok: true, applied });
  })
);

// Confirm: the row becomes a lecture for that one student, charged their own
// time. Nothing before this touches hours.
async function confirmOne(req: any, id: number): Promise<{ ok: boolean; reason?: string }> {
  const { error, row } = await rowFor(req, String(id));
  if (error) return { ok: false, reason: error };
  if (row.status !== 'Pending') return { ok: false, reason: 'Already handled' };
  if (!row.out_at) return { ok: false, reason: 'No time out yet — set one first' };

  const date = String(row.session_date).slice(0, 10);
  const timeOf = (v: any) => String(v).slice(11, 19) || null;
  const hours = Number(row.hours ?? 0);
  if (!(hours > 0)) return { ok: false, reason: 'The times do not make a length' };

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const made = await insertLecture(
      conn,
      {
        session_date: date,
        subject_id: row.subject_id ?? null,
        time_in: timeOf(row.in_at),
        time_out: timeOf(row.out_at),
        total_hours: hours,
        topic: row.topic, subtopic: row.subtopic, remark: row.remark,
        venue: row.venue, meeting_link: row.meeting_link,
        // Their own in-to-out time, not a shared class length.
        attendees: [{ student_id: row.student_id, hours_consumed: hours }],
      },
      row.teacher_id,
      req.user.userId
    );
    await conn.query(
      "UPDATE lecture_checkins SET status = 'Confirmed', lecture_id = ?, confirmed_by = ?, confirmed_at = NOW() WHERE id = ?",
      [made.id, req.user.userId, row.id]
    );
    await conn.commit();
    await audit(req.user.userId, 'CONFIRM_CHECKIN', 'lecture', made.id, row, { checkin_id: row.id, hours });
    return { ok: true };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

router.post(
  '/:id/confirm',
  requireRole('faculty', 'admin'),
  wrap(async (req, res) => {
    const r = await confirmOne(req, Number(req.params.id));
    if (!r.ok) return res.status(400).json({ error: r.reason });
    res.json({ ok: true });
  })
);

// Confirm several at once, once they have all been filled in.
router.post(
  '/confirm',
  requireRole('faculty', 'admin'),
  wrap(async (req, res) => {
    const { ids } = z.object({ ids: z.array(z.number().int()).min(1).max(100) }).parse(req.body);
    const done: number[] = [];
    const skipped: { id: number; reason?: string }[] = [];
    for (const id of ids) {
      const r = await confirmOne(req, id);
      if (r.ok) done.push(id); else skipped.push({ id, reason: r.reason });
    }
    res.json({ confirmed: done.length, skipped });
  })
);

// A scan that should not have happened — marked discarded, never erased.
router.delete(
  '/:id',
  requireRole('faculty', 'admin'),
  wrap(async (req, res) => {
    const { error, row } = await rowFor(req, req.params.id);
    if (error) return res.status(403).json({ error });
    if (row.status === 'Confirmed') {
      return res.status(400).json({ error: 'This one is already a lecture. Delete the lecture instead.' });
    }
    await query("UPDATE lecture_checkins SET status = 'Discarded' WHERE id = ?", [row.id]);
    await audit(req.user!.userId, 'DISCARD_CHECKIN', 'student', String(row.student_id), row, null);
    res.json({ ok: true });
  })
);

export default router;
