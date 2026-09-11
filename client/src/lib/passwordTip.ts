import { passwordProblem, PASSWORD_MIN } from './credentials';

/**
 * What to change in a password that is too simple, as a suggestion — or null
 * once it meets the rules. Shown only while there is something to fix, so a
 * good password gets no text under it at all.
 */
export function passwordTip(pw: string, username?: string): string | null {
  if (!pw) return null;
  if (!passwordProblem(pw, username)) return null;
  const u = String(username ?? '').trim().toLowerCase();
  if (/\s/.test(pw)) return 'Remove the spaces.';
  if (u.length >= 3 && pw.toLowerCase().includes(u)) return 'Too easy to guess — leave your username out of it.';
  const hasLetter = /[a-z]/i.test(pw);
  const hasNumber = /[0-9]/.test(pw);
  if (!hasLetter && !hasNumber) return `Too simple — use at least ${PASSWORD_MIN} characters with letters and a number.`;
  if (!hasNumber) return 'Too simple — add a number, e.g. Sky2026.';
  if (!hasLetter) return 'Too simple — add some letters, not just numbers.';
  if (pw.length < PASSWORD_MIN) return `Almost — make it at least ${PASSWORD_MIN} characters.`;
  return `Use ${PASSWORD_MIN}–64 characters.`;
}
