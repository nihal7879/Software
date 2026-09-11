import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { query, queryOne } from '../db';
import { requireAuth, requireRole, ensureOwnStudent } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { audit } from '../utils/audit';
import { usernameProblem, passwordProblem } from '../utils/credentials';
import { clientIp, deviceInfo, getReqCtx } from '../utils/reqContext';
import { claimFormNo, formNoOrder } from '../utils/formNo';

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
  mother_name: z.string().optional().nullable(),
  mother_mobile: z.string().optional().nullable(),
  guardian_name: z.string().optional().nullable(),
  guardian_mobile: z.string().optional().nullable(),
  relationship: z.enum(['Father', 'Mother', 'Guardian']).optional(),
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
  form_received: z.boolean().optional(),
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
         father_mobile,mother_mobile,guardian_name,guardian_mobile)
       VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        b.date_of_joining || null, b.status, b.student_type,
        // A trial's clock starts on the joining date, or today if none given.
        b.student_type === 'Trial' ? (b.date_of_joining || new Date().toISOString().slice(0, 10)) : null,
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
      .object({
        // Optionally record the first paid package in the same step.
        package_hours: z.number().positive().optional(),
        rate_per_hour: z.number().nonnegative().optional(),
      })
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

    let packageId: number | null = null;
    if (b.package_hours) {
      const pkg: any = await query(
        `INSERT INTO fee_packages (student_id,package_hours,rate_per_hour,start_date)
         VALUES (?,?,?,CURDATE())`,
        [req.params.id, b.package_hours, b.rate_per_hour ?? 0]
      );
      packageId = pkg.insertId;
    }

    await audit(req.user!.userId, 'CONVERT', 'student', req.params.id,
      { student_type: 'Trial', form_no: before.form_no },
      { student_type: 'Enrolled', form_no: formNo, package_hours: b.package_hours ?? null });
    res.json({ ok: true, package_id: packageId, form_no: formNo, previous_form_no: before.form_no });
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
