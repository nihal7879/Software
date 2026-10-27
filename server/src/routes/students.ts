import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { pool, query, queryOne } from '../db';
import { requireAuth, requireRole, ensureOwnStudent } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { audit } from '../utils/audit';
import { usernameProblem, passwordProblem } from '../utils/credentials';
import { clientIp, deviceInfo, getReqCtx } from '../utils/reqContext';
import { claimFormNo, formNoOrder } from '../utils/formNo';
import { today } from '../utils/dates';
import { needsApproval, requestApproval, noteProblem, applyStudentDelete } from '../utils/approvals';

const router = Router();
router.use(requireAuth);

const studentSchema = z.object({
  // form_no is system-assigned — T1, T2 … while on trial, an enrolment number
  // once enrolled. Never entered manually.
  form_no: z.string().optional(),
  date_of_joining: z.string().nullable().optional(),
  status: z.enum(['Active', 'Inactive']).default('Active'),
  // Whether this is a trial student. Independent of status: a trial can be
  // Active or Inactive, same as an enrolment.
  student_type: z.enum(['Trial', 'Enrolled']).default('Enrolled'),
  first_name: z.string().optional().nullable(),
  middle_name: z.string().optional().nullable(),
  last_name: z.string().optional().nullable(),
  year_grade: z.string().optional().nullable(),
  school_name: z.string().optional().nullable(),
  exam_board: z.string().optional().nullable(),
  father_name: z.string().optional().nullable(),
  father_mobile: z.string().optional().nullable(),
  // One address per person, beside their own number. The father and the mother
  // usually have different ones, and this is where a statement goes and where a
  // forgotten-password code is sent when the student has no address of their own.
  father_email: z.string().optional().nullable().or(z.literal('')),
  mother_name: z.string().optional().nullable(),
  mother_mobile: z.string().optional().nullable(),
  mother_email: z.string().optional().nullable().or(z.literal('')),
  guardian_name: z.string().optional().nullable(),
  guardian_mobile: z.string().optional().nullable(),
  guardian_email: z.string().optional().nullable().or(z.literal('')),
  // Null when nobody has been named yet — a record read and written back
  // carries that null, and it should not be an error.
  relationship: z.enum(['Father', 'Mother', 'Guardian']).nullable().optional(),
  // Contact email OR a plain username used as the student's login id.
  email: z.string().min(1).optional().nullable().or(z.literal('')),
  dob: z.string().optional().nullable(),
  age: z.number().int().optional().nullable(),
  gender: z.enum(['Male', 'Female', 'Other']).optional().nullable(),
  nationality: z.string().optional().nullable(),
  student_mobile: z.string().optional().nullable(),
  parent_mobile: z.string().optional().nullable(),
  extra_mobile: z.string().optional().nullable(),
  fees_received: z.number().optional().nullable(),
  // A yes/no that MySQL stores as 0/1 and hands back as a number. Anything
  // reading a student and writing it back returns the number, so both are
  // accepted rather than failing with "expected boolean, received number".
  form_received: z.union([z.boolean(), z.number().int().min(0).max(1)]).transform(Boolean).optional(),
  branch_id: z.number().int().optional().nullable(),
});

const fullName = (b: any) =>
  [b.first_name, b.middle_name, b.last_name].filter(Boolean).join(' ').trim();

// LIST (admin/faculty) with search + filters + pagination
router.get(
  '/',
  requireRole('admin', 'faculty'),
  wrap(async (req, res) => {
    const search = (req.query.search as string) || '';
    const status = req.query.status as string;
    const grade = req.query.grade as string;
    const board = req.query.board as string;
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(1000, Number(req.query.limit || 20));
    const offset = (page - 1) * limit;

    const where: string[] = ['is_deleted = FALSE'];
    const params: any[] = [];
    if (search) {
      where.push('(full_name LIKE ? OR form_no LIKE ? OR email LIKE ? OR parent_mobile LIKE ? OR student_mobile LIKE ? OR extra_mobile LIKE ? OR father_name LIKE ? OR mother_name LIKE ? OR year_grade LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like, like, like, like, like, like);
    }
    if (status) { where.push('status = ?'); params.push(status); }
    if (grade) { where.push('year_grade = ?'); params.push(grade); }
    if (board) { where.push('exam_board = ?'); params.push(board); }
    const studentType = req.query.student_type as string;
    if (studentType) { where.push('student_type = ?'); params.push(studentType); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await query(
      `SELECT * FROM students ${whereSql} ORDER BY ${formNoOrder()} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [{ total }] = await query<any>(
      `SELECT COUNT(*) AS total FROM students ${whereSql}`,
      params
    );
    res.json({ data: rows, page, limit, total });
  })
);

// GET one (own record for student/parent)
router.get(
  '/:id',
  ensureOwnStudent,
  wrap(async (req, res) => {
    const student = await queryOne<any>('SELECT * FROM students WHERE id = ?', [req.params.id]);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    // Expose the login the student registered with, so the profile can pre-fill
    // the Email field when no contact email was captured yet.
    if (student.user_id) {
      const u = await queryOne<any>('SELECT email FROM users WHERE id = ?', [student.user_id]);
      student.login_email = u?.email ?? null;
    }
    res.json(student);
  })
);

// CREATE
router.post(
  '/',
  requireRole('admin', 'faculty'),
  wrap(async (req, res) => {
    const b = studentSchema.parse(req.body);
    // Optional login: management can hand the student credentials at creation.
    const creds = z
      .object({
        // The login. Kept apart from the contact email now, like self-
        // registration; an older caller that sends only an email still works.
        username: z.string().trim().toLowerCase().optional(),
        password: z.string().optional(),
        // Free hours granted to a trial student.
        trial_hours: z.number().positive().optional(),
      })
      .parse(req.body);

    /**
     * An address is required to add a student.
     *
     * It is the only way back into an account nobody can get into: the
     * forgotten-password code has nowhere else to go, and an hours statement
     * has nowhere to be sent. 80 of the students already on the system have no
     * address anywhere, and each one is a phone call to the family to fix.
     * Enforced here rather than in studentSchema, because that schema is also
     * what a profile edit is read with, and an old record being corrected must
     * not be refused for a gap it already had.
     */
    const email = String(b.email ?? '').trim();
    if (!email) {
      return res.status(400).json({
        error: 'An email address is required to add a student — it is where their password reset and statements are sent.',
      });
    }

    /**
     * Is this person already on the system?
     *
     * Checked by name and by address, because a family registering twice does
     * it in one of two ways: the same child entered again by hand, or the same
     * address used for a second account. Both come back as a refusal the office
     * can read and then overrule — it is a warning, not a rule. Two children
     * really can share a name, and a family really does share one address.
     */
    if (req.body?.force !== true) {
      const name = fullName(b).trim();
      const dupes = await query<any>(
        `SELECT id, form_no, full_name, status, student_type, email, year_grade,
                parent_mobile, student_mobile, date_of_joining,
                (LOWER(TRIM(full_name)) = LOWER(?)) AS same_name,
                (LOWER(TRIM(COALESCE(email,''))) = LOWER(?)) AS same_email
           FROM students
          WHERE is_deleted = FALSE
            AND ( LOWER(TRIM(full_name)) = LOWER(?)
               OR (TRIM(COALESCE(email,'')) <> '' AND LOWER(TRIM(email)) = LOWER(?)) )
          ORDER BY (status = 'Active') DESC, id DESC
          LIMIT 10`,
        [name, email, name, email]
      );
      if (dupes.length) {
        const byName = dupes.some((d) => Number(d.same_name));
        const byEmail = dupes.some((d) => Number(d.same_email));
        const what = byName && byEmail ? 'name and email address'
          : byName ? 'name'
          : 'email address';
        return res.status(409).json({
          code: 'DUPLICATE_STUDENT',
          error: `A student with this ${what} is already on the system. Check it is not the same person, then add anyway if it is not.`,
          duplicates: dupes,
        });
      }
    }

    // If a login + password are given, create the student's login account first.
    let userId: number | null = null;
    const login = creds.username || b.email || '';
    if (login && creds.password) {
      if (creds.username) {
        const bad = usernameProblem(creds.username);
        if (bad) return res.status(400).json({ error: bad });
      }
      const weak = passwordProblem(creds.password, login);
      if (weak) return res.status(400).json({ error: weak });
      const exists = await queryOne<any>('SELECT id FROM users WHERE email = ?', [login]);
      if (exists) return res.status(409).json({ error: `The username "${login}" is already taken — choose another` });
      const hash = await bcrypt.hash(creds.password, 10);
      const ctx = getReqCtx();
      const gps = ctx?.lat != null && ctx?.lng != null ? `${ctx.lat},${ctx.lng}` : null;
      const u: any = await query(
        `INSERT INTO users (role, email, password_hash, display_name, registration_ip, registration_gps, registration_device)
         VALUES ('student', ?, ?, ?, ?, ?, ?)`,
        [login, hash, fullName(b) || login, clientIp(req), gps, deviceInfo(req)]
      );
      userId = (u as any).insertId;
    }

    // form_no is auto-assigned. Insert a temp unique value, then claim the real
    // number: a trial takes the next T-number, an enrolment the next form number.
    const result: any = await query(
      `INSERT INTO students
        (form_no,date_of_joining,status,student_type,trial_started_on,
         first_name,middle_name,last_name,full_name,
         year_grade,school_name,exam_board,father_name,mother_name,relationship,
         email,dob,age,gender,nationality,student_mobile,parent_mobile,extra_mobile,
         fees_received,form_received,branch_id,user_id,
         father_mobile,mother_mobile,guardian_name,guardian_mobile,
         father_email,mother_email,guardian_email)
       VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        b.date_of_joining || null, b.status, b.student_type,
        // A trial's clock starts on the joining date, or today if none given.
        b.student_type === 'Trial' ? (b.date_of_joining || today()) : null,
        b.first_name || null,
        b.middle_name || null, b.last_name || null, fullName(b), b.year_grade || null,
        b.school_name || null, b.exam_board || null, b.father_name || null,
        // Left null when not chosen — "who pays" is unknown, not assumed to be the father.
        b.mother_name || null, b.relationship || null, b.email || null, b.dob || null,
        b.age ?? null, b.gender || null, b.nationality || null, b.student_mobile || null,
        // parent_mobile is the number every list and search shows; with the
        // family contacts now entered one by one, it is the first one given.
        b.parent_mobile || b.father_mobile || b.mother_mobile || b.guardian_mobile || null,
        b.extra_mobile || null, b.fees_received ?? 0,
        b.form_received ?? false, b.branch_id ?? null, userId,
        b.father_mobile || null, b.mother_mobile || null, b.guardian_name || null, b.guardian_mobile || null,
        // Positional, like every value above: the column list and this array are
        // read together, and one missing entry shifts all of them.
        b.father_email || null, b.mother_email || null, b.guardian_email || null,
      ]
    );
    const id = (result as any).insertId;
    const formNo = await claimFormNo(id, b.student_type);

    // Trial hours are just a package at zero cost, so the existing hours ledger
    // counts them down and the statement screens show them with no extra logic.
    if (b.student_type === 'Trial' && creds.trial_hours) {
      await query(
        `INSERT INTO fee_packages (student_id,course_name,package_hours,rate_per_hour,start_date)
         VALUES (?,'Trial',?,0,CURDATE())`,
        [id, creds.trial_hours]
      );
    }

    await audit(req.user!.userId, 'CREATE', 'student', id, null, { ...b, password: undefined, form_no: formNo, login_created: !!userId });
    res.status(201).json({ id, form_no: formNo, login_created: !!userId });
  })
);

// UPDATE
router.put(
  '/:id',
  requireRole('admin', 'faculty'),
  wrap(async (req, res) => {
    const b = studentSchema.partial().parse(req.body);
    const before = await queryOne('SELECT * FROM students WHERE id = ?', [req.params.id]);
    if (!before) return res.status(404).json({ error: 'Student not found' });

    const fields: string[] = [];
    const params: any[] = [];
    for (const [k, v] of Object.entries(b)) {
      fields.push(`${k} = ?`);
      params.push(v);
    }
    if (b.first_name || b.middle_name || b.last_name) {
      fields.push('full_name = ?');
      params.push(fullName({ ...before, ...b }));
    }
    if (fields.length) {
      params.push(req.params.id);
      await query(`UPDATE students SET ${fields.join(', ')} WHERE id = ?`, params);
    }
    await audit(req.user!.userId, 'UPDATE', 'student', req.params.id, before, b);
    res.json({ ok: true });
  })
);

// Set status (Active / Inactive) — keeps is_active in sync. Admin only.
router.post(
  '/:id/set-status',
  requireRole('admin'),
  wrap(async (req, res) => {
    const b = z.object({ status: z.enum(['Active', 'Inactive']) }).parse(req.body);
    const isActive = b.status === 'Active';
    await query('UPDATE students SET status = ?, is_active = ? WHERE id = ?', [b.status, isActive, req.params.id]);
    // Keep the student's login in sync — an Inactive student can't sign in.
    await query('UPDATE users SET is_active = ? WHERE id = (SELECT user_id FROM students WHERE id = ?)', [isActive, req.params.id]);
    await audit(req.user!.userId, 'SET_STATUS', 'student', req.params.id, null, { status: b.status });
    res.json({ ok: true });
  })
);

// Convert a trial into a real enrolment.
//
// Deliberately flips the flag on the SAME student row rather than creating a
// new one, so the trial's lectures, login and parent record stay attached and
// the student keeps one continuous history. One-way on purpose.
//
// This is also where the student stops being T-something and joins the
// enrolment sequence: with 177 enrolled students the next one enrolled is 178.
// Their old T-number is recorded in the audit log, since anything printed or
// emailed during the trial still quotes it.
router.post(
  '/:id/convert',
  requireRole('admin'),
  wrap(async (req, res) => {
    const b = z
      .object({})
      .parse(req.body);

    const before = await queryOne<any>('SELECT * FROM students WHERE id = ?', [req.params.id]);
    if (!before) return res.status(404).json({ error: 'Student not found' });
    if (before.student_type !== 'Trial') {
      return res.status(409).json({ error: `${before.full_name} is already enrolled` });
    }

    await query(
      `UPDATE students SET student_type = 'Enrolled', converted_on = CURDATE(), converted_by = ?
       WHERE id = ?`,
      [req.user!.userId, req.params.id]
    );
    const formNo = await claimFormNo(req.params.id, 'Enrolled');

    await audit(req.user!.userId, 'CONVERT', 'student', req.params.id,
      { student_type: 'Trial', form_no: before.form_no },
      { student_type: 'Enrolled', form_no: formNo });
    res.json({ ok: true, form_no: formNo, previous_form_no: before.form_no });
  })
);

// ARCHIVE (soft -> Inactive)
router.post(
  '/:id/archive',
  requireRole('admin'),
  wrap(async (req, res) => {
    await query("UPDATE students SET status = 'Inactive', is_active = FALSE WHERE id = ?", [req.params.id]);
    await query('UPDATE users SET is_active = FALSE WHERE id = (SELECT user_id FROM students WHERE id = ?)', [req.params.id]);
    await audit(req.user!.userId, 'ARCHIVE', 'student', req.params.id, null, null);
    res.json({ ok: true });
  })
);

/**
 * Remove a student record — through the super admin, like the money.
 *
 * Archive and remove are different acts and both exist. Archiving is for a
 * child who has left: they stay on the list, their history stays reachable,
 * and one click puts them back. Removing is for a record that should never
 * have existed — a duplicate, a test row, a registration typed into the wrong
 * name — and it takes the record off every list.
 *
 * It is soft, like everything here, and it does not cascade: the student's
 * lectures and payments are left untouched. What it needs is the super admin,
 * for the same reason a payment does — the person who would notice the mistake
 * is the one who can no longer find the record.
 */
router.delete(
  '/:id',
  requireRole('admin'),
  wrap(async (req, res) => {
    const before = await queryOne<any>(
      'SELECT * FROM students WHERE id = ? AND is_deleted = FALSE', [req.params.id]);
    if (!before) return res.status(404).json({ error: 'Student not found' });

    const b = z.object({ request_note: z.string().optional() }).parse(req.body ?? {});

    // What is attached. The super admin reads this before deciding, and the
    // office is told before asking — "Form 74 has 12 payments behind her" is
    // the sentence that stops the wrong record being removed.
    const [{ payments, received }] = await query<any>(
      `SELECT COUNT(*) AS payments, COALESCE(SUM(amount),0) AS received
         FROM fee_transactions WHERE student_id = ? AND is_deleted = FALSE`,
      [req.params.id]
    );
    const [{ lectures }] = await query<any>(
      `SELECT COUNT(*) AS lectures FROM lecture_attendees a
         JOIN lecture_sessions l ON l.id = a.lecture_id
        WHERE a.student_id = ? AND a.is_deleted = FALSE AND l.is_deleted = FALSE`,
      [req.params.id]
    );

    /**
     * A student who has paid is archived, not removed.
     *
     * Their money stays on the books either way — the revenue total counts
     * fee_transactions and never asks whether the student is still listed — so
     * removing them leaves the figures standing with nobody behind them, and
     * the office looking for a student who is no longer anywhere. Archiving
     * does everything that was actually wanted and loses nothing.
     */
    if (Number(payments) > 0) {
      return res.status(409).json({
        code: 'STUDENT_HAS_PAYMENTS',
        error: `${before.full_name} has ${payments} payment${Number(payments) === 1 ? '' : 's'} on record (AED ${Number(received).toLocaleString()}). A student who has paid cannot be removed — archive them instead, which takes them off the active list and keeps the money where it belongs.`,
        payments: Number(payments),
        received: Number(received),
        lectures: Number(lectures),
      });
    }

    const who = `${before.form_no} — ${before.full_name}`;

    if (needsApproval(req.user!.role)) {
      const noteBad = noteProblem(b.request_note);
      if (noteBad) return res.status(400).json({ error: noteBad, field: 'request_note' });
      const id = await requestApproval({
        note: String(b.request_note).trim(),
        kind: 'student_delete',
        studentId: Number(req.params.id),
        payload: {
          form_no: before.form_no, full_name: before.full_name, status: before.status,
          student_type: before.student_type, email: before.email,
          date_of_joining: before.date_of_joining,
          attached: { payments: Number(payments), lectures: Number(lectures) },
        },
        targetType: 'student',
        targetId: Number(req.params.id),
        summary: `removing ${who}${Number(lectures) ? ` (${lectures} lecture rows)` : ' (nothing attached)'}`,
        userId: req.user!.userId,
      });
      return res.status(202).json({
        pending: true,
        approval_id: id,
        message: `Sent to the super admin for approval — removing ${who}. They stay on the list until it is approved.`,
      });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await applyStudentDelete(conn, req.params.id);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    await audit(req.user!.userId, 'DELETE', 'student', req.params.id, before,
      { reason: String(b.request_note ?? '').trim() || null, lectures: Number(lectures) });
    res.json({ ok: true, form_no: before.form_no, full_name: before.full_name });
  })
);

/**
 * Put a removed student back. The record was only marked, so this is the whole
 * of it — without this the row is there and nobody can reach it, which makes a
 * mistaken removal unrecoverable in practice even though nothing was erased.
 */
router.post(
  '/:id/restore',
  requireRole('admin'),
  wrap(async (req, res) => {
    const before = await queryOne<any>(
      'SELECT * FROM students WHERE id = ? AND is_deleted = TRUE', [req.params.id]);
    if (!before) return res.status(404).json({ error: 'No removed student with that id.' });
    // Comes back Inactive, never straight to Active: whoever puts them back
    // decides whether they are a current student, and that is one more click.
    await query("UPDATE students SET is_deleted = FALSE, status = 'Inactive' WHERE id = ?", [req.params.id]);
    await audit(req.user!.userId, 'RESTORE', 'student', req.params.id, before, null);
    res.json({ ok: true, form_no: before.form_no, full_name: before.full_name });
  })
);

// Self-service profile update (student updates own contact info)
router.patch(
  '/:id/profile',
  ensureOwnStudent,
  wrap(async (req, res) => {
    const b = z
      .object({
        email: z.string().email().optional(),
        student_mobile: z.string().optional(),
        parent_mobile: z.string().optional(),
        extra_mobile: z.string().optional(),
      })
      .parse(req.body);
    const fields = Object.keys(b).map((k) => `${k} = ?`);
    if (fields.length) {
      await query(`UPDATE students SET ${fields.join(', ')} WHERE id = ?`, [
        ...Object.values(b),
        req.params.id,
      ]);
    }
    res.json({ ok: true });
  })
);

// STUDENT "Complete Profile" submission — the post-login popup.
// Student fills ALL their Student Master details and Saves → goes to Management.
const completeSchema = studentSchema
  .omit({ form_no: true, fees_received: true }) // institute-managed; not student-editable
  .partial()
  .extend({ first_name: z.string().min(1) });

router.patch(
  '/:id/complete-profile',
  ensureOwnStudent,
  wrap(async (req, res) => {
    const b = completeSchema.parse(req.body);
    const before = await queryOne<any>('SELECT * FROM students WHERE id = ?', [req.params.id]);
    if (!before) return res.status(404).json({ error: 'Student not found' });

    const merged = { ...before, ...b };
    const full_name = [merged.first_name, merged.middle_name, merged.last_name].filter(Boolean).join(' ').trim();

    // The form asks for each family contact with their own number and no longer
    // asks "relationship to the child" or a shared "parent mobile". Both columns
    // are still read everywhere — relationship decides who pays, parent_mobile is
    // the number every list, search and roster shows — so they are derived here
    // from what was entered instead of being asked for twice.
    const txt = (v: any) => String(v ?? '').trim();
    const named = {
      Father: !!txt(merged.father_name),
      Mother: !!txt(merged.mother_name),
      Guardian: !!txt(merged.guardian_name),
    } as const;
    // Keep the existing payer while that person is still on the form; otherwise
    // the first person named, in the order the form lists them.
    const current = merged.relationship as keyof typeof named | undefined;
    const relationship = current && named[current]
      ? current
      : (['Father', 'Mother', 'Guardian'] as const).find((r) => named[r]) ?? merged.relationship ?? null;
    const mobileOf = { Father: merged.father_mobile, Mother: merged.mother_mobile, Guardian: merged.guardian_mobile };
    const parentMobile = [relationship && mobileOf[relationship as keyof typeof mobileOf], merged.father_mobile, merged.mother_mobile, merged.guardian_mobile]
      .map(txt).find(Boolean);
    delete (b as any).relationship;
    delete (b as any).parent_mobile;

    const cols: string[] = [];
    const params: any[] = [];
    const set = (c: string, v: any) => { cols.push(`${c} = ?`); params.push(v); };
    for (const [k, v] of Object.entries(b)) set(k, v as any);
    set('full_name', full_name);
    if (relationship) set('relationship', relationship);
    // Only overwrite when there is a number to put there — an older profile
    // saved before these fields existed keeps its parent_mobile.
    if (parentMobile) set('parent_mobile', parentMobile);
    set('profile_completed', true);
    cols.push('profile_submitted_at = NOW()');
    params.push(req.params.id);

    await query(`UPDATE students SET ${cols.join(', ')} WHERE id = ?`, params);
    await audit(req.user!.userId, 'COMPLETE_PROFILE', 'student', req.params.id, before, b);
    res.json({ ok: true, profile_completed: true });
  })
);

export default router;
