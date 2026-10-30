import { Router, Request } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { usernameProblem, passwordProblem } from '../utils/credentials';
import { sendMail, registrationAdminEmail, passwordOtpEmail, passwordChangedEmail } from '../utils/mailer';
import {
  accountForLogin, contactEmailFor, maskEmail, makeOtp, makePassword, storeOtp, checkOtp,
  recentRequests, recentRequestsFromIp,
  OTP_TTL_MINUTES, MAX_REQUESTS, REQUEST_WINDOW_MINUTES, MAX_REQUESTS_PER_IP,
} from '../utils/passwordReset';
import { bumpTokenVersion, currentTokenVersion } from '../utils/tokenVersion';
import { notify, adminUserIds } from '../utils/push';
import { z } from 'zod';
import { pool, query, queryOne } from '../db';
import { signToken } from '../utils/jwt';
import { requireAuth } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { loginBlocked, noteFailedLogin, clearFailedLogins } from '../utils/loginLimit';
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
  // A username (e.g. "sohel") or an email — see the SIGN-IN notes below.
  email: z.string().min(1),
  password: z.string().min(1),
});

// ---------------------------------------------------------------------------
// SIGN-IN — by username OR email.
//
// A username is unique, so it opens exactly one account. An email need not be:
// siblings may share their parent's address, and a parent with two children has
// a login for each. So an email is matched against every account that uses it
// (as the login itself, or as the contact email on a student, teacher or parent
// record), and only the ones whose PASSWORD matches are kept — nobody is ever
// shown an account they did not just prove they can open.
//
// One match signs straight in. Several — or one parent login linked to several
// children — returns a short list to choose from; picking one finishes sign-in
// through /login/select.
// ---------------------------------------------------------------------------
type LoginOption = { userId: number; studentId: number | null; role: string; label: string; sub: string };

// The choose-an-account pass is signed with its own secret, so requireAuth —
// which only accepts config.jwtSecret — can never mistake it for a sign-in
// token. It lives five minutes: long enough to pick, useless afterwards.
const selectSecret = () => `${config.jwtSecret}:account-select`;
const SELECT_TTL = '5m';

// Accounts this identifier + password can open. Capped, since each costs a bcrypt.
async function accountsFor(identifier: string, password: string): Promise<any[]> {
  const ids = new Set<number>();
  for (const r of await query<any>('SELECT id FROM users WHERE email = ?', [identifier])) ids.add(r.id);
  if (identifier.includes('@')) {
    const viaContact = await query<any>(
      `SELECT user_id AS id FROM students WHERE email = ? AND is_deleted = FALSE AND user_id IS NOT NULL
       UNION SELECT user_id FROM teachers WHERE email = ? AND is_deleted = FALSE AND user_id IS NOT NULL
       UNION SELECT user_id FROM parents  WHERE email = ? AND is_deleted = FALSE AND user_id IS NOT NULL`,
      [identifier, identifier, identifier]
    );
    for (const r of viaContact) ids.add(r.id);
  }
  if (ids.size === 0) return [];
  const users = await query<any>('SELECT * FROM users WHERE id IN (?) AND is_active = TRUE ORDER BY id LIMIT 10', [[...ids]]);
  const open: any[] = [];
  for (const u of users) if (await bcrypt.compare(password, u.password_hash)) open.push(u);
  return open;
}

// What each account lets you into. A parent gets one choice per linked child.
async function optionsFor(users: any[]): Promise<LoginOption[]> {
  const out: LoginOption[] = [];
  for (const u of users) {
    if (u.role === 'student') {
      const st = await queryOne<any>('SELECT id, full_name, form_no FROM students WHERE user_id = ?', [u.id]);
      out.push({ userId: u.id, studentId: st?.id ?? null, role: 'student', label: st?.full_name || u.display_name || u.email, sub: st ? `Student · Form ${st.form_no}` : 'Student' });
    } else if (u.role === 'parent') {
      const kids = await query<any>(
        `SELECT s.id, s.full_name, s.form_no FROM parents p JOIN students s ON s.id = p.student_id
          WHERE p.user_id = ? AND p.is_deleted = FALSE AND s.is_deleted = FALSE ORDER BY s.full_name`,
        [u.id]
      );
      if (kids.length === 0) out.push({ userId: u.id, studentId: null, role: 'parent', label: u.display_name || u.email, sub: 'Parent' });
      for (const k of kids) out.push({ userId: u.id, studentId: k.id, role: 'parent', label: k.full_name, sub: `Parent · Form ${k.form_no}` });
    } else {
      out.push({ userId: u.id, studentId: null, role: u.role, label: u.display_name || u.email, sub: u.role === 'faculty' ? 'Teacher' : 'Admin' });
    }
  }
  return out;
}

// Finish signing in as one account (and, for a parent, one child).
async function completeLogin(req: Request, res: any, userId: number, chosenStudentId: number | null) {
  const user = await queryOne<any>('SELECT * FROM users WHERE id = ? AND is_active = TRUE', [userId]);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  // Record where/when/what device this login happened on (+ audit trail).
  await query(
    'UPDATE users SET last_login_ip = ?, last_login_device = ?, last_login_at = NOW() WHERE id = ?',
    [clientIp(req), deviceInfo(req), user.id]
  );
  await audit(user.id, 'LOGIN', 'user', user.id, null, { email: user.email, role: user.role, student_id: chosenStudentId });

  // Resolve the scope record (student for student/parent, teacher for faculty).
  let studentId: number | null = null;
  let teacherId: number | null = null;
  if (user.role === 'student') {
    const s = await queryOne<any>('SELECT id FROM students WHERE user_id = ?', [user.id]);
    studentId = s?.id ?? null;
  } else if (user.role === 'parent') {
    // The chosen child — re-checked against this login's own links, so a pass
    // can only ever open a child this parent is actually linked to.
    const p = chosenStudentId != null
      ? await queryOne<any>('SELECT student_id FROM parents WHERE user_id = ? AND student_id = ? AND is_deleted = FALSE', [user.id, chosenStudentId])
      : await queryOne<any>('SELECT student_id FROM parents WHERE user_id = ? AND is_deleted = FALSE ORDER BY id LIMIT 1', [user.id]);
    studentId = p?.student_id ?? null;
  } else if (user.role === 'faculty') {
    const t = await queryOne<any>('SELECT id FROM teachers WHERE user_id = ?', [user.id]);
    teacherId = t?.id ?? null;
  }

  const token = signToken({
    userId: user.id, role: user.role, email: user.email, studentId, teacherId,
    tv: Number(user.token_version || 0),
  });
  return res.json({
    token,
    user: {
      id: user.id, role: user.role, email: user.email, displayName: user.display_name, studentId, teacherId,
      // Set when the password came out of a reset. The app then shows nothing
      // but the change-password screen until a password of their own is set.
      mustChangePassword: !!user.must_change_password,
    },
  });
}

router.post(
  '/login',
  wrap(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const identifier = email.trim();

    // Checked before the password is, so a blocked caller costs us a lookup
    // and not a bcrypt comparison. The machine is what is counted, never the
    // account — see utils/loginLimit.ts.
    const wait = await loginBlocked(clientIp(req), deviceInfo(req));
    if (wait > 0) {
      return res.status(429).json({
        error: `Too many failed sign-in attempts. Please wait ${Math.ceil(wait / 60)} minute${Math.ceil(wait / 60) === 1 ? '' : 's'} and try again, or contact the institute admin.`,
        retry_after_seconds: wait,
      });
    }

    let open = await accountsFor(identifier, password);

    // A student's email is optional as a way to sign in, and it only works while
    // it belongs to that one student. When brothers and sisters have the same
    // email on their records, it cannot tell them apart, so it is not accepted
    // for any of them — they sign in with their own username instead. A parent
    // is different: one parent email covering several children is expected, and
    // the child picker below handles it. The message is only given once the
    // password is right for one of those students, so a stranger typing the
    // email learns nothing about who uses it.
    if (identifier.includes('@')) {
      const studentLogins = await query<any>(
        `SELECT u.id FROM users u JOIN students s ON s.user_id = u.id
          WHERE s.is_deleted = FALSE AND u.is_active = TRUE AND (s.email = ? OR u.email = ?)`,
        [identifier, identifier]
      );
      if (studentLogins.length > 1) {
        const shared = new Set(studentLogins.map((r) => r.id));
        const studentMatched = open.some((u) => shared.has(u.id));
        open = open.filter((u) => !shared.has(u.id));
        if (open.length === 0 && studentMatched) {
          return res.status(409).json({
            error: 'This email is used by more than one student, so it cannot be used to sign in. Please sign in with your username.',
            code: 'EMAIL_SHARED',
          });
        }
      }
    }

    if (open.length === 0) {
      // A student who registered but has not been approved has no login yet.
      // Tell them why they cannot get in — but only once the password matches,
      // so the message never confirms to a stranger that an email is on file.
      // Found by the username they chose, or by their email — which siblings can
      // share, so every candidate is tried and the password picks the right one.
      const regs = await query<any>(
        `SELECT status, password_hash FROM student_registrations
          WHERE (username = ? OR email = ?) AND status <> 'Approved'
          ORDER BY id DESC LIMIT 10`,
        [identifier, identifier]
      );
      let reg: any = null;
      for (const r of regs) {
        if (await bcrypt.compare(password, r.password_hash)) { reg = r; break; }
      }
      if (reg) {
        return res.status(403).json({
          error: reg.status === 'Rejected'
            ? 'Your registration was not approved. Please contact the institute.'
            : 'Your registration is waiting for the administrator to confirm. You can sign in once it is approved.',
          registration_status: reg.status,
        });
      }
      // A switched-off account is dropped before the password is even compared,
      // so it used to fail with the same "Invalid credentials" as a wrong
      // password — sending people to hunt for a password problem that was not
      // there. Say what actually happened, but only once the password is right,
      // so a stranger still learns nothing about which usernames exist.
      const offAccounts = await query<any>(
        'SELECT password_hash FROM users WHERE email = ? AND is_active = FALSE AND is_deleted = FALSE LIMIT 5',
        [identifier]
      );
      for (const u of offAccounts) {
        if (await bcrypt.compare(password, u.password_hash)) {
          return res.status(403).json({
            error: 'This account has been switched off. Please contact the office.',
            code: 'ACCOUNT_DISABLED',
          });
        }
      }
      await noteFailedLogin(identifier, clientIp(req), deviceInfo(req));
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Got in: this machine's count goes, so a run of typos never follows
    // someone around. Other machines keep theirs.
    await clearFailedLogins(clientIp(req), deviceInfo(req));
    const options = await optionsFor(open);
    if (options.length === 1) return completeLogin(req, res, options[0].userId, options[0].studentId);

    // Several: hand back the list and a pass that can only finish one of them.
    const ticket = jwt.sign(
      { purpose: 'account-select', options: options.map((o) => ({ u: o.userId, s: o.studentId })) },
      selectSecret(),
      { expiresIn: SELECT_TTL }
    );
    return res.json({
      select: true,
      ticket,
      options: options.map((o, i) => ({ index: i, role: o.role, label: o.label, sub: o.sub })),
    });
  })
);

// Second step of a sign-in that matched several accounts: the chosen one.
router.post(
  '/login/select',
  wrap(async (req, res) => {
    const b = z.object({ ticket: z.string().min(1), index: z.number().int().min(0) }).parse(req.body);
    let payload: any;
    try {
      payload = jwt.verify(b.ticket, selectSecret());
    } catch {
      return res.status(401).json({ error: 'That sign-in has expired. Please sign in again.' });
    }
    const pick = payload?.purpose === 'account-select' ? payload.options?.[b.index] : null;
    if (!pick) return res.status(400).json({ error: 'Please choose one of the accounts shown.' });
    return completeLogin(req, res, Number(pick.u), pick.s == null ? null : Number(pick.s));
  })
);

// ---------------------------------------------------------------------------
// SELF-REGISTRATION (public) — one page per role. Everyone signs in with a
// username they choose; their email is a contact address and may be shared
// (siblings under one parent's email).
//   • student → a request only; an admin approves it as Trial or Enrolled, and
//     that creates the login + student record (see routes/registrations.ts).
//   • parent  → links to a child via the child's FORM NO (+ DOB verification),
//     creating a parents row → parent sees only that child.
//   • teacher → creates a faculty login + teacher record.
// ---------------------------------------------------------------------------
const registerSchema = z.object({
  role: z.enum(['student', 'parent', 'teacher']),
  // The login. Unique across every account; lower-cased so "Aarav" and "aarav"
  // are the same name. The rules themselves live in utils/credentials.ts.
  username: z
    .string()
    .trim()
    .toLowerCase()
    .superRefine((v, ctx) => { const p = usernameProblem(v); if (p) ctx.addIssue({ code: 'custom', message: p }); }),
  // student — a number the administrator can reach them on while verifying
  student_mobile: z.string().optional().nullable(),
  // A contact address — not the login, but also a way to sign in. Unique for a
  // student; a parent's may cover more than one child.
  email: z.string().trim().email(),
  password: z.string(),
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
}).superRefine((b, ctx) => {
  const p = passwordProblem(b.password, b.username);
  if (p) ctx.addIssue({ code: 'custom', path: ['password'], message: p });
});

// Public: is this username free? The registration pages ask while the person
// types, so a taken name is flagged at once rather than after the whole form is
// filled in. "Taken" means a live login, or a request still waiting for approval
// — the same two things /register refuses. Registration re-checks on submit, so
// this is a convenience, never the guarantee.
router.get(
  '/username-available',
  wrap(async (req, res) => {
    const username = String(req.query.username || '').trim().toLowerCase();
    const problem = usernameProblem(username);
    if (problem) return res.json({ username, available: false, reason: 'invalid', message: problem });
    const taken =
      (await queryOne<any>('SELECT id FROM users WHERE email = ?', [username])) ||
      (await queryOne<any>("SELECT id FROM student_registrations WHERE username = ? AND status = 'Pending'", [username]));
    res.json({ username, available: !taken, reason: taken ? 'taken' : null });
  })
);

router.post(
  '/register',
  wrap(async (req, res) => {
    const b = registerSchema.parse(req.body);

    // The username is the login, so it is what must be unique — across live
    // accounts and requests still waiting for approval alike.
    const taken =
      (await queryOne<any>('SELECT id FROM users WHERE email = ?', [b.username])) ||
      (await queryOne<any>("SELECT id FROM student_registrations WHERE username = ? AND status = 'Pending'", [b.username]));
    if (taken) {
      return res.status(409).json({ error: `The username "${b.username}" is already taken. Please choose another.`, code: 'USERNAME_TAKEN' });
    }

    const ip = clientIp(req);
    const ua = deviceInfo(req);
    const gps = reqGps(req) ?? (b.lat != null && b.lng != null ? `${b.lat},${b.lng}` : null);
    const hash = await bcrypt.hash(b.password, 10);

    // ---------------- STUDENT → a request for the administrator ----------------
    // No login and no student record yet: the admin approves the request and
    // chooses Trial or Enrolled (see routes/registrations.ts). Until then the
    // student cannot sign in, and the login route tells them why.
    if (b.role === 'student') {
      const first = b.first_name?.trim();
      if (!first) return res.status(400).json({ error: 'First name is required' });
      // A student's email is their own — a brother and sister each have one — so
      // an email already on a waiting request, a student record or a login means
      // this person is already registered. (Only a parent's email covers more
      // than one child; see the sign-in chooser.)
      const pending = await queryOne<any>(
        "SELECT id FROM student_registrations WHERE email = ? AND status = 'Pending'",
        [b.email]
      );
      if (pending) {
        return res.status(409).json({
          error: 'This email has already been used to register. It is waiting for the administrator to confirm — you can sign in once it is approved.',
          code: 'REGISTRATION_PENDING',
        });
      }
      const onFile =
        (await queryOne<any>('SELECT id FROM students WHERE email = ? AND is_deleted = FALSE LIMIT 1', [b.email])) ||
        (await queryOne<any>('SELECT id FROM users WHERE email = ?', [b.email]));
      if (onFile) {
        return res.status(409).json({
          error: 'This email is already registered to a student. Please sign in, or contact the office if you do not have your sign-in details.',
          code: 'EMAIL_REGISTERED',
        });
      }
      const r: any = await query(
        `INSERT INTO student_registrations
          (first_name, last_name, email, username, mobile, password_hash, registration_ip, registration_gps, registration_device)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [first, b.last_name?.trim() || null, b.email, b.username, b.student_mobile?.trim() || null, hash, ip, gps, ua]
      );
      await audit(undefined, 'REGISTER_REQUEST', 'student_registration', r.insertId, null, { username: b.username, email: b.email });
      // Tell the admin someone is waiting. Awaited, because on Vercel the function
      // can be frozen as soon as the response goes out, cutting off an email
      // still being sent. sendMail never throws — a mail failure is recorded in
      // email_log and the registration still succeeds.
      const mail = registrationAdminEmail({ first_name: first, last_name: b.last_name, username: b.username, email: b.email, mobile: b.student_mobile });
      await sendMail({ kind: 'registration_admin', to: config.mail.adminNotify, ...mail });
      // And a notification on whatever device the office has allowed one on.
      // Nobody sits watching the Registrations page, and a request waiting
      // unseen is a student who cannot sign in.
      await notify(await adminUserIds(), {
        kind: 'registration_new',
        title: 'New student registration',
        body: `${[first, b.last_name].filter(Boolean).join(' ')} is waiting to be approved.`,
        url: '/admin/registrations',
      });
      return res.status(201).json({ pending: true, id: r.insertId });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

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
        // users.email is the login column; it holds the username.
        const [u]: any = await conn.query(
          `INSERT INTO users (role, email, password_hash, display_name, registration_ip, registration_gps, registration_device)
           VALUES ('parent', ?, ?, ?, ?, ?, ?)`,
          [b.username, hash, parentName, ip, gps, ua]
        );
        await conn.query(
          `INSERT INTO parents (student_id, user_id, name, email, mobile, relationship) VALUES (?,?,?,?,?,?)`,
          // Null when the parent didn't pick one — better unknown than assumed father.
          [child.id, u.insertId, parentName, b.email, b.mobile || null, b.relationship || null]
        );
        await conn.commit();
        await audit(u.insertId, 'REGISTER', 'user', u.insertId, null, { role: 'parent', username: b.username, email: b.email, child_id: child.id });
        const token = signToken({ userId: u.insertId, role: 'parent', email: b.username, studentId: child.id });
        return res.status(201).json({
          token,
          user: { id: u.insertId, role: 'parent', email: b.username, displayName: parentName, studentId: child.id },
          child: { form_no: child.form_no, name: child.full_name },
        });
      }

      // ---------------- TEACHER ----------------
      const teacherName = b.name || [b.first_name, b.last_name].filter(Boolean).join(' ').trim();
      if (!teacherName) { await conn.rollback(); return res.status(400).json({ error: 'Name is required' }); }
      const [u]: any = await conn.query(
        `INSERT INTO users (role, email, password_hash, display_name, registration_ip, registration_gps, registration_device)
         VALUES ('faculty', ?, ?, ?, ?, ?, ?)`,
        [b.username, hash, teacherName, ip, gps, ua]
      );
      const [t]: any = await conn.query(
        `INSERT INTO teachers (name, email, mobile, specialization, user_id) VALUES (?,?,?,?,?)`,
        [teacherName, b.email, b.mobile || null, b.specialization || null, u.insertId]
      );
      await conn.commit();
      await audit(u.insertId, 'REGISTER', 'user', u.insertId, null, { role: 'faculty', username: b.username, email: b.email });
      const token = signToken({ userId: u.insertId, role: 'faculty', email: b.username, teacherId: t.insertId });
      return res.status(201).json({
        token,
        user: { id: u.insertId, role: 'faculty', email: b.username, displayName: teacherName, teacherId: t.insertId },
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
    const row = await queryOne<any>(
      'SELECT id, role, email, display_name, must_change_password FROM users WHERE id = ?',
      [u.userId]
    );
    res.json({
      ...row,
      studentId: u.studentId ?? null,
      teacherId: u.teacherId ?? null,
      // Read from the row, not the token: a reset done on another device has to
      // reach this one too.
      mustChangePassword: !!row?.must_change_password,
    });
  })
);

router.post(
  '/change-password',
  requireAuth,
  wrap(async (req, res) => {
    const body = z
      .object({ currentPassword: z.string(), newPassword: z.string() })
      .parse(req.body);
    const user = await queryOne<any>('SELECT * FROM users WHERE id = ?', [req.user!.userId]);
    // A new password meets today's rules, even on a login made before them.
    const weak = passwordProblem(body.newPassword, user?.email);
    if (weak) return res.status(400).json({ error: weak });
    const ok = await bcrypt.compare(body.currentPassword, user.password_hash);
    if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(body.newPassword, 10);
    // must_change_password is cleared here: the reset handed out a password the
    // system made up, and this is the person replacing it with their own.
    await query('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [hash, user.id]);
    await finishPasswordChange(user, req.user!.userId);

    // Raising the version turned off every token for this account — including
    // the one this request arrived with. A fresh one goes back, so the device
    // that did the changing stays signed in and every other device does not.
    const token = signToken({
      userId: user.id, role: user.role, email: user.email,
      studentId: req.user!.studentId ?? null, teacherId: req.user!.teacherId ?? null,
      tv: await currentTokenVersion(user.id),
    });
    res.json({ ok: true, token });
  })
);

// ---------------------------------------------------------------------------
// FORGOT PASSWORD — a code to the email on file, then a password we make up.
//
// Both steps are public, which is what shapes them:
//
//   • The answer is the same whether the login exists or not. A different reply
//     for "no such account" is a way to find out which logins are real.
//   • Three codes per account per quarter hour, and a ceiling per connection.
//     Without a cap this is a free way to send mail from the institute's address.
//   • The code is stored as a hash and dies after five wrong tries. Six digits is
//     a million guesses, which a script makes in minutes.
//
// The one deliberate exception to the first rule: an account with no email
// anywhere is told so, and told to ring the office. That does confirm the login
// exists — but today most accounts have no address on file, and leaving those
// families at a screen that says a code is coming when none ever will is worse.
// See utils/passwordReset.ts for where an address is looked for.
// ---------------------------------------------------------------------------

// The same words whatever happened, so nothing is learned from which one comes
// back. Not "we have sent" — we may not have.
const SENT_MESSAGE = 'If that login exists and has an email saved, a code has been sent to it.';

router.post(
  '/forgot',
  wrap(async (req, res) => {
    const b = z.object({ username: z.string().trim().min(1).max(120) }).parse(req.body);
    const ip = clientIp(req);

    // The per-connection ceiling is checked before anything is looked up, so it
    // also covers someone walking through a list of guessed usernames.
    if (await recentRequestsFromIp(ip) >= MAX_REQUESTS_PER_IP) {
      return res.status(429).json({ error: 'Too many requests from this connection. Please try again later, or contact the institute admin.' });
    }

    const user = await accountForLogin(b.username);
    if (!user) return res.json({ sent: true, message: SENT_MESSAGE });

    if (await recentRequests(user.id) >= MAX_REQUESTS) {
      return res.status(429).json({
        error: `A code has already been sent ${MAX_REQUESTS} times in the last ${REQUEST_WINDOW_MINUTES} minutes. Please check your email, or try again shortly.`,
      });
    }

    const to = await contactEmailFor(user);
    if (!to) {
      return res.status(400).json({
        code: 'NO_EMAIL',
        error: 'There is no email saved for this login. Please contact the institute admin to get a new password.',
      });
    }

    const otp = makeOtp();
    await storeOtp(user.id, otp, to, ip, deviceInfo(req));
    const mail = passwordOtpEmail({ otp, minutes: OTP_TTL_MINUTES });
    // Awaited: on Vercel the function can be frozen the moment the response goes
    // out, which would cut off an email still being sent. sendMail never throws.
    const result = await sendMail({ kind: 'password_otp', to, ...mail });
    // The code itself is never written to the audit log — it would be a password
    // in plain text sitting in a table anyone with the log can read.
    await audit(user.id, 'PASSWORD_RESET_REQUEST', 'user', user.id, null, {
      username: user.username, sent_to: maskEmail(to), email_status: result.status,
    });

    // A mail server that refused is worth saying plainly — the person would
    // otherwise sit waiting for a code that was never going to arrive.
    if (result.status !== 'sent') {
      return res.status(502).json({
        error: 'The code could not be emailed just now. Please contact the institute admin.',
        code: 'MAIL_FAILED',
      });
    }
    res.json({ sent: true, message: SENT_MESSAGE, sent_to: maskEmail(to) });
  })
);

router.post(
  '/forgot/reset',
  wrap(async (req, res) => {
    const b = z
      .object({
        username: z.string().trim().min(1).max(120),
        // Generous about what arrives: people paste the code with a space in it.
        otp: z.string().trim().transform((v) => v.replace(/\D/g, '')),
      })
      .parse(req.body);

    const user = await accountForLogin(b.username);
    // Same words as a wrong code: whether the login exists is not answered here
    // either. Someone who got this far already knows their own username.
    const nope = { error: 'That code is no longer valid. Please ask for a new one.' };
    if (!user) return res.status(400).json(nope);

    const check = await checkOtp(user.id, b.otp);
    if (!check.ok) return res.status(400).json({ error: check.error });

    // The code was right. The password is made here and shown once on the reply —
    // never emailed, so an old mailbox is not a permanent key to the account.
    const password = makePassword(user.username);
    const hash = await bcrypt.hash(password, 10);
    await query(
      'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
      [hash, user.id]
    );
    await query('UPDATE password_resets SET used_at = NOW() WHERE id = ?', [check.resetId]);
    await finishPasswordChange(user as any, user.id);

    res.json({
      ok: true,
      username: user.username,
      password,
      // Said on the screen as well as enforced: the next sign-in asks for a
      // password of their own.
      must_change: true,
    });
  })
);

/**
 * The three things that follow any password change, by reset or in Settings:
 * every other device is signed out, it goes in the audit log, and the person is
 * told by email — which is how a family notices a change they did not make.
 *
 * Neither password, old or new, is written anywhere but the hash column.
 */
async function finishPasswordChange(user: { id: number; email?: string; username?: string }, actorId: number) {
  const username = user.email || user.username || '';
  await bumpTokenVersion(user.id);
  await audit(actorId, 'PASSWORD_CHANGE', 'user', user.id, null, {
    username,
    by: actorId === user.id ? 'the account holder' : 'another user',
  });
  const when = new Date().toLocaleString('en-GB', {
    timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const to = await contactEmailFor({ id: user.id, role: '', username, display_name: null });
  if (to) await sendMail({ kind: 'password_changed', to, ...passwordChangedEmail({ username, when: `${when} (Dubai)` }) });
}

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








