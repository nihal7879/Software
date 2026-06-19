import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { signToken } from '../utils/jwt';
import { requireAuth } from '../middleware/auth';
import { wrap } from '../middleware/error';

const router = Router();

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

    // Resolve the student this user is scoped to (student or parent).
    let studentId: number | null = null;
    if (user.role === 'student') {
      const s = await queryOne<any>('SELECT id FROM students WHERE user_id = ?', [user.id]);
      studentId = s?.id ?? null;
    } else if (user.role === 'parent') {
      const p = await queryOne<any>('SELECT student_id FROM parents WHERE user_id = ?', [user.id]);
      studentId = p?.student_id ?? null;
    }

    const token = signToken({
      userId: user.id,
      role: user.role,
      email: user.email,
      studentId,
    });

    res.json({
      token,
      user: {
        id: user.id,
        role: user.role,
        email: user.email,
        displayName: user.display_name,
        studentId,
      },
    });
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
    res.json({ ...row, studentId: u.studentId ?? null });
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

export default router;
