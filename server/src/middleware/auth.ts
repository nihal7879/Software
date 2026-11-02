import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload, Role } from '../utils/jwt';
import { currentTokenVersion } from '../utils/tokenVersion';
import { cookieToken, isRevoked } from '../utils/session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  // The httpOnly session cookie first (utils/session.ts). A Bearer header is
  // still read so a browser signed in before the move to cookies is not thrown
  // out: its first /auth/me hands it a cookie and it stops sending the header.
  const header = req.headers.authorization;
  const fromCookie = cookieToken(req);
  const raw = fromCookie || (header?.startsWith('Bearer ') ? header.slice(7) : null);
  if (!raw) return res.status(401).json({ error: 'Please sign in.' });

  // A cookie rides along with any request the browser makes, including one
  // another site starts. So when the cookie is what signed this request in,
  // anything that changes data must also carry X-Requested-With — a header a
  // form or image on another site cannot add, and the app always sends.
  if (fromCookie && !SAFE_METHODS.has(req.method) && req.headers['x-requested-with'] !== 'XMLHttpRequest') {
    return res.status(403).json({ error: 'This request was refused. Please reload the page and try again.' });
  }

  let payload: JwtPayload;
  try {
    payload = verifyToken(raw);
  } catch {
    return res.status(401).json({ error: 'Your session has ended. Please sign in again.' });
  }
  try {
    // Signed out on this device: that one token is cancelled (S-08).
    if (payload.jti && (await isRevoked(payload.jti))) {
      return res.status(401).json({ error: 'You have signed out. Please sign in again.' });
    }
    // Changing a password signs every device out — see utils/tokenVersion.ts.
    // A token from before the change carries a lower number and is refused here,
    // not merely cleared from the browser that did the changing.
    if ((payload.tv ?? 0) < (await currentTokenVersion(payload.userId))) {
      return res.status(401).json({ error: 'Your password was changed. Please sign in again.' });
    }
  } catch (e) {
    // The database is unreachable. Refusing every signed-in request would take
    // the whole app down over a check; the token's own signature and expiry
    // still stand, so the request goes on and this is noted.
    console.error('token version check failed', e);
  }
  req.user = payload;
  next();
}

/**
 * The super admin is an admin with more, not a role beside it: it clears every
 * check that asks for 'admin' without any of those fifty checks being rewritten.
 * The few things an admin must NOT reach ask for the super admin explicitly,
 * with requireSuperAdmin below.
 */
export function allows(roles: Role[], role: Role) {
  return roles.includes(role) || (role === 'superadmin' && roles.includes('admin'));
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    if (!allows(roles, req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

/** For what only the super admin may see — the money overview and the pivots. */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Forbidden: super admin only' });
  }
  next();
}

// Student & parent may only access their own student record.
export function ensureOwnStudent(req: Request, res: Response, next: NextFunction) {
  const u = req.user!;
  // Not faculty. Every route behind this is a family's own record — their
  // payments, balance, contacts — and a teacher let through here could read
  // any family's, though no screen of theirs ever asks. A teacher's view of
  // their students comes from /teachers/me/…, which checks the assignment and
  // leaves the money out. (Security review S-02, Nov 2026.)
  if (u.role === 'admin' || u.role === 'superadmin') return next();
  const requested = Number(req.params.id ?? req.query.studentId ?? req.body?.student_id);
  if (u.studentId && requested && u.studentId === requested) return next();
  return res.status(403).json({ error: 'Forbidden: not your record' });
}
