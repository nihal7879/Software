import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload, Role } from '../utils/jwt';
import { currentTokenVersion } from '../utils/tokenVersion';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  let payload: JwtPayload;
  try {
    payload = verifyToken(header.slice(7));
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  try {
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
  if (u.role === 'admin' || u.role === 'superadmin' || u.role === 'faculty') return next();
  const requested = Number(req.params.id ?? req.query.studentId ?? req.body?.student_id);
  if (u.studentId && requested && u.studentId === requested) return next();
  return res.status(403).json({ error: 'Forbidden: not your record' });
}
