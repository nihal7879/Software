// The rules for a username and a password — the same checks the server makes,
// run here so the form can say what is wrong while the person types.
//
// MIRRORED from server/src/utils/credentials.ts, which is the one that actually
// decides. Change both together.
//
// They apply when a username or password is SET. Existing logins are never
// re-checked, so nobody is locked out by a rule that arrived after them.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;

// A username is a handle, not an address. Email providers are refused anywhere
// in it ("aarav.gmail", "gmailaarav"), and a domain ending is refused as the last
// part ("aarav.com") — the email has its own box.
const EMAIL_PROVIDERS = ['gmail', 'googlemail', 'yahoo', 'ymail', 'hotmail', 'outlook', 'icloud', 'rediffmail', 'protonmail'];
const DOMAIN_ENDINGS = ['com', 'in', 'net', 'org', 'co', 'ae', 'edu', 'gov', 'io', 'info', 'biz', 'uk', 'us'];

/** What is wrong with this username, or null if it is acceptable. Expects it trimmed + lower-cased. */
export function usernameProblem(u: string): string | null {
  if (u.length < USERNAME_MIN || u.length > USERNAME_MAX) return `Username must be ${USERNAME_MIN}–${USERNAME_MAX} characters.`;
  if (u.includes('@')) return 'A username cannot contain @ — put your email in the Email box.';
  if (!/^[a-z0-9._]+$/.test(u)) return 'Use only lowercase letters, numbers, dot (.) and underscore (_) — no spaces.';
  if (!/^[a-z]/.test(u)) return 'Username must start with a letter.';
  if (/[._]$/.test(u)) return 'Username cannot end with . or _';
  if (/[._]{2}/.test(u)) return 'Username cannot have two symbols in a row.';
  if (EMAIL_PROVIDERS.some((p) => u.includes(p))) return 'A username cannot contain an email provider (like gmail) — put your email in the Email box.';
  const last = u.split('.').pop()!;
  if (u.includes('.') && DOMAIN_ENDINGS.includes(last)) return `A username cannot end in .${last} — it is not an email address.`;
  return null;
}

/** What is wrong with this password, or null if it is acceptable. */
export function passwordProblem(pw: string, username?: string | null): string | null {
  if (pw.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (pw.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
  if (/\s/.test(pw)) return 'Password cannot contain spaces.';
  if (!/[a-z]/i.test(pw)) return 'Password must include at least one letter.';
  if (!/[0-9]/.test(pw)) return 'Password must include at least one number.';
  const u = String(username ?? '').trim().toLowerCase();
  if (u.length >= USERNAME_MIN && !u.includes('@') && pw.toLowerCase().includes(u)) return 'Password cannot contain your username.';
  return null;
}
