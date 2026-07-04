import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { query, queryOne } from '../db';
import { requireAuth, requireRole, ensureOwnStudent } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { audit } from '../utils/audit';
import { clientIp, deviceInfo, getReqCtx } from '../utils/reqContext';

const router = Router();
router.use(requireAuth);

const studentSchema = z.object({
  // form_no is system-assigned (= the student's DB id); never entered manually.
  form_no: z.string().optional(),
  date_of_joining: z.string().nullable().optional(),
  status: z.enum(['Active', 'Inactive']).default('Active'),
  first_name: z.string().optional().nullable(),
  middle_name: z.string().optional().nullable(),
  last_name: z.string().optional().nullable(),
  year_grade: z.string().optional().nullable(),
  school_name: z.string().optional().nullable(),
  exam_board: z.string().optional().nullable(),
  father_name: z.string().optional().nullable(),
  mother_name: z.string().optional().nullable(),
  relationship: z.enum(['Father', 'Mother', 'Guardian']).optional(),
  email: z.string().email().optional().nullable().or(z.literal('')),
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
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await query(
      `SELECT * FROM students ${whereSql} ORDER BY CAST(form_no AS UNSIGNED) LIMIT ? OFFSET ?`,
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
    const student = await queryOne('SELECT * FROM students WHERE id = ?', [req.params.id]);
    if (!student) return res.status(404).json({ error: 'Student not found' });
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
    const creds = z.object({ password: z.string().min(6).optional() }).parse(req.body);

    // If an email + password are given, create the student's login account first.
    let userId: number | null = null;
    if (b.email && creds.password) {
      const exists = await queryOne<any>('SELECT id FROM users WHERE email = ?', [b.email]);
      if (exists) return res.status(409).json({ error: 'A user with this email already exists' });
      const hash = await bcrypt.hash(creds.password, 10);
      const ctx = getReqCtx();
      const gps = ctx?.lat != null && ctx?.lng != null ? `${ctx.lat},${ctx.lng}` : null;
      const u: any = await query(
        `INSERT INTO users (role, email, password_hash, display_name, registration_ip, registration_gps, registration_device)
         VALUES ('student', ?, ?, ?, ?, ?, ?)`,
        [b.email, hash, fullName(b) || b.email, clientIp(req), gps, deviceInfo(req)]
      );
      userId = (u as any).insertId;
    }

    // form_no is auto-assigned = DB id. Insert a temp unique value, then set it to the id.
    const result: any = await query(
      `INSERT INTO students
        (form_no,date_of_joining,status,first_name,middle_name,last_name,full_name,
         year_grade,school_name,exam_board,father_name,mother_name,relationship,
         email,dob,age,gender,nationality,student_mobile,parent_mobile,extra_mobile,
         fees_received,form_received,branch_id,user_id)
       VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        b.date_of_joining || null, b.status, b.first_name || null,
        b.middle_name || null, b.last_name || null, fullName(b), b.year_grade || null,
        b.school_name || null, b.exam_board || null, b.father_name || null,
        b.mother_name || null, b.relationship || 'Father', b.email || null, b.dob || null,
        b.age ?? null, b.gender || null, b.nationality || null, b.student_mobile || null,
        b.parent_mobile || null, b.extra_mobile || null, b.fees_received ?? 0,
        b.form_received ?? false, b.branch_id ?? null, userId,
      ]
    );
    const id = (result as any).insertId;
    await query('UPDATE students SET form_no = ? WHERE id = ?', [String(id), id]);
    await audit(req.user!.userId, 'CREATE', 'student', id, null, { ...b, password: undefined, form_no: String(id), login_created: !!userId });
    res.status(201).json({ id, form_no: String(id), login_created: !!userId });
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
    await audit(req.user!.userId, 'SET_STATUS', 'student', req.params.id, null, { status: b.status });
    res.json({ ok: true });
  })
);

// ARCHIVE (soft -> Inactive)
router.post(
  '/:id/archive',
  requireRole('admin'),
  wrap(async (req, res) => {
    await query("UPDATE students SET status = 'Inactive', is_active = FALSE WHERE id = ?", [req.params.id]);
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

    const cols: string[] = [];
    const params: any[] = [];
    const set = (c: string, v: any) => { cols.push(`${c} = ?`); params.push(v); };
    for (const [k, v] of Object.entries(b)) set(k, v as any);
    set('full_name', full_name);
    set('profile_completed', true);
    cols.push('profile_submitted_at = NOW()');
    params.push(req.params.id);

    await query(`UPDATE students SET ${cols.join(', ')} WHERE id = ?`, params);
    await audit(req.user!.userId, 'COMPLETE_PROFILE', 'student', req.params.id, before, b);
    res.json({ ok: true, profile_completed: true });
  })
);

export default router;
