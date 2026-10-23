import { query, queryOne } from '../db';

/**
 * Signing out every device — which a password reset has to do.
 *
 * The sign-in token is self-contained: nothing about a session is stored, so
 * there was never anything to cancel. A token copied off a device kept working
 * for a whole day after the password changed, which is the one thing a reset is
 * meant to stop. Each token now carries the account's version number, and a
 * reset raises it, leaving every token issued before that moment worthless.
 *
 * CHECKED ON EVERY REQUEST, so it is cached for half a minute. The database sits
 * on the office network while the API runs on Vercel, and a round trip added to
 * every single call is paid for by every screen in the app. The cost of the cache
 * is that a reset takes up to thirty seconds to push the other devices out —
 * which is nothing against the day it used to take. Within this process the
 * cache is cleared the instant the version is raised, so the delay only ever
 * applies to another running instance.
 */
const CACHE_MS = 30_000;
const cache = new Map<number, { version: number; at: number }>();

export async function currentTokenVersion(userId: number): Promise<number> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.version;
  const row = await queryOne<any>('SELECT token_version FROM users WHERE id = ?', [userId]);
  const version = Number(row?.token_version || 0);
  cache.set(userId, { version, at: Date.now() });
  return version;
}

/**
 * Raise it: every token already handed out for this account stops working.
 * Called when a password changes, by reset or in Settings.
 */
export async function bumpTokenVersion(userId: number): Promise<number> {
  await query('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [userId]);
  cache.delete(userId);
  return currentTokenVersion(userId);
}
