import { Router, Request } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool, query, queryOne } from '../db';
import { signToken } from '../utils/jwt';
import { requireAuth } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { audit } from '../utils/audit';
import { clientIp, deviceInfo } from '../utils/reqContext';

const router = Router();

// GPS comes from the browser as headers — combined into one "lat,lng" string.
const reqGps = (req: Request): string | null => {
  const lat = req.headers['x-gps-lat'];
  const lng = req.headers['x-gps-lng'];
  return lat && lng ? `${lat},${lng}` : null;
};

// Compute age from a YYYY-MM-DD date of birth.
function ageFromDob(dob?: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 120 ? age : null;
}

// Public: subjects list for the registration page (specialization dropdown).
router.get(
  '/subjects',
  wrap(async (_req, res) => {
    res.json({ data: await query('SELECT id, name FROM subjects WHERE is_deleted = FALSE ORDER BY name') });
  })
);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post(
  '/login',
  wrap(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await queryOne<any>(
      'SELECT * FROM users WHERE email = ? AND is_active = TRUE',
      [email]
    );
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    // Record where/when/what device this login happened on (+ audit trail).
    await query(
      'UPDATE users SET last_login_ip = ?, last_login_device = ?, last_login_at = NOW() WHERE id = ?',
      [clientIp(req), deviceInfo(req), user.id]
    );
    await audit(user.id, 'LOGIN', 'user', user.id, null, { email: user.email, role: user.role });

    // Resolve the scope record (student for student/parent, teacher for faculty).
    let studentId: number | null = null;
    let teacherId: number | null = null;
    if (user.role === 'student') {
      const s = await queryOne<any>('SELECT id FROM students WHERE user_id = ?', [user.id]);
      studentId = s?.id ?? null;
    } else if (user.role === 'parent') {
      const p = await queryOne<any>('SELECT student_id FROM parents WHERE user_id = ?', [user.id]);
      studentId = p?.student_id ?? null;
    } else if (user.role === 'faculty') {
      const t = await queryOne<any>('SELECT id FROM teachers WHERE user_id = ?', [user.id]);
      teacherId = t?.id ?? null;
    }

    const token = signToken({
      userId: user.id,
      role: user.role,
      email: user.email,
      studentId,
      teacherId,
    });

    res.json({
      token,
      user: {
        id: user.id,
        role: user.role,
        email: user.email,
        displayName: user.display_name,
        studentId,
        teacherId,
      },
    });
  })
);

// ---------------------------------------------------------------------------
// ROLE-BASED SELF-REGISTRATION (public). On the website the user picks a role:
//   • student → creates a student login + skeletal student record (completes
//     full profile later inside the panel).
//   • parent  → links to a child via the child's FORM NO (+ DOB verification),
//     creating a parents row → parent sees only that child.
//   • teacher → creates a faculty login + teacher record.
// ---------------------------------------------------------------------------
const registerSchema = z.object({
  role: z.enum(['student', 'parent', 'teacher']),
  email: z.string().email(),
  password: z.string().min(6),
  // common name
  first_name: z.string().optional().nullable(),
  last_name: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  mobile: z.string().optional().nullable(),
  // parent → child link + verification
  child_form_no: z.string().optional().nullable(),
  child_dob: z.string().optional().nullable(),
  relationship: z.enum(['Father', 'Mother', 'Guardian']).optional(),
  // teacher
  specialization: z.string().optional().nullable(),
  // optional GPS from the browser at registration
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
});

router.post(
  '/register',
  wrap(async (req, res) => {
    const b = registerSchema.parse(req.body);

    const exists = await queryOne<any>('SELECT id FROM users WHERE email = ?', [b.email]);
    if (exists) return res.status(409).json({ error: 'An account with this email already exists' });

    const ip = clientIp(req);
    const ua = deviceInfo(req);
    const gps = reqGps(req) ?? (b.lat != null && b.lng != null ? `${b.lat},${b.lng}` : null);
    const hash = await bcrypt.hash(b.password, 10);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // ---------------- STUDENT ----------------
      if (b.role === 'student') {
        if (!b.first_name) { await conn.rollback(); return res.status(400).json({ error: 'First name is required' }); }
        const fullName = [b.first_name, b.last_name].filter(Boolean).join(' ').trim();

        const [u]: any = await conn.query(
          `INSERT INTO users (role, email, password_hash, display_name, registration_ip, registration_gps, registration_device)
           VALUES ('student', ?, ?, ?, ?, ?, ?)`,
          [b.email, hash, fullName, ip, gps, ua]
        );
        // form_no is auto-assigned = the student's DB id (insert temp unique, then set to id).
        const [s]: any = await conn.query(
          `INSERT INTO students (form_no, status, first_name, last_name, full_name, email, user_id, profile_completed)
           VALUES (UUID(), 'Active', ?, ?, ?, ?, ?, FALSE)`,
          [b.first_name, b.last_name || null, fullName, b.email, u.insertId]
        );
        const formNo = String(s.insertId);
        await conn.query('UPDATE students SET form_no = ? WHERE id = ?', [formNo, s.insertId]);
        await conn.commit();
        await audit(u.insertId, 'REGISTER', 'user', u.insertId, null, { role: 'student', email: b.email, form_no: formNo });
        const token = signToken({ userId: u.insertId, role: 'student', email: b.email, studentId: s.insertId });
        return res.status(201).json({
          token,
          user: { id: u.insertId, role: 'student', email: b.email, displayName: fullName, studentId: s.insertId },
          form_no: formNo,
        });
      }

      // ---------------- PARENT (link by child Form No) ----------------
      if (b.role === 'parent') {
        if (!b.child_form_no) { await conn.rollback(); return res.status(400).json({ error: "Child's Form No is required to link your account" }); }
        const [[child]]: any = await conn.query('SELECT * FROM students WHERE form_no = ?', [b.child_form_no.trim()]);
        if (!child) { await conn.rollback(); return res.status(404).json({ error: `No student found with Form No ${b.child_form_no}` }); }
        // verification: if the student record has a DOB, it must match
        if (child.dob && b.child_dob && String(child.dob).slice(0, 10) !== b.child_dob.slice(0, 10)) {
          await conn.rollback();
          return res.status(403).json({ error: "Child's date of birth does not match our records" });
        }
        const parentName = b.name || [b.first_name, b.last_name].filter(Boolean).join(' ').trim() || 'Parent';
        const [u]: any = await conn.query(
          `INSERT INTO users (role, email, password_hash, display_name, registration_ip, registration_gps, registration_device)
           VALUES ('parent', ?, ?, ?, ?, ?, ?)`,
          [b.email, hash, parentName, ip, gps, ua]
        );
        await conn.query(
          `INSERT INTO parents (student_id, user_id, name, mobile, relationship) VALUES (?,?,?,?,?)`,
          [child.id, u.insertId, parentName, b.mobile || null, b.relationship || 'Father']
        );
        await conn.commit();
        await audit(u.insertId, 'REGISTER', 'user', u.insertId, null, { role: 'parent', email: b.email, child_id: child.id });
        const token = signToken({ userId: u.insertId, role: 'parent', email: b.email, studentId: child.id });
        return res.status(201).json({
          token,
          user: { id: u.insertId, role: 'parent', email: b.email, displayName: parentName, studentId: child.id },
          child: { form_no: child.form_no, name: child.full_name },
        });
      }

      // ---------------- TEACHER ----------------
      const teacherName = b.name || [b.first_name, b.last_name].filter(Boolean).join(' ').trim();
      if (!teacherName) { await conn.rollback(); return res.status(400).json({ error: 'Name is required' }); }
      const [u]: any = await conn.query(
        `INSERT INTO users (role, email, password_hash, display_name, registration_ip, registration_gps, registration_device)
         VALUES ('faculty', ?, ?, ?, ?, ?, ?)`,
        [b.email, hash, teacherName, ip, gps, ua]
      );
      const [t]: any = await conn.query(
        `INSERT INTO teachers (name, email, mobile, specialization, user_id) VALUES (?,?,?,?,?)`,
        [teacherName, b.email, b.mobile || null, b.specialization || null, u.insertId]
      );
      await conn.commit();
      await audit(u.insertId, 'REGISTER', 'user', u.insertId, null, { role: 'faculty', email: b.email });
      const token = signToken({ userId: u.insertId, role: 'faculty', email: b.email, teacherId: t.insertId });
      return res.status(201).json({
        token,
        user: { id: u.insertId, role: 'faculty', email: b.email, displayName: teacherName, teacherId: t.insertId },
      });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  })
);

router.get(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    const u = req.user!;
    const row = await queryOne<any>('SELECT id, role, email, display_name FROM users WHERE id = ?', [
      u.userId,
    ]);
    res.json({ ...row, studentId: u.studentId ?? null, teacherId: u.teacherId ?? null });
  })
);

router.post(
  '/change-password',
  requireAuth,
  wrap(async (req, res) => {
    const body = z
      .object({ currentPassword: z.string(), newPassword: z.string().min(6) })
      .parse(req.body);
    const user = await queryOne<any>('SELECT * FROM users WHERE id = ?', [req.user!.userId]);
    const ok = await bcrypt.compare(body.currentPassword, user.password_hash);
    if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(body.newPassword, 10);
    await query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);
    res.json({ ok: true });
  })
);

// Logout — token is cleared client-side; this records the event (IP/GPS/device) in the audit trail.
router.post(
  '/logout',
  requireAuth,
  wrap(async (req, res) => {
    await audit(req.user!.userId, 'LOGOUT', 'user', req.user!.userId, null, { email: req.user!.email });
    res.json({ ok: true });
  })
);

export default router;








