import { Request, Response } from 'express';
import { query, queryOne } from '../db';

/**
 * Where the sign-in token lives: an httpOnly cookie.
 *
 * It used to be handed to the browser in the login reply and kept in
 * localStorage, where any script running on the page could read it — one
 * cross-site-scripting bug, and a fifteen-day admin session walks out of the
 * building. A cookie marked httpOnly is sent with every request by the browser
 * itself and is invisible to page scripts. (Security review S-07, Nov 2026.)
 *
 * SameSite=Lax keeps it off requests another site starts in the background, and
 * requireAuth additionally asks for the X-Requested-With header on anything that
 * changes data when the cookie is how the caller signed in — a header another
 * site's form cannot add. Secure everywhere but plain-http localhost.
 *
 * The app reaches the API on its own origin (the client's /api rewrite on
 * Vercel, Vite's proxy locally), so this is a first-party cookie. Pointing
 * VITE_API_URL at another domain would make it third-party and browsers would
 * drop it: keep it '/api'.
 */
export const SESSION_COOKIE = 'sv_session';

const secure = (req: Request) => req.secure || req.headers['x-forwarded-proto'] === 'https';

export function setSessionCookie(req: Request, res: Response, token: string, expSeconds: number) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secure(req),
    sameSite: 'lax',
    path: '/',
    maxAge: Math.max(0, expSeconds * 1000 - Date.now()),
  });
}

export function clearSessionCookie(req: Request, res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: secure(req), sameSite: 'lax', path: '/' });
}

/** The cookie's value, read by hand — one cookie does not need a parser. */
export function cookieToken(req: Request): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) {
      try { return decodeURIComponent(part.slice(i + 1).trim()) || null; } catch { return null; }
    }
  }
  return null;
}

/**
 * Signing out cancels the token itself, not only the browser's copy of it.
 *
 * Every token carries its own id (jti). Signing out records that id here until
 * the token would have expired anyway, and requireAuth refuses it. Only that
 * token: the same person's phone stays signed in when they sign out of the
 * office computer. A password change still ends every session at once, through
 * the token version. (Security review S-08, Nov 2026.)
 *
 * Checked on every request, so a "not revoked" answer is cached for half a
 * minute, like the token version (utils/tokenVersion.ts); a sign-out in this
 * process is seen at once, and by another running instance within 30 seconds.
 */
const CACHE_MS = 30_000;
const seen = new Map<string, { revoked: boolean; at: number }>();

export async function isRevoked(jti: string): Promise<boolean> {
  const hit = seen.get(jti);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.revoked;
  const row = await queryOne<any>('SELECT jti FROM revoked_tokens WHERE jti = ?', [jti]);
  const revoked = !!row;
  seen.set(jti, { revoked, at: Date.now() });
  if (seen.size > 5000) seen.clear(); // a long-lived instance must not grow without end
  return revoked;
}

export async function revokeToken(jti: string, userId: number, expSeconds: number) {
  await query(
    'INSERT IGNORE INTO revoked_tokens (jti, user_id, expires_at) VALUES (?, ?, FROM_UNIXTIME(?))',
    [jti, userId, expSeconds]
  );
  seen.set(jti, { revoked: true, at: Date.now() });
}
