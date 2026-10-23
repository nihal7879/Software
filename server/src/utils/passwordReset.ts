import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query, queryOne } from '../db';
import { passwordProblem } from './credentials';

/**
 * Forgot password — a code to the email on file, then a password the system
 * makes up.
 *
 * THE THING TO KNOW FIRST: users.email is the LOGIN NAME, not an address.
 * Most of them are "sachin.chawan" or "myra". The real address, where there is
 * one, sits on the student, parent or teacher record — which is why
 * contactEmailFor() exists and why the reset screen asks for the username.
 * Asking for an email would not work anyway: thirty addresses on file are shared
 * by more than one account (two children and their father on one Gmail), so an
 * address does not say whose password is being reset.
 *
 * Accounts with no address anywhere cannot be reset this way, and are told to
 * ask the office. Today that is most of them — including the admin and the super
 * admin, whose own logins have no email at all. Nothing here has to change as
 * the office fills those in: the address is looked up at the moment someone
 * asks, so an account starts working the day its email is entered.
 */

/** How long a code lives. Long enough to find the email, useless by evening. */
export const OTP_TTL_MINUTES = 10;
/** Wrong tries before the code is burnt. Six digits is a million guesses. */
export const MAX_ATTEMPTS = 5;
/** Codes one account may ask for in this many minutes. */
export const MAX_REQUESTS = 3;
export const REQUEST_WINDOW_MINUTES = 15;
/** And a ceiling per internet connection, for someone working through a list. */
export const MAX_REQUESTS_PER_IP = 12;
export const IP_WINDOW_MINUTES = 60;

export type ResetAccount = {
  id: number;
  role: string;
  username: string;
  display_name: string | null;
};

const looksLikeEmail = (v: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? '').trim());

/**
 * The one account this login name opens. Username only — it is the only thing
 * that is unique. A switched-off account resolves to nothing: a closed login is
 * not reopened by a reset.
 */
export async function accountForLogin(login: string): Promise<ResetAccount | null> {
  return queryOne<ResetAccount>(
    `SELECT id, role, email AS username, display_name
       FROM users WHERE email = ? AND is_active = TRUE AND is_deleted = FALSE`,
    [login.trim().toLowerCase()]
  );
}

/**
 * Where a code can be sent for this account, or null if there is nowhere.
 *
 * In order: the login itself when it happens to be a real address (seventy
 * parents' are), then the contact email on their own record. A student's and a
 * teacher's record is their own; a parent may be on several children's records
 * with the same address, so the first is taken.
 */
export async function contactEmailFor(user: ResetAccount): Promise<string | null> {
  if (looksLikeEmail(user.username)) return user.username.trim();
  const r = await queryOne<any>(
    // In order of how directly the address belongs to this account: their own,
    // then their parent's record, then the address the office keeps on the
    // student's own row. That last one is the family's, and for most students
    // it is the only address on file — so it is the difference between being
    // able to reset a password and having to ring the office.
    `SELECT COALESCE(
       (SELECT NULLIF(TRIM(s.email), '') FROM students s WHERE s.user_id = ? AND s.is_deleted = FALSE AND s.email LIKE '%@%' LIMIT 1),
       (SELECT NULLIF(TRIM(p.email), '') FROM parents  p WHERE p.user_id = ? AND p.is_deleted = FALSE AND p.email LIKE '%@%' LIMIT 1),
       (SELECT NULLIF(TRIM(t.email), '') FROM teachers t WHERE t.user_id = ? AND t.is_deleted = FALSE AND t.email LIKE '%@%' LIMIT 1),
       -- The parents' addresses on the student's own record. Ordered the way
       -- parent_mobile is chosen: the one the family named as the payer first,
       -- then whoever else is on the record. For most students this is the only
       -- address there is, so it decides whether a password can be reset at all.
       (SELECT NULLIF(TRIM(CASE s.relationship
                             WHEN 'Father'   THEN s.father_email
                             WHEN 'Mother'   THEN s.mother_email
                             WHEN 'Guardian' THEN s.guardian_email END), '')
          FROM students s WHERE s.user_id = ? AND s.is_deleted = FALSE LIMIT 1),
       (SELECT COALESCE(NULLIF(TRIM(s.father_email), ''), NULLIF(TRIM(s.mother_email), ''), NULLIF(TRIM(s.guardian_email), ''))
          FROM students s WHERE s.user_id = ? AND s.is_deleted = FALSE LIMIT 1),
       -- And the same two, for a parent login, through the child they are linked to.
       (SELECT NULLIF(TRIM(CASE s.relationship
                             WHEN 'Father'   THEN s.father_email
                             WHEN 'Mother'   THEN s.mother_email
                             WHEN 'Guardian' THEN s.guardian_email END), '')
          FROM students s JOIN parents p2 ON p2.student_id = s.id
         WHERE p2.user_id = ? AND p2.is_deleted = FALSE AND s.is_deleted = FALSE LIMIT 1),
       (SELECT COALESCE(NULLIF(TRIM(s.father_email), ''), NULLIF(TRIM(s.mother_email), ''), NULLIF(TRIM(s.guardian_email), ''))
          FROM students s JOIN parents p2 ON p2.student_id = s.id
         WHERE p2.user_id = ? AND p2.is_deleted = FALSE AND s.is_deleted = FALSE LIMIT 1)
     ) AS email`,
    [user.id, user.id, user.id, user.id, user.id, user.id, user.id]
  );
  const email = String(r?.email ?? '').trim();
  return looksLikeEmail(email) ? email : null;
}

/** "ahu***@gmail.com" — enough to recognise your own address, not to learn it. */
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!domain) return '***';
  const head = name.slice(0, Math.min(3, Math.max(1, name.length - 1)));
  return `${head}${'*'.repeat(3)}@${domain}`;
}

/** Six digits, from the crypto source — Math.random is guessable. */
export function makeOtp(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// Syllables rather than random characters: this password is read off a screen
// and typed on a phone, so "bakemotu481" beats "xK7#qp2Z". No l/1/0/O anywhere.
const ONSETS = ['b', 'd', 'f', 'g', 'h', 'j', 'k', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z'];
const VOWELS = ['a', 'e', 'i', 'o', 'u'];
const pick = <T,>(a: T[]) => a[crypto.randomInt(0, a.length)];

/**
 * A password the system makes up: three syllables and three digits, e.g.
 * "bakemotu481". It satisfies the same rules a person's own password must
 * (utils/credentials) — checked here rather than assumed, so a change to those
 * rules can never start handing out passwords the app would then refuse.
 *
 * It is shown once on screen and never emailed: the email carries the code only,
 * so an old mailbox is not a permanent key to the account. It is also temporary
 * by design — users.must_change_password makes the app insist on a new one at
 * the next sign-in, because this one is in a WhatsApp message within the hour.
 */
export function makePassword(username?: string | null): string {
  for (let i = 0; i < 20; i++) {
    const word = Array.from({ length: 3 }, () => pick(ONSETS) + pick(VOWELS)).join('');
    const candidate = `${word}${crypto.randomInt(100, 1000)}`;
    if (!passwordProblem(candidate, username)) return candidate;
  }
  // Unreachable in practice; never hand back something that failed the rules.
  return `stem${crypto.randomBytes(4).toString('hex')}${crypto.randomInt(10, 100)}`;
}

/** How many codes this account has asked for inside the window. */
export async function recentRequests(userId: number): Promise<number> {
  const r = await queryOne<any>(
    `SELECT COUNT(*) AS n FROM password_resets
      WHERE user_id = ? AND created_at > (NOW() - INTERVAL ? MINUTE)`,
    [userId, REQUEST_WINDOW_MINUTES]
  );
  return Number(r?.n || 0);
}

/** And from this connection, whatever account was named. */
export async function recentRequestsFromIp(ip: string | null): Promise<number> {
  if (!ip) return 0;
  const r = await queryOne<any>(
    `SELECT COUNT(*) AS n FROM password_resets
      WHERE requested_ip = ? AND created_at > (NOW() - INTERVAL ? MINUTE)`,
    [ip, IP_WINDOW_MINUTES]
  );
  return Number(r?.n || 0);
}

/**
 * Store a new code and retire any earlier one.
 *
 * Only the hash is kept. Asking again puts the previous row out of use in the
 * same breath, so the code in an older email stops working the moment a newer
 * one is sent — otherwise every email ever sent would stay a live key for ten
 * minutes each.
 */
export async function storeOtp(userId: number, otp: string, sentTo: string, ip: string | null, device: string | null) {
  await query('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [userId]);
  await query(
    `INSERT INTO password_resets (user_id, otp_hash, sent_to, expires_at, requested_ip, requested_device)
     VALUES (?,?,?, NOW() + INTERVAL ? MINUTE, ?,?)`,
    [userId, await bcrypt.hash(otp, 10), sentTo.slice(0, 255), OTP_TTL_MINUTES, ip, device?.slice(0, 255) ?? null]
  );
}

export type OtpCheck =
  | { ok: true; resetId: number }
  | { ok: false; error: string };

/**
 * Is this the code we sent? One wrong try is counted; the fifth burns the row,
 * so the next attempt is told to ask for a new code rather than being allowed to
 * keep guessing.
 */
export async function checkOtp(userId: number, otp: string): Promise<OtpCheck> {
  const row = await queryOne<any>(
    `SELECT id, otp_hash, attempts, expires_at < NOW() AS expired
       FROM password_resets
      WHERE user_id = ? AND used_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [userId]
  );
  if (!row) return { ok: false, error: 'That code is no longer valid. Please ask for a new one.' };
  if (Number(row.expired)) {
    await query('UPDATE password_resets SET used_at = NOW() WHERE id = ?', [row.id]);
    return { ok: false, error: `That code has expired — it is only good for ${OTP_TTL_MINUTES} minutes. Please ask for a new one.` };
  }
  if (await bcrypt.compare(otp, row.otp_hash)) return { ok: true, resetId: row.id };

  const attempts = Number(row.attempts) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await query('UPDATE password_resets SET attempts = ?, used_at = NOW() WHERE id = ?', [attempts, row.id]);
    return { ok: false, error: 'Too many wrong codes. Please ask for a new one.' };
  }
  await query('UPDATE password_resets SET attempts = ? WHERE id = ?', [attempts, row.id]);
  const left = MAX_ATTEMPTS - attempts;
  return { ok: false, error: `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` };
}
